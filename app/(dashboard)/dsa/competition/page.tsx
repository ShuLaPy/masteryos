"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Trophy,
  Timer,
  ExternalLink,
  Loader2,
  CheckCircle2,
  Circle,
  Flag,
  BarChart2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from "recharts";

// ─── types ────────────────────────────────────────────────────────────────────

type Problem = {
  slug: string;
  title: string;
  difficulty: string;
  url: string;
};

type StartData = {
  competitionId: string;
  problems: Problem[];
  maxScore: number;
  durationMinutes: number;
};

type HistoryEntry = {
  id: string;
  started_at: string;
  completed_at: string | null;
  score: number | null;
  max_score: number;
  duration_seconds: number | null;
};

type Phase = "idle" | "starting" | "active" | "submitting" | "done";

// ─── helpers ─────────────────────────────────────────────────────────────────

function difficultyStyle(d: string) {
  if (d === "easy") return "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
  if (d === "medium") return "text-amber-400 bg-amber-500/10 border-amber-500/20";
  return "text-red-400 bg-red-500/10 border-red-500/20";
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ─── CompetitionTimer ─────────────────────────────────────────────────────────

function CompetitionTimer({
  durationMinutes,
  onExpire,
}: {
  durationMinutes: number;
  onExpire: () => void;
}) {
  const totalSeconds = durationMinutes * 60;
  const [remaining, setRemaining] = useState(totalSeconds);
  const expiredRef = useRef(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          if (!expiredRef.current) {
            expiredRef.current = true;
            onExpire();
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [onExpire]);

  const urgent = remaining < 300; // < 5 min
  const pct = (remaining / totalSeconds) * 100;

  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className={`text-4xl font-mono font-bold tabular-nums ${
          urgent ? "text-red-400 animate-pulse" : "text-foreground"
        }`}
      >
        {formatTime(remaining)}
      </div>
      <div className="w-48 h-1.5 rounded-full bg-border overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${
            urgent ? "bg-red-500" : pct > 50 ? "bg-emerald-500" : "bg-amber-500"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">{durationMinutes} min competition</p>
    </div>
  );
}

// ─── HistoryChart ─────────────────────────────────────────────────────────────

function HistoryChart({ history }: { history: HistoryEntry[] }) {
  const completed = history
    .filter((h) => h.completed_at && h.score !== null)
    .map((h) => ({
      date: formatDate(h.started_at),
      score: h.score as number,
      max: h.max_score,
      pct: Math.round(((h.score as number) / h.max_score) * 100),
    }))
    .reverse();

  if (completed.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        No completed competitions yet — finish your first one to see trends here.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={completed} margin={{ top: 4, right: 12, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
        <XAxis
          dataKey="date"
          tick={{ fill: "#6b7280", fontSize: 11 }}
          axisLine={{ stroke: "#1f2937" }}
          tickLine={false}
        />
        <YAxis
          domain={[0, 100]}
          tick={{ fill: "#6b7280", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `${v}%`}
        />
        <Tooltip
          contentStyle={{
            background: "#111827",
            border: "1px solid #1f2937",
            borderRadius: "8px",
            fontSize: "12px",
          }}
          formatter={(value) => [`${value}%`, "Score %"]}
        />
        <ReferenceLine y={75} stroke="#7c3aed" strokeDasharray="4 4" strokeOpacity={0.5} />
        <Line
          type="monotone"
          dataKey="pct"
          stroke="#7c3aed"
          strokeWidth={2}
          dot={{ fill: "#7c3aed", r: 3 }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CompetitionPage() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [competition, setCompetition] = useState<StartData | null>(null);
  const [solved, setSolved] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<{ score: number; maxScore: number } | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  // Load history on mount
  useEffect(() => {
    fetch("/api/dsa/competition")
      .then((r) => r.json())
      .then((res: { data: { history: HistoryEntry[] } | null; error: string | null }) => {
        if (res.data) setHistory(res.data.history);
      })
      .catch(() => {})
      .finally(() => setHistoryLoading(false));
  }, []);

  const handleStart = async () => {
    setPhase("starting");
    try {
      const res = await fetch("/api/dsa/competition", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      });
      const json = (await res.json()) as {
        data: StartData | null;
        error: string | null;
      };
      if (json.error || !json.data) {
        toast.error(json.error ?? "Failed to start competition");
        setPhase("idle");
        return;
      }
      setCompetition(json.data);
      setSolved(new Set());
      setPhase("active");
    } catch {
      toast.error("Network error");
      setPhase("idle");
    }
  };

  const submitResults = useCallback(
    async (fromTimer = false) => {
      if (!competition) return;
      if (!fromTimer) setPhase("submitting");

      const results = (competition.problems ?? []).map((p) => ({
        slug: p.slug,
        solved: solved.has(p.slug),
      }));

      try {
        const res = await fetch("/api/dsa/competition", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "complete",
            competitionId: competition.competitionId,
            results,
          }),
        });
        const json = (await res.json()) as {
          data: { score: number; maxScore: number } | null;
          error: string | null;
        };
        if (json.error || !json.data) {
          toast.error(json.error ?? "Failed to submit");
          setPhase("active");
          return;
        }
        setResult(json.data);
        setPhase("done");
        // Refresh history
        fetch("/api/dsa/competition")
          .then((r) => r.json())
          .then((res: { data: { history: HistoryEntry[] } | null; error: string | null }) => {
            if (res.data) setHistory(res.data.history);
          })
          .catch(() => {});
      } catch {
        toast.error("Network error");
        setPhase("active");
      }
    },
    [competition, solved],
  );

  const handleTimerExpire = useCallback(() => {
    toast.warning("Time's up! Submitting your results…");
    void submitResults(true);
  }, [submitResults]);

  const toggleSolved = (slug: string) => {
    setSolved((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/dsa" className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
              <Trophy className="w-5 h-5 text-amber-400" />
              Weekly Competition
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              90-min timed contest — 4 problems from your history + spaced review
            </p>
          </div>
        </div>
      </div>

      {/* ── IDLE ─────────────────────────────────────────────────────────────── */}
      {phase === "idle" && (
        <div className="glass rounded-xl p-8 flex flex-col items-center gap-6 text-center">
          <div className="w-16 h-16 rounded-2xl bg-amber-500/10 flex items-center justify-center">
            <Trophy className="w-8 h-8 text-amber-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground mb-1">
              This Week&apos;s Competition
            </h2>
            <p className="text-sm text-muted-foreground max-w-sm">
              4 problems drawn from your recent and overdue history. Solve as many as
              you can in 90 minutes. Your score feeds into pattern mastery.
            </p>
          </div>
          <div className="flex items-center gap-6 text-sm">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Timer className="w-4 h-4" />
              <span>90 minutes</span>
            </div>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Trophy className="w-4 h-4 text-amber-400" />
              <span>4 problems · scored</span>
            </div>
          </div>
          <Button
            onClick={handleStart}
            className="bg-amber-500 hover:bg-amber-600 text-white font-semibold px-8"
          >
            Start Competition
          </Button>
        </div>
      )}

      {/* ── STARTING ─────────────────────────────────────────────────────────── */}
      {phase === "starting" && (
        <div className="glass rounded-xl p-8 flex flex-col items-center gap-4 text-center">
          <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
          <p className="text-sm text-muted-foreground">Selecting your problems…</p>
        </div>
      )}

      {/* ── ACTIVE ───────────────────────────────────────────────────────────── */}
      {phase === "active" && competition && (
        <div className="space-y-5">
          {/* Timer + score */}
          <div className="glass rounded-xl p-5 flex items-center justify-between">
            <CompetitionTimer
              durationMinutes={competition.durationMinutes}
              onExpire={handleTimerExpire}
            />
            <div className="text-right">
              <p className="text-xs text-muted-foreground mb-0.5">Max score</p>
              <p className="text-2xl font-bold text-amber-400">{competition.maxScore}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Current:{" "}
                <span className="text-foreground font-medium">
                  {competition.problems
                    .filter((p) => solved.has(p.slug))
                    .reduce(
                      (s, p) =>
                        s + ({ easy: 1, medium: 2, hard: 3 }[p.difficulty] ?? 2),
                      0,
                    )}
                </span>
              </p>
            </div>
          </div>

          {/* Problems */}
          <div className="space-y-3">
            {competition.problems.map((p, i) => {
              const isSolved = solved.has(p.slug);
              return (
                <div
                  key={p.slug}
                  className={`glass rounded-xl p-4 flex items-center gap-4 cursor-pointer transition-all border ${
                    isSolved
                      ? "border-emerald-500/40 bg-emerald-500/5"
                      : "border-transparent hover:border-border"
                  }`}
                  onClick={() => toggleSolved(p.slug)}
                >
                  {isSolved ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                  ) : (
                    <Circle className="w-5 h-5 text-muted-foreground shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs text-muted-foreground font-mono">
                        #{i + 1}
                      </span>
                      <Badge variant="outline" className={`text-xs ${difficultyStyle(p.difficulty)}`}>
                        {p.difficulty}
                      </Badge>
                      <Badge variant="outline" className="text-xs text-muted-foreground">
                        {p.difficulty === "easy" ? "+1" : p.difficulty === "medium" ? "+2" : "+3"} pts
                      </Badge>
                    </div>
                    <p className={`font-medium text-sm truncate ${isSolved ? "line-through text-muted-foreground" : "text-foreground"}`}>
                      {p.title}
                    </p>
                  </div>
                  <a
                    href={p.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-primary transition-colors p-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>
              );
            })}
          </div>

          {/* Finish button */}
          <Button
            onClick={() => void submitResults(false)}
            className="w-full bg-primary hover:bg-primary/90 text-white"
          >
            <Flag className="w-4 h-4 mr-2" />
            Finish &amp; Submit
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            Click a problem row to mark it solved/unsolved before submitting.
          </p>
        </div>
      )}

      {/* ── SUBMITTING ───────────────────────────────────────────────────────── */}
      {phase === "submitting" && (
        <div className="glass rounded-xl p-8 flex flex-col items-center gap-4 text-center">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
          <p className="text-sm text-muted-foreground">Submitting results…</p>
        </div>
      )}

      {/* ── DONE ─────────────────────────────────────────────────────────────── */}
      {phase === "done" && result && (
        <div className="glass rounded-xl p-8 flex flex-col items-center gap-6 text-center">
          <div className="w-16 h-16 rounded-2xl bg-amber-500/10 flex items-center justify-center">
            <Trophy className="w-8 h-8 text-amber-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground mb-1">Competition Complete!</h2>
            <p className="text-4xl font-bold text-amber-400 mt-2">
              {result.score} / {result.maxScore}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {Math.round((result.score / result.maxScore) * 100)}% score
              {result.score === result.maxScore && " · Perfect score!"}
            </p>
          </div>
          <Button
            onClick={() => {
              setPhase("idle");
              setCompetition(null);
              setResult(null);
              setSolved(new Set());
            }}
            variant="outline"
            className="border-border text-foreground hover:bg-surface"
          >
            Start Another Competition
          </Button>
        </div>
      )}

      {/* ── History chart ─────────────────────────────────────────────────────── */}
      {(phase === "idle" || phase === "done") && (
        <div className="glass rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Competition History</h3>
          </div>
          {historyLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
            </div>
          ) : (
            <HistoryChart history={history} />
          )}
          {!historyLoading && history.filter((h) => h.completed_at).length > 0 && (
            <p className="text-xs text-muted-foreground text-center">
              Dashed line at 75% — aim to stay above it consistently.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
