import { NextRequest } from "next/server";
import { createHash } from "crypto";
import { fromZonedTime } from "date-fns-tz";
import { createClient } from "@/lib/supabase/server";
import { generateJSON } from "@/lib/openai";

type RouteContext = { params: Promise<{ id: string }> };

// Pretest unlocks in the final 48h before the lecture (pretesting effect:
// answering before exposure primes encoding — wrong answers are expected).
const UNLOCK_WINDOW_HOURS = 48;
const MIN_QUESTIONS = 3;
const MAX_QUESTIONS = 8;
const BRIDGE_EXCERPT_CHARS = 1500;

const SELF_GRADES = ["got_it", "partial", "no_idea"] as const;
type SelfGrade = (typeof SELF_GRADES)[number];

/** Shape persisted in lecture_schedules.pretest (jsonb). */
interface PretestData {
  generated_at: string;
  cache_key: string;
  questions: { q: string; model_answer: string }[];
}

/** Shape persisted in lecture_schedules.pretest_attempt (jsonb). */
interface PretestAttempt {
  taken_at: string;
  answers: { index: number; answer: string; self_grade: SelfGrade }[];
}

interface PretestGeneration {
  questions: { q?: unknown; model_answer?: unknown }[];
}

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

/** Narrow jsonb → PretestData (null on unknown shape). */
function asPretest(v: unknown): PretestData | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Partial<PretestData>;
  if (typeof o.cache_key !== "string" || !Array.isArray(o.questions)) return null;
  return o as PretestData;
}

/**
 * Content-aware key (mirrors the bridge route's buildCacheKey): regenerate the
 * pretest when the lecture title or prerequisite set/content changes.
 */
function buildPretestCacheKey(
  title: string,
  prereqIds: string[],
  prereqConceptsVersion: string
): string {
  const raw = `${title}|${[...prereqIds].sort().join(",")}|${prereqConceptsVersion}`;
  return createHash("sha256").update(raw).digest("hex");
}

