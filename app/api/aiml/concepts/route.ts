import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateEmbedding } from "@/lib/openai";
import crypto from "crypto";

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const body = await request.json();
  const { id, prerequisites } = body;

  if (!id) return Response.json({ error: "Concept id is required" }, { status: 400 });
  if (!Array.isArray(prerequisites)) {
    return Response.json({ error: "prerequisites must be an array" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("aiml_concepts")
    .update({ prerequisites })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, prerequisites")
    .single();

  if (error || !data) {
    return Response.json({ error: "Failed to update prerequisites" }, { status: 500 });
  }

  return Response.json({ success: true, prerequisites: data.prerequisites });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const body = await request.json();
  const { title, week_number, concept_type, notes, tags, source, prerequisites } = body;

  if (!title) return Response.json({ error: "Title is required" }, { status: 400 });

  // 1. Insert Concept
  const { data: concept, error: conceptError } = await supabase
    .from("aiml_concepts")
    .insert({
      user_id: user.id,
      title,
      week_number,
      concept_type,
      notes,
      tags,
      source,
      prerequisites: Array.isArray(prerequisites) ? prerequisites : [],
    })
    .select()
    .single();

  if (conceptError || !concept) {
    return Response.json({ error: "Failed to save concept" }, { status: 500 });
  }

  // 2. Generate embedding for semantic search (non-blocking — don't fail the request)
  try {
    const embeddingContent = [title, concept_type ? `Type: ${concept_type}` : "", notes || "", tags?.length ? `Tags: ${tags.join(", ")}` : ""].filter(Boolean).join("\n");
    if (embeddingContent.length >= 10) {
      const contentHash = crypto.createHash("sha256").update(embeddingContent).digest("hex");
      const { data: embedding } = await generateEmbedding(embeddingContent);
      if (embedding) {
        await supabase.from("concept_embeddings").insert({
          user_id: user.id,
          source_type: "aiml_concept",
          source_id: concept.id,
          content_hash: contentHash,
          embedding: JSON.stringify(embedding),
        });
      }
    }
  } catch {
    // Embedding generation failure shouldn't block concept creation
  }

  return Response.json({ success: true, concept });
}
