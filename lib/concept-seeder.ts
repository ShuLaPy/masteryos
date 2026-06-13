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

/**
 * Reclaim window for stuck seeding (roadmap Phase 1a). A concept left in
 * 'seeding' longer than this — e.g. a fire-and-forget task that Vercel froze
 * after the response — is considered abandoned and may be re-claimed.
 */
const SEEDING_STALE_MS = 10 * 60 * 1000;

/**
 * Atomically claim concepts for cold-start seeding (roadmap Phase 1a — single
 * seeding authority / race fix).
 *
 * Two independent paths seed prerequisite cards: the lecture create/update routes
 * (fire-and-forget) and plan generation (remediateColdStart, awaited). Both
 * previously gated only on "concept has no cards", so the same concept could be
 * seeded twice when they overlapped. This claim closes the race: the UPDATE …
 * WHERE card_status IN ('none' | stale 'seeding') is a single atomic statement,
 * so exactly one caller flips a given row to 'seeding' and gets it back.
 *
 * Stale 'seeding' rows are re-claimable so a frozen fire-and-forget never leaves
 * a prereq permanently un-seeded. Concepts that already have cards (seeded by a
 * path that didn't update card_status) are filtered out as a final guard.
 */
export async function claimConceptsForSeeding(
  supabase: SupabaseClient<Database>,
  conceptIds: string[]
): Promise<ConceptToSeed[]> {
  if (conceptIds.length === 0) return [];

  const now = new Date();
  const staleCutoff = new Date(now.getTime() - SEEDING_STALE_MS).toISOString();

  const { data: claimed } = await supabase
    .from("aiml_concepts")
    .update({ card_status: "seeding", card_status_updated_at: now.toISOString() })
    .in("id", conceptIds)
    .or(`card_status.eq.none,and(card_status.eq.seeding,card_status_updated_at.lt.${staleCutoff})`)
    .select("id, title, notes");

  if (!claimed || claimed.length === 0) return [];

  // Final guard: never re-seed a concept that already has cards.
  const { data: existingCards } = await supabase
    .from("srs_cards")
    .select("source_id")
    .eq("source_type", "aiml_concept")
    .in("source_id", claimed.map((c) => c.id));

  const hasCards = new Set((existingCards ?? []).map((c) => c.source_id));
  const unseeded = claimed.filter((c) => !hasCards.has(c.id));

  // Release any claim we won't use so it isn't stuck in 'seeding'.
  const releaseIds = claimed.filter((c) => hasCards.has(c.id)).map((c) => c.id);
  if (releaseIds.length > 0) {
    await supabase
      .from("aiml_concepts")
      .update({ card_status: "seeded", card_status_updated_at: now.toISOString() })
      .in("id", releaseIds);
  }

  return unseeded;
}

/**
 * Reset a seeding claim back to 'none' so it can be retried (roadmap Phase 1a).
 * Called when seeding fails after the row was claimed, so the prereq doesn't get
 * stuck in 'seeding' until the stale window elapses.
 */
export async function releaseSeedingClaim(
  supabase: SupabaseClient<Database>,
  conceptIds: string[]
): Promise<void> {
  if (conceptIds.length === 0) return;
  await supabase
    .from("aiml_concepts")
    .update({ card_status: "none", card_status_updated_at: new Date().toISOString() })
    .in("id", conceptIds)
    .eq("card_status", "seeding");
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
          // Release the claim so this prereq can be retried by either path.
          await releaseSeedingClaim(admin, [concept.id]);
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
          await releaseSeedingClaim(admin, [concept.id]);
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
        await releaseSeedingClaim(admin, [concept.id]).catch(() => {});
      }
    }
  })();
}
