import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dbCardToFSRS, fsrsCardToDB, reviewCard, Rating } from "@/lib/fsrs";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const body = await request.json();
  const { card_id, rating, duration_seconds, confidence_predicted } = body;

  if (!card_id || !rating || rating < 1 || rating > 4) {
    return Response.json({ error: "Invalid parameters" }, { status: 400 });
  }

  // Fetch current card state
  const { data: card, error: fetchErr } = await supabase
    .from("srs_cards")
    .select("*")
    .eq("id", card_id)
    .eq("user_id", user.id)
    .single();

  if (fetchErr || !card) {
    return Response.json({ error: "Card not found" }, { status: 404 });
  }

  // Run FSRS algorithm
  const fsrsCard = dbCardToFSRS(card);
  const result = reviewCard(fsrsCard, rating as Rating);

  if (!result || !result.updatedCard) {
    return Response.json(
      { error: "FSRS scheduling failed — card state may be corrupted" },
      { status: 500 }
    );
  }

  const { updatedCard } = result;
  const dbFields = fsrsCardToDB(updatedCard);

  // Update card + log review in parallel
  const [updateResult] = await Promise.all([
    supabase
      .from("srs_cards")
      .update(dbFields)
      .eq("id", card_id)
      .eq("user_id", user.id),
    supabase.from("reviews").insert({
      user_id: user.id,
      card_id,
      rating,
      duration_seconds: duration_seconds ?? 0,
      confidence_predicted:
        confidence_predicted >= 1 && confidence_predicted <= 5
          ? confidence_predicted
          : null,
      stability_before: card.stability,
      stability_after: updatedCard.stability,
      retrievability_at_review:
        card.stability > 0 && card.last_review
          ? Math.pow(
              1 +
                (Date.now() - new Date(card.last_review).getTime()) /
                  (1000 * 60 * 60 * 24) /
                  (9 * card.stability),
              -1
            )
          : 1,
      scheduled_days_after: updatedCard.scheduled_days,
    }),
  ]);

  if (updateResult.error) {
    return Response.json({ error: updateResult.error.message }, { status: 500 });
  }

  return Response.json({
    success: true,
    next_due: dbFields.due,
    scheduled_days: updatedCard.scheduled_days,
    new_state: updatedCard.state,
  });
}
