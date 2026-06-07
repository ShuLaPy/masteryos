"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { TrendingUp } from "lucide-react";

export interface TrajectoryPoint {
  week: string;
  avg_score: number;
  count: number;
}

function shortDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

interface TooltipPayload {
  payload?: Array<{ value: number; payload: TrajectoryPoint }>;
  label?: string;
}

function CustomTooltip({ payload, label }: TooltipPayload) {
  const point = payload?.[0]?.payload;
  if (!point) return null;
  return (
    <div className="glass rounded-lg px-3 py-2 text-xs border border-border/60">
      <p className="text-muted-foreground mb-0.5">Week of {shortDate(label ?? point.week)}</p>
      <p className="font-medium text-foreground">
        Avg score: {Math.round(point.avg_score * 100)}%
      </p>
      <p className="text-muted-foreground">{point.count} attempt{point.count !== 1 ? "s" : ""}</p>
    </div>
  );
}

interface Props {
  trajectory: TrajectoryPoint[];
}

export default function TrajectorySparkline({ trajectory }: Props) {
  if (trajectory.length < 2) {
    return (
      <div className="glass rounded-xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <TrendingUp className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Performance Trend
          </h2>
        </div>
        <div className="h-24 flex items-center justify-center text-xs text-muted-foreground">
          Solve a few problems across multiple weeks to see your trend.
        </div>
      </div>
    );
  }

  const chartData = trajectory.map((t) => ({
    ...t,
    score_pct: Math.round(t.avg_score * 100),
  }));

  return (
    <div className="glass rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Performance Trend
          </h2>
        </div>
        <span className="text-xs text-muted-foreground">
          Last {trajectory.length} week{trajectory.length !== 1 ? "s" : ""} · avg outcome score
        </span>
      </div>

      <ResponsiveContainer width="100%" height={96}>
        <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
          <defs>
            <linearGradient id="scoreGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#7c3aed" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#7c3aed" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="week"
            tickFormatter={shortDate}
            tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={[0, 100]}
            tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => `${v}%`}
          />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="score_pct"
            stroke="#7c3aed"
            strokeWidth={2}
            fill="url(#scoreGrad)"
            dot={{ r: 3, fill: "#7c3aed", stroke: "#7c3aed" }}
            activeDot={{ r: 5, fill: "#7c3aed", stroke: "#111827", strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
