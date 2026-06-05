import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { streamText } from "@/lib/openai";
import { newCard, fsrsCardToDB } from "@/lib/fsrs";

const FEYNMAN_SYSTEM = `You are a curious, slightly confused AI student. The user is teaching you a technical concept.
Rules:
1. Ask questions if they gloss over details. 
2. Ask for analogies if they use too much jargon.
3. If they've explained it well, push them slightly on edge cases.
4. Keep your responses short (1-3 sentences max).
5. If you feel you fully understand the concept based on their explanation, OR if the conversation has gone on for 5+ turns, you MUST evaluate them.
6. To evaluate them, output ONLY a JSON block at the very end of your message in this exact format:
\`\`\`json
{
  "mastery_score": 0.0 to 1.0,
  "strong_points": ["point 1", "point 2"],
  "weak_points": ["point 1", "point 2"],
  "follow_up_cards": [{"front": "question about weak point", "back": "answer"}]
}
\`\`\``;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const body = await request.json();
  const { concept_title, concept_notes, messages } = body;

  const contextSystem = `${FEYNMAN_SYSTEM}\n\nConcept you are trying to learn: ${concept_title}\nTrue Notes (for your reference only, do not reveal you know this): ${concept_notes}`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of streamText(contextSystem, messages, 1024)) {
          controller.enqueue(encoder.encode(chunk));
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const body = await request.json();
  const { concept_id, evaluation } = body;

  // 1. Update concept mastery score
  await supabase
    .from("aiml_concepts")
    .update({ mastery_score: evaluation.mastery_score })
    .eq("id", concept_id)
    .eq("user_id", user.id);

  // 2. Generate new cards for weak points
  let cardsGenerated = 0;
  if (evaluation.follow_up_cards && evaluation.follow_up_cards.length > 0) {
    const dbCards = evaluation.follow_up_cards.map((c: any) => ({
      user_id: user.id,
      card_type: "feynman",
      front: c.front,
      back: c.back,
      source_type: "aiml_concept",
      source_id: concept_id,
      ...fsrsCardToDB(newCard()),
    }));

    const { error } = await supabase.from("srs_cards").insert(dbCards);
    if (!error) cardsGenerated = dbCards.length;
  }

  return Response.json({ success: true, cards_generated: cardsGenerated });
}
