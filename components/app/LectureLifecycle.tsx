"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Loader2, Workflow } from "lucide-react";
import type { LectureLifecycle as Lifecycle } from "@/lib/lecture-lifecycle";

interface LifecycleResponse {
  data: { lifecycles: Lifecycle[] } | null;
  error: string | null;
}

// ─── Stepper ────────────────────────────────────────────────────────────────

const STEPS = [
  { key: "prep", label: "Prep" },
  { key: "attend", label: "Attend" },
  { key: "capture", label: "Capture" },
  { key: "reinforce", label: "Reinforce" },
] as const;

function stepState(
  step: (typeof STEPS)[number]["key"],
  lc: Lifecycle
): "done" | "active" | "pending" {
  switch (step) {
    case "prep":
      return lc.capture.attended ? "done" : "active";
    case "attend":
      return lc.capture.attended ? "done" : "pending";
    case "capture":
      if (lc.capture.notesIngested) return "done";
      return lc.stage === "capture" ? "active" : "pending";
    case "reinforce":
      if (lc.stage === "complete") return "done";
      return lc.stage === "reinforce" ? "active" : "pending";
  }
}

function Stepper({ lc }: { lc: Lifecycle }) {
  return (
    <div className="flex items-center gap-1.5">
      {STEPS.map((step, i) => {
        const state = stepState(step.key, lc);
        return (
          <div key={step.key} className="flex items-center gap-1.5">
            {i > 0 && <div className="w-4 h-px bg-border/60" />}
            <span
              className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${
                state === "done"
                  ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10"
                  : state === "active"
                    ? "text-primary border-primary/40 bg-primary/10"
                    : "text-muted-foreground border-border/50"
              }`}
            >
              {state === "done" && (
                <CheckCircle2 className="w-3 h-3 inline mr-1 -mt-px" />
              )}
              {step.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Checkpoint pills ────────────────────────────────────────────────────────

const CP_STATUS_CLS: Record<string, string> = {
  done: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
  open: "text-amber-400 border-amber-500/30 bg-amber-500/10",
  missed: "text-red-400 border-red-500/30 bg-red-500/10",
  upcoming: "text-muted-foreground border-border/50",
};

function CheckpointPills({ lc }: { lc: Lifecycle }) {
  if (!lc.reinforce) return null;
  return (
    <div className="flex items-center gap-1.5">
      {lc.reinforce.map((cp) => (
        <span
          key={cp.window}
          title={`${cp.cardsReviewed}/${cp.cardsTotal} cards reviewed · closes ${new Date(cp.closesAt).toLocaleString()}`}
          className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${CP_STATUS_CLS[cp.status]}`}
        >
          {cp.window}
          {cp.status === "open" && ` · ${cp.cardsReviewed}/${cp.cardsTotal}`}
        </span>
      ))}
    </div>
  );
}

// ─── Sub-state chips ────────────────────────────────────────────────────────

function Chips({ lc }: { lc: Lifecycle }) {
  const chips: string[] = [];
  if (lc.stage === "prep") {
    if (lc.prep.readinessPct !== null) chips.push(`${lc.prep.readinessPct}% ready`);
    if (lc.prep.pretestTaken) chips.push("Pretest ✓");
    else if (lc.prep.pretestUnlocked) chips.push("Pretest unlocked");
  } else {
    if (lc.capture.brainDumpDone) chips.push("Brain dump ✓");
    if (lc.capture.notesIngested) chips.push("Notes ✓");
    if (lc.prep.pretestTaken) chips.push("Pretest ✓");
  }
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((c) => (
        <span
          key={c}
          className="text-[10px] text-muted-foreground bg-secondary px-1.5 py-0.5 rounded"
        >
          {c}
        </span>
      ))}
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

/**
 * Per-lecture lifecycle steppers (Prep → Attend → Capture → Reinforce) for the
 * active lectures, with the single next action that moves each one forward.
 */
export function LectureLifecycle() {
  const [loading, setLoading] = useState(true);
  const [lifecycles, setLifecycles] = useState<Lifecycle[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/lectures/lifecycle");
        const json = (await res.json()) as LifecycleResponse;
        if (!cancelled) setLifecycles(json.data?.lifecycles ?? []);
      } catch {
        if (!cancelled) setLifecycles([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="glass rounded-2xl p-4 mb-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading lecture lifecycle…
      </div>
    );
  }

  const active = lifecycles.filter((lc) => lc.stage !== "complete");
  if (active.length === 0) return null;

  return (
    <section className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <Workflow className="w-4 h-4 text-primary" />
        <h2 className="text-sm font-semibold text-foreground">Active lectures</h2>
      </div>
      <div className="space-y-2">
        {active.map((lc) => (
          <div
            key={lc.lectureId}
            className="glass rounded-2xl p-4 flex flex-wrap items-center gap-x-4 gap-y-2"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm text-foreground truncate">
                <span className="text-xs font-bold text-muted-foreground mr-2">
                  W{lc.weekNumber}
                </span>
                {lc.title}
              </p>
              <div className="flex flex-wrap items-center gap-2 mt-1.5">
                <Stepper lc={lc} />
                <CheckpointPills lc={lc} />
                <Chips lc={lc} />
              </div>
            </div>
            {lc.nextAction && (
              <Link
                href={lc.nextAction.href}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-primary border border-primary/30 bg-primary/10 hover:bg-primary/20 px-3 py-1.5 rounded-lg transition-colors shrink-0"
              >
                {lc.nextAction.label}
                <ArrowRight className="w-3 h-3" />
              </Link>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
