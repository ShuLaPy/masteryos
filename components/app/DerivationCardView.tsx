"use client";

/**
 * Review UI for `card_type='derivation'` cards (roadmap Phase 1b, goal 4).
 *
 * The student is shown the goal and recalls/derives the steps mentally, then
 * reveals them one at a time (active reproduction, not passive reading), and
 * finally self-grades on the standard 4-button FSRS scale. Rendered by
 * ReviewClient in place of the flip card, mirroring how ResolveLadderCard owns
 * its own reveal/grade flow. All math goes through MathMarkdown (KaTeX).
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sigma, Eye, ChevronDown, CheckCircle2 } from "lucide-react";
import MathMarkdown from "@/components/app/MathMarkdown";
import type { DerivationPayload } from "@/lib/derivation";

const RATINGS = [
  { value: 1, label: "Again", color: "bg-red-500/20 border-red-500/40 text-red-300 hover:bg-red-500/30", key: "1" },
  { value: 2, label: "Hard", color: "bg-orange-500/20 border-orange-500/40 text-orange-300 hover:bg-orange-500/30", key: "2" },
  { value: 3, label: "Good", color: "bg-emerald-500/20 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30", key: "3" },
  { value: 4, label: "Easy", color: "bg-violet-500/20 border-violet-500/40 text-violet-300 hover:bg-violet-500/30", key: "4" },
];

interface DerivationCardViewProps {
  card: { id: string; front: string };
  payload: DerivationPayload;
  submitting: boolean;
  onGrade: (rating: number) => void;
}

export default function DerivationCardView({
  card,
  payload,
  submitting,
  onGrade,
}: DerivationCardViewProps) {
  // How many steps are currently revealed. Once all steps are shown, the rating
  // buttons appear.
  const [revealed, setRevealed] = useState(0);
  const total = payload.steps.length;
  const allRevealed = revealed >= total;

  return (
    <div className="w-full">
      <div className="flex justify-center mb-4">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 text-primary border border-primary/20 px-3 py-1 text-xs font-medium">
          <Sigma className="w-3.5 h-3.5" /> Derivation
        </span>
      </div>

      {/* Goal — what the student must reproduce. */}
      <div className="glass rounded-2xl p-8 mb-4">
        <p className="text-xs font-semibold text-primary mb-3 uppercase tracking-widest text-center">
          Derive
        </p>
        <div className="text-center text-lg text-foreground">
          <MathMarkdown className="bridge-prose inline-block text-left">
            {`$$${payload.goal_latex}$$`}
          </MathMarkdown>
        </div>
        {card.front && (
          <p className="mt-3 text-sm text-muted-foreground text-center">{card.front}</p>
        )}
        {revealed === 0 && (
          <p className="mt-6 text-center text-sm text-muted-foreground">
            Work it through on paper, then reveal the steps to check yourself.
          </p>
        )}
      </div>

      {/* Revealed steps. */}
      <div className="space-y-3">
        <AnimatePresence initial={false}>
          {payload.steps.slice(0, revealed).map((step, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass rounded-xl p-5 border-primary/15"
            >
              <div className="flex items-start gap-3">
                <span className="shrink-0 w-6 h-6 rounded-full bg-primary/15 text-primary text-xs font-bold flex items-center justify-center mt-0.5">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <MathMarkdown className="bridge-prose">
                    {`$$${step.latex}$$`}
                  </MathMarkdown>
                  {step.explanation && (
                    <div className="mt-1 text-sm text-muted-foreground">
                      <MathMarkdown className="bridge-prose">{step.explanation}</MathMarkdown>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Reveal control / rating buttons. */}
      {!allRevealed ? (
        <button
          type="button"
          onClick={() => setRevealed((r) => Math.min(total, r + 1))}
          className="mt-5 w-full flex items-center justify-center gap-2 rounded-xl border border-border/60 py-3 text-sm font-medium text-foreground hover:bg-secondary/40 transition-colors"
        >
          {revealed === 0 ? (
            <>
              <Eye className="w-4 h-4" /> Reveal first step
            </>
          ) : (
            <>
              <ChevronDown className="w-4 h-4" /> Reveal next step ({revealed}/{total})
            </>
          )}
        </button>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-6"
        >
          <p className="text-center text-xs text-muted-foreground mb-3 flex items-center justify-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            How well did you reproduce this derivation?
          </p>
          <div className="grid grid-cols-4 gap-3">
            {RATINGS.map((r) => (
              <motion.button
                key={r.value}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => onGrade(r.value)}
                disabled={submitting}
                className={`py-3 rounded-xl border font-medium text-sm transition-all ${r.color} disabled:opacity-50`}
              >
                <span className="block text-lg font-bold mb-0.5">{r.key}</span>
                {r.label}
              </motion.button>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
}
