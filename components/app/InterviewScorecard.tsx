"use client";

import { motion } from "framer-motion";
import { Sparkles, Target, TrendingUp } from "lucide-react";

export interface ScorecardData {
  overall_score: number;
  readiness_summary: string;
  per_concept: { title: string; slot_grade: number; gap: string }[];
  focus_recommendation: string;
}

const GRADE_LABEL: Record<number, string> = { 4: "Strong", 3: "Solid", 2: "Shaky", 1: "Gap" };

function gradeColor(grade: number): string {
  if (grade >= 4) return "text-emerald-400 border-emerald-500/30 bg-emerald-500/10";
  if (grade >= 3) return "text-amber-400 border-amber-500/30 bg-amber-500/10";
  if (grade >= 2) return "text-orange-400 border-orange-500/30 bg-orange-500/10";
  return "text-red-400 border-red-500/30 bg-red-500/10";
}

export default function InterviewScorecard({ scorecard }: { scorecard: ScorecardData }) {
  const pct = Math.round(Math.max(0, Math.min(1, scorecard.overall_score)) * 100);
  const circumference = 276;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      className="max-w-3xl mx-auto glass rounded-2xl p-6 border-primary/30"
    >
      <div className="flex items-center gap-2 mb-6">
        <Sparkles className="w-5 h-5 text-primary" />
        <h2 className="text-xl font-bold gradient-text">Interview Debrief</h2>
      </div>

      {/* Readiness score */}
      <div className="flex items-center gap-6 mb-8">
        <div className="w-24 h-24 rounded-full bg-secondary flex items-center justify-center relative shrink-0">
          <svg className="w-full h-full transform -rotate-90 absolute inset-0">
            <circle cx="48" cy="48" r="44" stroke="currentColor" strokeWidth="4" fill="transparent" className="text-border" />
            <circle
              cx="48"
              cy="48"
              r="44"
              stroke="currentColor"
              strokeWidth="4"
              fill="transparent"
              strokeDasharray={circumference}
              strokeDashoffset={circumference - (circumference * pct) / 100}
              className="text-primary transition-all duration-1000"
            />
          </svg>
          <span className="text-2xl font-bold text-foreground">{pct}%</span>
        </div>
        <div>
          <p className="text-sm text-muted-foreground mb-1">Interview readiness</p>
          <p className="text-foreground text-sm leading-relaxed">{scorecard.readiness_summary}</p>
        </div>
      </div>

      {/* Per-concept breakdown */}
      {scorecard.per_concept?.length > 0 && (
        <div className="space-y-2 mb-6">
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-1.5">
            <TrendingUp className="w-4 h-4 text-muted-foreground" /> Question breakdown
          </h3>
          {scorecard.per_concept.map((c, i) => (
            <div
              key={i}
              className="flex items-start gap-3 bg-secondary/30 rounded-xl p-3 border border-border/60"
            >
              <span
                className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${gradeColor(c.slot_grade)}`}
              >
                {GRADE_LABEL[c.slot_grade] ?? "—"}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{c.title}</p>
                {c.gap && <p className="text-xs text-muted-foreground mt-0.5">{c.gap}</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Focus recommendation */}
      {scorecard.focus_recommendation && (
        <div className="bg-primary/10 rounded-xl p-4 border border-primary/20 flex items-start gap-3">
          <Target className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-semibold text-primary mb-0.5">Focus next</p>
            <p className="text-sm text-foreground leading-relaxed">{scorecard.focus_recommendation}</p>
          </div>
        </div>
      )}
    </motion.div>
  );
}
