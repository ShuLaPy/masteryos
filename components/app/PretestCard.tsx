"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, HelpCircle, Loader2, Lock, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

// ─── Types (mirror /api/lectures/[id]/pretest) ──────────────────────────────

type SelfGrade = "got_it" | "partial" | "no_idea";

interface PretestQuestion {
  q: string;
  model_answer: string;
}

interface PretestData {
  generated_at: string;
  questions: PretestQuestion[];
}

interface PretestAttempt {
  taken_at: string;
  answers: { index: number; answer: string; self_grade: SelfGrade }[];
}

interface PretestResponse {
  data: {
    unlocked: boolean;
    hoursUntilLecture: number;
    pretest: PretestData | null;
    attempt: PretestAttempt | null;
    message?: string;
  } | null;
  error: string | null;
}

const GRADE_META: Record<SelfGrade, { label: string; cls: string }> = {
  got_it: { label: "Got it", cls: "text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10" },
  partial: { label: "Partial", cls: "text-amber-400 border-amber-500/30 hover:bg-amber-500/10" },
  no_idea: { label: "No idea", cls: "text-red-400 border-red-500/30 hover:bg-red-500/10" },
};

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * Pre-lecture pretest (pretesting effect): open questions answered before the
 * lecture — wrong answers are expected and still prime encoding. Unlocks in
 * the final 48h before the lecture.
 */
export function PretestCard({ lectureId }: { lectureId: string }) {
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<PretestResponse["data"]>(null);

  // Quiz-taking state
  const [current, setCurrent] = useState(0);
  const [answer, setAnswer] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [answers, setAnswers] = useState<PretestAttempt["answers"]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/lectures/${lectureId}/pretest`);
        const json = (await res.json()) as PretestResponse;
        if (!cancelled) setState(json.data);
      } catch {
        if (!cancelled) setState(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lectureId]);

  async function submitAttempt(finalAnswers: PretestAttempt["answers"]) {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/lectures/${lectureId}/pretest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: finalAnswers }),
      });
      const json = (await res.json()) as { data: unknown; error: string | null };
      if (!res.ok) {
        toast.error(json.error ?? "Failed to save pretest");
        return;
      }
      toast.success("Pretest saved — watch for these questions in lecture!");
      setState((prev) =>
        prev
          ? {
              ...prev,
              attempt: { taken_at: new Date().toISOString(), answers: finalAnswers },
            }
          : prev
      );
    } catch {
      toast.error("Network error — please try again");
    } finally {
      setSubmitting(false);
    }
  }

  function gradeAndAdvance(grade: SelfGrade) {
    const entry = { index: current, answer: answer.trim(), self_grade: grade };
    const next = [...answers, entry];
    setAnswers(next);
    setAnswer("");
    setRevealed(false);
    if (state?.pretest && current + 1 < state.pretest.questions.length) {
      setCurrent(current + 1);
    } else {
      void submitAttempt(next);
    }
  }

  // ── Render states ──────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="glass rounded-2xl p-5 mb-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading pretest…
      </div>
    );
  }

  if (!state) return null;

  // Locked — outside the 48h window.
  if (!state.unlocked && !state.attempt) {
    return (
      <div className="glass rounded-2xl p-5 mb-6 border-border/60">
        <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
          <Lock className="w-4 h-4" />
          <span>
            <span className="text-foreground font-medium">Pretest</span> unlocks 48h
            before the lecture
            {state.hoursUntilLecture > 48 && (
              <> — {Math.max(0, state.hoursUntilLecture - 48)}h to go</>
            )}
            . Answering questions before class primes your brain to grasp the
            lecture.
          </span>
        </div>
      </div>
    );
  }

  // Generation failed.
  if (state.unlocked && !state.pretest && state.message) {
    return (
      <div className="glass rounded-2xl p-5 mb-6 border-border/60">
        <p className="text-sm text-muted-foreground">
          Pretest could not be generated — try refreshing in a moment.
        </p>
      </div>
    );
  }

  // Already taken — collapsed summary.
  if (state.attempt && state.pretest) {
    const counts = state.attempt.answers.reduce(
      (acc, a) => {
        acc[a.self_grade] += 1;
        return acc;
      },
      { got_it: 0, partial: 0, no_idea: 0 } as Record<SelfGrade, number>
    );
    return (
      <div className="glass rounded-2xl p-5 mb-6 border-emerald-500/20">
        <div className="flex items-center gap-2 text-sm mb-3">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span className="text-foreground font-medium">Pretest taken</span>
          <span className="text-muted-foreground">
            — watch for these questions in lecture
          </span>
        </div>
        <div className="flex flex-wrap gap-2 mb-3">
          {(Object.keys(counts) as SelfGrade[])
            .filter((g) => counts[g] > 0)
            .map((g) => (
              <span
                key={g}
                className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${GRADE_META[g].cls.split(" hover:")[0]}`}
              >
                {counts[g]} {GRADE_META[g].label.toLowerCase()}
              </span>
            ))}
        </div>
        <ul className="space-y-1.5">
          {state.attempt.answers.map((a) => (
            <li key={a.index} className="text-xs text-muted-foreground flex gap-2">
              <span className={GRADE_META[a.self_grade].cls.split(" hover:")[0]}>●</span>
              <span>{state.pretest?.questions[a.index]?.q}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  // Unlocked quiz flow.
  if (state.unlocked && state.pretest) {
    const questions = state.pretest.questions;
    const q = questions[current];
    return (
      <div className="glass rounded-2xl p-5 mb-6 border-primary/20">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-sm">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="text-foreground font-medium">Pre-lecture pretest</span>
          </div>
          <span className="text-xs text-muted-foreground">
            {current + 1} / {questions.length}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Take your best guess — being wrong is the point. It primes your brain to
          notice the answer during the lecture.
        </p>

        <p className="text-sm text-foreground mb-3">{q.q}</p>

        <Textarea
          placeholder="Your best guess…"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          rows={3}
          className="bg-secondary/50 border-border/60 focus:border-primary/60 text-sm resize-none mb-3"
          disabled={revealed || submitting}
        />

        {!revealed ? (
          <Button
            onClick={() => setRevealed(true)}
            disabled={submitting}
            className="bg-primary hover:bg-primary/90 h-8 text-xs"
          >
            <HelpCircle className="w-3.5 h-3.5 mr-1.5" /> Reveal likely answer
          </Button>
        ) : (
          <>
            <div className="rounded-xl border border-border/60 bg-secondary/30 p-3 mb-3">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
                Likely answer
              </p>
              <p className="text-sm text-foreground">{q.model_answer}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground mr-1">How close were you?</span>
              {(Object.keys(GRADE_META) as SelfGrade[]).map((g) => (
                <button
                  key={g}
                  onClick={() => gradeAndAdvance(g)}
                  disabled={submitting}
                  className={`text-xs font-medium px-2.5 py-1 rounded-lg border transition-colors ${GRADE_META[g].cls}`}
                >
                  {submitting && <Loader2 className="w-3 h-3 animate-spin inline mr-1" />}
                  {GRADE_META[g].label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  return null;
}
