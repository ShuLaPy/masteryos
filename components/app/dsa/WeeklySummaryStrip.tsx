import { TrendingUp, Trophy, BarChart3, Clock, Target, CheckCircle2 } from "lucide-react";

interface DifficultyCeiling {
  easy: number;
  medium: number;
  hard: number;
}

export interface WeeklySummary {
  avg_rating: number;
  breadth: number;
  difficulty_ceiling: DifficultyCeiling;
  median_time_to_insight_seconds: number | null;
  balance_score: number;
  recognition_accuracy_pct: number | null;
}

function formatTime(seconds: number | null): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function topCeiling(dc: DifficultyCeiling): string {
  if (dc.hard > 0) return "Hard";
  if (dc.medium > 0) return "Medium";
  if (dc.easy > 0) return "Easy";
  return "—";
}

export default function WeeklySummaryStrip({ summary }: { summary: WeeklySummary }) {
  const ceiling = topCeiling(summary.difficulty_ceiling);

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        Weekly Snapshot
      </p>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="glass rounded-xl p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <TrendingUp className="w-3.5 h-3.5 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">Avg Rating</p>
          </div>
          <p
            className={`text-2xl font-bold ${
              summary.avg_rating >= 1650
                ? "text-emerald-400"
                : summary.avg_rating >= 1500
                  ? "text-amber-400"
                  : "text-red-400"
            }`}
          >
            {summary.avg_rating}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">across 25 patterns</p>
        </div>

        <div className="glass rounded-xl p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <Trophy className="w-3.5 h-3.5 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">Breadth</p>
          </div>
          <p
            className={`text-2xl font-bold ${
              summary.breadth >= 10
                ? "text-emerald-400"
                : summary.breadth >= 3
                  ? "text-amber-400"
                  : "text-foreground"
            }`}
          >
            {summary.breadth}
            <span className="text-sm text-muted-foreground font-normal">/25</span>
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">patterns mastered</p>
        </div>

        <div className="glass rounded-xl p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <BarChart3 className="w-3.5 h-3.5 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">Difficulty Ceiling</p>
          </div>
          <p
            className={`text-2xl font-bold ${
              ceiling === "Hard"
                ? "text-red-400"
                : ceiling === "Medium"
                  ? "text-amber-400"
                  : ceiling === "Easy"
                    ? "text-emerald-400"
                    : "text-muted-foreground"
            }`}
          >
            {ceiling}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {summary.difficulty_ceiling.hard}H &middot; {summary.difficulty_ceiling.medium}M &middot;{" "}
            {summary.difficulty_ceiling.easy}E cleared
          </p>
        </div>

        <div className="glass rounded-xl p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <Clock className="w-3.5 h-3.5 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">Median Time</p>
          </div>
          <p className="text-2xl font-bold text-foreground">
            {formatTime(summary.median_time_to_insight_seconds)}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">to insight · last 7d</p>
        </div>

        <div className="glass rounded-xl p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <Target className="w-3.5 h-3.5 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">Balance</p>
          </div>
          <p
            className={`text-2xl font-bold ${
              summary.balance_score >= 0.85
                ? "text-emerald-400"
                : summary.balance_score >= 0.65
                  ? "text-amber-400"
                  : "text-red-400"
            }`}
          >
            {summary.balance_score.toFixed(2)}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">practice balance</p>
        </div>

        <div className="glass rounded-xl p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">Recognition</p>
          </div>
          <p
            className={`text-2xl font-bold ${
              summary.recognition_accuracy_pct == null
                ? "text-muted-foreground"
                : summary.recognition_accuracy_pct >= 70
                  ? "text-emerald-400"
                  : summary.recognition_accuracy_pct >= 50
                    ? "text-amber-400"
                    : "text-red-400"
            }`}
          >
            {summary.recognition_accuracy_pct != null
              ? `${summary.recognition_accuracy_pct}%`
              : "—"}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">accuracy · last 30d</p>
        </div>
      </div>
    </div>
  );
}
