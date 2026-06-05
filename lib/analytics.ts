import { DSA_PATTERNS } from "@/lib/constants";
import { dbCardToFSRS, getRetrievability } from "@/lib/fsrs";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ConceptRecord {
  id: string;
  title: string;
  mastery_score: number | null;
  prerequisites?: string[] | null;
  created_at?: string;
}

export interface SRSCardRecord {
  source_id: string;
  source_type: string;
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  state: string;
  last_review: string | null;
}

export interface ReviewRecord {
  rating: number;
  duration_seconds: number;
  created_at: string;
  confidence_predicted?: number | null;
  retrievability_at_review?: number;
}

export interface DSAProblemRecord {
  patterns: string[] | null;
  confidence: number | null;
  solved_at: string;
}

export interface ConceptRetention {
  id: string;
  title: string;
  retention: number;
}

export interface TimelinePoint {
  week: string;
  aimlPct: number;
  dsaPct: number;
  retentionPct: number;
  targetPct: number;
}

export interface PatternStat {
  pattern: string;
  count: number;
  avgConfidence: number;
  trend: number;
}

export interface GraphNode {
  id: string;
  title: string;
  mastery: number;
}

export interface GraphLink {
  source: string;
  target: string;
}

export interface CalibrationPoint {
  confidence: number;
  successRate: number;
  count: number;
}

export interface DailyActivity {
  date: string;
  count: number;
  minutes: number;
}

export interface ForecastDay {
  date: string;
  label: string;
  count: number;
  isToday: boolean;
}

export interface PacePrediction {
  currentPatterns: number;
  ratePerWeek: number;
  projectedByMonth4: number;
  weeklyHistory: { week: string; patterns: number }[];
}

