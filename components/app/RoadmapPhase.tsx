"use client";

/**
 * Phase node on the vertical timeline spine. Renders the phase marker
 * (completed / active / upcoming), a collapsible panel with its topics/subtopics,
 * and a compact phase-level progress summary in the header.
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, CheckCircle2 } from "lucide-react";
import { RoadmapItemRow } from "@/components/app/RoadmapItemRow";
import { formatMinutes, phaseTimeTotal, phaseDifficultyRange } from "@/lib/roadmap";
import type { RoadmapNode, RoadmapItemRow as ItemRow, ItemStatus } from "@/lib/roadmap";

// ── Types ─────────────────────────────────────────────────────────────────────

type PhaseState = "completed" | "active" | "upcoming";

// ── Helper: count completed leaves ───────────────────────────────────────────

function countLeaves(node: RoadmapNode): { done: number; total: number } {
  if (node.children.length === 0) {
    return { done: node.status === "completed" ? 1 : 0, total: 1 };
  }
  let done = 0;
  let total = 0;
  for (const child of node.children) {
    const r = countLeaves(child);
    done += r.done;
    total += r.total;
  }
  return { done, total };
}

// ── RoadmapPhase ─────────────────────────────────────────────────────────────

export function RoadmapPhase({
  phase,
  phaseIndex,
  phaseState,
  isLast,
  conceptId,
  idToTitle,
  statusById,
  nextActionableId,
  onItemChange,
  forceExpanded,
}: {
  phase: RoadmapNode;
  phaseIndex: number;
  phaseState: PhaseState;
  isLast: boolean;
  conceptId: string;
  idToTitle: Map<string, string>;
  statusById: Map<string, ItemStatus>;
  nextActionableId: string | null;
  onItemChange: (row: ItemRow) => void;
  /** Override from parent "expand all / collapse all". */
  forceExpanded: boolean | null;
}) {
  const [localExpanded, setLocalExpanded] = useState(phaseState === "active");
  // forceExpanded=null means "respect local state"; true/false overrides.
  const expanded = forceExpanded !== null ? forceExpanded : localExpanded;

  const { done, total } = countLeaves(phase);
  const timeTotal = phaseTimeTotal(phase);
  const difficulties = phaseDifficultyRange(phase);
  const diffLabel =
    difficulties.length === 0
      ? null
      : difficulties.length === 1
      ? difficulties[0]
      : `${difficulties[0]} – ${difficulties[difficulties.length - 1]}`;

  // ── Marker style ────────────────────────────────────────────────────────
  const markerEl = (() => {
    if (phaseState === "completed") {
      return (
        <div className="w-7 h-7 rounded-full bg-emerald-500/20 border border-emerald-500/50 flex items-center justify-center shrink-0">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
        </div>
      );
    }
    if (phaseState === "active") {
      return (
        <div
          className="w-7 h-7 rounded-full bg-primary/20 border-2 border-primary flex items-center justify-center shrink-0"
          style={{ boxShadow: "0 0 10px oklch(0.62 0.22 280 / 40%)" }}
          aria-label="Active phase"
        >
          <span className="text-[11px] font-bold text-primary">{phaseIndex + 1}</span>
        </div>
      );
    }
    return (
      <div className="w-7 h-7 rounded-full bg-secondary/60 border border-border/60 flex items-center justify-center shrink-0">
        <span className="text-[11px] font-bold text-muted-foreground/60">{phaseIndex + 1}</span>
      </div>
    );
  })();

  return (
    <div className="flex gap-0">
      {/* Left spine */}
      <div className="flex flex-col items-center" style={{ width: "28px", marginRight: "12px" }}>
        {markerEl}
        {/* Connector line to next phase */}
        {!isLast && (
          <div
            className={`flex-1 w-px mt-1 min-h-[16px] ${
              phaseState === "completed"
                ? "bg-emerald-500/30"
                : "bg-border/40"
            }`}
          />
        )}
      </div>

      {/* Phase panel */}
      <div className="flex-1 min-w-0 pb-4">
        {/* Phase header — always visible */}
        <button
          type="button"
          onClick={() => {
            // If forceExpanded is overriding, toggle back to local and flip it.
            setLocalExpanded(forceExpanded !== null ? !forceExpanded : !localExpanded);
          }}
          aria-expanded={expanded}
          className="w-full flex items-center gap-3 text-left group py-1"
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`text-sm font-semibold ${
                  phaseState === "upcoming"
                    ? "text-muted-foreground"
                    : "text-foreground"
                }`}
              >
                {phase.title}
              </span>
              {/* Compact progress */}
              <span
                className={`text-[11px] tabular-nums shrink-0 ${
                  done === total && total > 0
                    ? "text-emerald-400"
                    : phaseState === "active"
                    ? "text-primary"
                    : "text-muted-foreground"
                }`}
              >
                {done}/{total}
              </span>
              {/* Phase time */}
              {timeTotal > 0 && (
                <span className="text-[11px] text-muted-foreground shrink-0">
                  · {formatMinutes(timeTotal)}
                </span>
              )}
              {/* Difficulty range */}
              {diffLabel && (
                <span className="text-[11px] text-muted-foreground/70 capitalize shrink-0 hidden sm:inline">
                  · {diffLabel}
                </span>
              )}
            </div>
            {/* Mini progress bar */}
            <div className="mt-1.5 h-1 w-full max-w-[200px] bg-border/40 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  done === total && total > 0 ? "bg-emerald-400" : "bg-primary"
                }`}
                style={{ width: total > 0 ? `${(done / total) * 100}%` : "0%" }}
              />
            </div>
          </div>

          <ChevronDown
            className={`w-4 h-4 text-muted-foreground/60 transition-transform shrink-0 ${
              expanded ? "rotate-180" : ""
            }`}
          />
        </button>

        {/* Topics list */}
        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              key="topics"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeInOut" }}
              className="overflow-hidden"
            >
              <div className="mt-2 space-y-0.5 border-l border-border/40 pl-3">
                {phase.children.map((topic) => (
                  <RoadmapItemRow
                    key={topic.id}
                    node={topic}
                    conceptId={conceptId}
                    idToTitle={idToTitle}
                    statusById={statusById}
                    onItemChange={onItemChange}
                    isNextActionable={topic.id === nextActionableId}
                  />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
