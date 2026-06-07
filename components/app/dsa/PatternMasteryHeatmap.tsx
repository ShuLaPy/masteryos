"use client";

import { motion } from "framer-motion";

export interface PatternInsight {
  pattern: string;
  rating: number;
  rd: number;
  attempts: number;
  weakness: number;
  zpd_difficulty: string;
}

const DISPLAY: Record<string, string> = {
  arrays: "Arrays",
  strings: "Strings",
  two_pointers: "Two Ptr",
  sliding_window: "Sliding Win",
  prefix_sum: "Prefix Sum",
  hashing: "Hashing",
  binary_search: "Bin Search",
  sorting: "Sorting",
  linked_list: "Linked List",
  stack: "Stack",
  monotonic_stack: "Mono Stack",
  heap: "Heap",
  tree: "Tree",
  bst: "BST",
  trie: "Trie",
  graph_traversal: "BFS / DFS",
  advanced_graph: "Adv. Graph",
  backtracking: "Backtrack",
  dynamic_programming: "DP",
  greedy: "Greedy",
  intervals: "Intervals",
  bit_manipulation: "Bit Manip",
  math_geometry: "Math / Geo",
  design: "Design",
  matrix: "Matrix",
};

function ratingColor(rating: number, attempts: number): string {
  if (attempts === 0) return "bg-muted/30 border-border/20";
  if (rating >= 1700) return "bg-emerald-500 border-emerald-400/40";
  if (rating >= 1600) return "bg-violet-500 border-violet-400/40";
  if (rating >= 1400) return "bg-amber-500 border-amber-400/40";
  return "bg-red-500 border-red-400/40";
}

function ratingTextColor(rating: number, attempts: number): string {
  if (attempts === 0) return "text-muted-foreground/60";
  if (rating >= 1700) return "text-emerald-50";
  if (rating >= 1600) return "text-violet-50";
  if (rating >= 1400) return "text-amber-50";
  return "text-red-50";
}

function cellOpacity(rd: number, attempts: number): number {
  if (attempts === 0) return 0.35;
  return Math.max(0.25, 1 - ((rd - 50) / 300) * 0.75);
}

interface Props {
  patterns: PatternInsight[];
}

export default function PatternMasteryHeatmap({ patterns }: Props) {
  const explored = patterns.filter((p) => p.attempts > 0).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          Pattern Heatmap
        </h2>
        <span className="text-xs text-muted-foreground">
          {explored} / 25 explored
        </span>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 mb-3 text-[10px] text-muted-foreground flex-wrap">
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm bg-red-500 inline-block" /> &lt;1400
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm bg-amber-500 inline-block" /> 1400–1599
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm bg-violet-500 inline-block" /> 1600–1699
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" /> ≥1700
        </span>
        <span className="ml-auto">opacity = confidence</span>
      </div>

      <div className="grid grid-cols-5 gap-1.5">
        {patterns.map((p, i) => (
          <motion.div
            key={p.pattern}
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.015, duration: 0.25 }}
            title={`${p.pattern} | rating: ${Math.round(p.rating)} | rd: ${Math.round(p.rd)} | attempts: ${p.attempts} | zpd: ${p.zpd_difficulty}`}
            className={`rounded-md border px-1.5 py-2 cursor-default ${ratingColor(p.rating, p.attempts)}`}
            style={{ opacity: cellOpacity(p.rd, p.attempts) }}
          >
            <div
              className={`text-[9px] font-semibold leading-tight truncate ${ratingTextColor(p.rating, p.attempts)}`}
            >
              {DISPLAY[p.pattern] ?? p.pattern}
            </div>
            <div className={`text-[9px] mt-0.5 ${ratingTextColor(p.rating, p.attempts)} opacity-80`}>
              {p.attempts > 0 ? Math.round(p.rating) : "—"}
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
