"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Microscope, RefreshCw, Loader2, Sparkles, Cpu } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import PaperRecommendationCard from "@/components/app/PaperRecommendationCard";
import type { PaperRecommendation } from "@/lib/paper-recommender";

type Status = PaperRecommendation["status"];

interface ListResponse {
  data: { recommendations: PaperRecommendation[] } | null;
  error: string | null;
}

interface GenerateResponse {
  data:
    | { recommendations: PaperRecommendation[] }
    | { insufficient: true; learnedCount: number; message: string }
    | null;
  error: string | null;
}

const FILTERS: { key: Status; label: string }[] = [
  { key: "suggested", label: "Inbox" },
  { key: "saved", label: "Saved" },
  { key: "read", label: "Read" },
  { key: "dismissed", label: "Dismissed" },
];

const QUERY_KEY = ["paper-recommendations"];

export default function ResearchClient({
  initialRecommendations,
  learnedCount,
}: {
  initialRecommendations: PaperRecommendation[];
  learnedCount: number;
}) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Status>("suggested");

  const { data } = useQuery<ListResponse>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const res = await fetch("/api/papers/recommend");
      return res.json();
    },
    initialData: {
      data: { recommendations: initialRecommendations },
      error: null,
    },
  });

  const recommendations = data?.data?.recommendations ?? [];

  const generate = useMutation({
    mutationFn: async (): Promise<GenerateResponse> => {
      const res = await fetch("/api/papers/recommend", { method: "POST" });
      const json: GenerateResponse = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to generate recommendations");
      return json;
    },
    onSuccess: (json) => {
      const payload = json.data;
      if (payload && "insufficient" in payload) {
        toast.info(payload.message);
        return;
      }
      const count = payload?.recommendations?.length ?? 0;
      toast.success(`Found ${count} paper${count === 1 ? "" : "s"} for your level`);
      qc.invalidateQueries({ queryKey: QUERY_KEY });
      setTab("suggested");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: Status }) => {
      const res = await fetch(`/api/papers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to update");
      return json;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
    onError: (err: Error) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/papers/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to delete");
      return json;
    },
    onSuccess: () => {
      toast.success("Removed from reading list");
      qc.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const counts = FILTERS.reduce<Record<Status, number>>(
    (acc, f) => {
      acc[f.key] = recommendations.filter((r) => r.status === f.key).length;
      return acc;
    },
    { suggested: 0, saved: 0, read: 0, dismissed: 0 }
  );

  const visible = recommendations.filter((r) => r.status === tab);
  const hasAny = recommendations.length > 0;
  const generating = generate.isPending;
  const mutating = setStatus.isPending || remove.isPending;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Microscope className="w-6 h-6 text-primary" /> Research Papers
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            arXiv papers matched to what you&apos;ve learned — with bridge readings for any gaps.
          </p>
        </div>
        <Button
          onClick={() => generate.mutate()}
          disabled={generating}
          className="bg-primary hover:bg-primary/90 glow-violet shrink-0"
        >
          {generating ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4 mr-2" />
          )}
          {hasAny ? "Regenerate" : "Generate"}
        </Button>
      </div>

      {generating && (
        <div className="glass rounded-xl p-4 mb-6 flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin text-primary" />
          Searching arXiv and ranking papers for your level… this takes ~20 seconds.
        </div>
      )}

      {/* Too-few-concepts hint */}
      {learnedCount < 3 && !hasAny && (
        <div className="text-center py-16 glass rounded-2xl">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto mb-4">
            <Sparkles className="w-8 h-8 text-primary" />
          </div>
          <h2 className="text-xl font-semibold text-foreground mb-2">
            Learn a few concepts first
          </h2>
          <p className="text-muted-foreground text-sm mb-6 max-w-md mx-auto">
            Paper recommendations are matched to what you&apos;ve mastered. Log and study at
            least 3 AIML concepts, then come back to get papers you can actually understand.
          </p>
          <Link href="/aiml">
            <Button variant="outline">
              <Cpu className="w-4 h-4 mr-2" /> Go to AIML Track
            </Button>
          </Link>
        </div>
      )}

      {/* Empty (eligible but not yet generated) */}
      {learnedCount >= 3 && !hasAny && !generating && (
        <div className="text-center py-16 glass rounded-2xl">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto mb-4">
            <Microscope className="w-8 h-8 text-primary" />
          </div>
          <h2 className="text-xl font-semibold text-foreground mb-2">
            Find papers for your level
          </h2>
          <p className="text-muted-foreground text-sm mb-6 max-w-md mx-auto">
            We&apos;ll scan arXiv and surface research papers aligned to your{" "}
            {learnedCount} learned concept{learnedCount === 1 ? "" : "s"}.
          </p>
          <Button
            onClick={() => generate.mutate()}
            className="bg-primary hover:bg-primary/90"
          >
            <Sparkles className="w-4 h-4 mr-2" /> Generate recommendations
          </Button>
        </div>
      )}

      {/* Reading list */}
      {hasAny && (
        <>
          <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-muted mb-5">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setTab(f.key)}
                className={cn(
                  "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                  tab === f.key
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {f.label}
                <span className="ml-1.5 text-[11px] text-muted-foreground">
                  {counts[f.key]}
                </span>
              </button>
            ))}
          </div>

          {visible.length === 0 ? (
            <p className="text-sm text-muted-foreground py-10 text-center">
              Nothing in {FILTERS.find((f) => f.key === tab)?.label.toLowerCase()}.
            </p>
          ) : (
            <div className="space-y-4">
              {visible.map((paper) => (
                <PaperRecommendationCard
                  key={paper.id}
                  paper={paper}
                  busy={mutating}
                  onSetStatus={(status) => setStatus.mutate({ id: paper.id, status })}
                  onDelete={() => remove.mutate(paper.id)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
