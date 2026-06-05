import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateEmbedding } from "@/lib/openai";
import crypto from "crypto";

/**
 * POST /api/embeddings/backfill
 * Generates embeddings for all concepts/problems that don't have one yet.
 * Useful for bootstrapping semantic search after Phase 7 deployment.
 * 
 * Body: { batch_size?: number } (defaults to 10 per call to avoid timeouts)
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const body = await request.json().catch(() => ({}));
  const batchSize = Math.min(body.batch_size ?? 10, 20);

  let processed = 0;
  let skipped = 0;
  let errors = 0;

  // Get existing embedding source_ids to skip
  const { data: existingEmbeddings } = await supabase
    .from("concept_embeddings")
    .select("source_id, source_type")
    .eq("user_id", user.id);

  const existingSet = new Set(
    (existingEmbeddings ?? []).map((e) => `${e.source_type}:${e.source_id}`)
  );

  // Fetch concepts without embeddings
  const { data: concepts } = await supabase
    .from("aiml_concepts")
    .select("id, title, notes, tags, concept_type")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  const conceptsToProcess = (concepts ?? []).filter(
    (c) => !existingSet.has(`aiml_concept:${c.id}`)
  ).slice(0, batchSize);

  for (const concept of conceptsToProcess) {
    const content = [
      concept.title,
      concept.concept_type ? `Type: ${concept.concept_type}` : "",
      concept.notes || "",
      concept.tags?.length ? `Tags: ${concept.tags.join(", ")}` : "",
    ].filter(Boolean).join("\n");

    if (content.length < 10) { skipped++; continue; }

    const contentHash = crypto.createHash("sha256").update(content).digest("hex");
    const { data: embedding, error } = await generateEmbedding(content);

    if (error || !embedding) { errors++; continue; }

    const { error: insertErr } = await supabase.from("concept_embeddings").insert({
      user_id: user.id,
      source_type: "aiml_concept",
      source_id: concept.id,
      content_hash: contentHash,
      embedding: JSON.stringify(embedding),
    });

    if (insertErr) { errors++; } else { processed++; }
  }

  // Fetch problems without embeddings (use remaining batch capacity)
  const remainingBatch = batchSize - conceptsToProcess.length;
  if (remainingBatch > 0) {
    const { data: problems } = await supabase
      .from("dsa_problems")
      .select("id, title, patterns, approach_notes, difficulty")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    const problemsToProcess = (problems ?? []).filter(
      (p) => !existingSet.has(`dsa_problem:${p.id}`)
    ).slice(0, remainingBatch);

    for (const problem of problemsToProcess) {
      const content = [
        problem.title,
        problem.difficulty ? `Difficulty: ${problem.difficulty}` : "",
        problem.patterns?.length ? `Patterns: ${problem.patterns.join(", ")}` : "",
        problem.approach_notes || "",
      ].filter(Boolean).join("\n");

      if (content.length < 10) { skipped++; continue; }

      const contentHash = crypto.createHash("sha256").update(content).digest("hex");
      const { data: embedding, error } = await generateEmbedding(content);

      if (error || !embedding) { errors++; continue; }

      const { error: insertErr } = await supabase.from("concept_embeddings").insert({
        user_id: user.id,
        source_type: "dsa_problem",
        source_id: problem.id,
        content_hash: contentHash,
        embedding: JSON.stringify(embedding),
      });

      if (insertErr) { errors++; } else { processed++; }
    }
  }

  // Check remaining items without embeddings
  const totalConcepts = (concepts ?? []).filter(
    (c) => !existingSet.has(`aiml_concept:${c.id}`)
  ).length;

  return Response.json({
    success: true,
    processed,
    skipped,
    errors,
    remaining: Math.max(0, totalConcepts - conceptsToProcess.length),
  });
}
