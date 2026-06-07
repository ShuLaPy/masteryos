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

interface ExtractedConcept {
  name: string;
  definition: string;
  front: string;
  back: string;
}

interface IngestionResult {
  concepts: ExtractedConcept[];
}

interface UserSettings {
  timezone?: unknown;
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

// POST /api/lectures/[id]/attend
//
// Two variants:
//   • No `material` in body  → Part 1: mark the lecture attended (awaiting upload).
//   • { material: string }   → Part 2: AI ingestion pipeline (spec §6/§8, Req 6) —
//     extract concepts, dedup into the graph, create seed cards, regenerate plan.
export async function POST(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  // Body is optional for the attend-state variant; tolerate empty/invalid JSON.
  let body: { material?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const material =
    typeof body?.material === "string" ? body.material.trim() : "";
  const hasMaterial = material.length > 0;

  // Verify the lecture exists and belongs to the current user
  const { data: lecture, error: fetchError } = await supabase
    .from("lecture_schedules")
    .select("id, is_attended, extracted_concept_ids")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (fetchError || !lecture) {
    return Response.json({ data: null, error: "Not found" }, { status: 404 });
  }

  // ── Variant A: attend-state only (Part 1) ───────────────────────────────────
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
      .update({ is_attended: true, updated_at: new Date().toISOString() })
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

  // ── Variant B: AI ingestion pipeline (Part 2) ───────────────────────────────

  // Idempotent re-ingestion: concepts already extracted → don't duplicate cards.
  if ((lecture.extracted_concept_ids ?? []).length > 0) {
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

  // 1. Extract concepts + flashcard content via gpt-4o.
  const { data: extraction } = await generateJSON<IngestionResult>(
    "You are an expert AI tutor who extracts core concepts from lecture material and writes spaced-repetition flashcards.",
    `Extract 3–5 distinct core concepts from this lecture material and generate ` +
      `front-and-back flashcard content for each. Return JSON: ` +
      `{ "concepts": [{ "name", "definition", "front", "back" }] }\n\n` +
      `Lecture material:\n${material}`
  );

  // 2. Validate: keep only well-formed, distinct (by name) concepts.
  const seenNames = new Set<string>();
  const concepts: ExtractedConcept[] = (extraction?.concepts ?? [])
    .filter(
      (c): c is ExtractedConcept =>
        !!c &&
        typeof c.name === "string" &&
        c.name.trim().length > 0 &&
        typeof c.front === "string" &&
        c.front.trim().length > 0 &&
        typeof c.back === "string" &&
        c.back.trim().length > 0
    )
    .filter((c) => {
      const key = c.name.trim().toLowerCase();
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
    const name = c.name.trim();
    const definition = c.definition?.trim() ?? "";
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

  // 4. Create one seed card per concept (user-scoped client → RLS).
  const dbCards = concepts.map((c, i) => ({
    user_id: user.id,
    card_type: "concept",
    front: c.front.trim(),
    back: c.back.trim(),
    source_type: "aiml_concept",
    source_id: resolvedConceptIds[i],
    ...fsrsCardToDB(newCard()),
    due: dueToday, // due today in the user's timezone (overrides newCard default)
  }));

  const { error: cardsError } = await supabase.from("srs_cards").insert(dbCards);
  if (cardsError) {
    return Response.json(
      { data: null, error: `Failed to create cards: ${cardsError.message}` },
      { status: 500 }
    );
  }

  // 5. Record raw material + extracted concept ids on the lecture.
  const { error: lectureUpdateError } = await supabase
    .from("lecture_schedules")
    .update({
      is_attended: true,
      notes: material,
      extracted_concept_ids: resolvedConceptIds,
      updated_at: new Date().toISOString(),
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

  // 7. Return ingestion summary.
  return Response.json({
    data: {
      lectureId: lecture.id,
      conceptsExtracted: resolvedConceptIds.length,
      cardsCreated: dbCards.length,
      planRegenerated,
    },
    error: null,
  });
}
