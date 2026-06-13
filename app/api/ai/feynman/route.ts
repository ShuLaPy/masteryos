import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { streamText } from "@/lib/openai";
import { newCard, fsrsCardToDB } from "@/lib/fsrs";

const FEYNMAN_SYSTEM = `You are a curious, slightly confused AI student. The user is teaching you a technical concept.
Rules:
1. Ask questions if they gloss over details.
2. Ask for analogies if they use too much jargon.
3. If they've explained it well, push them slightly on edge cases AND on the "why" behind the mechanism (not just the "what").
4. Keep your responses short (1-3 sentences max).
5. If you feel you fully understand the concept based on their explanation, OR if the conversation has gone on for 5+ turns, you MUST evaluate them.
6. To evaluate them, output ONLY a JSON block at the very end of your message in this exact format:
\`\`\`json
{
  "mastery_score": 0.0 to 1.0,
  "dimensions": { "accuracy": 0.0 to 1.0, "completeness": 0.0 to 1.0, "depth_of_why": 0.0 to 1.0 },
  "strong_points": ["point 1", "point 2"],
  "weak_points": ["point 1", "point 2"],
  "follow_up_cards": [{"front": "question about weak point", "back": "answer"}]
}
\`\`\`
Where: accuracy = factual correctness; completeness = coverage of the core ideas; depth_of_why = how well they explained the underlying reasons, not just surface facts. mastery_score should reflect all three.`;

/** Evaluation payload emitted by the model and saved on session finish. */
interface FollowUpCard {
  front: string;
  back: string;
}
interface FeynmanEvaluation {
  mastery_score: number;
  dimensions?: { accuracy?: number; completeness?: number; depth_of_why?: number };
  strong_points?: string[];
  weak_points?: string[];
  follow_up_cards?: FollowUpCard[];
}
interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** Clamp an untrusted score into [0,1]; fall back to 0 when not a finite number. */
function clampScore(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : 0;
}

function sanitizeFollowUpCards(raw: unknown): FollowUpCard[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((c) => {
    if (!c || typeof c !== "object") return [];
    const card = c as Record<string, unknown>;
    if (typeof card.front !== "string" || typeof card.back !== "string") return [];
    return [{ front: card.front, back: card.back }];
  });
}

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

  const body = (await request.json()) as {
    concept_id?: unknown;
    conversation?: unknown;
    evaluation?: unknown;
  };

  if (typeof body.concept_id !== "string" || !body.evaluation || typeof body.evaluation !== "object") {
    return Response.json(
      { success: false, error: "concept_id and evaluation are required" },
      { status: 400 }
    );
  }

  const conceptId = body.concept_id;
  const rawEval = body.evaluation as Record<string, unknown>;
  const evaluation: FeynmanEvaluation = {
    mastery_score: clampScore(rawEval.mastery_score),
    dimensions:
      rawEval.dimensions && typeof rawEval.dimensions === "object"
        ? {
            accuracy: clampScore((rawEval.dimensions as Record<string, unknown>).accuracy),
            completeness: clampScore((rawEval.dimensions as Record<string, unknown>).completeness),
            depth_of_why: clampScore((rawEval.dimensions as Record<string, unknown>).depth_of_why),
          }
        : undefined,
    strong_points: Array.isArray(rawEval.strong_points)
      ? rawEval.strong_points.filter((p): p is string => typeof p === "string")
      : [],
    weak_points: Array.isArray(rawEval.weak_points)
      ? rawEval.weak_points.filter((p): p is string => typeof p === "string")
      : [],
    follow_up_cards: sanitizeFollowUpCards(rawEval.follow_up_cards),
  };

  const conversation: ChatMessage[] = Array.isArray(body.conversation)
    ? (body.conversation as ChatMessage[])
    : [];

  // 1. Update concept mastery score
  await supabase
    .from("aiml_concepts")
    .update({ mastery_score: evaluation.mastery_score })
    .eq("id", conceptId)
    .eq("user_id", user.id);

  // 2. Generate new cards for weak points
  let cardsGenerated = 0;
  if (evaluation.follow_up_cards && evaluation.follow_up_cards.length > 0) {
    const dbCards = evaluation.follow_up_cards.map((c) => ({
      user_id: user.id,
      card_type: "feynman",
      front: c.front,
      back: c.back,
      source_type: "aiml_concept",
      source_id: conceptId,
      ...fsrsCardToDB(newCard()),
    }));

    const { error } = await supabase.from("srs_cards").insert(dbCards);
    if (!error) cardsGenerated = dbCards.length;
  }

  // 3. Persist the teaching session (transcript + evaluation) — previously dropped.
  const { error: sessionError } = await supabase.from("feynman_sessions").insert({
    user_id: user.id,
    concept_id: conceptId,
    messages: conversation as unknown as Record<string, unknown>[],
    evaluation: evaluation as unknown as Record<string, unknown>,
    mastery_score: evaluation.mastery_score,
    cards_generated: cardsGenerated,
  });
  if (sessionError) {
    console.error("[feynman] Failed to persist session:", sessionError.message);
  }

  return Response.json({ success: true, cards_generated: cardsGenerated });
}
