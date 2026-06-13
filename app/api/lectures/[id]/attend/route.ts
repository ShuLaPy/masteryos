import { NextRequest } from "next/server";
import crypto from "crypto";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateJSON, generateEmbedding } from "@/lib/openai";
import { newCard, fsrsCardToDB } from "@/lib/fsrs";

type RouteContext = { params: Promise<{ id: string }> };

// Concept dedup threshold (AGENTS.md §"Concept dedup on ingestion" / spec §8).
const DEDUP_SIMILARITY_THRESHOLD = 0.85;
const MIN_DISTINCT_CONCEPTS = 3; // spec §6 / Req 6 — retryable below this
const MIN_CARDS_PER_CONCEPT = 2;

// Free-recall comparison outcome per concept (forgetting-curve capture loop).
type RecallStatus = "recalled" | "partial" | "missed" | "distorted" | "n/a";
const RECALL_STATUSES: RecallStatus[] = [
  "recalled",
  "partial",
  "missed",
  "distorted",
  "n/a",
];

// Card depth levels, in seeding order — definition first, example last.
const CARD_LEVELS = ["definition", "application", "connection", "example"];

interface ExtractedCard {
  front: string;
  back: string;
  level: string;
}

interface ExtractedConcept {
  name: string;
  definition: string;
  recall_status: RecallStatus;
  recall_note: string;
  cards: ExtractedCard[];
}

interface IngestionResult {
  concepts: ExtractedConcept[];
}

// Shape stored in lecture_schedules.gap_analysis (jsonb).
interface GapAnalysisEntry {
  concept_id: string;
  name: string;
  status: RecallStatus;
  note: string;
}

interface UserSettings {
  timezone?: unknown;
}

interface PretestData {
  questions?: { q?: unknown; model_answer?: unknown }[];
}

interface PretestAttemptData {
  answers?: { index?: unknown; answer?: unknown; self_grade?: unknown }[];
}

/** Validate an IANA timezone via Intl; fall back to UTC (spec §9.4, AGENTS.md). */
function resolveTimeZone(tz: unknown): string {
  if (typeof tz === "string" && tz.length > 0) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return tz;
    } catch {
      // fall through to UTC
    }
  }
  return "UTC";
}

/** How many seed cards a concept earns: weaker recall → more cards. */
function seedCardCount(status: RecallStatus): number {
  switch (status) {
    case "missed":
    case "distorted":
      return 4;
    case "partial":
      return 3;
    default: // recalled, n/a
      return 2;
  }
}

/** Order cards definition → application → connection → example (unknown levels last). */
function orderCardsByLevel(cards: ExtractedCard[]): ExtractedCard[] {
  return [...cards].sort((a, b) => {
    const ai = CARD_LEVELS.indexOf(a.level);
    const bi = CARD_LEVELS.indexOf(b.level);
    return (ai === -1 ? CARD_LEVELS.length : ai) - (bi === -1 ? CARD_LEVELS.length : bi);
  });
}

/** Render the taken pretest as prompt context so ingestion can close the loop. */
function buildPretestContext(pretest: unknown, attempt: unknown): string {
  const questions = (pretest as PretestData | null)?.questions;
  const answers = (attempt as PretestAttemptData | null)?.answers;
  if (!Array.isArray(questions) || !Array.isArray(answers) || answers.length === 0) {
    return "";
  }
  const lines = answers
    .filter((a) => typeof a?.index === "number" && questions[a.index as number])
    .map((a) => {
      const q = questions[a.index as number];
      return `- Q: ${String(q?.q ?? "")}\n  Student's pre-lecture answer: ${String(
        a.answer ?? "(blank)"
      )} (self-graded: ${String(a.self_grade ?? "unknown")})`;
    });
  if (lines.length === 0) return "";
  return (
    `\n\nBefore the lecture the student attempted these pretest questions:\n` +
    lines.join("\n") +
    `\nWhere an extracted concept answers one of these questions, mention it in that ` +
    `concept's "recall_note" (e.g. "answers your pretest question about X").`
  );
}

