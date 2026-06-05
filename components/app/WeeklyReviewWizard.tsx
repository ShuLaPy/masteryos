"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import {
  Brain,
  Code2,
  Target,
  ChevronRight,
  ChevronLeft,
  Sparkles,
  Loader2,
  CalendarCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface WeekConcept {
  id: string;
  title: string;
  mastery_score: number | null;
}

interface WeekProblem {
  id: string;
  title: string;
  difficulty: string | null;
}

interface WeeklyReviewWizardProps {
  weekStartDate: string;
  reviewCount: number;
  conceptCount: number;
  problemCount: number;
  totalMinutes: number;
  avgRetention: number;
  weekConcepts: WeekConcept[];
  allConcepts: { id: string; title: string }[];
  existingSynthesis: string | null;
  dailyGoalMinutes: number;
  weeklyGoalMinutes: number;
}

const STEPS = ["Week Stats", "Rate Concepts", "Weak Area", "AI Synthesis", "Set Goals"];

export default function WeeklyReviewWizard(props: WeeklyReviewWizardProps) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [weakArea, setWeakArea] = useState("");
  const [synthesis, setSynthesis] = useState(props.existingSynthesis ?? "");
  const [streaming, setStreaming] = useState(false);
  const [dailyGoal, setDailyGoal] = useState(props.dailyGoalMinutes);
  const [weeklyGoal, setWeeklyGoal] = useState(props.weeklyGoalMinutes);
  const [saving, setSaving] = useState(false);

  const progress = ((step + 1) / STEPS.length) * 100;

  async function loadSynthesis() {
    if (synthesis && !streaming) return;
    setStreaming(true);
    setSynthesis("");
    try {
      const res = await fetch("/api/weekly/synthesis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stream: true }),
      });
      if (!res.ok || !res.body) throw new Error("Failed");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let text = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        setSynthesis(text);
      }
    } catch {
      setSynthesis("Unable to generate synthesis. Try again later.");
    } finally {
      setStreaming(false);
    }
  }

  async function saveStep2And3() {
    await fetch("/api/weekly/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        concept_ratings: ratings,
        weak_area_focus: weakArea || undefined,
      }),
    });
  }

  async function finishWizard() {
    setSaving(true);
    try {
      await fetch("/api/weekly/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          daily_goal_minutes: dailyGoal,
          weekly_goal_minutes: weeklyGoal,
        }),
      });
      router.push("/");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function nextStep() {
    if (step === 1 && Object.keys(ratings).length > 0) {
      await saveStep2And3();
    }
    if (step === 2 && weakArea) {
      await saveStep2And3();
    }
    if (step === 3 && !synthesis) {
      await loadSynthesis();
    }
    if (step < STEPS.length - 1) {
      setStep((s) => s + 1);
    } else {
      await finishWizard();
    }
  }

  function prevStep() {
    if (step > 0) setStep((s) => s - 1);
  }

  return (
    <div className="p-6 max-w-2xl mx-auto min-h-[calc(100vh-48px)] flex flex-col">
      <div className="text-center mb-8">
        <div className="w-14 h-14 rounded-2xl bg-primary/20 flex items-center justify-center border border-primary/30 mx-auto mb-4">
          <CalendarCheck className="w-7 h-7 text-primary" />
        </div>
        <h1 className="text-2xl font-bold gradient-text">Weekly Review</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Step {step + 1} of {STEPS.length}: {STEPS[step]}
        </p>
        <Progress value={progress} className="mt-4 h-1.5 bg-secondary max-w-md mx-auto" />
      </div>

      <div className="flex-1 glass rounded-2xl p-6 mb-6 overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.25 }}
          >
            {step === 0 && (
              <div className="grid grid-cols-2 gap-4">
                <StatCard icon={Target} label="Reviews" value={props.reviewCount} color="text-violet-400" />
                <StatCard icon={Brain} label="Concepts" value={props.conceptCount} color="text-primary" />
                <StatCard icon={Code2} label="Problems" value={props.problemCount} color="text-emerald-400" />
                <StatCard icon={Sparkles} label="Minutes" value={props.totalMinutes} color="text-amber-400" />
                <div className="col-span-2 text-center pt-2">
                  <p className="text-sm text-muted-foreground">
                    Average retention:{" "}
                    <span className="text-foreground font-semibold">{props.avgRetention}%</span>
                  </p>
                </div>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-4 max-h-96 overflow-y-auto custom-scrollbar">
                {props.weekConcepts.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No new concepts this week. Skip to next step.
                  </p>
                ) : (
                  props.weekConcepts.map((c) => (
                    <div key={c.id} className="flex items-center justify-between gap-4">
                      <span className="text-sm text-foreground truncate">{c.title}</span>
                      <div className="flex gap-1 shrink-0">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <button
                            key={n}
                            type="button"
                            onClick={() => setRatings((r) => ({ ...r, [c.id]: n }))}
                            className={`w-8 h-8 rounded-lg border text-xs font-medium ${
                              ratings[c.id] === n
                                ? "bg-primary/20 border-primary/40 text-primary"
                                : "border-border/60 text-muted-foreground"
                            }`}
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4">
                <Label>Which area needs the most attention next week?</Label>
                <select
                  value={weakArea}
                  onChange={(e) => setWeakArea(e.target.value)}
                  className="w-full rounded-lg border border-border/60 bg-secondary/50 px-3 py-2 text-sm text-foreground"
                >
                  <option value="">Select a concept...</option>
                  {props.allConcepts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-4">
                {streaming && !synthesis && (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-6 h-6 animate-spin text-primary" />
                  </div>
                )}
                <div className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap min-h-[200px]">
                  {synthesis || (streaming ? "" : "Click Next to generate your weekly synthesis.")}
                </div>
                {!streaming && synthesis && (
                  <Button variant="outline" size="sm" onClick={() => { setSynthesis(""); loadSynthesis(); }}>
                    Regenerate
                  </Button>
                )}
              </div>
            )}

            {step === 4 && (
              <div className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="daily">Daily study goal (minutes)</Label>
                  <Input
                    id="daily"
                    type="number"
                    min={15}
                    max={480}
                    value={dailyGoal}
                    onChange={(e) => {
                      const v = parseInt(e.target.value) || 60;
                      setDailyGoal(v);
                      setWeeklyGoal(v * 7);
                    }}
                    className="bg-secondary/50"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="weekly">Weekly commitment (minutes)</Label>
                  <Input
                    id="weekly"
                    type="number"
                    min={30}
                    max={3000}
                    value={weeklyGoal}
                    onChange={(e) => setWeeklyGoal(parseInt(e.target.value) || 420)}
                    className="bg-secondary/50"
                  />
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="flex gap-3 justify-between">
        <Button variant="outline" onClick={prevStep} disabled={step === 0} className="border-border/60">
          <ChevronLeft className="w-4 h-4 mr-1" /> Back
        </Button>
        <Button
          className="bg-primary hover:bg-primary/90 glow-violet"
          onClick={nextStep}
          disabled={saving || streaming}
        >
          {saving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : step === STEPS.length - 1 ? (
            "Finish & Start Fresh"
          ) : step === 3 && !synthesis ? (
            <>Generate Synthesis <Sparkles className="w-4 h-4 ml-1" /></>
          ) : (
            <>Next <ChevronRight className="w-4 h-4 ml-1" /></>
          )}
        </Button>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="glass rounded-xl p-4 text-center">
      <Icon className={`w-6 h-6 mx-auto mb-2 ${color}`} />
      <p className="text-3xl font-bold text-foreground">{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{label}</p>
    </div>
  );
}
