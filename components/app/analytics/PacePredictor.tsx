"use client";

import { motion } from "framer-motion";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { TrendingUp } from "lucide-react";
import type { PacePrediction } from "@/lib/analytics";

interface PacePredictorProps {
  data: PacePrediction;
}

export default function PacePredictor({ data }: PacePredictorProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1 }}
      className="space-y-4"
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center shrink-0">
          <TrendingUp className="w-5 h-5 text-emerald-400" />
        </div>
        <div>
          <p className="text-sm text-muted-foreground">Pace Predictor</p>
          <p className="text-lg font-semibold text-foreground mt-1">
            At current pace: master{" "}
            <span className="text-emerald-400">{data.projectedByMonth4}/25</span>{" "}
            DSA patterns by month 4
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {data.currentPatterns} patterns explored · {data.ratePerWeek}/week rate
          </p>
        </div>
      </div>

      {data.weeklyHistory.some((w) => w.patterns > 0) && (
        <div className="h-20">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.weeklyHistory}>
              <defs>
                <linearGradient id="paceGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Tooltip
                contentStyle={{
                  background: "#111827",
                  border: "1px solid #1f2937",
                  borderRadius: 8,
                  fontSize: 11,
                }}
                formatter={(value) => [`${value} patterns`, "Cumulative"]}
              />
              <Area
                type="monotone"
                dataKey="patterns"
                stroke="#10b981"
                fill="url(#paceGrad)"
                animationDuration={800}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </motion.div>
  );
}
