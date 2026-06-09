"use client";

import { useState } from "react";
import { Eye, EyeOff, CheckCircle2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { DSA_PATTERNS } from "@/lib/constants";

function difficultyColor(diff: string) {
  if (diff === "easy") return "text-emerald-400 bg-emerald-500/15 border-emerald-500/25";
  if (diff === "medium") return "text-amber-400 bg-amber-500/15 border-amber-500/25";
  return "text-red-400 bg-red-500/15 border-red-500/25";
}

interface Props {
  difficulty: string;
  patterns: string[];
  lcTopicTags: string[];
  problemSlug: string | null;
  blindMode: boolean;
}

type Phase = "hidden" | "attempted" | "revealed";

export function BlindModeSection({
  difficulty,
  patterns,
  lcTopicTags,
  problemSlug,
  blindMode,
}: Props) {
  const [phase, setPhase] = useState<Phase>("hidden");
  const [guessed, setGuessed] = useState<string[]>([]);
  const [drillResult, setDrillResult] = useState<{ is_correct: boolean } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function toggleGuess(p: string) {
    setGuessed((cur) =>
      cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p],
    );
  }

  async function submitDrill() {
    if (!problemSlug) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/dsa/drill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          problem_slug: problemSlug,
          guessed_patterns: guessed,
          correct_patterns: patterns,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed");
      setDrillResult(json.data);
    } catch {
      toast.error("Failed to log pattern drill");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Non-blind: render normally ─────────────────────────────────────────────

  if (!blindMode) {
    return (
      <div className="space-y-4">
        <Badge
          className={`capitalize text-xs px-2 py-0.5 border shrink-0 ${difficultyColor(difficulty)}`}
        >
          {difficulty}
        </Badge>

        {patterns.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Patterns
            </p>
            <div className="flex flex-wrap gap-1.5">
              {patterns.map((p) => (
                <Badge
                  key={p}
                  variant="outline"
                  className="text-[11px] border-border/60 text-muted-foreground"
                >
                  {p}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {lcTopicTags.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Topic Tags
            </p>
            <div className="flex flex-wrap gap-1.5">
              {lcTopicTags.map((tag) => (
                <Badge
                  key={tag}
                  variant="outline"
                  className="text-[11px] border-border/40 text-muted-foreground/80"
                >
                  {tag}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Blind mode: hidden ─────────────────────────────────────────────────────

  if (phase === "hidden") {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-secondary/40 border border-border/60">
          <EyeOff className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <p className="text-xs text-muted-foreground">
            Difficulty & patterns hidden — classify it yourself first.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setPhase("attempted")}
          className="text-xs h-7"
        >
          I&apos;ve attempted this
        </Button>
      </div>
    );
  }

  // ── Blind mode: attempted ──────────────────────────────────────────────────

  if (phase === "attempted") {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-secondary/40 border border-border/60">
          <EyeOff className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <p className="text-xs text-muted-foreground">
            Difficulty & patterns hidden — classify it yourself first.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => setPhase("revealed")}
          className="text-xs h-7 bg-violet-500 hover:bg-violet-600 text-white"
        >
          <Eye className="w-3 h-3 mr-1" />
          Reveal
        </Button>
      </div>
    );
  }

  // ── Blind mode: revealed ───────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Difficulty */}
      <Badge
        className={`capitalize text-xs px-2 py-0.5 border shrink-0 ${difficultyColor(difficulty)}`}
      >
        {difficulty}
      </Badge>

      {/* Patterns */}
      {patterns.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Patterns
          </p>
          <div className="flex flex-wrap gap-1.5">
            {patterns.map((p) => (
              <Badge
                key={p}
                variant="outline"
                className="text-[11px] border-border/60 text-muted-foreground"
              >
                {p}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* LeetCode topic tags */}
      {lcTopicTags.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Topic Tags
          </p>
          <div className="flex flex-wrap gap-1.5">
            {lcTopicTags.map((tag) => (
              <Badge
                key={tag}
                variant="outline"
                className="text-[11px] border-border/40 text-muted-foreground/80"
              >
                {tag}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Pattern drill prompt */}
      {problemSlug && !drillResult && (
        <div className="border-t border-border/40 pt-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">
            What pattern did you think it was?
          </p>
          <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto p-3 rounded-xl border border-border/60 bg-secondary/20 mb-3">
            {DSA_PATTERNS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => toggleGuess(p)}
                className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors border ${
                  guessed.includes(p)
                    ? "bg-violet-500/20 border-violet-500/30 text-violet-300"
                    : "bg-secondary border-transparent text-muted-foreground hover:bg-secondary/80"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
          <Button
            size="sm"
            onClick={submitDrill}
            disabled={submitting || guessed.length === 0}
            className="text-xs h-7 bg-emerald-500 hover:bg-emerald-600 text-white"
          >
            Submit guess
          </Button>
        </div>
      )}

      {/* Drill result */}
      {drillResult && (
        <div
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs border ${
            drillResult.is_correct
              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
              : "bg-red-500/10 border-red-500/20 text-red-400"
          }`}
        >
          {drillResult.is_correct ? (
            <>
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              Correct! Pattern recognition logged.
            </>
          ) : (
            <>
              <XCircle className="w-3.5 h-3.5 shrink-0" />
              Not quite — drill logged for review.
            </>
          )}
        </div>
      )}
    </div>
  );
}