export interface AnalyticsKPIs {
  streak: number;
  reviewCards: number;
  learningCards: number;
  totalCards: number;
  timeSpentMins: number;
  totalReviews: number;
  avgStability: number;
  avgMastery: number;
  totalConcepts: number;
  avgDSAConf: number;
  totalDSA: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function formatDateKey(d: Date): string {
  return d.toISOString().split("T")[0];
}

function formatShortDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function getWeekStart(d: Date): Date {
  const x = startOfDay(d);
  const day = x.getDay();
  x.setDate(x.getDate() - day);
  return x;
}

// ─── Aggregators ─────────────────────────────────────────────────────────────

export function getConceptRetentionGrid(
  concepts: ConceptRecord[],
  cards: SRSCardRecord[]
): ConceptRetention[] {
  return concepts.map((concept) => {
    const conceptCards = cards.filter(
      (c) => c.source_type === "aiml_concept" && c.source_id === concept.id
    );

    if (conceptCards.length === 0) {
      const fallback = concept.mastery_score ?? 0;
      return { id: concept.id, title: concept.title, retention: fallback };
    }

    const retentions = conceptCards.map((c) =>
      getRetrievability(dbCardToFSRS(c))
    );
    const avg =
      retentions.reduce((s, r) => s + r, 0) / retentions.length;

    return {
      id: concept.id,
      title: concept.title,
      retention: Math.round(avg * 100) / 100,
    };
  });
}

export function getProgressTimeline(
  accountStart: string,
  concepts: ConceptRecord[],
  problems: DSAProblemRecord[],
  reviews: ReviewRecord[]
): TimelinePoint[] {
  const start = getWeekStart(new Date(accountStart));
  const end = new Date(start);
  end.setMonth(end.getMonth() + 8);

  const points: TimelinePoint[] = [];
  const totalWeeks = Math.ceil(
    (end.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000)
  );

  for (let w = 0; w <= totalWeeks; w++) {
    const weekEnd = new Date(start);
    weekEnd.setDate(weekEnd.getDate() + (w + 1) * 7);

    const conceptsByWeek = concepts.filter(
      (c) => c.created_at && new Date(c.created_at) <= weekEnd
    );
    const mastered = conceptsByWeek.filter(
      (c) => (c.mastery_score ?? 0) >= 0.8
    ).length;
    const aimlPct =
      conceptsByWeek.length > 0
        ? Math.round((mastered / conceptsByWeek.length) * 100)
        : 0;

    const patternsSeen = new Set<string>();
    for (const p of problems) {
      if (new Date(p.solved_at) <= weekEnd) {
        for (const pat of p.patterns ?? []) patternsSeen.add(pat);
      }
    }
    const dsaPct = Math.round((patternsSeen.size / 25) * 100);

    const weekReviews = reviews.filter((r) => {
      const d = new Date(r.created_at);
      const weekStart = new Date(start);
      weekStart.setDate(weekStart.getDate() + w * 7);
      return d >= weekStart && d < weekEnd;
    });
    const retentionPct =
      weekReviews.length > 0
        ? Math.round(
            (weekReviews.reduce(
              (s, r) => s + (r.retrievability_at_review ?? 0),
              0
            ) /
              weekReviews.length) *
              100
          )
        : 0;

    const targetPct = Math.min(
      100,
      Math.round((w / totalWeeks) * 100)
    );

    const weekLabel = new Date(start);
    weekLabel.setDate(weekLabel.getDate() + w * 7);

    points.push({
      week: weekLabel.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
      aimlPct,
      dsaPct,
      retentionPct,
      targetPct,
    });
  }

  return points;
}

export function getPatternBreakdown(
  problems: DSAProblemRecord[]
): PatternStat[] {
  const now = Date.now();
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;

  return DSA_PATTERNS.map((pattern) => {
    const pProbs = problems.filter((p) => (p.patterns ?? []).includes(pattern));
    const count = pProbs.length;
    const avgConfidence =
      count > 0
        ? pProbs.reduce((acc, curr) => acc + (curr.confidence ?? 0), 0) / count
        : 0;

    const recent = pProbs.filter(
      (p) => now - new Date(p.solved_at).getTime() <= thirtyDays
    ).length;
    const prior = pProbs.filter((p) => {
      const age = now - new Date(p.solved_at).getTime();
      return age > thirtyDays && age <= 2 * thirtyDays;
    }).length;
    const trend = recent - prior;

    return { pattern, count, avgConfidence, trend };
  }).sort((a, b) => b.count - a.count);
}

export function getConceptGraph(concepts: ConceptRecord[]): {
  nodes: GraphNode[];
  links: GraphLink[];
} {
  const nodes: GraphNode[] = concepts.map((c) => ({
    id: c.id,
    title: c.title,
    mastery: c.mastery_score ?? 0,
  }));

  const links: GraphLink[] = [];
  for (const concept of concepts) {
    for (const prereqId of concept.prerequisites ?? []) {
      if (concepts.some((c) => c.id === prereqId)) {
        links.push({ source: prereqId, target: concept.id });
      }
    }
  }

  return { nodes, links };
}

export function getCalibrationData(reviews: ReviewRecord[]): CalibrationPoint[] {
  const buckets: Record<number, { total: number; success: number }> = {};

  for (const review of reviews) {
    const conf = review.confidence_predicted;
    if (!conf || conf < 1 || conf > 5) continue;
    if (!buckets[conf]) buckets[conf] = { total: 0, success: 0 };
    buckets[conf].total++;
    if (review.rating >= 3) buckets[conf].success++;
  }

  return [1, 2, 3, 4, 5]
    .map((confidence) => {
      const b = buckets[confidence];
      if (!b || b.total < 1) return null;
      return {
        confidence,
        successRate: Math.round((b.success / b.total) * 100),
        count: b.total,
      };
    })
    .filter((p): p is CalibrationPoint => p !== null);
}

export function getStudyActivity(reviews: ReviewRecord[]): {
  calendar: DailyActivity[];
  dailyMinutes: DailyActivity[];
} {
  const byDate: Record<string, { count: number; minutes: number }> = {};

  for (const review of reviews) {
    const key = formatDateKey(new Date(review.created_at));
    if (!byDate[key]) byDate[key] = { count: 0, minutes: 0 };
    byDate[key].count++;
    byDate[key].minutes += (review.duration_seconds ?? 0) / 60;
  }

  const calendar: DailyActivity[] = [];
  const today = startOfDay(new Date());
  for (let i = 364; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = formatDateKey(d);
    const entry = byDate[key] ?? { count: 0, minutes: 0 };
    calendar.push({
      date: key,
      count: entry.count,
      minutes: Math.round(entry.minutes),
    });
  }

  const dailyMinutes: DailyActivity[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = formatDateKey(d);
    const entry = byDate[key] ?? { count: 0, minutes: 0 };
    dailyMinutes.push({
      date: formatShortDate(d),
      count: entry.count,
      minutes: Math.round(entry.minutes),
    });
  }

  return { calendar, dailyMinutes };
}

export function getReviewForecast(cards: { due: string }[]): ForecastDay[] {
  const today = startOfDay(new Date());
  const days: ForecastDay[] = [];

  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const nextDay = new Date(d);
    nextDay.setDate(nextDay.getDate() + 1);

    const count = cards.filter((c) => {
      const due = new Date(c.due);
      return due >= d && due < nextDay;
    }).length;

    days.push({
      date: formatDateKey(d),
      label: i === 0 ? "Today" : formatShortDate(d),
      count,
      isToday: i === 0,
    });
  }

