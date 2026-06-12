/**
 * Lecture lifecycle (Prime → Capture → Reinforce).
 *
 * Derives, per active lecture, where the student stands in the flagship loop:
 *
 *   prep      — upcoming: clear the prerequisite runway, take the pretest
 *   capture   — attended but notes not ingested: brain dump → notes
 *   reinforce — ingested: 24h / 72h / 7d recall checkpoints (forgetting curve —
 *               the first review within ~24h matters most)
 *   complete  — the 7d checkpoint has closed
 *
 * Checkpoints are READ-ONLY over the reviews log: they make the windows visible
 * and urgent, but FSRS scheduling is never touched. A checkpoint is "done" when
 * ≥80% of the lecture's seed cards have been reviewed since attended_at.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

// ─── Types ───────────────────────────────────────────────────────────────────

export type LifecycleStage = "prep" | "capture" | "reinforce" | "complete";
export type CheckpointWindow = "24h" | "72h" | "7d";
export type CheckpointStatus = "upcoming" | "open" | "done" | "missed";

export interface ReinforcementCheckpoint {
  window: CheckpointWindow;
  /** ISO timestamp: attended_at + 24h/72h/7d. */
  closesAt: string;
  status: CheckpointStatus;
  cardsReviewed: number;
  cardsTotal: number;
}

export interface LectureLifecycle {
  lectureId: string;
  title: string;
  weekNumber: number;
  scheduledDate: string;
  stage: LifecycleStage;
  prep: {
    /** 0–100, from mentor intel (null when not available). */
    readinessPct: number | null;
    /** Prereqs still unstudied/weak (from mentor intel; 0 when unknown). */
    gapCount: number;
    pretestUnlocked: boolean;
    pretestTaken: boolean;
  };
  capture: {
    attended: boolean;
    brainDumpDone: boolean;
    notesIngested: boolean;
  };
  reinforce: ReinforcementCheckpoint[] | null;
  nextAction: { label: string; href: string } | null;
}

/** Per-lecture prep numbers the caller derives from computeLectureIntelligence. */
export interface PrepIntel {
  readinessPct: number;
  gapCount: number;
}

// ─── Checkpoint math (pure) ───────────────────────────────────────────────────

const MS_PER_HOUR = 3_600_000;
const WINDOWS: { window: CheckpointWindow; hours: number }[] = [
  { window: "24h", hours: 24 },
  { window: "72h", hours: 72 },
  { window: "7d", hours: 168 },
];
/** Fraction of seed cards that must be reviewed for a checkpoint to count. */
const DONE_FRACTION = 0.8;
/** Pretest unlocks within this many days of the lecture (mirrors pretest route). */
const PRETEST_UNLOCK_DAYS = 2;
/** Attended lectures stay "active" until the last checkpoint has long closed. */
const ACTIVE_AFTER_ATTEND_DAYS = 8;
/** How many upcoming lectures get a lifecycle card. */
const MAX_UPCOMING = 2;

/**
 * Compute the 24h/72h/7d checkpoints for one lecture. Windows are cumulative:
 * a card reviewed in hour 3 counts toward all three.
 */
export function computeReinforcementCheckpoints(
  attendedAt: string,
  cardIds: string[],
  reviews: { card_id: string; created_at: string }[],
  now: Date = new Date()
): ReinforcementCheckpoint[] {
  const startMs = Date.parse(attendedAt);
  const nowMs = now.getTime();
  const cardIdSet = new Set(cardIds);
  const total = cardIds.length;
  const needed = Math.max(1, Math.ceil(DONE_FRACTION * total));

  let prevCloseMs = startMs;
  return WINDOWS.map(({ window, hours }) => {
    const closeMs = startMs + hours * MS_PER_HOUR;
    const reviewed = new Set(
      reviews
        .filter((r) => {
          const t = Date.parse(r.created_at);
          return cardIdSet.has(r.card_id) && t >= startMs && t <= closeMs;
        })
        .map((r) => r.card_id)
    ).size;

    let status: CheckpointStatus;
    if (total > 0 && reviewed >= needed) status = "done";
    else if (nowMs > closeMs) status = "missed";
    else if (nowMs >= prevCloseMs) status = "open";
    else status = "upcoming";

    prevCloseMs = closeMs;
    return {
      window,
      closesAt: new Date(closeMs).toISOString(),
      status,
      cardsReviewed: reviewed,
      cardsTotal: total,
    };
  });
}

// ─── Loader ───────────────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;

/** Calendar-day number (UTC) for a 'YYYY-MM-DD' (or ISO) date string. */
function dayNumber(dateStr: string): number {
  const t = Date.parse(`${dateStr.substring(0, 10)}T00:00:00Z`);
  return Number.isNaN(t) ? NaN : Math.floor(t / MS_PER_DAY);
}

/**
 * Compute lifecycle cards for the user's active lectures: the next
 * {@link MAX_UPCOMING} upcoming plus lectures attended within the last
 * {@link ACTIVE_AFTER_ATTEND_DAYS} days. `prepIntel` (readiness % + gap count
 * per upcoming lecture id) comes from computeLectureIntelligence so prep
 * numbers match the mentor/Schedule widgets exactly.
 */
