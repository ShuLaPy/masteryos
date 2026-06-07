import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { complete } from "@/lib/ai-router";
import { newCard, fsrsCardToDB } from "@/lib/fsrs";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

interface CardExtraction {
  cue: string;
  pattern: string;
  insight: string;
  trick: string;
}

const SYSTEM_PROMPT = `You are an expert DSA tutor creating spaced-repetition flashcards from a solved problem.

Given a problem statement and the learner's solution notes, extract:
- cue: the compressed problem setup that signals which pattern to use. Focus on the constraints and structure, NOT the solution. Keep it to 1–2 sentences.
- pattern: the primary DSA pattern (e.g. "Sliding Window", "Two Pointers", "BFS", "Dynamic Programming").
- insight: one sentence explaining WHY this pattern solves the problem.
- trick: the single crux step or technique to remember — the move that unlocks the solution.

Return only valid JSON with exactly these keys: cue, pattern, insight, trick.`;

function resolveTimezone(settings: unknown): string {
  const tz = (settings as { timezone?: unknown } | null)?.timezone;
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

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const body = await request.json();
  const {
    problemId,
    statement,
    solutionNotes,
  }: {
    problemId: string;
    statement: string;
    solutionNotes?: string;
  } = body;

  if (!problemId || !statement) {
    return Response.json(
      { data: null, error: "Missing required fields: problemId, statement" },
      { status: 400 },
    );
  }

  // 1. Dedupe: skip generation if cards already exist for this problem.
  const { data: existing, error: dedupError } = await supabase
    .from("srs_cards")
    .select("id")
    .eq("user_id", user.id)
    .eq("source_type", "dsa_recognition")
    .eq("source_id", problemId)
    .limit(1);

  if (dedupError) {
    return Response.json({ data: null, error: dedupError.message }, { status: 500 });
  }

  if (existing && existing.length > 0) {
    return Response.json({ data: { cardsCreated: 0 }, error: null });
  }

  // 2. Fetch problem title (for the insight card front) and user timezone in parallel.
  const [problemRes, profileRes] = await Promise.all([
    supabase
      .from("dsa_problems")
      .select("title")
      .eq("id", problemId)
      .eq("user_id", user.id)
      .single(),
    supabase.from("users").select("settings").eq("id", user.id).single(),
  ]);

  if (problemRes.error || !problemRes.data) {
    return Response.json({ data: null, error: "Problem not found" }, { status: 404 });
  }

  const timezone = resolveTimezone(profileRes.data?.settings);
  const today = formatInTimeZone(new Date(), timezone, "yyyy-MM-dd");
  const dueToday = fromZonedTime(`${today}T00:00:00`, timezone).toISOString();

  // 3. Call LLM to extract card content.
  const { data: completionData, error: llmError } = await complete({
    task: "card_generation",
    systemPrompt:
      SYSTEM_PROMPT +
      "\n\nIMPORTANT: Respond with ONLY valid JSON, no markdown, no explanation, no code blocks.",
    messages: [
      {
        role: "user",
        content: `Problem statement:\n${statement}\n\nSolution notes:\n${solutionNotes ?? "(none)"}`,
      },
    ],
  });

  if (llmError || !completionData) {
    return Response.json(
      { data: null, error: llmError ?? "LLM failed" },
      { status: 500 },
    );
  }

  let extracted: CardExtraction | null = null;
  try {
    extracted = JSON.parse(completionData.content) as CardExtraction;
  } catch {
    return Response.json(
      { data: null, error: "LLM returned invalid JSON" },
      { status: 500 },
    );
  }

  if (!extracted?.cue || !extracted?.pattern || !extracted?.insight || !extracted?.trick) {
    return Response.json(
      { data: null, error: "LLM returned incomplete card data" },
      { status: 500 },
    );
  }

  // 4. Insert recognition + insight cards.
  const baseCard = { ...fsrsCardToDB(newCard()), due: dueToday };

  const { error: insertError } = await supabase.from("srs_cards").insert([
    {
      user_id: user.id,
      card_type: "recognition",
      front: extracted.cue,
      back: `${extracted.pattern} — ${extracted.insight}`,
      source_type: "dsa_recognition",
      source_id: problemId,
      ...baseCard,
    },
    {
      user_id: user.id,
      card_type: "insight",
      front: `Key trick for ${problemRes.data.title}`,
      back: extracted.trick,
      source_type: "dsa_recognition",
      source_id: problemId,
      ...baseCard,
    },
  ]);

  if (insertError) {
    return Response.json({ data: null, error: insertError.message }, { status: 500 });
  }

  return Response.json({ data: { cardsCreated: 2 }, error: null });
}
