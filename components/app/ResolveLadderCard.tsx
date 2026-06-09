"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Eye, ExternalLink, Lightbulb, PencilRuler, Code2, Loader2, Clock,
} from "lucide-react";
import { toast } from "sonner";

/**
 * A problem behind a `dsa_resolve` card. Patterns are CANONICAL (snake_case),
 * ready to feed the Glicko-2 mastery engine via /api/dsa/attempt.
 */
export interface ResolveProblem {
  id: string;
  title: string;
  url: string | null;
  difficulty: string; // resolved easy | medium | hard
  patterns: string[];
  ai_explanation: string | null;
}

interface ResolveLadderCardProps {
  card: { id: string; reps: number; source_id: string };
  problem: ResolveProblem;
  /** Parent (ReviewClient) is mid-submit on /api/review. */
  submitting: boolean;
  /** Submit the FSRS grade — advances the card and the queue. */
  onGrade: (rating: number) => void;
}

type Rung = 1 | 2 | 3;

const RATINGS = [
  { value: 1, label: "Again", color: "bg-red-500/20 border-red-500/40 text-red-300 hover:bg-red-500/30" },
  { value: 2, label: "Hard", color: "bg-orange-500/20 border-orange-500/40 text-orange-300 hover:bg-orange-500/30" },
  { value: 3, label: "Good", color: "bg-emerald-500/20 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30" },
  { value: 4, label: "Easy", color: "bg-violet-500/20 border-violet-500/40 text-violet-300 hover:bg-violet-500/30" },
];

/** Rung escalates automatically with the card's review count. */
function rungForReps(reps: number): Rung {
  if (reps <= 1) return 1;
  if (reps <= 3) return 2;
  return 3;
}

const RUNG_META: Record<Rung, { label: string; time: string; prompt: string; Icon: typeof Lightbulb }> = {
  1: { label: "Insight Recall", time: "~30s", prompt: "Recall the key insight that cracks this.", Icon: Lightbulb },
  2: { label: "Approach Sketch", time: "~3–5m", prompt: "Sketch the full approach (mentally or on paper).", Icon: PencilRuler },
  3: { label: "Full Re-Solve", time: "~20–40m", prompt: "Open LeetCode and solve it again from scratch.", Icon: Code2 },
};

/** Which `## Heading` of ai_explanation a rung reveals. */
const RUNG_SECTION: Record<1 | 2, string> = {
  1: "The Insight",
  2: "Optimal Approach",
};

/** Extract the body of a `## <heading>` section from the AI blueprint markdown. */
function extractSection(markdown: string, heading: string): string | null {
  const lines = markdown.split("\n");
  const target = `## ${heading}`.toLowerCase();
  const start = lines.findIndex((l) => l.trim().toLowerCase() === target);
  if (start === -1) return null;
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) break;
    body.push(lines[i]);
  }
  const text = body.join("\n").trim();
  return text.length > 0 ? text : null;
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={i} className="px-1 py-0.5 rounded text-xs font-mono bg-secondary/60 text-emerald-300">
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

/** Compact renderer for a single ai_explanation section (bullets, **bold**, `code`). */
function MiniMarkdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const nodes: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^[-*] /.test(line)) {
      const bullets: string[] = [];
      while (i < lines.length && /^[-*] /.test(lines[i])) {
        bullets.push(lines[i].slice(2));
        i++;
      }
      nodes.push(
        <ul key={key++} className="my-2 ml-1 space-y-1.5 list-none">
          {bullets.map((b, idx) => (
            <li key={idx} className="text-sm text-foreground/80 flex gap-2 leading-relaxed">
              <span className="text-violet-400 mt-0.5 shrink-0">·</span>
              <span>{renderInline(b)}</span>
            </li>
          ))}
        </ul>,
      );
    } else if (line.trim() === "") {
      i++;
    } else {
      nodes.push(
        <p key={key++} className="text-sm text-foreground/80 leading-relaxed my-1.5">
          {renderInline(line)}
        </p>,
      );
      i++;
    }
  }
  return <>{nodes}</>;
}

