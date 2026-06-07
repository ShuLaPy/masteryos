"use client";

import { motion } from "framer-motion";
import { TrendingDown, TrendingUp, Scale } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";

export interface CoachData {
  neglected: string[];
  over_practiced: string[];
  balance_score: number;
}

const DISPLAY: Record<string, string> = {
  arrays: "Arrays", strings: "Strings", two_pointers: "Two Pointers",
  sliding_window: "Sliding Window", prefix_sum: "Prefix Sum", hashing: "Hashing",
  binary_search: "Binary Search", sorting: "Sorting", linked_list: "Linked List",
  stack: "Stack", monotonic_stack: "Monotonic Stack", heap: "Heap",
  tree: "Tree", bst: "BST", trie: "Trie", graph_traversal: "BFS/DFS",
  advanced_graph: "Adv. Graph", backtracking: "Backtracking",
  dynamic_programming: "DP", greedy: "Greedy", intervals: "Intervals",
  bit_manipulation: "Bit Manipulation", math_geometry: "Math/Geometry",
  design: "Design", matrix: "Matrix",
};

function balanceLabel(score: number): string {
  if (score >= 0.85) return "Well balanced";
  if (score >= 0.65) return "Slightly skewed";
  return "Needs rebalancing";
}

function balanceColor(score: number): string {
  if (score >= 0.85) return "text-emerald-400";
  if (score >= 0.65) return "text-amber-400";
  return "text-red-400";
}

interface Props {
  coach: CoachData;
}

export default function DsaCoachCard({ coach }: Props) {
  const { neglected, over_practiced, balance_score } = coach;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="glass rounded-xl p-4 space-y-4"
    >
      <div className="flex items-center gap-2">
        <Scale className="w-4 h-4 text-primary" />
        <h2 className="text-sm font-semibold text-foreground">Practice Balance</h2>
      </div>

      {/* Balance score */}
      <div>
        <div className="flex justify-between items-center mb-1.5">
          <span className="text-xs text-muted-foreground">Balance score</span>
          <span className={`text-sm font-bold ${balanceColor(balance_score)}`}>
            {balance_score.toFixed(2)} — {balanceLabel(balance_score)}
          </span>
        </div>
        <Progress
          value={balance_score * 100}
          className="h-1.5 bg-secondary"
        />
      </div>

      {/* Neglected */}
      <div>
        <div className="flex items-center gap-1.5 mb-2">
          <TrendingDown className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-xs font-medium text-amber-400">Focus on these</span>
        </div>
        {neglected.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No neglected patterns — great coverage!</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {neglected.map((p) => (
              <Badge
                key={p}
                className="text-[10px] bg-amber-500/15 text-amber-300 border-amber-500/25 border"
              >
                {DISPLAY[p] ?? p}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Over-practiced */}
      <div>
        <div className="flex items-center gap-1.5 mb-2">
          <TrendingUp className="w-3.5 h-3.5 text-blue-400" />
          <span className="text-xs font-medium text-blue-400">Ease off these</span>
        </div>
        {over_practiced.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No over-practiced patterns.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {over_practiced.map((p) => (
              <Badge
                key={p}
                className="text-[10px] bg-blue-500/15 text-blue-300 border-blue-500/25 border"
              >
                {DISPLAY[p] ?? p}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}
