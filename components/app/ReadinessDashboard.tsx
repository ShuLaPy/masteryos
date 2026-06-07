"use client";

import { useEffect, useState } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { TrendingUp, Loader2 } from "lucide-react";
import { getRetentionColor } from "@/lib/fsrs";

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

interface ReadinessData {
  lectureReadiness: LectureReadiness[];
  retentionTrajectory: WeekBucket[];
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Tailwind bg color mapped from the text color returned by getRetentionColor */
function retentionBgColor(score: number): string {
  if (score >= 0.85) return "bg-emerald-400";
  if (score >= 0.65) return "bg-amber-400";
  if (score >= 0.4) return "bg-orange-400";
  return "bg-red-400";
}

function shortDate(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${parseInt(month)}/${parseInt(day)}`;
}

// ─── Sparkline tooltip ─────────────────────────────────────────────────────

function SparkTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass rounded-lg px-3 py-2 text-xs border border-border/60">
      <p className="text-muted-foreground">{label}</p>
      <p className="font-semibold text-foreground">
        {(payload[0].value * 100).toFixed(1)}%
      </p>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────

export function ReadinessDashboard() {
  const [data, setData] = useState<ReadinessData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/metrics/readiness")
      .then((r) => r.json())
      .then((json: { data: ReadinessData | null; error: string | null }) => {
        if (json.error || !json.data) {
          setError(json.error ?? "Failed to load readiness data");
        } else {
          setData(json.data);
        }
      })
      .catch(() => setError("Network error"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="glass rounded-2xl p-6 flex items-center gap-3 text-muted-foreground text-sm">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading readiness data…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="glass rounded-2xl p-6 text-sm text-red-400">
        {error ?? "No data available."}
      </div>
    );
  }

  const { lectureReadiness, retentionTrajectory } = data;

  // Fill null weeks with 0 for the chart (Recharts skips undefined; we show gaps as 0)
  const chartData = retentionTrajectory.map((w) => ({
    week: shortDate(w.weekStart),
    r: w.avgRetentionality ?? 0,
    hasData: w.avgRetentionality !== null,
  }));

  const latestR =
    [...retentionTrajectory].reverse().find((w) => w.avgRetentionality !== null)
      ?.avgRetentionality ?? null;

  return (
    <div className="space-y-5">
      {/* ── Retention Trajectory sparkline ────────────────────────────── */}
      <div className="glass rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">
              Weekly Retention
            </h3>
          </div>
          {latestR !== null && (
            <span className={`text-sm font-semibold ${getRetentionColor(latestR)}`}>
              {(latestR * 100).toFixed(1)}% this week
            </span>
          )}
        </div>
        <div className="h-28">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id="retGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#7c3aed" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#7c3aed" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="week"
                tick={{ fontSize: 10, fill: "#6b7280" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                domain={[0, 1]}
                tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
                tick={{ fontSize: 10, fill: "#6b7280" }}
                axisLine={false}
                tickLine={false}
                width={36}
              />
              <Tooltip content={<SparkTooltip />} />
              <Area
                type="monotone"
                dataKey="r"
                stroke="#7c3aed"
                strokeWidth={2}
                fill="url(#retGrad)"
                dot={{ r: 3, fill: "#7c3aed", strokeWidth: 0 }}
                activeDot={{ r: 4, fill: "#7c3aed" }}
                connectNulls={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Per-lecture readiness ──────────────────────────────────────── */}
      {lectureReadiness.length > 0 && (
        <div className="glass rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">
            Lecture Readiness
          </h3>
          <div className="space-y-3">
            {lectureReadiness.map((lec) => {
              const pct = Math.round(lec.readinessScore * 100);
              const coveragePct = Math.round(lec.coverage * 100);
              const colorClass = getRetentionColor(lec.readinessScore);
              const bgClass = retentionBgColor(lec.readinessScore);
              return (
                <div key={lec.lectureId}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs text-muted-foreground shrink-0">
                        {shortDate(lec.scheduledDate)}
                      </span>
                      <span className="text-xs text-foreground truncate">
                        {lec.title}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 ml-3">
                      <span className="text-[10px] text-muted-foreground">
                        {coveragePct}% covered
                      </span>
                      <span className={`text-xs font-semibold tabular-nums ${colorClass}`}>
                        {pct}%
                      </span>
                    </div>
                  </div>
                  <div className="h-1.5 rounded-full bg-secondary/60 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${bgClass}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
