"use client";

import { motion } from "framer-motion";
import {
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import type { CalibrationPoint } from "@/lib/analytics";

interface CalibrationChartProps {
  data: CalibrationPoint[];
}

export default function CalibrationChart({ data }: CalibrationChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-sm text-muted-foreground text-center px-4">
        <p>Rate your confidence during reviews to see calibration data</p>
        <p className="text-xs mt-1">Use the 1–5 confidence picker before rating cards</p>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="h-56"
    >
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis
            type="number"
            dataKey="confidence"
            name="Predicted"
            domain={[0.5, 5.5]}
            ticks={[1, 2, 3, 4, 5]}
            tick={{ fill: "#9ca3af", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            label={{
              value: "Predicted confidence",
              position: "insideBottom",
              offset: -2,
              fill: "#6b7280",
              fontSize: 10,
            }}
          />
          <YAxis
            type="number"
            dataKey="successRate"
            name="Actual"
            domain={[0, 100]}
            tick={{ fill: "#9ca3af", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `${v}%`}
            label={{
              value: "Actual success %",
              angle: -90,
              position: "insideLeft",
              fill: "#6b7280",
              fontSize: 10,
            }}
          />
          <ZAxis type="number" dataKey="count" range={[60, 400]} />
          <Tooltip
            contentStyle={{
              background: "#111827",
              border: "1px solid #1f2937",
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(value, name, props) => {
              const p = props.payload as CalibrationPoint;
              if (name === "Actual") {
                return [`${value}% (${p.count} reviews)`, "Success rate"];
              }
              return [value, name];
            }}
          />
          <ReferenceLine
            segment={[
              { x: 1, y: 20 },
              { x: 5, y: 100 },
            ]}
            stroke="#6b7280"
            strokeDasharray="4 4"
          />
          <Scatter
            name="Your calibration"
            data={data}
            fill="#7c3aed"
            animationDuration={800}
          />
        </ScatterChart>
      </ResponsiveContainer>
    </motion.div>
  );
}
