"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Brain,
  Loader2,
  CheckCircle,
  XCircle,
  ChevronRight,
  Target,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CANONICAL_PATTERNS } from "@/lib/pattern-map";

function displayPattern(p: string): string {
  return p.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function difficultyColor(diff: string) {
  if (diff === "easy")
    return "text-emerald-400 bg-emerald-500/15 border-emerald-500/25";
  if (diff === "medium")
    return "text-amber-400 bg-amber-500/15 border-amber-500/25";
  return "text-red-400 bg-red-500/15 border-red-500/25";
}

type DrillProblem = { slug: string; title: string; difficulty: string; content: string | null };
type DrillResult = {
  isCorrect: boolean;
  realPatterns: string[];
  explanation: string;
};
type Phase = "idle" | "loading_problem" | "drilling" | "submitting" | "result";

export default function DrillPage() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [problem, setProblem] = useState<DrillProblem | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<DrillResult | null>(null);
  const [sessionCorrect, setSessionCorrect] = useState(0);
  const [sessionTotal, setSessionTotal] = useState(0);

  const startDrill = useCallback(async () => {
    setPhase("loading_problem");
    setSelected(new Set());
    setResult(null);
    try {
      const res = await fetch("/api/dsa/drill");
      const json = (await res.json()) as {
        data: DrillProblem | null;
        error: string | null;
      };
      if (json.error || !json.data) {
        toast.error(json.error ?? "Failed to load problem");
        setPhase("idle");
        return;
      }
      setProblem(json.data);
      setPhase("drilling");
    } catch {
      toast.error("Failed to load problem");
      setPhase("idle");
    }
  }, []);

  const togglePattern = (p: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };

  const submitGuess = async () => {
    if (!problem) return;
    setPhase("submitting");
    try {
      const res = await fetch("/api/dsa/drill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: problem.slug,
          guessedPatterns: [...selected],
        }),
      });
      const json = (await res.json()) as {
        data: DrillResult | null;
        error: string | null;
      };
      if (json.error || !json.data) {
        toast.error(json.error ?? "Failed to submit");
        setPhase("drilling");
        return;
      }
      setResult(json.data);
      setSessionTotal((t) => t + 1);
      if (json.data.isCorrect) setSessionCorrect((c) => c + 1);
      setPhase("result");
    } catch {
      toast.error("Failed to submit");
      setPhase("drilling");
    }
  };

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/dsa">
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
              <Brain className="w-5 h-5 text-violet-400" /> Pattern Drill
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Identify the pattern — before you look at the solution
            </p>
          </div>
        </div>

        {sessionTotal > 0 && (
          <div className="text-right">
            <p className="text-lg font-bold text-foreground">
              {sessionCorrect}/{sessionTotal}
            </p>
            <p className="text-xs text-muted-foreground">session accuracy</p>
          </div>
        )}
      </div>

      {/* Idle */}
      {phase === "idle" && (
        <div className="glass rounded-xl p-10 flex flex-col items-center gap-4 text-center">
          <div className="w-14 h-14 rounded-2xl bg-violet-500/15 flex items-center justify-center">
            <Target className="w-7 h-7 text-violet-400" />
          </div>
          <div>
            <p className="text-base font-semibold text-foreground">
              Pattern Recognition
            </p>
            <p className="text-sm text-muted-foreground mt-1 max-w-xs">
              You&apos;ll see a problem title and difficulty. Pick the DSA
              pattern(s) you think it requires — before peeking at any solution.
            </p>
          </div>
          <Button
            onClick={startDrill}
            className="bg-violet-600 hover:bg-violet-700 text-white"
          >
            <Target className="w-4 h-4 mr-2" /> Start Drill
          </Button>
        </div>
      )}

      {/* Loading problem */}
      {phase === "loading_problem" && (
        <div className="glass rounded-xl p-10 flex items-center justify-center gap-2">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            Picking a problem…
          </span>
        </div>
      )}

      {/* Drilling / submitting */}
      {(phase === "drilling" || phase === "submitting") && problem && (
        <div className="space-y-4">
          {/* Problem card */}
          <div className="glass rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <Badge
                className={`capitalize text-xs px-2 py-0.5 border ${difficultyColor(problem.difficulty)}`}
              >
                {problem.difficulty}
              </Badge>
              {sessionTotal > 0 && (
                <span className="text-xs text-muted-foreground ml-auto">
                  Session: {sessionCorrect}/{sessionTotal}
                </span>
              )}
            </div>
            <h2 className="text-lg font-semibold text-foreground">
              {problem.title}
            </h2>

            {problem.content ? (
              <div
                className="lc-prose text-sm text-foreground/80 leading-relaxed mt-3 max-h-72 overflow-y-auto pr-1"
                dangerouslySetInnerHTML={{ __html: problem.content }}
              />
            ) : (
              <p className="text-xs text-muted-foreground mt-2 italic">
                Problem statement unavailable — identify the pattern from the title alone.
              </p>
            )}

            <p className="text-xs text-muted-foreground mt-3 pt-3 border-t border-border/40">
              What pattern(s) does this problem require?
            </p>
          </div>

          {/* Pattern grid */}
          <div className="glass rounded-xl p-5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
              Select all applicable patterns
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {CANONICAL_PATTERNS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => togglePattern(p)}
                  disabled={phase === "submitting"}
                  className={`text-left text-sm px-3 py-2 rounded-lg border transition-all ${
                    selected.has(p)
                      ? "bg-violet-500/20 border-violet-500/50 text-violet-200"
                      : "bg-background border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                  } disabled:opacity-60 disabled:cursor-not-allowed`}
                >
                  {displayPattern(p)}
                </button>
              ))}
            </div>
          </div>

          <Button
            onClick={submitGuess}
            disabled={phase === "submitting" || selected.size === 0}
            className="w-full bg-violet-600 hover:bg-violet-700 text-white"
          >
            {phase === "submitting" ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Evaluating…
              </>
            ) : (
              <>
                <ChevronRight className="w-4 h-4 mr-2" /> Submit Guess
              </>
            )}
          </Button>
        </div>
      )}

      {/* Result */}
      {phase === "result" && problem && result && (
        <div className="space-y-4">
          {/* Problem reminder */}
          <div className="glass rounded-xl p-4 flex items-center gap-3">
            <Badge
              className={`capitalize text-xs px-2 py-0.5 border shrink-0 ${difficultyColor(problem.difficulty)}`}
            >
              {problem.difficulty}
            </Badge>
            <span className="font-medium text-foreground">{problem.title}</span>
          </div>

          {/* Verdict + explanation */}
          <div
            className={`glass rounded-xl p-5 border ${
              result.isCorrect ? "border-emerald-500/30" : "border-red-500/20"
            }`}
          >
            <div className="flex items-center gap-2 mb-3">
              {result.isCorrect ? (
                <>
                  <CheckCircle className="w-5 h-5 text-emerald-400" />
                  <span className="font-semibold text-emerald-400">
                    Correct!
                  </span>
                </>
              ) : (
                <>
                  <XCircle className="w-5 h-5 text-red-400" />
                  <span className="font-semibold text-red-400">Incorrect</span>
                </>
              )}
            </div>

            <div className="mb-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                Actual patterns
              </p>
              <div className="flex flex-wrap gap-1.5">
                {result.realPatterns.map((p, i) => (
                  <Badge
                    key={p}
                    className={`text-xs px-2 py-0.5 border ${
                      i === 0
                        ? "bg-violet-500/20 border-violet-500/40 text-violet-200"
                        : "border-border/50 text-muted-foreground bg-transparent"
                    }`}
                  >
                    {displayPattern(p)}
                    {i === 0 && (
                      <span className="ml-1 text-[9px] opacity-60">
                        primary
                      </span>
                    )}
                  </Badge>
                ))}
              </div>
            </div>

            <p className="text-sm text-foreground/80 leading-relaxed">
              {result.explanation}
            </p>
          </div>

          {/* Session score + next */}
          <div className="glass rounded-xl p-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Session accuracy</p>
              <p className="text-xl font-bold text-foreground mt-0.5">
                {sessionCorrect}/{sessionTotal}
                <span className="text-sm font-normal text-muted-foreground ml-2">
                  (
                  {sessionTotal > 0
                    ? Math.round((sessionCorrect / sessionTotal) * 100)
                    : 0}
                  %)
                </span>
              </p>
            </div>
            <Button
              onClick={startDrill}
              className="bg-violet-600 hover:bg-violet-700 text-white shrink-0"
            >
              <ChevronRight className="w-4 h-4 mr-2" /> Next Problem
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
