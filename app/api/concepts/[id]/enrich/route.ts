import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateJSON } from "@/lib/openai";
import { newCard, fsrsCardToDB } from "@/lib/fsrs";
import { generateDailyPlanForUser } from "@/lib/planning-engine";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  // Validate concept ownership
  const { data: concept, error: conceptError } = await supabase
    .from("aiml_concepts")
    .select("id, title, notes")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (conceptError || !concept) {
    return Response.json({ data: null, error: "Not found" }, { status: 404 });
  }

  // Validate body
  const body = await request.json();
  const { notes } = body;

  if (!notes || typeof notes !== "string" || notes.trim().length === 0) {
    return Response.json(
      { data: null, error: "notes must be a non-empty string" },
      { status: 400 }
    );
  }

  const trimmedNotes = notes.trim();

  // Generate flashcards from the student's own notes
  const result = await generateJSON<{ cards: { front: string; back: string }[] }>(
    "You are helping an AIML student build long-term memory of a concept they just studied. Extract core ideas from their notes and generate high-quality flashcards.",
    `Concept: ${concept.title}
Student's notes:
${trimmedNotes}

Generate 3-5 flashcard pairs from THESE notes specifically — use the student's own framing and examples where possible.
Return ONLY valid JSON:
{ "cards": [{ "front": "string", "back": "string" }] }`
  );

  const cards = result.data?.cards;

  if (!cards || cards.length < 3) {
    return Response.json(
      {
        data: null,
        error:
          "Notes did not produce enough distinct cards — try adding more detail.",
      },
      { status: 422 }
    );
  }

  const now = new Date();
  const nowISO = now.toISOString();

  // Count and delete existing seed cards for this concept
  const { data: deleted, error: deleteError } = await supabase
    .from("srs_cards")
    .delete()
    .eq("source_type", "aiml_concept")
    .eq("source_id", concept.id)
    .eq("user_id", user.id)
    .select("id");

  if (deleteError) {
    return Response.json(
      { data: null, error: "Failed to replace existing cards" },
      { status: 500 }
    );
  }

  const cardsReplaced = deleted?.length ?? 0;

  // Insert new cards built from the student's notes
  const dbCards = cards.map((c) => ({
    user_id: user.id,
    card_type: "concept",
    front: c.front,
    back: c.back,
    source_type: "aiml_concept",
    source_id: concept.id,
    ...fsrsCardToDB(newCard()),
    due: nowISO,
  }));

  const { error: insertError } = await supabase.from("srs_cards").insert(dbCards);

  if (insertError) {
    return Response.json(
      { data: null, error: "Failed to save new cards" },
      { status: 500 }
    );
  }

  // Update concept with the enriched notes and promote card_status to 'learned'
  const { error: updateError } = await supabase
    .from("aiml_concepts")
    .update({
      notes: trimmedNotes,
      card_status: "learned",
      card_status_updated_at: nowISO,
    })
    .eq("id", concept.id)
    .eq("user_id", user.id);

  if (updateError) {
    return Response.json(
      { data: null, error: "Cards saved but failed to update concept status" },
      { status: 500 }
    );
  }

  // Regenerate today's plan in the background so the Runway zone reflects the change
  void generateDailyPlanForUser(supabase, user.id).catch((err: unknown) => {
    console.error("[enrich] Plan regeneration failed:", err);
  });

  return Response.json({
    data: { cardsReplaced, cardsCreated: dbCards.length },
    error: null,
  });
}
