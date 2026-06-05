import { SupabaseClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getWeekStartISO } from "@/lib/accountability";
import { generateText, streamText } from "@/lib/openai";

const SYNTHESIS_SYSTEM = `You are a personal learning coach writing a weekly synthesis report for a student mastering AIML and DSA.

Write a reflective, specific summary in 3-4 short paragraphs covering:
1. What they accomplished this week (concrete numbers)
2. Strengths and patterns emerging
3. One honest gap or weak area to address
4. One specific focus recommendation for next week

Be warm but direct. Reference actual concept names and patterns from the data. No markdown headers.`;

async function gatherWeekData(supabase: SupabaseClient, userId: string) {
  const weekStart = getWeekStartISO();
  const weekStartDate = weekStart.split("T")[0];

  const [reviewsRes, conceptsRes, problemsRes, profileRes, synthesisRes] =
    await Promise.all([
      supabase
        .from("reviews")
        .select("rating, duration_seconds, retrievability_at_review")
        .eq("user_id", userId)
        .gte("created_at", weekStart),
      supabase
        .from("aiml_concepts")
        .select("title, mastery_score")
        .eq("user_id", userId)
        .gte("created_at", weekStart),
      supabase
        .from("dsa_problems")
        .select("title, difficulty, patterns")
        .eq("user_id", userId)
        .gte("solved_at", weekStart),
      supabase
        .from("users")
        .select("streak_count, daily_goal_minutes")
        .eq("id", userId)
        .single(),
      supabase
        .from("weekly_syntheses")
        .select("ai_synthesis")
        .eq("user_id", userId)
        .eq("week_start_date", weekStartDate)
        .maybeSingle(),
    ]);

  return {
    weekStartDate,
    reviews: reviewsRes.data ?? [],
    concepts: conceptsRes.data ?? [],
    problems: problemsRes.data ?? [],
    profile: profileRes.data,
    existingSynthesis: synthesisRes.data?.ai_synthesis ?? null,
  };
}

function buildSynthesisPrompt(data: Awaited<ReturnType<typeof gatherWeekData>>): string {
  const reviewCount = data.reviews.length;
  const conceptTitles = data.concepts.map((c) => c.title).join(", ") || "none";
  const problemTitles = data.problems.map((p) => p.title).join(", ") || "none";
  const patterns = [
    ...new Set(data.problems.flatMap((p) => p.patterns ?? [])),
  ].join(", ") || "none";
  const avgRetention =
    reviewCount > 0
      ? Math.round(
          (data.reviews.reduce((s, r) => s + (r.retrievability_at_review ?? 0), 0) /
            reviewCount) *
            100
        )
      : 0;

  return `Weekly data:
- Reviews completed: ${reviewCount}
- Average retention at review: ${avgRetention}%
- AIML concepts added: ${data.concepts.length} (${conceptTitles})
- DSA problems solved: ${data.problems.length} (${problemTitles})
- Patterns practiced: ${patterns}
- Current streak: ${data.profile?.streak_count ?? 0} days
- Daily goal: ${data.profile?.daily_goal_minutes ?? 60} min/day

Write the weekly synthesis.`;
}

async function saveSynthesis(
  supabase: SupabaseClient,
  userId: string,
  weekStartDate: string,
  synthesis: string,
  data: Awaited<ReturnType<typeof gatherWeekData>>
) {
  const reviewCount = data.reviews.length;
  const avgRetention =
    reviewCount > 0
      ? data.reviews.reduce((s, r) => s + (r.retrievability_at_review ?? 0), 0) / reviewCount
      : 0;

  const payload = {
    user_id: userId,
    week_start_date: weekStartDate,
    week_number: Math.ceil(new Date(weekStartDate).getDate() / 7),
    ai_synthesis: synthesis,
    concepts_learned: data.concepts.map((c) => c.title),
    problems_logged_count: data.problems.length,
    average_retention: avgRetention,
  };

  const { data: existing } = await supabase
    .from("weekly_syntheses")
    .select("id")
    .eq("user_id", userId)
    .eq("week_start_date", weekStartDate)
    .maybeSingle();

  if (existing?.id) {
    await supabase.from("weekly_syntheses").update(payload).eq("id", existing.id);
  } else {
    await supabase.from("weekly_syntheses").insert(payload);
  }
}

export async function GET() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const data = await gatherWeekData(supabase, user.id);
  return Response.json({
    synthesis: data.existingSynthesis,
    weekStartDate: data.weekStartDate,
  });
}

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const body = await request.json().catch(() => ({}));
  const stream = body.stream === true;

  const data = await gatherWeekData(supabase, user.id);

  if (data.existingSynthesis && !body.regenerate) {
    if (stream) {
      return new Response(data.existingSynthesis, {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    return Response.json({ synthesis: data.existingSynthesis, cached: true });
  }

  const prompt = buildSynthesisPrompt(data);

  if (stream) {
    const encoder = new TextEncoder();
    let fullText = "";

    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of streamText(SYNTHESIS_SYSTEM, [
            { role: "user", content: prompt },
          ], 800)) {
            fullText += chunk;
            controller.enqueue(encoder.encode(chunk));
          }
          if (fullText) {
            await saveSynthesis(supabase, user.id, data.weekStartDate, fullText, data);
          }
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const { data: text, error } = await generateText(SYNTHESIS_SYSTEM, prompt, 800);
  if (error || !text) {
    return Response.json({ error: error ?? "Generation failed" }, { status: 500 });
  }

  await saveSynthesis(supabase, user.id, data.weekStartDate, text, data);
  return Response.json({ synthesis: text, cached: false });
}

export async function generateSynthesisForUser(userId: string): Promise<string | null> {
  const admin = createAdminClient();
  const data = await gatherWeekData(admin, userId);

  if (data.existingSynthesis) return data.existingSynthesis;

  const prompt = buildSynthesisPrompt(data);
  const { data: text, error } = await generateText(SYNTHESIS_SYSTEM, prompt, 800);
  if (error || !text) return null;

  await saveSynthesis(admin, userId, data.weekStartDate, text, data);
  return text;
}
