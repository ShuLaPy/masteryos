"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Progress } from "@/components/ui/progress";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import type { PatternStat } from "@/lib/analytics";

interface PatternBreakdownProps {
  data: PatternStat[];
}

type SortKey = "pattern" | "count" | "avgConfidence" | "trend";

export default function PatternBreakdown({ data }: PatternBreakdownProps) {
  const [sortKey, setSortKey] = useState<SortKey>("count");
  const [sortAsc, setSortAsc] = useState(false);

  const sorted = [...data].sort((a, b) => {
    const mul = sortAsc ? 1 : -1;
    if (sortKey === "pattern") return mul * a.pattern.localeCompare(b.pattern);
    return mul * ((a[sortKey] as number) - (b[sortKey] as number));
  });

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(!sortAsc);
    else {
      setSortKey(key);
      setSortAsc(false);
    }
  }

  const explored = data.filter((d) => d.count > 0).length;

  if (explored === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
        Log DSA problems to see pattern breakdown
      </div>
    );
  }

  const headers: { key: SortKey; label: string }[] = [
    { key: "pattern", label: "Pattern" },
    { key: "count", label: "Solved" },
    { key: "avgConfidence", label: "Confidence" },
    { key: "trend", label: "Trend" },
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="max-h-80 overflow-y-auto custom-scrollbar"
    >
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-card/95 backdrop-blur">
          <tr className="text-xs text-muted-foreground">
            {headers.map((h) => (
              <th
                key={h.key}
                className="text-left py-2 px-2 font-medium cursor-pointer hover:text-foreground"
                onClick={() => toggleSort(h.key)}
              >
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((stat, i) => (
            <motion.tr
              key={stat.pattern}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.02 }}
              className="border-t border-border/30"
            >
              <td className="py-2 px-2 text-xs font-medium text-foreground max-w-[140px] truncate">
                {stat.pattern}
              </td>
              <td className="py-2 px-2 text-xs text-muted-foreground">{stat.count}</td>
              <td className="py-2 px-2">
                <div className="flex items-center gap-2 min-w-[100px]">
                  <Progress
                    value={stat.count > 0 ? (stat.avgConfidence / 5) * 100 : 0}
                    className="h-1.5 flex-1 bg-secondary"
                  />
                  <span className="text-[10px] w-6 text-right">
                    {stat.count > 0 ? stat.avgConfidence.toFixed(1) : "-"}
                  </span>
                </div>
              </td>
              <td className="py-2 px-2">
                {stat.count === 0 ? (
                  <Minus className="w-3 h-3 text-muted-foreground" />
                ) : stat.trend > 0 ? (
                  <span className="flex items-center gap-0.5 text-emerald-400 text-xs">
                    <ArrowUp className="w-3 h-3" />+{stat.trend}
                  </span>
                ) : stat.trend < 0 ? (
                  <span className="flex items-center gap-0.5 text-red-400 text-xs">
                    <ArrowDown className="w-3 h-3" />{stat.trend}
                  </span>
                ) : (
                  <Minus className="w-3 h-3 text-muted-foreground" />
                )}
              </td>
            </motion.tr>
          ))}
        </tbody>
      </table>
    </motion.div>
  );
}
