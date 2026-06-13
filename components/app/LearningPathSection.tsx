"use client";

/**
 * "Learning Path" section on the concept page — the Dynamic Learning Path
 * Generator's UI. Drives generation lifecycle (auto-kick on first view +
 * poll-until-ready, backstopping the create-route fire-and-forget) and renders
 * the vertical timeline of phases with rolled-up progress. Per-item edits are
 * owned by RoadmapItemRow; this component holds the flat item list as the
 * source of truth so completion % recomputes on every checkoff.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  Route,
  Loader2,
  RefreshCw,
  AlertTriangle,
  MoreHorizontal,
  ArrowRight,
  Sparkles,
  ChevronsUpDown,
} from "lucide-react";
import {
  buildRoadmapTree,
  computeOverallProgress,
  computeTimeRemaining,
  findNextActionable,
  formatMinutes,
  type RoadmapItemRow as ItemRow,
  type ItemStatus,
} from "@/lib/roadmap";
import { RoadmapPhase } from "@/components/app/RoadmapPhase";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

// ── Constants ──────────────────────────────────────────────────────────────────

type Status = "pending" | "generating" | "ready" | "failed" | null;
const MAX_POLLS = 25; // ~100s ceiling before we stop auto-refreshing

// ── API helpers ────────────────────────────────────────────────────────────────

async function postGenerate(conceptId: string, regenerate: boolean) {
  const res = await fetch(`/api/concepts/${conceptId}/roadmap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ regenerate }),
  });
  return res.json().catch(() => ({}));
}

// ── Generating skeleton ────────────────────────────────────────────────────────

function GeneratingSkeleton() {
  return (
    <div className="space-y-4" aria-label="Generating learning path…" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex gap-3">
          {/* Spine marker */}
          <div className="flex flex-col items-center" style={{ width: 28, marginRight: 12 }}>
            <Skeleton className="w-7 h-7 rounded-full" />
            {i < 2 && <Skeleton className="w-px flex-1 mt-1 min-h-[40px]" />}
          </div>
          {/* Phase card */}
          <div className="flex-1 space-y-2 pb-4">
            <Skeleton className="h-9 w-full rounded-xl" />
            {i === 1 && (
              <div className="space-y-1.5 pl-3 mt-2">
                {[0, 1, 2].map((j) => (
                  <Skeleton key={j} className="h-8 w-full rounded-lg" />
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
      <p className="text-center text-xs text-muted-foreground pt-1">
        Generating your learning path… this can take up to a minute.
      </p>
    </div>
  );
}

// ── LearningPathSection ────────────────────────────────────────────────────────

export function LearningPathSection({
  conceptId,
  initialStatus,
  initialError,
  initialItems,
}: {
  conceptId: string;
  initialStatus: Status;
  initialError: string | null;
  initialItems: ItemRow[];
}) {
  const router = useRouter();
  const [items, setItems] = useState<ItemRow[]>(initialItems);
  const [status, setStatus] = useState<Status>(initialStatus);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // null = follow local phase state; true/false = expand all / collapse all
  const [forceExpanded, setForceExpanded] = useState<boolean | null>(null);

  // Resync from the server after router.refresh() supplies new prop references.
  // Adjusting state during render (guarded by a prev-prop snapshot) is React's
  // recommended pattern over a setState-in-effect.
  const [snapshot, setSnapshot] = useState({ items: initialItems, status: initialStatus });
  if (snapshot.items !== initialItems || snapshot.status !== initialStatus) {
    setSnapshot({ items: initialItems, status: initialStatus });
    setItems(initialItems);
    setStatus(initialStatus);
  }

  const generate = useMutation({
    mutationFn: (regenerate: boolean) => postGenerate(conceptId, regenerate),
    onSettled: () => router.refresh(),
  });

  // Auto-kick generation once when the path isn't ready/failed yet.
  const kicked = useRef(false);
  useEffect(() => {
    if (kicked.current) return;
    if (status === "ready" || status === "failed") return;
    kicked.current = true;
    generate.mutate(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // Poll while in-progress (covers a concurrent create-route fire-and-forget).
  const polls = useRef(0);
  useEffect(() => {
    if (status !== "pending" && status !== "generating") return;
    if (polls.current >= MAX_POLLS) return;
    const t = setTimeout(() => {
      polls.current += 1;
      router.refresh();
    }, 4000);
    return () => clearTimeout(t);
  }, [status, router]);

  // ── Derived state ────────────────────────────────────────────────────────────

  const tree = buildRoadmapTree(items);

  // Build statusById and idToTitle from the live optimistic items list so
  // dependency gating stays current without needing the tree to be rebuilt.
  const statusById: Map<string, ItemStatus> = new Map(
    items.map((it) => [it.id, it.status])
  );
  const idToTitle: Map<string, string> = new Map(
    items.map((it) => [it.id, it.title])
  );

  const progress = computeOverallProgress(tree);
  const { remainingMinutes } = computeTimeRemaining(tree);
  const nextActionable = findNextActionable(tree, statusById);
  const allDone = progress.totalLeaves > 0 && progress.completedLeaves === progress.totalLeaves;

  // Map each phase to its state (completed / active / upcoming).
  // activePhaseIdx is the index of the first phase that is not 100% complete.
  const activePhaseIdx = tree.findIndex((phase) => phase.completionPct < 100);
  const phaseStates: Array<"completed" | "active" | "upcoming"> = tree.map(
    (phase, i) => {
      if (phase.completionPct === 100) return "completed";
      if (i === activePhaseIdx) return "active";
      return "upcoming";
    }
  );

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const onItemChange = useCallback(
    (row: ItemRow) =>
      setItems((prev) => prev.map((it) => (it.id === row.id ? row : it))),
    []
  );

  // Scroll to + briefly highlight the next actionable topic row.
  const handleContinue = () => {
    if (!nextActionable) return;
    const el = document.getElementById(`roadmap-item-${nextActionable.id}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.focus();
    }
  };

  const isWorking = generate.isPending || status === "pending" || status === "generating";
  const showTree = status === "ready" && items.length > 0;

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <section className="glass rounded-2xl p-6 border-primary/20">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
            <Route className="w-5 h-5 text-primary" />
            Learning Path
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            The full progression from foundations to mastery. Complete every item to master this
            concept.
          </p>
        </div>

        {/* Overflow menu — only when the tree is loaded */}
        {showTree && (
          <div className="flex items-center gap-2 shrink-0">
            {/* Expand / collapse all */}
            <button
              type="button"
              onClick={() => setForceExpanded((v) => (v === true ? false : v === false ? null : true))}
              title={forceExpanded === true ? "Collapse all phases" : "Expand all phases"}
              aria-label={forceExpanded === true ? "Collapse all phases" : "Expand all phases"}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground border border-border/50 rounded-lg px-2 py-1.5 transition-colors"
            >
              <ChevronsUpDown className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">
                {forceExpanded === true ? "Collapse" : "Expand"} all
              </span>
            </button>

            {/* ⋯ overflow: Regenerate */}
            <DropdownMenu>
              <DropdownMenuTrigger
                className="flex items-center justify-center w-8 h-8 rounded-lg border border-border/50 text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                aria-label="More options"
              >
                <MoreHorizontal className="w-4 h-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="bottom">
                <DropdownMenuItem
                  onClick={() => setConfirmOpen(true)}
                  disabled={generate.isPending}
                  className="gap-2 cursor-pointer"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${generate.isPending ? "animate-spin" : ""}`}
                  />
                  Regenerate path
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-muted-foreground text-xs cursor-default" disabled>
                  {progress.totalLeaves} topics · {tree.length} phases
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {/* ── Summary strip (ready + items) ──────────────────────────────────── */}
      {showTree && (
        <div className="mb-6 space-y-4">
          {/* Progress bar + stats row */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="font-medium text-foreground tabular-nums">
                {progress.overallPct}% complete
              </span>
              <span>
                {progress.completedLeaves}/{progress.totalLeaves} topics ·{" "}
                {tree.length} phase{tree.length !== 1 ? "s" : ""}
                {remainingMinutes > 0 && (
                  <> · <span className="text-primary/80">{formatMinutes(remainingMinutes)} remaining</span></>
                )}
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  allDone ? "bg-emerald-400" : "bg-primary"
                }`}
                style={{ width: `${progress.overallPct}%` }}
              />
            </div>
          </div>

          {/* All-done celebration or Continue CTA */}
          {allDone ? (
            <div className="flex items-center gap-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 px-4 py-3">
              <Sparkles className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="text-sm font-medium text-emerald-400">
                Mastered! You&apos;ve completed every topic on this learning path.
              </span>
            </div>
          ) : nextActionable ? (
            <button
              type="button"
              onClick={handleContinue}
              className="flex items-center gap-2.5 w-full rounded-xl bg-primary/10 border border-primary/25 px-4 py-3 text-left hover:bg-primary/15 transition-colors group"
            >
              <ArrowRight className="w-4 h-4 text-primary shrink-0 group-hover:translate-x-0.5 transition-transform" />
              <span className="text-sm font-medium text-foreground min-w-0">
                Continue:{" "}
                <span className="text-primary">{nextActionable.title}</span>
              </span>
            </button>
          ) : null}
        </div>
      )}

      {/* ── Vertical timeline tree ──────────────────────────────────────────── */}
      {showTree && (
        <div>
          {tree.map((phase, i) => (
            <RoadmapPhase
              key={phase.id}
              phase={phase}
              phaseIndex={i}
              phaseState={phaseStates[i]}
              isLast={i === tree.length - 1}
              conceptId={conceptId}
              idToTitle={idToTitle}
              statusById={statusById}
              nextActionableId={nextActionable?.id ?? null}
              onItemChange={onItemChange}
              forceExpanded={forceExpanded}
            />
          ))}
        </div>
      )}

      {/* ── Generating (skeleton) ───────────────────────────────────────────── */}
      {!showTree && isWorking && (
        <GeneratingSkeleton />
      )}

      {/* ── Failed ─────────────────────────────────────────────────────────── */}
      {!showTree && !isWorking && status === "failed" && (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 px-5 py-6 text-center space-y-4">
          <div className="flex items-center justify-center gap-2 text-amber-400">
            <AlertTriangle className="w-5 h-5" />
            <span className="text-sm font-medium">
              {initialError ?? "Generation failed. Please try again."}
            </span>
          </div>
          <button
            type="button"
            onClick={() => generate.mutate(false)}
            disabled={generate.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium px-4 py-2 hover:bg-primary/90 disabled:opacity-50"
          >
            {generate.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            Retry
          </button>
        </div>
      )}

      {/* ── Empty / first-run ───────────────────────────────────────────────── */}
      {!showTree && !isWorking && status !== "failed" && (
        <div className="rounded-xl border border-border/50 bg-secondary/20 px-6 py-10 text-center space-y-4">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 border border-primary/20">
            <Route className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-foreground mb-1">
              No learning path yet
            </h3>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
              Generate a personalised, dependency-aware topic trail that takes you from
              foundations to mastery for this concept.
            </p>
          </div>
          <button
            type="button"
            onClick={() => generate.mutate(false)}
            disabled={generate.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium px-5 py-2.5 hover:bg-primary/90 disabled:opacity-50"
          >
            {generate.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Route className="w-4 h-4" />
            )}
            Generate Learning Path
          </button>
        </div>
      )}

      {/* ── Regenerate confirm dialog ───────────────────────────────────────── */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Regenerate Learning Path?</DialogTitle>
            <DialogDescription>
              This will replace all existing topics and permanently reset your progress, notes,
              and resources for this path. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose
              render={
                <button
                  type="button"
                  className="rounded-lg border border-border/60 px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
                />
              }
            >
              Cancel
            </DialogClose>
            <button
              type="button"
              onClick={() => {
                setConfirmOpen(false);
                generate.mutate(true);
              }}
              disabled={generate.isPending}
              className="inline-flex items-center gap-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium px-4 py-2 hover:bg-primary/90 disabled:opacity-50"
            >
              {generate.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              Yes, regenerate
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