// ─── GET /api/lectures/[id]/pretest ─────────────────────────────────────────
//
// Returns the pretest for an upcoming lecture, generating + caching it when the
// lecture is within the 48h unlock window. Same GET-that-writes pattern as the
// bridge route — the cache write is best-effort.
export async function GET(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { data: lecture, error: fetchError } = await supabase
    .from("lecture_schedules")
    .select(
      "id, title, week_number, scheduled_date, prerequisite_concept_ids, is_attended, pretest, pretest_attempt, pretest_taken_at, bridge_cache"
    )
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (fetchError || !lecture) {
    return Response.json({ data: null, error: "Not found" }, { status: 404 });
  }

  const { data: profile } = await supabase
    .from("users")
    .select("settings")
    .eq("id", user.id)
    .single();
  const timeZone = resolveTimeZone(
    (profile?.settings as { timezone?: unknown } | null)?.timezone
  );

  // Lecture "moment" = start of its scheduled day in the user's timezone.
  const now = Date.now();
  const dayStart = fromZonedTime(
    `${lecture.scheduled_date}T00:00:00`,
    timeZone
  ).getTime();
  const dayEnd = fromZonedTime(
    `${lecture.scheduled_date}T23:59:59`,
    timeZone
  ).getTime();
  const hoursUntilLecture = Math.max(0, Math.round((dayStart - now) / 3_600_000));
  const unlocked =
    !lecture.is_attended &&
    now <= dayEnd &&
    dayStart - now <= UNLOCK_WINDOW_HOURS * 3_600_000;

  const existing = asPretest(lecture.pretest);

  if (!unlocked) {
    return Response.json({
      data: {
        unlocked: false,
        hoursUntilLecture,
        pretest: existing,
        attempt: lecture.pretest_attempt ?? null,
      },
      error: null,
    });
  }

  // ── Content-version string for the cache key (prereq id:created_at) ────────
  const prereqIds = lecture.prerequisite_concept_ids ?? [];
  let prereqConcepts: { id: string; title: string; notes: string | null; created_at: string }[] =
    [];
  if (prereqIds.length > 0) {
    const { data } = await supabase
      .from("aiml_concepts")
      .select("id, title, notes, created_at")
      .eq("user_id", user.id)
      .in("id", prereqIds);
    prereqConcepts = data ?? [];
  }
  const prereqConceptsVersion = [...prereqConcepts]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((c) => `${c.id}:${c.created_at}`)
    .join(",");
  const cacheKey = buildPretestCacheKey(lecture.title, prereqIds, prereqConceptsVersion);

  // Cache hit → serve as-is.
  if (existing && existing.cache_key === cacheKey) {
    return Response.json({
      data: {
        unlocked: true,
        hoursUntilLecture,
        pretest: existing,
        attempt: lecture.pretest_attempt ?? null,
      },
      error: null,
    });
  }

  // ── Generate ────────────────────────────────────────────────────────────────
  const prereqContext = prereqConcepts
    .map((c) => `- ${c.title}${c.notes ? `: ${c.notes.slice(0, 300)}` : ""}`)
    .join("\n");
  const bridgeSynthesis = (lecture.bridge_cache as { synthesis?: unknown } | null)
    ?.synthesis;
  const bridgeExcerpt =
    typeof bridgeSynthesis === "string"
      ? `\n\nBridge document excerpt (links the previous lecture to this one):\n${bridgeSynthesis.slice(0, BRIDGE_EXCERPT_CHARS)}`
      : "";

  const { data: generation } = await generateJSON<PretestGeneration>(
    "You write pretest questions — short, open-ended questions a student answers " +
      "BEFORE a lecture. Wrong answers are expected; the goal is to spark curiosity " +
      "and prime encoding during the lecture. Never ask trivial recall of the " +
      "prerequisites alone — probe what the lecture will likely teach.",
    `Upcoming lecture (Week ${lecture.week_number}): "${lecture.title}".\n` +
      `Prerequisite concepts the student already knows about:\n` +
      `${prereqContext || "(none listed)"}` +
      bridgeExcerpt +
      `\n\nWrite 5–8 open questions probing what this lecture will likely teach and ` +
      `how it builds on the prerequisites. For each, include a concise "model_answer" ` +
      `(2–3 sentences, best-guess based on the topic).\n` +
      `Return JSON: { "questions": [{ "q", "model_answer" }] }`,
    2048,
    "gpt-4o"
  );

  const questions = (generation?.questions ?? [])
    .filter(
      (q): q is { q: string; model_answer: string } =>
        !!q &&
        typeof q.q === "string" &&
        q.q.trim().length > 0 &&
        typeof q.model_answer === "string" &&
        q.model_answer.trim().length > 0
    )
    .slice(0, MAX_QUESTIONS)
    .map((q) => ({ q: q.q.trim(), model_answer: q.model_answer.trim() }));

  // AI failure → message, not an error status (bridge route pattern).
  if (questions.length < MIN_QUESTIONS) {
    return Response.json({
      data: {
        unlocked: true,
        hoursUntilLecture,
        pretest: null,
        attempt: null,
        message: "pretest could not be generated",
      },
      error: null,
    });
  }

  const pretest: PretestData = {
    generated_at: new Date().toISOString(),
    cache_key: cacheKey,
    questions,
  };

  // Best-effort persist; content changed → any old attempt refers to stale
  // questions, so clear it alongside.
  await supabase
    .from("lecture_schedules")
    .update({
      pretest,
      pretest_attempt: null,
      pretest_taken_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("user_id", user.id);

  return Response.json({
    data: { unlocked: true, hoursUntilLecture, pretest, attempt: null },
    error: null,
  });
}

// ─── POST /api/lectures/[id]/pretest ────────────────────────────────────────
//
// Store the student's attempt: { answers: [{ index, answer, self_grade }] }.
export async function POST(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  let body: { answers?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const { data: lecture, error: fetchError } = await supabase
    .from("lecture_schedules")
    .select("id, pretest, extracted_concept_ids")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (fetchError || !lecture) {
    return Response.json({ data: null, error: "Not found" }, { status: 404 });
  }

  const pretest = asPretest(lecture.pretest);
  if (!pretest) {
    return Response.json(
      { data: null, error: "no pretest generated for this lecture" },
      { status: 400 }
    );
  }
  if ((lecture.extracted_concept_ids ?? []).length > 0) {
    return Response.json(
      { data: null, error: "lecture already ingested; pretest window has closed" },
      { status: 409 }
    );
  }

  const answers = (Array.isArray(body.answers) ? body.answers : [])
    .filter(
      (a): a is { index: number; answer: string; self_grade: SelfGrade } =>
        !!a &&
        typeof (a as { index?: unknown }).index === "number" &&
        Number.isInteger((a as { index: number }).index) &&
        (a as { index: number }).index >= 0 &&
        (a as { index: number }).index < pretest.questions.length &&
        typeof (a as { answer?: unknown }).answer === "string" &&
        SELF_GRADES.includes((a as { self_grade: SelfGrade }).self_grade)
    )
    .map((a) => ({
      index: a.index,
      answer: a.answer.trim(),
      self_grade: a.self_grade,
    }));

  if (answers.length === 0) {
    return Response.json(
      { data: null, error: "no valid answers provided" },
      { status: 400 }
    );
  }

  const nowIso = new Date().toISOString();
  const attempt: PretestAttempt = { taken_at: nowIso, answers };

  const { error: updateError } = await supabase
    .from("lecture_schedules")
    .update({
      pretest_attempt: attempt,
      pretest_taken_at: nowIso,
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

  const gradeSummary = answers.reduce(
    (acc, a) => {
      acc[a.self_grade] += 1;
      return acc;
    },
    { got_it: 0, partial: 0, no_idea: 0 }
  );

  return Response.json({ data: { saved: true, gradeSummary }, error: null });
}
