import { NextRequest, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateJSON } from "@/lib/openai";
import { newCard, fsrsCardToDB } from "@/lib/fsrs";
import { generateDailyPlanForUser } from "@/lib/planning-engine";
import { parseDerivationPayload, type DerivationPayload } from "@/lib/derivation";

type RouteContext = { params: Promise<{ id: string }> };

/** AI extraction shape — validated through parseDerivationPayload before use. */
interface DerivationExtraction {
  derivations: {
    title: string;
    goal_latex: string;
    steps: { latex: string; explanation: string }[];
  }[];
}

/** A cached derivation pointer stored on aiml_concepts.derivations. */
interface DerivationRef {
  title: string;
  card_id: string;
  generated_at: string;
}

const SYSTEM_PROMPT =
  "You are a rigorous AIML tutor helping a student reach mastery of the MATH behind a concept — the level where they can reproduce key derivations from scratch on a whiteboard. You write clean LaTeX.";

function buildUserPrompt(title: string, notes: string): string {
  return `Concept: ${title}
Student's notes:
${notes}

Identify the derivations / proofs a mastery-level student must be able to reproduce from scratch for THIS concept. Produce 1-3 of them (only as many as the material genuinely supports).

For each derivation:
- "title": a short name (e.g. "Gradient of softmax cross-entropy")
- "goal_latex": the result to arrive at, as a LaTeX expression WITHOUT surrounding $ signs
- "steps": 4-8 ordered steps from premises to the goal. Each step is:
    - "latex": one line of the derivation as a LaTeX expression WITHOUT surrounding $ signs
    - "explanation": ONE sentence stating WHY this step is valid (the rule/identity used). May contain inline $...$ math.

Prefer fewer, correct, self-contained derivations over many shallow ones. Do not invent results the notes do not support.
Return ONLY valid JSON, no markdown:
{ "derivations": [ { "title": "string", "goal_latex": "string", "steps": [ { "latex": "string", "explanation": "string" } ] } ] }`;
}

/** Plain-text fallback for front/back so non-math renderers degrade gracefully. */
function summarizeBack(payload: DerivationPayload): string {
  const lines = payload.steps.map((s, i) => `${i + 1}. $${s.latex}$${s.explanation ? ` — ${s.explanation}` : ""}`);
  return `Goal: $${payload.goal_latex}$\n\n${lines.join("\n")}`;
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { data: concept, error: conceptError } = await supabase
    .from("aiml_concepts")
    .select("id, title, notes, derivations")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (conceptError || !concept) {
    return Response.json({ data: null, error: "Not found" }, { status: 404 });
  }

  const notes = (concept.notes ?? "").trim();
  if (notes.length === 0) {
    return Response.json(
      { data: null, error: "Add notes to this concept before generating a derivation drill." },
      { status: 422 }
    );
  }

  const { data: extraction, error: aiError } = await generateJSON<DerivationExtraction>(
    SYSTEM_PROMPT,
    buildUserPrompt(concept.title, notes)
  );

  if (aiError || !extraction?.derivations) {
    return Response.json(
      { data: null, error: aiError ?? "Failed to generate derivations." },
      { status: 502 }
    );
  }

  // Validate every candidate; require at least 2 steps to be a real derivation.
  const valid: { title: string; payload: DerivationPayload }[] = [];
  for (const cand of extraction.derivations) {
    const payload = parseDerivationPayload({
      goal_latex: cand?.goal_latex,
      steps: cand?.steps,
      source_section: concept.title,
    });
    if (payload && payload.steps.length >= 2) {
      const title =
        typeof cand.title === "string" && cand.title.trim().length > 0
          ? cand.title.trim()
          : `Derivation: ${concept.title}`;
      valid.push({ title, payload });
    }
  }

  if (valid.length === 0) {
    return Response.json(
      { data: null, error: "No reproducible derivations found in these notes." },
      { status: 422 }
    );
  }

  const nowISO = new Date().toISOString();
  const dbCards = valid.map(({ title, payload }) => ({
    user_id: user.id,
    card_type: "derivation",
    front: title,
    back: summarizeBack(payload),
    source_type: "aiml_concept",
    source_id: concept.id,
    payload: payload as unknown as Record<string, unknown>,
    ...fsrsCardToDB(newCard()),
    due: nowISO,
  }));

  const { data: inserted, error: insertError } = await supabase
    .from("srs_cards")
    .insert(dbCards)
    .select("id, front");

  if (insertError || !inserted) {
    return Response.json(
      { data: null, error: `Failed to save derivation cards: ${insertError?.message ?? "unknown"}` },
      { status: 500 }
    );
  }

  // Cache derivation pointers on the concept (append to any existing list).
  const existing = Array.isArray(concept.derivations)
    ? (concept.derivations as unknown as DerivationRef[])
    : [];
  const newRefs: DerivationRef[] = inserted.map((row) => ({
    title: row.front,
    card_id: row.id,
    generated_at: nowISO,
  }));

  await supabase
    .from("aiml_concepts")
    .update({ derivations: [...existing, ...newRefs] as unknown as Record<string, unknown>[] })
    .eq("id", concept.id)
    .eq("user_id", user.id);

  // Surface the new cards in today's plan (best-effort, non-blocking).
  after(async () => {
    try {
      await generateDailyPlanForUser(supabase, user.id);
    } catch (err) {
      console.error("[derivations] Plan regeneration failed:", err);
    }
  });

  return Response.json({
    data: { derivationsCreated: inserted.length },
    error: null,
  });
}
