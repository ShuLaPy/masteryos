"use client";

/**
 * "Learning Path" section on the concept page — the Dynamic Learning Path
 * Generator's UI. Drives generation lifecycle (auto-kick on first view +
 * poll-until-ready, backstopping the create-route fire-and-forget) and renders
 * the topic tree with rolled-up progress. Per-item edits are owned by
 * RoadmapItemRow; this component holds the flat item list as the source of
 * truth so completion % recomputes on every checkoff.
 */

import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Route, Loader2, RefreshCw, AlertTriangle } from "lucide-react";
import {
  buildRoadmapTree,
  computeOverallProgress,
  type RoadmapItemRow as ItemRow,
} from "@/lib/roadmap";
import { RoadmapItemRow } from "@/components/app/RoadmapItemRow";

type Status = "pending" | "generating" | "ready" | "failed" | null;
const MAX_POLLS = 25; // ~100s ceiling before we stop auto-refreshing

async function postGenerate(conceptId: string, regenerate: boolean) {
  const res = await fetch(`/api/concepts/${conceptId}/roadmap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ regenerate }),
  });
  return res.json().catch(() => ({}));
}

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

  const tree = buildRoadmapTree(items);
  const idToTitle = new Map(items.map((it) => [it.id, it.title]));
  const progress = computeOverallProgress(tree);

  const onItemChange = (row: ItemRow) =>
    setItems((prev) => prev.map((it) => (it.id === row.id ? row : it)));

  const isWorking = generate.isPending || status === "pending" || status === "generating";
  const showTree = status === "ready" && items.length > 0;

  return (
    <section className="glass rounded-2xl p-6 border-primary/20">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
            <Route className="w-5 h-5 text-primary" /> Learning Path
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            The full progression from foundations to mastery. Complete every item to master this
            concept.
          </p>
        </div>
        {showTree && (
          <button
            type="button"
            onClick={() => {
              if (
                window.confirm(
                  "Regenerate this Learning Path? This replaces all items and resets your progress, notes, and resources."
                )
              ) {
                generate.mutate(true);
              }
            }}
            disabled={generate.isPending}
            className="shrink-0 flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground border border-border/60 rounded-lg px-2.5 py-1.5 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${generate.isPending ? "animate-spin" : ""}`} />
            Regenerate
          </button>
        )}
      </div>

      {/* Overall progress */}
      {showTree && (
        <div className="mb-5">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
            <span>
              {progress.completedLeaves} / {progress.totalLeaves} topics complete
            </span>
            <span className="font-bold text-foreground">{progress.overallPct}%</span>
          </div>
          <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${progress.overallPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Tree */}
      {showTree && (
        <div className="space-y-3">
          {tree.map((phase) => (
            <RoadmapItemRow
              key={phase.id}
              node={phase}
              conceptId={conceptId}
              idToTitle={idToTitle}
              onItemChange={onItemChange}
            />
          ))}
        </div>
      )}

      {/* Generating */}
      {!showTree && isWorking && (
        <div className="flex items-center gap-3 text-sm text-muted-foreground py-8 justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-primary" />
          Generating your learning path… this can take up to a minute.
        </div>
      )}

      {/* Failed */}
      {!showTree && !isWorking && status === "failed" && (
        <div className="py-6 text-center space-y-3">
          <div className="flex items-center gap-2 justify-center text-sm text-amber-400">
            <AlertTriangle className="w-4 h-4" />
            {initialError ?? "Generation failed."}
          </div>
          <button
            type="button"
            onClick={() => generate.mutate(false)}
            className="inline-flex items-center gap-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium px-4 py-2 hover:bg-primary/90"
          >
            <RefreshCw className="w-4 h-4" /> Retry
          </button>
        </div>
      )}

      {/* Empty / not yet started (edge: no row and not working) */}
      {!showTree && !isWorking && status !== "failed" && (
        <div className="py-6 text-center">
          <button
            type="button"
            onClick={() => generate.mutate(false)}
            className="inline-flex items-center gap-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium px-4 py-2 hover:bg-primary/90"
          >
            <Route className="w-4 h-4" /> Generate Learning Path
          </button>
        </div>
      )}
    </section>
  );
}
