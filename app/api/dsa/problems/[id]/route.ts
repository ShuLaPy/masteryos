import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ data: null, error: "Unauthorized" }, { status: 401 });

  const body = (await request.json()) as { approach_notes?: string | null };

  if (
    body.approach_notes !== undefined &&
    body.approach_notes !== null &&
    typeof body.approach_notes !== "string"
  ) {
    return Response.json({ data: null, error: "Invalid approach_notes" }, { status: 400 });
  }

  // Load the current row to confirm ownership and decide whether a cached
  // AI explanation needs to be invalidated by this edit.
  const { data: existing, error: fetchErr } = await supabase
    .from("dsa_problems")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (fetchErr || !existing) {
    return Response.json({ data: null, error: "Problem not found" }, { status: 404 });
  }

  const approachNotes =
    body.approach_notes === undefined ? existing.approach_notes : body.approach_notes;

  // The approach context feeds the AI blueprint — clear any cached explanation
  // so the next "AI Explain" regenerates against the updated notes.
  const hasCachedExplanation = Boolean(
    (existing as unknown as { ai_explanation: string | null }).ai_explanation
  );

  const update: Record<string, unknown> = { approach_notes: approachNotes };
  if (hasCachedExplanation) {
    update.ai_explanation = null;
    update.ai_explanation_generated_at = null;
    update.ai_explanation_model = null;
  }

  const { data: updated, error: updateErr } = await supabase
    .from("dsa_problems")
    .update(update)
    .eq("id", id)
    .eq("user_id", user.id)
    .select()
    .single();

  if (updateErr || !updated) {
    return Response.json({ data: null, error: "Failed to update problem" }, { status: 500 });
  }

  return Response.json({ data: updated, error: null });
}
