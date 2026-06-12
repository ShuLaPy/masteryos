import { type NextRequest } from "next/server";
import { createHash } from "crypto";
import { formatInTimeZone } from "date-fns-tz";
import { createClient } from "@/lib/supabase/server";
import { generateText } from "@/lib/openai";

// ─── Types ─────────────────────────────────────────────────────────────────

/** Shape persisted in lecture_schedules.bridge_cache */
interface BridgeCache {
  synthesis: string;
  generated_at: string;
}

type LectureRow = {
  id: string;
  title: string;
  week_number: number;
  scheduled_date: string;
  extracted_concept_ids: string[] | null;
  prerequisite_concept_ids: string[] | null;
  bridge_cache: BridgeCache | null;
  bridge_cache_key: string | null;
  updated_at: string;
  pretest: unknown;
  pretest_attempt: unknown;
  pretest_taken_at: string | null;
};

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Validate an IANA timezone via Intl; fall back to UTC (spec §9.4). */
function resolveTimeZone(tz: unknown): string {
  if (typeof tz === "string" && tz.length > 0) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return tz;
    } catch {
      // fall through
    }
  }
  return "UTC";
}

/**
 * Build the content-aware cache key (spec §10.4 / AGENTS.md).
 *
 * key = sha256(
 *   most_recent.extracted_concept_ids.sort().join(',') + '|' + most_recent.updated_at +
 *   '|' + next.prerequisite_concept_ids.sort().join(',') + '|' + prereqConceptsVersion
 * )
 *
 * prereqConceptsVersion is "id:created_at,…" sorted by id — closest available
 * proxy for concept content version since aiml_concepts has no updated_at column.
 */
