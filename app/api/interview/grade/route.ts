import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { updateStreak } from "@/lib/streak";
import { newCard, fsrsCardToDB } from "@/lib/fsrs";
import {
  normalizeSlotGrade,
  emaMastery,
  type InterviewSlot,
  type AppliedGrade,
} from "@/lib/interview-engine";
import type { Json } from "@/types/database";

/**
 * POST /api/interview/grade
 *   { sessionId, slot_index, slot_grade, outcome?, strong_points?, weak_points?,
 *     follow_up_card?, force? }
 *
 * SHADOW-SCORE ONLY. Validates/clamps the grade, then for the slot's concept:
 *   - EMA-blends aiml_concepts.mastery_score (never clobbers)
 *   - seeds a follow-up SRS card for the weak point (additive)
 * It NEVER writes a reviews row, moves srs_cards.due, or mutates pattern_mastery.
 * current_slot is server-authoritative — advancing it is what unblocks the next
 * question, so a parse-failure "force" still advances with no scoring write.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const body = await request.json().catch(() => ({}));
  const force = body.force === true;
  const grade = normalizeSlotGrade(body.slot_grade);

  if (!body.sessionId || typeof body.slot_index !== "number") {
    return Response.json({ data: null, error: "Bad request" }, { status: 400 });
  }
  if (grade === null && !force) {
    return Response.json({ data: null, error: "Invalid slot_grade" }, { status: 400 });
  }

  const { data: session, error } = await supabase
    .from("interview_sessions")
    .select("question_plan, grades, current_slot")
    .eq("id", body.sessionId)
    .eq("user_id", user.id)
    .single();
  if (error || !session) {
    return Response.json({ data: null, error: "Session not found" }, { status: 404 });
  }

  const plan = (session.question_plan as unknown as InterviewSlot[]) ?? [];
  const slotIndex: number = body.slot_index;
  if (slotIndex < 0 || slotIndex >= plan.length) {
    return Response.json({ data: null, error: "slot_index out of range" }, { status: 400 });
  }
  const slot = plan[slotIndex];
  const grades = (session.grades as unknown as AppliedGrade[]) ?? [];

  // Idempotent: never apply the same slot twice.
  const alreadyApplied = grades.some((g) => g.slot_index === slotIndex);
  const nextSlot = Math.max(session.current_slot ?? 0, slotIndex + 1);

  if (alreadyApplied) {
    return Response.json({
      data: { nextSlotIndex: nextSlot, done: nextSlot >= plan.length },
      error: null,
    });
  }

  // ── Shadow writes (only when we have a real grade) ──
  // Every slot is an AIML concept: EMA-blend its mastery_score and seed an
  // additive follow-up card. Never touches reviews / srs_cards.due / pattern_mastery.
  if (grade !== null && slot.conceptId) {
    const { data: concept } = await supabase
      .from("aiml_concepts")
      .select("mastery_score")
      .eq("id", slot.conceptId)
      .eq("user_id", user.id)
      .single();
    const newMastery = emaMastery(concept?.mastery_score ?? null, grade);
    await supabase
      .from("aiml_concepts")
      .update({ mastery_score: newMastery })
      .eq("id", slot.conceptId)
      .eq("user_id", user.id);

    // Seed a follow-up card targeting the gap, attached to the concept.
    const card = body.follow_up_card;
    const front = typeof card?.front === "string" ? card.front.trim() : "";
    const back = typeof card?.back === "string" ? card.back.trim() : "";
    if (front && back) {
      await supabase.from("srs_cards").insert({
        user_id: user.id,
        card_type: "interview",
        front,
        back,
        source_type: "aiml_concept",
        source_id: slot.conceptId,
        ...fsrsCardToDB(newCard()),
      });
    }
  }

  // ── Append the applied grade + advance the slot (server-authoritative) ──
  const appliedGrade: AppliedGrade = {
    slot_index: slotIndex,
    concept_id: slot.conceptId,
    slot_grade: grade ?? 3,
    strong_points: Array.isArray(body.strong_points) ? body.strong_points : [],
    weak_points: Array.isArray(body.weak_points) ? body.weak_points : [],
    applied: grade !== null,
  };

  await supabase
    .from("interview_sessions")
    .update({
      grades: [...grades, appliedGrade] as unknown as Json,
      current_slot: nextSlot,
    })
    .eq("id", body.sessionId)
    .eq("user_id", user.id);

  await updateStreak(supabase, user.id);

  return Response.json({
    data: { nextSlotIndex: nextSlot, done: nextSlot >= plan.length },
    error: null,
  });
}
