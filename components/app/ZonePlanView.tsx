"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Clock, Layers } from "lucide-react";

// ─── Types (mirrors GeneratedPlan from lib/planning-engine.ts) ─────────────

type PlanItemReason =
  | "weak_prereq"
  | "immediate"
  | "cold_start"
  | "cold_start_primer"
  | "overdue";

interface PlanItem {
  card_id: string | null;
  concept_id: string | null;
  priority: number;
  est_minutes: number;
  reason: PlanItemReason | string;
  retrievability?: number;
}

interface Zone {
  allocated_minutes: number;
  items: PlanItem[];
}

interface GeneratedPlan {
  zones: {
    immediate_recall: Zone;
    prerequisite_runway: Zone;
    general_srs: Zone;
  };
  deferred: PlanItem[];
}

function asGeneratedPlan(v: unknown): GeneratedPlan | null {
  if (!v || typeof v !== "object") return null;
  const obj = v as Record<string, unknown>;
  if (!obj.zones || typeof obj.zones !== "object") return null;
  return v as GeneratedPlan;
}

// ─── Reason metadata ───────────────────────────────────────────────────────

const REASON_META: Record<string, { label: string; color: string }> = {
  immediate:        { label: "Immediate Recall",  color: "text-emerald-400" },
  weak_prereq:      { label: "Weak prereq",       color: "text-amber-400"  },
  cold_start:       { label: "Cold start",         color: "text-blue-400"   },
  cold_start_primer:{ label: "Primer",             color: "text-blue-400"   },
  overdue:          { label: "Overdue",            color: "text-red-400"    },
};

function ReasonTag({ reason }: { reason: string }) {
  const meta = REASON_META[reason] ?? { label: reason.replace(/_/g, " "), color: "text-muted-foreground" };
  return <span className={`text-[10px] font-medium ${meta.color}`}>{meta.label}</span>;
}

// ─── Zone config ───────────────────────────────────────────────────────────

const ZONE_META = [
  {
    key: "immediate_recall" as const,
    label: "Immediate Recall",
    accent: "border-emerald-500/20",
    dot: "bg-emerald-400",
    emptyMsg: "No just-attended lecture material to recall.",
  },
  {
    key: "prerequisite_runway" as const,
    label: "Prerequisite Runway",
    accent: "border-amber-500/20",
    dot: "bg-amber-400",
    emptyMsg: "All prerequisites are strong — minutes redistributed to other zones.",
  },
  {
    key: "general_srs" as const,
    label: "General SRS",
    accent: "border-violet-500/20",
    dot: "bg-violet-400",
    emptyMsg: "No overdue cards outside the other zones.",
  },
];

// ─── Single zone panel ─────────────────────────────────────────────────────

function ZonePanel({
  label,
  accent,
  dot,
  emptyMsg,
  zone,
}: {
  label: string;
  accent: string;
  dot: string;
  emptyMsg: string;
  zone: Zone;
}) {
  const count = zone.items.length;
  const mins = zone.allocated_minutes;

  return (
    <div className={`glass rounded-xl p-4 ${accent}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={`inline-block w-2 h-2 rounded-full ${dot} shrink-0`} />
          <span className="text-xs font-semibold text-foreground">{label}</span>
        </div>
        <div className="flex items-center gap-1 text-muted-foreground">
          <Clock className="w-3 h-3" />
          <span className="text-[11px]">{mins} min</span>
        </div>
      </div>

      {/* Items */}
      {count === 0 ? (
        <p className="text-[11px] text-muted-foreground leading-snug">{emptyMsg}</p>
      ) : (
        <div className="space-y-1.5">
          {zone.items.slice(0, 5).map((item, i) => (
            <div
              key={item.card_id ?? item.concept_id ?? i}
              className="flex items-center justify-between gap-2"
            >
              <ReasonTag reason={item.reason} />
              <div className="flex items-center gap-2 shrink-0 text-[10px] text-muted-foreground">
                <span>{item.est_minutes.toFixed(1)}m</span>
                <span className="font-mono">
                  {(item.priority * 100).toFixed(0)}%
                </span>
              </div>
            </div>
          ))}
          {count > 5 && (
            <p className="text-[10px] text-muted-foreground">+{count - 5} more</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────

interface ZonePlanViewProps {
  /** Raw JSONB from daily_plans.generated_plan — null when no plan exists. */
  rawPlan: unknown;
}

export function ZonePlanView({ rawPlan }: ZonePlanViewProps) {
  const [deferredOpen, setDeferredOpen] = useState(false);
  const plan = asGeneratedPlan(rawPlan);

  if (!plan) {
    return (
      <div className="glass rounded-xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <Layers className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold text-foreground">Today&apos;s Study Plan</span>
        </div>
        <p className="text-[11px] text-muted-foreground">
          No plan generated yet — check back after your daily plan is generated.
        </p>
      </div>
    );
  }

  const deferred = plan.deferred ?? [];
  const totalItems =
    plan.zones.immediate_recall.items.length +
    plan.zones.prerequisite_runway.items.length +
    plan.zones.general_srs.items.length;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 px-1">
        <Layers className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold text-foreground">Today&apos;s Study Plan</span>
        {totalItems > 0 && (
          <span className="text-[10px] text-muted-foreground ml-auto">
            {totalItems} items
          </span>
        )}
      </div>

      {ZONE_META.map((zm) => (
        <ZonePanel
          key={zm.key}
          label={zm.label}
          accent={zm.accent}
          dot={zm.dot}
          emptyMsg={zm.emptyMsg}
          zone={plan.zones[zm.key]}
        />
      ))}

      {/* Deferred */}
      {deferred.length > 0 && (
        <div className="glass rounded-xl overflow-hidden">
          <button
            onClick={() => setDeferredOpen((o) => !o)}
            className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/[0.02] transition-colors"
          >
            <span className="text-[11px] text-muted-foreground">
              {deferred.length} item{deferred.length !== 1 ? "s" : ""} deferred to tomorrow
            </span>
            {deferredOpen ? (
              <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
            )}
          </button>
          {deferredOpen && (
            <div className="px-4 pb-3 space-y-1.5 border-t border-border/40 pt-2">
              {deferred.map((item, i) => (
                <div
                  key={item.card_id ?? item.concept_id ?? i}
                  className="flex items-center justify-between gap-2"
                >
                  <ReasonTag reason={item.reason} />
                  <span className="text-[10px] text-muted-foreground">
                    {item.est_minutes.toFixed(1)}m
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
