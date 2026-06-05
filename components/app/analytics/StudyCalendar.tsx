"use client";

import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import * as d3 from "d3";
import type { DailyActivity } from "@/lib/analytics";

interface StudyCalendarProps {
  calendar: DailyActivity[];
  dailyMinutes: DailyActivity[];
}

export default function StudyCalendar({ calendar, dailyMinutes }: StudyCalendarProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  const totalReviews = calendar.reduce((s, d) => s + d.count, 0);

  useEffect(() => {
    if (!svgRef.current || calendar.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const cellSize = 11;
    const cellGap = 2;
    const weeks = 52;
    const days = 7;

    const maxCount = Math.max(1, ...calendar.map((d) => d.count));
    const colorScale = d3
      .scaleLinear<string>()
      .domain([0, 1, maxCount])
      .range(["#1f2937", "#4c1d95", "#10b981"]);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    calendar.forEach((day, i) => {
      const dayDate = new Date(day.date);
      const daysFromEnd = calendar.length - 1 - i;
      const col = Math.floor(daysFromEnd / 7);
      const row = dayDate.getDay();

      if (col >= weeks) return;

      svg
        .append("rect")
        .attr("x", col * (cellSize + cellGap))
        .attr("y", row * (cellSize + cellGap))
        .attr("width", cellSize)
        .attr("height", cellSize)
        .attr("rx", 2)
        .attr("fill", colorScale(day.count))
        .append("title")
        .text(`${day.date}: ${day.count} reviews`);
    });
  }, [calendar]);

  if (totalReviews === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
        Complete reviews to see study activity
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="space-y-4"
    >
      <div className="overflow-x-auto">
        <svg ref={svgRef} width={52 * 13} height={7 * 13} className="min-w-0" />
      </div>

      <div className="h-32">
        <p className="text-xs text-muted-foreground mb-2">Daily study time (last 30 days)</p>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={dailyMinutes} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <XAxis
              dataKey="date"
              tick={{ fill: "#9ca3af", fontSize: 9 }}
              axisLine={false}
              tickLine={false}
              interval={6}
            />
            <YAxis
              tick={{ fill: "#9ca3af", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => `${v}m`}
            />
            <Tooltip
              contentStyle={{
                background: "#111827",
                border: "1px solid #1f2937",
                borderRadius: 8,
                fontSize: 11,
              }}
              formatter={(value) => [`${value} min`, "Study time"]}
            />
            <Bar
              dataKey="minutes"
              fill="#7c3aed"
              radius={[2, 2, 0, 0]}
              animationDuration={800}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </motion.div>
  );
}