export default function ResolveLadderCard({ card, problem, submitting, onGrade }: ResolveLadderCardProps) {
  const rung = rungForReps(card.reps);
  const meta = RUNG_META[rung];

  const [revealed, setRevealed] = useState(false);
  const [explanation, setExplanation] = useState<string | null>(problem.ai_explanation);
  const [loadingExplain, setLoadingExplain] = useState(false);
  const [grading, setGrading] = useState(false);

  const disabled = submitting || grading;

  async function handleReveal() {
    setRevealed(true);
    // Rungs 1 & 2 reveal a section of the AI blueprint — generate it if missing.
    if (rung !== 3 && !explanation) {
      setLoadingExplain(true);
      try {
        const res = await fetch("/api/dsa/explain", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ problemId: problem.id }),
        });
        const json = (await res.json()) as {
          data: { explanation: string } | null;
          error: string | null;
        };
        if (json?.data?.explanation) setExplanation(json.data.explanation);
        else toast.error(json?.error ?? "Could not load the explanation");
      } catch {
        toast.error("Failed to load the explanation");
      } finally {
        setLoadingExplain(false);
      }
    }
  }

  async function handleGrade(rating: number) {
    if (disabled) return;
    setGrading(true);
    try {
      // A completed Rung-3 re-solve is ground truth for pattern mastery (§5.3).
      // Map the FSRS grade to an attempt outcome and feed Glicko-2.
      if (rung === 3 && rating >= 2 && problem.patterns.length > 0) {
        const outcome = rating === 2 ? "solved_effort" : "solved_fast";
        await fetch("/api/dsa/attempt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            problemId: problem.id,
            patterns: problem.patterns,
            difficulty: problem.difficulty,
            outcome,
          }),
        }).catch(() => {
          // Mastery logging is best-effort — never block the FSRS grade.
        });
      }
    } finally {
      setGrading(false);
    }
    onGrade(rating);
  }

  const section =
    rung !== 3 && explanation ? extractSection(explanation, RUNG_SECTION[rung as 1 | 2]) : null;

  const { Icon } = meta;

  return (
    <div className="w-full">
      {/* Rung header */}
      <div className="flex flex-col items-center mb-5">
        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-violet-500/10 border border-violet-500/20">
          <Icon className="w-3.5 h-3.5 text-violet-300" />
          <span className="text-xs font-semibold text-violet-300 uppercase tracking-widest">
            Rung {rung} · {meta.label}
          </span>
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Clock className="w-3 h-3" /> {meta.time}
          </span>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">Re-Solve Ladder</p>
      </div>

      {/* Prompt panel */}
      <div className="glass rounded-2xl p-8 min-h-56 flex flex-col items-center justify-center text-center">
        <p className="text-xs font-semibold text-primary mb-3 uppercase tracking-widest">Problem</p>
        <p className="text-xl font-medium text-foreground leading-relaxed">{problem.title}</p>
        <p className="mt-4 text-sm text-muted-foreground max-w-md">{meta.prompt}</p>

        {!revealed && (
          <button
            type="button"
            onClick={handleReveal}
            className="mt-7 inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-primary/30 text-primary text-sm font-medium hover:bg-primary/10 transition-colors"
          >
            {rung === 3 ? (
              <><ExternalLink className="w-4 h-4" /> Open the problem</>
            ) : (
              <><Eye className="w-4 h-4" /> Reveal</>
            )}
          </button>
        )}
      </div>

      {/* Reveal panel */}
      <AnimatePresence>
        {revealed && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            className="mt-4"
          >
            {rung === 3 ? (
              <div className="glass rounded-2xl p-6 border-primary/20">
                <p className="text-xs font-semibold text-emerald-400 mb-3 uppercase tracking-widest">
                  Re-solve from scratch
                </p>
                {problem.url ? (
                  <a
                    href={problem.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary/10 border border-primary/30 text-primary text-sm font-medium hover:bg-primary/20 transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" /> Open on LeetCode
                  </a>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No LeetCode link saved — solve it from your notes, then rate how it went.
                  </p>
                )}
                <p className="mt-4 text-sm text-foreground/80 leading-relaxed">
                  Code the complete solution with no hints. When you&apos;re done, rate how it went —
                  your grade also updates pattern mastery.
                </p>
              </div>
            ) : (
              <div className="glass rounded-2xl p-6 border-primary/20">
                <p className="text-xs font-semibold text-emerald-400 mb-3 uppercase tracking-widest">
                  {RUNG_SECTION[rung as 1 | 2]}
                </p>
                {loadingExplain ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                    <Loader2 className="w-4 h-4 animate-spin" /> Generating explanation…
                  </div>
                ) : section ? (
                  <MiniMarkdown text={section} />
                ) : explanation ? (
                  <MiniMarkdown text={explanation} />
                ) : (
                  <p className="text-sm text-muted-foreground py-2">
                    No explanation available — grade from memory.
                  </p>
                )}
              </div>
            )}

            {/* FSRS grade buttons — every rung ends here */}
            <div className="mt-6">
              <p className="text-center text-xs text-muted-foreground mb-3">
                {rung === 3 ? "How did the re-solve go?" : "How well did you recall this?"}
              </p>
              <div className="grid grid-cols-4 gap-3">
                {RATINGS.map((r) => (
                  <motion.button
                    key={r.value}
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => handleGrade(r.value)}
                    disabled={disabled}
                    className={`py-3 rounded-xl border font-medium text-sm transition-all ${r.color} disabled:opacity-50`}
                  >
                    <span className="block text-lg font-bold mb-0.5">{r.value}</span>
                    {r.label}
                  </motion.button>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