// POST /api/lectures/[id]/attend
//
// Three variants (capture loop — free recall before notes):
//   • No body fields          → mark the lecture attended (awaiting capture).
//   • { brain_dump: string }  → Step 1: store the student's free recall, written
//     WITHOUT notes. Must happen before ingestion.
//   • { material: string }    → Step 2: AI ingestion pipeline (spec §6/§8, Req 6) —
//     extract concepts, compare against the brain dump (gap analysis), dedup into
//     the graph, seed 2–4 multi-level cards per concept (more for missed concepts),
//     regenerate the plan.
export async function POST(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  // Body is optional for the attend-state variant; tolerate empty/invalid JSON.
  let body: { material?: unknown; brain_dump?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const material =
    typeof body?.material === "string" ? body.material.trim() : "";
  const hasMaterial = material.length > 0;
  const brainDumpInput =
    typeof body?.brain_dump === "string" ? body.brain_dump.trim() : "";

  // Verify the lecture exists and belongs to the current user
  const { data: lecture, error: fetchError } = await supabase
    .from("lecture_schedules")
    .select(
      "id, is_attended, attended_at, extracted_concept_ids, brain_dump, pretest, pretest_attempt"
    )
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (fetchError || !lecture) {
    return Response.json({ data: null, error: "Not found" }, { status: 404 });
  }

  const nowIso = new Date().toISOString();
  // attended_at anchors the 24h/72h/7d reinforcement windows — set once, never shift.
  const attendedAt = lecture.attended_at ?? nowIso;
  const alreadyIngested = (lecture.extracted_concept_ids ?? []).length > 0;

  // ── Variant: brain dump only (capture Step 1) ───────────────────────────────
  if (!hasMaterial && brainDumpInput.length > 0) {
    // Free recall is only meaningful before the notes are ingested.
    if (alreadyIngested) {
      return Response.json(
        {
          data: null,
          error: "material already ingested; brain dump must come first",
        },
        { status: 409 }
      );
    }

    const { error: updateError } = await supabase
      .from("lecture_schedules")
      .update({
        is_attended: true,
        attended_at: attendedAt,
        brain_dump: brainDumpInput,
        brain_dump_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", id)
      .eq("user_id", user.id);

    if (updateError) {
      return Response.json(
        { data: null, error: updateError.message },
        { status: 500 }
      );
    }

    return Response.json({
      data: {
        lectureId: lecture.id,
        brainDumpSaved: true,
        awaitingMaterial: true,
      },
      error: null,
    });
  }

  // ── Variant A: attend-state only ────────────────────────────────────────────
  if (!hasMaterial) {
    // Idempotent re-attend: already attended → no duplicate cards, no re-trigger
    if (lecture.is_attended) {
      return Response.json({
        data: {
          lectureId: lecture.id,
          alreadyAttended: true,
          message: "already attended, no changes made",
        },
        error: null,
      });
    }

    const { error: updateError } = await supabase
      .from("lecture_schedules")
      .update({
        is_attended: true,
        attended_at: attendedAt,
        updated_at: nowIso,
      })
      .eq("id", id)
      .eq("user_id", user.id);

    if (updateError) {
      return Response.json(
        { data: null, error: updateError.message },
        { status: 500 }
      );
    }

    return Response.json({
      data: { lectureId: lecture.id, awaitingUpload: true },
      error: null,
    });
  }

  // ── Variant B: AI ingestion pipeline (capture Step 2) ───────────────────────

  // Idempotent re-ingestion: concepts already extracted → don't duplicate cards.
  if (alreadyIngested) {
    return Response.json({
      data: {
        lectureId: lecture.id,
        alreadyIngested: true,
        conceptsExtracted: lecture.extracted_concept_ids?.length ?? 0,
        cardsCreated: 0,
        message: "material already ingested, no changes made",
      },
      error: null,
    });
  }

  // Brain dump from this request wins over a previously stored one.
  const brainDump = brainDumpInput.length > 0 ? brainDumpInput : (lecture.brain_dump ?? "").trim();
  const hasBrainDump = brainDump.length > 0;

  // 1. Single AI pass: extract concepts + compare against free recall + write
  //    multi-level cards. 5 concepts × 4 cards exceeds 2048 tokens → 4096 + gpt-5.4.
  const pretestContext = buildPretestContext(
    lecture.pretest,
    lecture.pretest_attempt
  );
  const { data: extraction } = await generateJSON<IngestionResult>(
    "You are an expert AI tutor. You extract core concepts from lecture material, " +
    "compare them against the student's free-recall brain dump, and write " +
    "multi-level spaced-repetition flashcards.",
    `Extract 3–5 distinct core concepts from the lecture material below.\n` +
    `For each concept return:\n` +
    `- "name" and "definition"\n` +
    `- "recall_status": compare the concept against the student's brain dump — ` +
    `"recalled" (present and accurate), "partial" (mentioned but incomplete), ` +
    `"missed" (absent), "distorted" (present but wrong). ` +
    `If no brain dump is provided, use "n/a" for every concept.\n` +
    `- "recall_note": one sentence on what was missing or wrong (empty string if recalled)\n` +
    `- "cards": exactly 4 flashcards spanning levels — one "definition", ` +
    `one "application" (why/when it's used), one "connection" (link to a ` +
    `prerequisite or adjacent concept), one "example" (worked example or edge case).\n` +
    `Return JSON: { "concepts": [{ "name", "definition", "recall_status", ` +
    `"recall_note", "cards": [{ "front", "back", "level" }] }] }` +
    pretestContext +
    `\n\nStudent's brain dump (free recall, written without notes):\n` +
    (hasBrainDump ? brainDump : "(none provided)") +
    `\n\nLecture material:\n${material}`,
    4096,
    "gpt-5.4"
  );

  // 2. Validate: keep only well-formed, distinct (by name) concepts with ≥2 cards.
  const seenNames = new Set<string>();
  const concepts: ExtractedConcept[] = (extraction?.concepts ?? [])
    .map((c) => {
      if (!c || typeof c.name !== "string" || c.name.trim().length === 0) {
        return null;
      }
      const cards = (Array.isArray(c.cards) ? c.cards : []).filter(
        (card): card is ExtractedCard =>
          !!card &&
          typeof card.front === "string" &&
          card.front.trim().length > 0 &&
          typeof card.back === "string" &&
          card.back.trim().length > 0
      );
      if (cards.length < MIN_CARDS_PER_CONCEPT) return null;
      const status: RecallStatus =
        hasBrainDump && RECALL_STATUSES.includes(c.recall_status)
          ? c.recall_status
          : hasBrainDump
            ? "missed" // brain dump given but AI returned junk status → treat as gap
            : "n/a";
      return {
        name: c.name.trim(),
        definition: typeof c.definition === "string" ? c.definition.trim() : "",
        recall_status: status,
        recall_note: typeof c.recall_note === "string" ? c.recall_note.trim() : "",
        cards: orderCardsByLevel(cards),
      };
    })
    .filter((c): c is ExtractedConcept => c !== null)
    .filter((c) => {
      const key = c.name.toLowerCase();
      if (seenNames.has(key)) return false;
      seenNames.add(key);
      return true;
    });

  // AI failed or produced too few concepts → persist nothing, stay retryable.
  if (concepts.length < MIN_DISTINCT_CONCEPTS) {
    return Response.json(
      { data: null, error: "ingestion did not produce enough concepts" },
      { status: 422 }
    );
  }

  // Resolve "today" in the user's timezone for card due dates (spec §9.4).
  const { data: profile } = await supabase
    .from("users")
    .select("settings")
    .eq("id", user.id)
    .single();
  const timeZone = resolveTimeZone((profile?.settings as UserSettings)?.timezone);
  const today = formatInTimeZone(new Date(), timeZone, "yyyy-MM-dd");
  const dueToday = fromZonedTime(`${today}T00:00:00`, timeZone).toISOString();

  // 3. Dedup step — resolve each extracted concept to an aiml_concepts id.
  // Concept + embedding writes use the admin client (privileged graph growth);
  // dedup lookups go through match_concepts (security definer, user-scoped).
  const admin = createAdminClient();
  const resolvedConceptIds: string[] = [];

  for (const c of concepts) {
    const name = c.name;
    const definition = c.definition;
    const embeddingContent = [name, definition].filter(Boolean).join("\n");

    const { data: embedding } = await generateEmbedding(embeddingContent);

    // 3b. Look for an existing concept above the similarity threshold.
    let matchedId: string | null = null;
    if (embedding) {
      const { data: matches } = await admin.rpc("match_concepts", {
        query_embedding: JSON.stringify(embedding),
        match_count: 1,
        match_user_id: user.id,
      });
      const top = matches?.[0];
      if (
        top &&
        top.source_type === "aiml_concept" &&
        top.similarity > DEDUP_SIMILARITY_THRESHOLD
      ) {
        matchedId = top.source_id;
      }
    }

    if (matchedId) {
      // 3c. Reuse the existing concept (don't duplicate the graph node).
      resolvedConceptIds.push(matchedId);
      continue;
    }

    // 3d. New concept → insert the aiml_concepts row + its embedding.
    const { data: newConcept, error: conceptError } = await admin
      .from("aiml_concepts")
      .insert({
        user_id: user.id,
        title: name,
        notes: definition || null,
        source: "lecture",
        prerequisites: [],
      })
      .select("id")
      .single();

    if (conceptError || !newConcept) {
      return Response.json(
        { data: null, error: "Failed to persist extracted concept" },
        { status: 500 }
      );
    }

    if (embedding) {
      const contentHash = crypto
        .createHash("sha256")
        .update(embeddingContent)
        .digest("hex");
      await admin.from("concept_embeddings").insert({
        user_id: user.id,
        source_type: "aiml_concept",
        source_id: newConcept.id,
        content_hash: contentHash,
        embedding: JSON.stringify(embedding),
      });
    }

    resolvedConceptIds.push(newConcept.id);
  }

  // 4. Seed cards — weaker recall earns more cards (missed 4, partial 3, else 2),
  //    taken in level order (definition → application → connection → example).
  const dbCards = concepts.flatMap((c, i) =>
    c.cards.slice(0, seedCardCount(c.recall_status)).map((card) => ({
      user_id: user.id,
      card_type: "concept",
      front: card.front.trim(),
      back: card.back.trim(),
      source_type: "aiml_concept",
      source_id: resolvedConceptIds[i],
      ...fsrsCardToDB(newCard()),
      due: dueToday, // due today in the user's timezone (overrides newCard default)
    }))
  );

  const { error: cardsError } = await supabase.from("srs_cards").insert(dbCards);
  if (cardsError) {
    return Response.json(
      { data: null, error: `Failed to create cards: ${cardsError.message}` },
      { status: 500 }
    );
  }

  // 5. Record material, extracted concept ids, and gap analysis on the lecture.
  //    gap_analysis stores RESOLVED concept ids (post-dedup) so the planning
  //    engine can match boosts to cards by source_id.
  const gapEntries: GapAnalysisEntry[] = concepts.map((c, i) => ({
    concept_id: resolvedConceptIds[i],
    name: c.name,
    status: c.recall_status,
    note: c.recall_note,
  }));

  const { error: lectureUpdateError } = await supabase
    .from("lecture_schedules")
    .update({
      is_attended: true,
      attended_at: attendedAt,
      notes: material,
      ...(brainDumpInput.length > 0
        ? { brain_dump: brainDumpInput, brain_dump_at: nowIso }
        : {}),
      extracted_concept_ids: resolvedConceptIds,
      gap_analysis: hasBrainDump
        ? { analyzed_at: nowIso, concepts: gapEntries }
        : null,
      updated_at: nowIso,
    })
    .eq("id", id)
    .eq("user_id", user.id);

  if (lectureUpdateError) {
    return Response.json(
      { data: null, error: lectureUpdateError.message },
      { status: 500 }
    );
  }

  // 6. Regenerate today's plan so new Immediate Recall cards surface immediately.
  // Best-effort: forward auth cookies to the internal endpoint; never block on it.
  let planRegenerated = false;
  try {
    const res = await fetch(new URL("/api/plans/generate", req.url), {
      method: "POST",
      headers: { cookie: req.headers.get("cookie") ?? "" },
    });
    planRegenerated = res.ok;
  } catch {
    // Plan regeneration is non-critical to ingestion success.
  }

  // 7. Return ingestion summary (+ recall gap breakdown when a brain dump exists).
  const gapSummary = hasBrainDump
    ? gapEntries.reduce(
      (acc, e) => {
        if (e.status === "recalled") acc.recalled += 1;
        else if (e.status === "partial") acc.partial += 1;
        else if (e.status === "distorted") acc.distorted += 1;
        else acc.missed += 1;
        return acc;
      },
      { recalled: 0, partial: 0, missed: 0, distorted: 0 }
    )
    : null;

  return Response.json({
    data: {
      lectureId: lecture.id,
      conceptsExtracted: resolvedConceptIds.length,
      cardsCreated: dbCards.length,
      gapSummary,
      planRegenerated,
    },
    error: null,
  });
}
