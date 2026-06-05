"use client";

import { motion } from "framer-motion";
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Cell,
} from "recharts";
import type { ForecastDay } from "@/lib/analytics";

interface ReviewForecastProps {
  data: ForecastDay[];
}

export default function ReviewForecast({ data }: ReviewForecastProps) {
  const total = data.reduce((s, d) => s + d.count, 0);

  if (total === 0 && data.every((d) => d.count === 0)) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
        No reviews scheduled for the next 7 days
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="h-48"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <XAxis
            dataKey="label"
            tick={{ fill: "#9ca3af", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fill: "#9ca3af", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={{
              background: "#111827",
              border: "1px solid #1f2937",
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(value) => [`${value} cards`, "Due"]}
          />
          <Bar dataKey="count" radius={[4, 4, 0, 0]} animationDuration={800}>
            {data.map((entry) => (
              <Cell
                key={entry.date}
                fill={entry.isToday ? "#7c3aed" : "#4c1d95"}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </motion.div>
  );
}
