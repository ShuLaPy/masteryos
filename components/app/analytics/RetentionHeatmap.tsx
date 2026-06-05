"use client";

import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { retentionToColor, type ConceptRetention } from "@/lib/analytics";

interface RetentionHeatmapProps {
  data: ConceptRetention[];
}

export default function RetentionHeatmap({ data }: RetentionHeatmapProps) {
  const router = useRouter();

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
        Add AIML concepts to see retention heatmap
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
        <span>Low</span>
        <div className="flex gap-0.5">
          {["#374151", "#ef4444", "#f97316", "#f59e0b", "#10b981"].map((c) => (
            <div key={c} className="w-3 h-3 rounded-sm" style={{ background: c }} />
          ))}
        </div>
        <span>High</span>
      </div>
      <div
        className="grid gap-1"
        style={{
          gridTemplateColumns: "repeat(auto-fill, minmax(14px, 1fr))",
        }}
      >
        {data.map((cell, i) => (
          <motion.button
            key={cell.id}
            type="button"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: Math.min(i * 0.01, 0.5) }}
            onClick={() => router.push(`/aiml/${cell.id}`)}
            title={`${cell.title}: ${Math.round(cell.retention * 100)}% retention`}
            className="aspect-square rounded-sm hover:ring-1 hover:ring-primary/50 transition-all cursor-pointer"
            style={{ backgroundColor: retentionToColor(cell.retention) }}
          />
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground">
        {data.length} concept{data.length !== 1 ? "s" : ""} · click to open
      </p>
    </div>
  );
}
