"use client";

import { useState } from "react";
import { Target, Pencil, Check } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface CommitmentWidgetProps {
  weeklyGoalMinutes: number;
  actualMinutes: number;
  compliancePct: number;
}

export default function CommitmentWidget({
  weeklyGoalMinutes: initialGoal,
  actualMinutes,
  compliancePct,
}: CommitmentWidgetProps) {
  const [editing, setEditing] = useState(false);
  const [goal, setGoal] = useState(initialGoal);
  const [saving, setSaving] = useState(false);

  async function saveGoal() {
    setSaving(true);
    try {
      const res = await fetch("/api/accountability/commitment", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekly_goal_minutes: goal }),
      });
      if (res.ok) setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  const complianceColor =
    compliancePct >= 80
      ? "text-emerald-400"
      : compliancePct >= 50
        ? "text-amber-400"
        : "text-red-400";

  return (
    <div className="glass rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Target className="w-4 h-4 text-primary" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Weekly Commitment
          </span>
        </div>
        {!editing ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-muted-foreground hover:text-foreground"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
        ) : (
          <button
            type="button"
            onClick={saveGoal}
            disabled={saving}
            className="text-primary hover:text-primary/80"
          >
            <Check className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {editing ? (
        <div className="flex gap-2 mb-3">
          <Input
            type="number"
            min={30}
            max={3000}
            value={goal}
            onChange={(e) => setGoal(parseInt(e.target.value) || 0)}
            className="h-8 text-sm bg-secondary/50"
          />
          <span className="text-xs text-muted-foreground self-center">min/week</span>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground mb-2">
          Goal: <span className="text-foreground font-medium">{goal} min</span>
          {" · "}
          Actual: <span className={`font-medium ${complianceColor}`}>{actualMinutes} min</span>
        </p>
      )}

      <Progress value={compliancePct} className="h-2 bg-secondary mb-1" />
      <p className={`text-xs text-right font-medium ${complianceColor}`}>
        {compliancePct}% compliance
      </p>
    </div>
  );
}
