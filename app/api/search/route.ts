import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateEmbedding } from "@/lib/openai";

export interface SearchResult {
  source_type: "aiml_concept" | "dsa_problem";
  source_id: string;
  similarity: number;
  title: string;
  subtitle: string;
}

/**
 * POST /api/search
 * Semantic search across concepts and problems using pgvector cosine similarity.
 * 
 * Body: { query: string, limit?: number }
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const body = await request.json();
  const { query, limit = 10 } = body;

  if (!query || query.trim().length < 2) {
    return Response.json({ error: "Query must be at least 2 characters" }, { status: 400 });
  }

  // Generate embedding for the search query
  const { data: queryEmbedding, error: embeddingError } = await generateEmbedding(query);

  if (embeddingError || !queryEmbedding) {
    return Response.json({ error: `Failed to generate query embedding: ${embeddingError}` }, { status: 500 });
  }

  // Call the match_concepts RPC
  const { data: matches, error: matchError } = await supabase.rpc("match_concepts", {
    query_embedding: JSON.stringify(queryEmbedding),
    match_count: limit,
    match_user_id: user.id,
  });

  if (matchError) {
    return Response.json({ error: `Search failed: ${matchError.message}` }, { status: 500 });
  }

  if (!matches || matches.length === 0) {
    return Response.json({ results: [] });
  }

  // Fetch titles for the matched sources
  const aimlIds = matches
    .filter((m: { source_type: string }) => m.source_type === "aiml_concept")
    .map((m: { source_id: string }) => m.source_id);
  const dsaIds = matches
    .filter((m: { source_type: string }) => m.source_type === "dsa_problem")
    .map((m: { source_id: string }) => m.source_id);

  const [{ data: concepts }, { data: problems }] = await Promise.all([
    aimlIds.length > 0
      ? supabase.from("aiml_concepts").select("id, title, concept_type, week_number").in("id", aimlIds)
      : Promise.resolve({ data: [] }),
    dsaIds.length > 0
      ? supabase.from("dsa_problems").select("id, title, difficulty, patterns").in("id", dsaIds)
      : Promise.resolve({ data: [] }),
  ]);

  // Build enriched results
  const conceptMap = new Map((concepts ?? []).map((c) => [c.id, c]));
  const problemMap = new Map((problems ?? []).map((p) => [p.id, p]));

  const results: SearchResult[] = matches.map((match: { source_type: string; source_id: string; similarity: number }) => {
    if (match.source_type === "aiml_concept") {
      const concept = conceptMap.get(match.source_id);
      return {
        source_type: match.source_type,
        source_id: match.source_id,
        similarity: match.similarity,
        title: concept?.title ?? "Unknown Concept",
        subtitle: concept ? `Week ${concept.week_number} · ${concept.concept_type ?? "general"}` : "",
      };
    } else {
      const problem = problemMap.get(match.source_id);
      return {
        source_type: match.source_type,
        source_id: match.source_id,
        similarity: match.similarity,
        title: problem?.title ?? "Unknown Problem",
        subtitle: problem ? `${problem.difficulty ?? ""} · ${(problem.patterns ?? []).join(", ")}` : "",
      };
    }
  });

  return Response.json({ results });
}
