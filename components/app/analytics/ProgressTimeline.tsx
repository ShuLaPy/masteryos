"use client";

import { motion } from "framer-motion";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TimelinePoint } from "@/lib/analytics";

interface ProgressTimelineProps {
  data: TimelinePoint[];
}

export default function ProgressTimeline({ data }: ProgressTimelineProps) {
  const hasData = data.some(
    (d) => d.aimlPct > 0 || d.dsaPct > 0 || d.retentionPct > 0
  );

  if (!hasData) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-muted-foreground">
        Start learning to see your 8-month progress timeline
      </div>
    );
  }

  const tickInterval = Math.max(1, Math.floor(data.length / 8));

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="h-64"
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis
            dataKey="week"
            tick={{ fill: "#9ca3af", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            interval={tickInterval}
          />
          <YAxis
            domain={[0, 100]}
            tick={{ fill: "#9ca3af", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `${v}%`}
          />
          <Tooltip
            contentStyle={{
              background: "#111827",
              border: "1px solid #1f2937",
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(value, name) => [`${value}%`, name]}
          />
          <Legend
            wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
            formatter={(value) => (
              <span style={{ color: "#9ca3af" }}>{value}</span>
            )}
          />
          <Line
            type="monotone"
            dataKey="aimlPct"
            name="AIML"
            stroke="#7c3aed"
            strokeWidth={2}
            dot={false}
            animationDuration={1000}
          />
          <Line
            type="monotone"
            dataKey="dsaPct"
            name="DSA"
            stroke="#10b981"
            strokeWidth={2}
            dot={false}
            animationDuration={1000}
          />
          <Line
            type="monotone"
            dataKey="retentionPct"
            name="Retention"
            stroke="#f59e0b"
            strokeWidth={2}
            dot={false}
            animationDuration={1000}
          />
          <Line
            type="monotone"
            dataKey="targetPct"
            name="Target"
            stroke="#6b7280"
            strokeWidth={1.5}
            strokeDasharray="5 5"
            dot={false}
            animationDuration={1000}
          />
        </LineChart>
      </ResponsiveContainer>
    </motion.div>
  );
}
