import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/embeddings/related?source_id=...&source_type=...&limit=5
 * Returns top-N related concepts/problems for a given source item.
 * Uses the existing embedding to find similar items (no new embedding generation needed).
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { searchParams } = new URL(request.url);
  const sourceId = searchParams.get("source_id");
  const sourceType = searchParams.get("source_type");
  const limit = parseInt(searchParams.get("limit") ?? "5", 10);

  if (!sourceId || !sourceType) {
    return Response.json({ error: "source_id and source_type are required" }, { status: 400 });
  }

  // Get the embedding for the requested source
  const { data: sourceEmbedding } = await supabase
    .from("concept_embeddings")
    .select("embedding")
    .eq("user_id", user.id)
    .eq("source_type", sourceType)
    .eq("source_id", sourceId)
    .single();

  if (!sourceEmbedding) {
    return Response.json({ related: [], message: "No embedding found for this item" });
  }

  // Find similar items using the match_concepts RPC (exclude itself)
  const { data: matches, error: matchError } = await supabase.rpc("match_concepts", {
    query_embedding: sourceEmbedding.embedding,
    match_count: limit + 1, // +1 because it'll match itself
    match_user_id: user.id,
  });

  if (matchError) {
    return Response.json({ error: `Search failed: ${matchError.message}` }, { status: 500 });
  }

  // Filter out the source itself
  const filtered = (matches ?? []).filter(
    (m: { source_id: string; source_type: string }) =>
      !(m.source_id === sourceId && m.source_type === sourceType)
  ).slice(0, limit);

  if (filtered.length === 0) {
    return Response.json({ related: [] });
  }

  // Fetch titles
  const aimlIds = filtered
    .filter((m: { source_type: string }) => m.source_type === "aiml_concept")
    .map((m: { source_id: string }) => m.source_id);
  const dsaIds = filtered
    .filter((m: { source_type: string }) => m.source_type === "dsa_problem")
    .map((m: { source_id: string }) => m.source_id);

  const [{ data: concepts }, { data: problems }] = await Promise.all([
    aimlIds.length > 0
      ? supabase.from("aiml_concepts").select("id, title, concept_type, mastery_score").in("id", aimlIds)
      : Promise.resolve({ data: [] }),
    dsaIds.length > 0
      ? supabase.from("dsa_problems").select("id, title, difficulty, patterns").in("id", dsaIds)
      : Promise.resolve({ data: [] }),
  ]);

  const conceptMap = new Map((concepts ?? []).map((c) => [c.id, c]));
  const problemMap = new Map((problems ?? []).map((p) => [p.id, p]));

  const related = filtered.map((match: { source_type: string; source_id: string; similarity: number }) => {
    if (match.source_type === "aiml_concept") {
      const concept = conceptMap.get(match.source_id);
      return {
        source_type: match.source_type,
        source_id: match.source_id,
        similarity: match.similarity,
        title: concept?.title ?? "Unknown",
        mastery_score: concept?.mastery_score ?? 0,
        subtitle: concept?.concept_type ?? "",
      };
    } else {
      const problem = problemMap.get(match.source_id);
      return {
        source_type: match.source_type,
        source_id: match.source_id,
        similarity: match.similarity,
        title: problem?.title ?? "Unknown",
        subtitle: `${problem?.difficulty ?? ""} · ${(problem?.patterns ?? []).join(", ")}`,
      };
    }
  });

  return Response.json({ related });
}
