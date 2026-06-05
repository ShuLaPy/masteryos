import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateJSON } from "@/lib/openai";

interface ConnectionExplanation {
  connection: string;
  why_it_matters: string;
}

/**
 * POST /api/ai/discover-connections
 * Finds cross-domain connections between AIML concepts and DSA patterns.
 * Uses pgvector to find similar pairs, then Claude explains the connection.
 * 
 * Body: { threshold?: number, max_pairs?: number }
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const body = await request.json();
  const { threshold = 0.65, max_pairs = 5 } = body;

  // Find cross-domain pairs using the RPC function
  const { data: pairs, error: pairsError } = await supabase.rpc("find_cross_connections", {
    p_user_id: user.id,
    similarity_threshold: threshold,
    max_pairs,
  });

  if (pairsError) {
    return Response.json({ error: `Failed to find connections: ${pairsError.message}` }, { status: 500 });
  }

  if (!pairs || pairs.length === 0) {
    return Response.json({ connections: [], message: "No cross-domain connections found yet. Add more concepts and problems to discover connections." });
  }

  // Fetch details for matched pairs
  const aimlIds = pairs.map((p: { aiml_source_id: string }) => p.aiml_source_id);
  const dsaIds = pairs.map((p: { dsa_source_id: string }) => p.dsa_source_id);

  const [{ data: concepts }, { data: problems }] = await Promise.all([
    supabase.from("aiml_concepts").select("id, title, notes, concept_type").in("id", aimlIds),
    supabase.from("dsa_problems").select("id, title, patterns, approach_notes").in("id", dsaIds),
  ]);

  const conceptMap = new Map((concepts ?? []).map((c) => [c.id, c]));
  const problemMap = new Map((problems ?? []).map((p) => [p.id, p]));

  // Ask AI to explain each connection
  const connections = [];

  for (const pair of pairs) {
    const concept = conceptMap.get(pair.aiml_source_id);
    const problem = problemMap.get(pair.dsa_source_id);

    if (!concept || !problem) continue;

    const prompt = `Explain the connection between this AIML concept and DSA problem in 2-3 sentences.

AIML Concept: "${concept.title}" (${concept.concept_type ?? "general"})
${concept.notes ? `Notes: ${concept.notes.slice(0, 200)}` : ""}

DSA Problem: "${problem.title}" (Patterns: ${(problem.patterns ?? []).join(", ")})
${problem.approach_notes ? `Notes: ${problem.approach_notes.slice(0, 200)}` : ""}

Return JSON with "connection" (2-3 sentence explanation of how they're related) and "why_it_matters" (1 sentence on why understanding this link helps learning).`;

    const { data: explanation } = await generateJSON<ConnectionExplanation>(
      "You are a learning science expert who identifies cross-domain connections between AI/ML theory and data structures & algorithms.",
      prompt
    );

    if (explanation) {
      connections.push({
        aiml_concept: { id: concept.id, title: concept.title },
        dsa_problem: { id: problem.id, title: problem.title },
        similarity: pair.similarity,
        explanation: explanation.connection,
        why_it_matters: explanation.why_it_matters,
      });
    }
  }

  // Store connections in weekly_syntheses as cross_connections
  if (connections.length > 0) {
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Start of week (Sunday)

    await supabase.from("weekly_syntheses").upsert(
      {
        user_id: user.id,
        week_start_date: weekStart.toISOString().split("T")[0],
        cross_connections: connections,
      },
      { onConflict: "user_id,week_start_date", ignoreDuplicates: false }
    );
  }

  return Response.json({ connections });
}