  return days;
}

export function getPacePrediction(
  problems: DSAProblemRecord[],
  accountStart: string
): PacePrediction {
  const patternsSeen = new Set<string>();
  const firstSeen: Record<string, Date> = {};

  for (const p of problems) {
    const solved = new Date(p.solved_at);
    for (const pat of p.patterns ?? []) {
      patternsSeen.add(pat);
      if (!firstSeen[pat] || solved < firstSeen[pat]) {
        firstSeen[pat] = solved;
      }
    }
  }

  const fourWeeksAgo = new Date();
  fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
  const recentPatterns = Object.entries(firstSeen).filter(
    ([, d]) => d >= fourWeeksAgo
  ).length;
  const ratePerWeek = recentPatterns / 4;

  const accountDate = new Date(accountStart);
  const month4 = new Date(accountDate);
  month4.setMonth(month4.getMonth() + 4);
  const weeksRemaining = Math.max(
    0,
    (month4.getTime() - Date.now()) / (7 * 24 * 60 * 60 * 1000)
  );
  const projectedByMonth4 = Math.min(
    25,
    Math.round(patternsSeen.size + ratePerWeek * weeksRemaining)
  );

  const weeklyHistory: { week: string; patterns: number }[] = [];
  const start = getWeekStart(accountDate);
  for (let w = 0; w < 8; w++) {
    const weekEnd = new Date(start);
    weekEnd.setDate(weekEnd.getDate() + (w + 1) * 7);
    const count = Object.values(firstSeen).filter((d) => d <= weekEnd).length;
    const weekLabel = new Date(start);
    weekLabel.setDate(weekLabel.getDate() + w * 7);
    weeklyHistory.push({
      week: weekLabel.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      patterns: count,
    });
  }

  return {
    currentPatterns: patternsSeen.size,
    ratePerWeek: Math.round(ratePerWeek * 10) / 10,
    projectedByMonth4,
    weeklyHistory,
  };
}

export function computeKPIs(
  profile: { streak_count?: number | null } | null,
  cards: { state: string; stability: number | null }[],
  reviews: ReviewRecord[],
  concepts: ConceptRecord[],
  problems: DSAProblemRecord[]
): AnalyticsKPIs {
  const totalCards = cards.length;
  const learningCards = cards.filter(
    (c) => c.state === "learning" || c.state === "relearning" || c.state === "new"
  ).length;
  const reviewCards = cards.filter((c) => c.state === "review").length;
  const avgStability =
    totalCards > 0
      ? cards.reduce((sum, c) => sum + (c.stability ?? 0), 0) / totalCards
      : 0;

  const totalReviews = reviews.length;
  const timeSpentSecs = reviews.reduce(
    (sum, r) => sum + (r.duration_seconds ?? 0),
    0
  );

  const totalConcepts = concepts.length;
  const avgMastery =
    totalConcepts > 0
      ? concepts.reduce((sum, c) => sum + (c.mastery_score ?? 0), 0) /
        totalConcepts
      : 0;

  const totalDSA = problems.length;
  const avgDSAConf =
    totalDSA > 0
      ? problems.reduce((sum, p) => sum + (p.confidence ?? 0), 0) / totalDSA
      : 0;

  return {
    streak: profile?.streak_count ?? 0,
    reviewCards,
    learningCards,
    totalCards,
    timeSpentMins: Math.round(timeSpentSecs / 60),
    totalReviews,
    avgStability,
    avgMastery,
    totalConcepts,
    avgDSAConf,
    totalDSA,
  };
}

export function retentionToColor(retention: number): string {
  if (retention >= 0.85) return "#10b981";
  if (retention >= 0.65) return "#f59e0b";
  if (retention >= 0.4) return "#f97316";
  if (retention > 0) return "#ef4444";
  return "#374151";
}

export function masteryToColor(mastery: number): string {
  if (mastery >= 0.8) return "#10b981";
  if (mastery >= 0.5) return "#f59e0b";
  if (mastery >= 0.2) return "#f97316";
  return "#ef4444";
}
