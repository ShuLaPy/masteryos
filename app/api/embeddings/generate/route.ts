import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateEmbedding } from "@/lib/openai";
import crypto from "crypto";

/**
 * POST /api/embeddings/generate
 * Generates an embedding for a concept or problem and stores it in concept_embeddings.
 * Called after concept/problem creation.
 * 
 * Body: { source_type: 'aiml_concept' | 'dsa_problem', source_id: string }
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const body = await request.json();
  const { source_type, source_id } = body;

  if (!source_type || !source_id) {
    return Response.json({ error: "source_type and source_id are required" }, { status: 400 });
  }

  if (!["aiml_concept", "dsa_problem"].includes(source_type)) {
    return Response.json({ error: "source_type must be 'aiml_concept' or 'dsa_problem'" }, { status: 400 });
  }

  // Fetch the source content
  let content = "";

  if (source_type === "aiml_concept") {
    const { data: concept } = await supabase
      .from("aiml_concepts")
      .select("title, notes, tags, concept_type")
      .eq("id", source_id)
      .eq("user_id", user.id)
      .single();

    if (!concept) {
      return Response.json({ error: "Concept not found" }, { status: 404 });
    }

    content = [
      concept.title,
      concept.concept_type ? `Type: ${concept.concept_type}` : "",
      concept.notes || "",
      concept.tags?.length ? `Tags: ${concept.tags.join(", ")}` : "",
    ].filter(Boolean).join("\n");
  } else {
    const { data: problem } = await supabase
      .from("dsa_problems")
      .select("title, patterns, approach_notes, difficulty")
      .eq("id", source_id)
      .eq("user_id", user.id)
      .single();

    if (!problem) {
      return Response.json({ error: "Problem not found" }, { status: 404 });
    }

    content = [
      problem.title,
      problem.difficulty ? `Difficulty: ${problem.difficulty}` : "",
      problem.patterns?.length ? `Patterns: ${problem.patterns.join(", ")}` : "",
      problem.approach_notes || "",
    ].filter(Boolean).join("\n");
  }

  if (content.length < 10) {
    return Response.json({ error: "Not enough content to generate embedding" }, { status: 400 });
  }

  // Check content hash for deduplication
  const contentHash = crypto.createHash("sha256").update(content).digest("hex");

  const { data: existing } = await supabase
    .from("concept_embeddings")
    .select("id, content_hash")
    .eq("user_id", user.id)
    .eq("source_type", source_type)
    .eq("source_id", source_id)
    .single();

  // Skip if content hasn't changed
  if (existing && existing.content_hash === contentHash) {
    return Response.json({ success: true, skipped: true, message: "Embedding already up to date" });
  }

  // Generate embedding
  const { data: embedding, error: embeddingError } = await generateEmbedding(content);

  if (embeddingError || !embedding) {
    return Response.json({ error: `Embedding generation failed: ${embeddingError}` }, { status: 500 });
  }

  // Upsert embedding record
  if (existing) {
    const { error: updateError } = await supabase
      .from("concept_embeddings")
      .update({
        content_hash: contentHash,
        embedding: JSON.stringify(embedding),
      })
      .eq("id", existing.id);

    if (updateError) {
      return Response.json({ error: "Failed to update embedding" }, { status: 500 });
    }
  } else {
    const { error: insertError } = await supabase
      .from("concept_embeddings")
      .insert({
        user_id: user.id,
        source_type,
        source_id,
        content_hash: contentHash,
        embedding: JSON.stringify(embedding),
      });

    if (insertError) {
      return Response.json({ error: "Failed to store embedding" }, { status: 500 });
    }
  }

  return Response.json({ success: true, content_hash: contentHash });
}
