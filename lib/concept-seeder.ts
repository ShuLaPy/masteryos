import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateJSON } from "@/lib/openai";
import { newCard, fsrsCardToDB } from "@/lib/fsrs";
import type { Database } from "@/types/database";

interface ConceptToSeed {
  id: string;
  title: string;
  notes: string | null;
}

export async function getConceptsNeedingSeeds(
  supabase: SupabaseClient<Database>,
  conceptIds: string[]
): Promise<ConceptToSeed[]> {
  if (conceptIds.length === 0) return [];

  const { data: concepts, error } = await supabase
    .from("aiml_concepts")
    .select("id, title, notes")
    .in("id", conceptIds)
    .eq("card_status", "none");

  if (error || !concepts || concepts.length === 0) return [];

  const { data: existingCards } = await supabase
    .from("srs_cards")
    .select("source_id")
    .eq("source_type", "aiml_concept")
    .in("source_id", concepts.map((c) => c.id));

  const alreadySeeded = new Set((existingCards ?? []).map((c) => c.source_id));
  return concepts.filter((c) => !alreadySeeded.has(c.id));
}

export function fireAndForgetSeedConcepts(
  userId: string,
  concepts: ConceptToSeed[]
): void {
  if (concepts.length === 0) return;

  void (async () => {
    const admin = createAdminClient();
    const now = new Date();

    for (const concept of concepts) {
      try {
        const result = await generateJSON<{ cards: { front: string; back: string }[] }>(
          "You are helping an AIML student prepare for an upcoming lecture. Generate a concise primer on a prerequisite concept.",
          `Concept: ${concept.title}
Description: ${concept.notes ?? "an AIML concept"}

Generate 3-5 flashcard pairs covering the core ideas.
Return ONLY valid JSON, no markdown:
{ "cards": [{ "front": "string", "back": "string" }] }`
        );

        if (!result.data?.cards || result.data.cards.length < 3) {
          console.error(
            `[concept-seeder] Skipping concept ${concept.id}: ${result.error ?? "fewer than 3 cards returned"}`
          );
          continue;
        }

        const dbCards = result.data.cards.map((c) => ({
          user_id: userId,
          card_type: "concept",
          front: c.front,
          back: c.back,
          source_type: "aiml_concept",
          source_id: concept.id,
          ...fsrsCardToDB(newCard()),
          due: now.toISOString(),
        }));

        const { error: insertErr } = await admin.from("srs_cards").insert(dbCards);

        if (insertErr) {
          console.error(
            `[concept-seeder] Insert failed for concept ${concept.id}: ${insertErr.message}`
          );
          continue;
        }

        const { error: updateErr } = await admin
          .from("aiml_concepts")
          .update({ card_status: "seeded", card_status_updated_at: now.toISOString() })
          .eq("id", concept.id)
          .eq("user_id", userId);

        if (updateErr) {
          console.error(
            `[concept-seeder] Status update failed for concept ${concept.id}: ${updateErr.message}`
          );
        }
      } catch (err) {
        console.error(`[concept-seeder] Unexpected error seeding concept ${concept.id}:`, err);
      }
    }
  })();
}
