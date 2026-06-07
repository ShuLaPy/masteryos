import { createClient } from "@/lib/supabase/server";
import { dbCardToFSRS, getRetrievability } from "@/lib/fsrs";

// ─── Types ─────────────────────────────────────────────────────────────────

interface LectureReadiness {
  lectureId: string;
  title: string;
  scheduledDate: string;
  readinessScore: number;
  coverage: number;
}

interface WeekBucket {
  weekStart: string;
  avgRetentionality: number | null;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** ISO date string for Monday of the week containing `ts` (UTC). */
function weekStartISO(ts: number): string {
  const d = new Date(ts);
  const day = d.getUTCDay(); // 0 = Sun
  const diff = day === 0 ? -6 : 1 - day; // shift to Monday
  const mon = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff));
  return mon.toISOString().substring(0, 10);
}

// ─── Route ─────────────────────────────────────────────────────────────────

/**
 * GET /api/metrics/readiness
 *
 * Returns:
 *   lectureReadiness  — per-lecture readiness score + coverage, computed at query time
 *   retentionTrajectory — weekly avg retrievability_at_review for the last 8 weeks
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  // ── Fetch in parallel ───────────────────────────────────────────────────
  const [schedulesRes, cardsRes, reviewsRes] = await Promise.all([
    supabase
      .from("lecture_schedules")
      .select("id, title, scheduled_date, prerequisite_concept_ids")
      .eq("user_id", user.id)
      .order("scheduled_date", { ascending: true }),
    supabase
      .from("srs_cards")
      .select(
        "id, source_id, source_type, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review, due"
      )
      .eq("user_id", user.id)
      .eq("source_type", "aiml_concept"),
    supabase
      .from("reviews")
      .select("created_at, retrievability_at_review")
      .eq("user_id", user.id)
      .gte(
        "created_at",
        new Date(Date.now() - 8 * 7 * 86400 * 1000).toISOString()
      ),
  ]);

  if (schedulesRes.error)
    return Response.json({ data: null, error: schedulesRes.error.message }, { status: 500 });
  if (cardsRes.error)
    return Response.json({ data: null, error: cardsRes.error.message }, { status: 500 });
  if (reviewsRes.error)
    return Response.json({ data: null, error: reviewsRes.error.message }, { status: 500 });

  const lectures = schedulesRes.data ?? [];
  const conceptCards = cardsRes.data ?? [];
  const reviews = reviewsRes.data ?? [];

  // ── Build concept → cards index ─────────────────────────────────────────
  // source_id is concept UUID when source_type = 'aiml_concept'
  const cardsByConceptId = new Map<string, typeof conceptCards>();
  for (const card of conceptCards) {
    const list = cardsByConceptId.get(card.source_id) ?? [];
    list.push(card);
    cardsByConceptId.set(card.source_id, list);
  }

  // ── Lecture readiness ───────────────────────────────────────────────────
  const lectureReadiness: LectureReadiness[] = lectures.map((lecture) => {
    const prereqIds = (lecture.prerequisite_concept_ids as string[] | null) ?? [];

    if (prereqIds.length === 0) {
      return {
        lectureId: lecture.id,
        title: lecture.title,
        scheduledDate: lecture.scheduled_date,
        readinessScore: 1,
        coverage: 1,
      };
    }

    let totalR = 0;
    let studiedCount = 0;

    for (const conceptId of prereqIds) {
      const cards = cardsByConceptId.get(conceptId);
      if (!cards || cards.length === 0) {
        // Unstudied prereq: treat R = 0 (spec §12)
        totalR += 0;
        continue;
      }
      studiedCount++;
      // Average retrievability across the concept's cards
      let conceptR = 0;
      for (const card of cards) {
        const fsrsCard = dbCardToFSRS(card as Parameters<typeof dbCardToFSRS>[0]);
        conceptR += getRetrievability(fsrsCard);
      }
      totalR += conceptR / cards.length;
    }

    return {
      lectureId: lecture.id,
      title: lecture.title,
      scheduledDate: lecture.scheduled_date,
      readinessScore: totalR / prereqIds.length,
      coverage: studiedCount / prereqIds.length,
    };
  });

  // ── Retention trajectory (last 8 complete weeks) ────────────────────────
  // Bucket reviews by the ISO week-start (Monday) in which they occurred,
  // then average retrievability_at_review within each bucket.
  const now = Date.now();
  const weekBuckets = new Map<string, { sum: number; count: number }>();

  // Pre-populate all 8 week slots (oldest → newest) so gaps show up as null
  for (let i = 7; i >= 0; i--) {
    const key = weekStartISO(now - i * 7 * 86400 * 1000);
    if (!weekBuckets.has(key)) weekBuckets.set(key, { sum: 0, count: 0 });
  }

  for (const review of reviews) {
    const ts = new Date(review.created_at).getTime();
    const key = weekStartISO(ts);
    const bucket = weekBuckets.get(key);
    if (bucket) {
      bucket.sum += review.retrievability_at_review;
      bucket.count += 1;
    }
  }

  const retentionTrajectory: WeekBucket[] = Array.from(weekBuckets.entries()).map(
    ([weekStart, { sum, count }]) => ({
      weekStart,
      avgRetentionality: count > 0 ? sum / count : null,
    })
  );

  return Response.json({
    data: { lectureReadiness, retentionTrajectory },
    error: null,
  });
}