export async function computeLectureLifecycles(
  supabase: Client,
  userId: string,
  prepIntel: Map<string, PrepIntel> = new Map(),
  today: string = new Date().toISOString().slice(0, 10)
): Promise<{ data: LectureLifecycle[] | null; error: string | null }> {
  const { data: schedules, error: schedulesError } = await supabase
    .from("lecture_schedules")
    .select(
      "id, title, week_number, scheduled_date, is_attended, attended_at, brain_dump_at, extracted_concept_ids, pretest_taken_at"
    )
    .eq("user_id", userId)
    .order("scheduled_date", { ascending: true })
    .order("week_number", { ascending: true });

  if (schedulesError) {
    return { data: null, error: `Failed to load schedule: ${schedulesError.message}` };
  }

  const now = new Date();
  const todayNum = dayNumber(today);
  const all = schedules ?? [];

  const upcoming = all
    .filter((l) => !l.is_attended && dayNumber(l.scheduled_date) >= todayNum)
    .slice(0, MAX_UPCOMING);

  const recentAttended = all.filter(
    (l) =>
      l.is_attended &&
      l.attended_at !== null &&
      now.getTime() - Date.parse(l.attended_at) <=
        ACTIVE_AFTER_ATTEND_DAYS * MS_PER_DAY
  );

  // ── Load seed cards + reviews for the attended lectures' concepts ───────────
  const conceptIds = Array.from(
    new Set(recentAttended.flatMap((l) => l.extracted_concept_ids ?? []))
  );
  const cardsByConcept = new Map<string, string[]>();
  let reviews: { card_id: string; created_at: string }[] = [];

  if (conceptIds.length > 0) {
    const { data: cards } = await supabase
      .from("srs_cards")
      .select("id, source_id")
      .eq("user_id", userId)
      .eq("source_type", "aiml_concept")
      .in("source_id", conceptIds);

    for (const card of cards ?? []) {
      const list = cardsByConcept.get(card.source_id);
      if (list) list.push(card.id);
      else cardsByConcept.set(card.source_id, [card.id]);
    }

    const allCardIds = (cards ?? []).map((c) => c.id);
    const earliestAttend = recentAttended
      .map((l) => l.attended_at as string)
      .sort()[0];
    if (allCardIds.length > 0 && earliestAttend) {
      const { data: reviewRows } = await supabase
        .from("reviews")
        .select("card_id, created_at")
        .eq("user_id", userId)
        .in("card_id", allCardIds)
        .gte("created_at", earliestAttend);
      reviews = reviewRows ?? [];
    }
  }

  // ── Build lifecycle cards ────────────────────────────────────────────────────
  const lifecycles: LectureLifecycle[] = [];

  for (const lecture of upcoming) {
    const intel = prepIntel.get(lecture.id) ?? null;
    const daysUntil = dayNumber(lecture.scheduled_date) - todayNum;
    const pretestUnlocked = daysUntil <= PRETEST_UNLOCK_DAYS;
    const pretestTaken = lecture.pretest_taken_at !== null;

    let nextAction: LectureLifecycle["nextAction"] = null;
    if (pretestUnlocked && !pretestTaken) {
      nextAction = { label: "Take pretest", href: "/schedule/prep" };
    } else if ((intel?.gapCount ?? 0) > 0) {
      nextAction = {
        label: `Review weak prereqs (${intel?.gapCount})`,
        href: "/schedule/prep",
      };
    }

    lifecycles.push({
      lectureId: lecture.id,
      title: lecture.title,
      weekNumber: lecture.week_number,
      scheduledDate: lecture.scheduled_date,
      stage: "prep",
      prep: {
        readinessPct: intel?.readinessPct ?? null,
        gapCount: intel?.gapCount ?? 0,
        pretestUnlocked,
        pretestTaken,
      },
      capture: { attended: false, brainDumpDone: false, notesIngested: false },
      reinforce: null,
      nextAction,
    });
  }

  for (const lecture of recentAttended) {
    const extractedIds = lecture.extracted_concept_ids ?? [];
    const ingested = extractedIds.length > 0;
    const brainDumpDone = lecture.brain_dump_at !== null;

    let stage: LifecycleStage;
    let reinforce: ReinforcementCheckpoint[] | null = null;
    let nextAction: LectureLifecycle["nextAction"] = null;

    if (!ingested) {
      stage = "capture";
      nextAction = brainDumpDone
        ? { label: "Add lecture notes", href: "/schedule" }
        : { label: "Capture brain dump", href: "/schedule" };
    } else {
      const cardIds = extractedIds.flatMap((id) => cardsByConcept.get(id) ?? []);
      reinforce = computeReinforcementCheckpoints(
        lecture.attended_at as string,
        cardIds,
        reviews,
        now
      );
      const lastClosed = reinforce.every(
        (cp) => cp.status === "done" || cp.status === "missed"
      );
      stage = lastClosed || cardIds.length === 0 ? "complete" : "reinforce";

      const openCp = reinforce.find((cp) => cp.status === "open");
      if (openCp) {
        const remaining = openCp.cardsTotal - openCp.cardsReviewed;
        if (remaining > 0) {
          nextAction = {
            label: `Review ${remaining} card${remaining === 1 ? "" : "s"}`,
            href: "/review",
          };
        }
      }
    }

    lifecycles.push({
      lectureId: lecture.id,
      title: lecture.title,
      weekNumber: lecture.week_number,
      scheduledDate: lecture.scheduled_date,
      stage,
      prep: {
        readinessPct: null,
        gapCount: 0,
        pretestUnlocked: false,
        pretestTaken: lecture.pretest_taken_at !== null,
      },
      capture: { attended: true, brainDumpDone, notesIngested: ingested },
      reinforce,
      nextAction,
    });
  }

  // Attended lectures first (freshest capture/reinforce work), then upcoming.
  lifecycles.sort((a, b) => {
    const stageOrder: Record<LifecycleStage, number> = {
      capture: 0,
      reinforce: 1,
      prep: 2,
      complete: 3,
    };
    if (stageOrder[a.stage] !== stageOrder[b.stage]) {
      return stageOrder[a.stage] - stageOrder[b.stage];
    }
    return a.scheduledDate < b.scheduledDate ? -1 : 1;
  });

  return { data: lifecycles, error: null };
}