function buildCacheKey(
  mostRecent: LectureRow | null,
  next: LectureRow | null,
  prereqConceptsVersion: string
): string {
  const recentIds = [...(mostRecent?.extracted_concept_ids ?? [])].sort().join(",");
  const recentUpdated = mostRecent?.updated_at ?? "";
  const nextPrereqIds = [...(next?.prerequisite_concept_ids ?? [])].sort().join(",");
  // The next lecture's pretest feeds the prompt context, so its version must
  // invalidate the cache too — otherwise a pre-pretest bridge would serve stale.
  const nextPretestVersion = `${next?.pretest_taken_at ?? ""}:${
    (next?.pretest as { generated_at?: string } | null)?.generated_at ?? ""
  }`;
  const raw = `${recentIds}|${recentUpdated}|${nextPrereqIds}|${prereqConceptsVersion}|${nextPretestVersion}`;
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Render the next lecture's taken pretest as extra prompt context, so the
 * bridge can speak to what the student wondered about before the lecture.
 */
function buildPretestContext(next: LectureRow | null): string {
  if (!next || !next.pretest_taken_at) return "";
  const questions = (next.pretest as { questions?: { q?: unknown }[] } | null)
    ?.questions;
  const answers = (
    next.pretest_attempt as {
      answers?: { index?: unknown; answer?: unknown; self_grade?: unknown }[];
    } | null
  )?.answers;
  if (!Array.isArray(questions) || !Array.isArray(answers) || answers.length === 0) {
    return "";
  }
  const lines = answers
    .filter((a) => typeof a?.index === "number" && questions[a.index as number])
    .map(
      (a) =>
        `- Q: ${String(questions[a.index as number]?.q ?? "")}\n` +
        `  Student's guess: ${String(a.answer ?? "(blank)")} ` +
        `(self-graded: ${String(a.self_grade ?? "unknown")})`
    );
  if (lines.length === 0) return "";
  return (
    `\n\nBefore this lecture the student attempted a pretest:\n${lines.join("\n")}\n` +
    `Where relevant, address their guesses — confirm what they got right and ` +
    `correct what they got wrong.`
  );
}

// ─── AI prompt builders ────────────────────────────────────────────────────

function buildBothPrompt(
  mostRecent: LectureRow,
  next: LectureRow,
  recentConceptNames: string,
  prereqConceptNames: string
): { systemPrompt: string; userMessage: string } {
  const systemPrompt =
    "You are an expert AI tutor synthesizing a Bridge Document between two lectures. " +
    "Write in clear, well-structured Markdown. Focus on structural and mathematical " +
    "throughlines — how the concepts build on each other. Be concrete and precise.";
  const userMessage =
    `Most recent lecture (Week ${mostRecent.week_number}): "${mostRecent.title}"\n` +
    `Concepts covered: ${recentConceptNames || "(none logged yet)"}\n\n` +
    `Upcoming lecture (Week ${next.week_number}): "${next.title}"\n` +
    `Prerequisites required: ${prereqConceptNames || "(none listed)"}\n\n` +
    `Write a Bridge Document that:\n` +
    `1. Identifies the structural and mathematical links from the recent lecture's concepts to the next lecture's prerequisites\n` +
    `2. Highlights 2–3 key throughlines the student should keep in mind\n` +
    `3. Ends with a short "What to solidify before ${next.title}" checklist\n\n` +
    `Format in Markdown. Be concise and precise.`;
  return { systemPrompt, userMessage };
}

function buildNextOnlyPrompt(
  next: LectureRow,
  prereqConceptNames: string
): { systemPrompt: string; userMessage: string } {
  const systemPrompt =
    "You are an expert AI tutor writing a preparatory overview to help a student " +
    "prepare for an upcoming lecture. Write in clear, well-structured Markdown.";
  const userMessage =
    `Upcoming lecture (Week ${next.week_number}): "${next.title}"\n` +
    `Prerequisites required: ${prereqConceptNames || "(none listed)"}\n\n` +
    `Write a Preparatory Overview that:\n` +
    `1. Briefly explains each prerequisite concept and why it matters for this lecture\n` +
    `2. Highlights how the prerequisites connect to each other\n` +
    `3. Ends with a short "Key things to know before lecture" checklist\n\n` +
    `Format in Markdown. Be concise and precise.`;
  return { systemPrompt, userMessage };
}

function buildRecentOnlyPrompt(
  mostRecent: LectureRow,
  recentConceptNames: string
): { systemPrompt: string; userMessage: string } {
  const systemPrompt =
    "You are an expert AI tutor writing a concluding synthesis of a recent lecture. " +
    "Write in clear, well-structured Markdown.";
  const userMessage =
    `Most recent lecture (Week ${mostRecent.week_number}): "${mostRecent.title}"\n` +
    `Concepts covered: ${recentConceptNames || "(none logged yet)"}\n\n` +
    `Write a Concluding Summary that:\n` +
    `1. Synthesizes the key concepts from this lecture into a coherent narrative\n` +
    `2. Identifies the most important structural or mathematical ideas to remember\n` +
    `3. Suggests 2–3 questions to test understanding\n\n` +
    `Format in Markdown. Be concise and precise.`;
  return { systemPrompt, userMessage };
}

// ─── Route ─────────────────────────────────────────────────────────────────

/**
 * GET /api/lectures/bridge
 *
 * Query params (all optional):
 *   most_recent_id — ID of the most-recently attended lecture
 *   next_id        — ID of the next upcoming lecture
 *
 * When neither param is provided the route auto-detects Next_Lecture and
 * Most_Recent_Lecture from the authenticated user's schedule (same rules as
 * the planning engine: earliest un-attended on/after today for next; latest
 * attended on/before today for most-recent).
 *
 * Returns:
 *   { data: { synthesis: string; generated_at: string; cached?: true }, error: null }
 *   { data: { message: string }, error: null }   — for no-lecture and AI-fail cases
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  // ── Resolve timezone for "today" ─────────────────────────────────────────
  const { data: profile } = await supabase
    .from("users")
    .select("settings")
    .eq("id", user.id)
    .single();
  const settings = (profile?.settings ?? {}) as { timezone?: unknown };
  const timeZone = resolveTimeZone(settings.timezone);
  const today = formatInTimeZone(new Date(), timeZone, "yyyy-MM-dd");

  // ── Resolve lecture IDs ───────────────────────────────────────────────────
  const url = new URL(request.url);
  let mostRecentId = url.searchParams.get("most_recent_id");
  let nextId = url.searchParams.get("next_id");

  if (!mostRecentId && !nextId) {
    // Auto-detect from the user's full schedule
    const { data: schedules } = await supabase
      .from("lecture_schedules")
      .select("id, scheduled_date, week_number, is_attended")
      .eq("user_id", user.id)
      .order("scheduled_date", { ascending: true })
      .order("week_number", { ascending: true });

    const all = schedules ?? [];
    const nextLecture = all.find((s) => s.scheduled_date >= today && !s.is_attended);
    const attendedPast = all.filter((s) => s.scheduled_date <= today && s.is_attended);
    const mostRecentLecture = attendedPast.at(-1);

    nextId = nextLecture?.id ?? null;
    mostRecentId = mostRecentLecture?.id ?? null;
  }

  // Neither exists → spec mandates this exact response; no AI call
  if (!mostRecentId && !nextId) {
    return Response.json({ data: { message: "no lectures scheduled" }, error: null });
  }

  // ── Load lecture rows (RLS-scoped to user) ────────────────────────────────
  const idsToLoad = [mostRecentId, nextId].filter(Boolean) as string[];
  const { data: lectures } = await supabase
    .from("lecture_schedules")
    .select(
      "id, title, week_number, scheduled_date, extracted_concept_ids, prerequisite_concept_ids, bridge_cache, bridge_cache_key, updated_at, pretest, pretest_attempt, pretest_taken_at"
    )
    .eq("user_id", user.id)
    .in("id", idsToLoad);

  const lectureMap = new Map(
    ((lectures ?? []) as unknown as LectureRow[]).map((l) => [l.id, l])
  );
  const mostRecent = mostRecentId ? (lectureMap.get(mostRecentId) ?? null) : null;
  const next = nextId ? (lectureMap.get(nextId) ?? null) : null;

  if (!mostRecent && !next) {
    return Response.json({ data: { message: "no lectures scheduled" }, error: null });
  }

  // ── Build prereq concept version string for the cache key ─────────────────
  // aiml_concepts has no updated_at, so we use "id:created_at" sorted by id
  // as the closest available content-version signal.
  const prereqIds = next?.prerequisite_concept_ids ?? [];
  let prereqConceptsVersion = "";
  if (prereqIds.length > 0) {
    const { data: prereqConcepts } = await supabase
      .from("aiml_concepts")
      .select("id, created_at")
      .eq("user_id", user.id)
      .in("id", prereqIds);
    prereqConceptsVersion = (prereqConcepts ?? [])
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((c) => `${c.id}:${c.created_at}`)
      .join(",");
  }

  // ── Cache check (content-aware key per spec §10.4) ────────────────────────
  const cacheKey = buildCacheKey(mostRecent, next, prereqConceptsVersion);
  // Store/check on "next" if it exists, else on mostRecent
  const primaryLecture = next ?? mostRecent!;

  if (
    primaryLecture.bridge_cache_key === cacheKey &&
    primaryLecture.bridge_cache?.synthesis
  ) {
    return Response.json({
      data: { ...primaryLecture.bridge_cache, cached: true },
      error: null,
    });
  }

  // ── Load concept titles for the AI prompt ─────────────────────────────────
  const allConceptIds = Array.from(
    new Set([
      ...(mostRecent?.extracted_concept_ids ?? []),
      ...(next?.prerequisite_concept_ids ?? []),
    ])
  );
  const conceptTitleMap = new Map<string, string>();
  if (allConceptIds.length > 0) {
    const { data: concepts } = await supabase
      .from("aiml_concepts")
      .select("id, title")
      .eq("user_id", user.id)
      .in("id", allConceptIds);
    (concepts ?? []).forEach((c) => conceptTitleMap.set(c.id, c.title));
  }

  const recentConceptNames = (mostRecent?.extracted_concept_ids ?? [])
    .map((id) => conceptTitleMap.get(id) ?? id)
    .join(", ");
  const prereqConceptNames = (next?.prerequisite_concept_ids ?? [])
    .map((id) => conceptTitleMap.get(id) ?? id)
    .join(", ");

  // ── Select AI prompt variation (spec §8) ──────────────────────────────────
  let promptParts: { systemPrompt: string; userMessage: string };
  if (mostRecent && next) {
    promptParts = buildBothPrompt(mostRecent, next, recentConceptNames, prereqConceptNames);
  } else if (!mostRecent && next) {
    promptParts = buildNextOnlyPrompt(next, prereqConceptNames);
  } else {
    promptParts = buildRecentOnlyPrompt(mostRecent!, recentConceptNames);
  }

  const { data: synthesis, error: aiError } = await generateText(
    promptParts.systemPrompt,
    promptParts.userMessage + buildPretestContext(next),
    1500
  );

  // AI failure → return message, NOT an error status (spec §8)
  if (aiError || !synthesis) {
    return Response.json({
      data: { message: "synthesis could not be generated" },
      error: null,
    });
  }

  // ── Persist cache on the primary lecture ──────────────────────────────────
  const cachePayload: BridgeCache = {
    synthesis,
    generated_at: new Date().toISOString(),
  };
  // Best-effort — a cache write failure does not prevent returning the result
  await supabase
    .from("lecture_schedules")
    .update({ bridge_cache: cachePayload, bridge_cache_key: cacheKey })
    .eq("id", primaryLecture.id)
    .eq("user_id", user.id);

  return Response.json({ data: cachePayload, error: null });
}
