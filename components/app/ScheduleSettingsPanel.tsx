"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// ─── Types ─────────────────────────────────────────────────────────────────

interface ZoneAllocationPreferences {
  immediate_recall: number;
  prerequisite_runway: number;
  general_srs: number;
}

interface PriorityWeights {
  centrality: number;
  blast: number;
  proximity: number;
}

export interface BridgeSettings {
  weakness_threshold: number;
  zone_allocation_preferences: ZoneAllocationPreferences;
  priority_weights: PriorityWeights;
  lookahead_days: number;
  timezone: string;
}

// ─── Field-level error display ─────────────────────────────────────────────

function FieldError({ msg }: { msg: string | undefined }) {
  if (!msg) return null;
  return <p className="text-xs text-red-400 mt-1">{msg}</p>;
}

// ─── Section heading ───────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
      {children}
    </p>
  );
}

// ─── Inline sum indicator ──────────────────────────────────────────────────

function SumBadge({ sum, target }: { sum: number; target: number }) {
  const ok = Math.abs(sum - target) < (target === 1 ? 0.001 : 0.5);
  return (
    <span
      className={`text-xs font-mono ${ok ? "text-emerald-400" : "text-amber-400"}`}
    >
      sum = {sum.toFixed(target === 1 ? 3 : 0)}
      {!ok && ` (need ${target})`}
    </span>
  );
}

// ─── Main component ────────────────────────────────────────────────────────

export function ScheduleSettingsPanel({
  initialSettings,
}: {
  initialSettings: BridgeSettings;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Local form state — strings so inputs are always controlled
  const [threshold, setThreshold] = useState(
    String(initialSettings.weakness_threshold)
  );
  const [zoneIR, setZoneIR] = useState(
    String(initialSettings.zone_allocation_preferences.immediate_recall)
  );
  const [zonePR, setZonePR] = useState(
    String(initialSettings.zone_allocation_preferences.prerequisite_runway)
  );
  const [zoneGS, setZoneGS] = useState(
    String(initialSettings.zone_allocation_preferences.general_srs)
  );
  const [pwCentrality, setPwCentrality] = useState(
    String(initialSettings.priority_weights.centrality)
  );
  const [pwBlast, setPwBlast] = useState(
    String(initialSettings.priority_weights.blast)
  );
  const [pwProximity, setPwProximity] = useState(
    String(initialSettings.priority_weights.proximity)
  );
  const [lookahead, setLookahead] = useState(
    String(initialSettings.lookahead_days)
  );
  const [timezone, setTimezone] = useState(initialSettings.timezone);

  // Per-field errors returned from the API
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Computed sums for live feedback
  const zoneSum = [zoneIR, zonePR, zoneGS]
    .map(Number)
    .filter(Number.isFinite)
    .reduce((a, b) => a + b, 0);
  const pwSum = [pwCentrality, pwBlast, pwProximity]
    .map(Number)
    .filter(Number.isFinite)
    .reduce((a, b) => a + b, 0);

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setFieldErrors({});

    const body = {
      weakness_threshold: Number(threshold),
      zone_allocation_preferences: {
        immediate_recall: Number(zoneIR),
        prerequisite_runway: Number(zonePR),
        general_srs: Number(zoneGS),
      },
      priority_weights: {
        centrality: Number(pwCentrality),
        blast: Number(pwBlast),
        proximity: Number(pwProximity),
      },
      lookahead_days: Number(lookahead),
      timezone: timezone.trim(),
    };

    try {
      const res = await fetch("/api/lectures/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        toast.error("Failed to reach settings endpoint");
        return;
      }

      const json = (await res.json()) as {
        data: { saved: string[] } | null;
        errors: Record<string, string>;
      };

      if (json.errors && Object.keys(json.errors).length > 0) {
        setFieldErrors(json.errors);
      }

      const saved = json.data?.saved ?? [];
      if (saved.length > 0) {
        toast.success(
          `Saved: ${saved
            .map((s) => s.replace(/_/g, " "))
            .join(", ")}`
        );
      } else if (Object.keys(json.errors ?? {}).length > 0) {
        toast.error("No fields were saved — fix the errors below");
      }
    } catch {
      toast.error("Network error — settings not saved");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="glass rounded-2xl overflow-hidden">
      {/* Toggle header */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-6 py-4 hover:bg-white/[0.03] transition-colors"
      >
        <span className="text-sm font-semibold text-foreground">
          Planning Settings
        </span>
        {open ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        )}
      </button>

      {open && (
        <div className="px-6 pb-6 border-t border-border/40 pt-5 space-y-7">
          {/* ── Weakness threshold ─────────────────────────────────── */}
          <div>
            <SectionLabel>Weakness threshold</SectionLabel>
            <p className="text-xs text-muted-foreground mb-3">
              A prerequisite with retrievability below this value counts as
              &ldquo;weak&rdquo; and enters the Runway zone.
            </p>
            <div className="flex items-center gap-3 max-w-xs">
              <Input
                id="weakness_threshold"
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                className="bg-secondary/50 border-border/60 h-9 text-sm w-28"
              />
              <Label htmlFor="weakness_threshold" className="text-xs text-muted-foreground">
                0.0–1.0 (default 0.85)
              </Label>
            </div>
            <FieldError msg={fieldErrors.weakness_threshold} />
          </div>

          {/* ── Zone allocation ────────────────────────────────────── */}
          <div>
            <SectionLabel>Zone allocation (%)</SectionLabel>
            <p className="text-xs text-muted-foreground mb-3">
              How your daily goal minutes are split across the three study
              zones. Must sum to 100.
            </p>
            <div className="grid grid-cols-3 gap-4 max-w-lg">
              {(
                [
                  ["Immediate Recall", zoneIR, setZoneIR],
                  ["Prereq Runway", zonePR, setZonePR],
                  ["General SRS", zoneGS, setZoneGS],
                ] as [string, string, (v: string) => void][]
              ).map(([label, val, setter]) => (
                <div key={label}>
                  <Label className="text-xs text-muted-foreground mb-1 block">
                    {label}
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={val}
                    onChange={(e) => setter(e.target.value)}
                    className="bg-secondary/50 border-border/60 h-9 text-sm"
                  />
                </div>
              ))}
            </div>
            <div className="mt-2">
              <SumBadge sum={zoneSum} target={100} />
            </div>
            <FieldError msg={fieldErrors.zone_allocation_preferences} />
          </div>

          {/* ── Priority weights ───────────────────────────────────── */}
          <div>
            <SectionLabel>Priority weights</SectionLabel>
            <p className="text-xs text-muted-foreground mb-3">
              Relevance = blast·B + centrality·C + proximity·P. Must sum to
              1.0. Blast Radius (how much the next lecture depends on this
              prereq) gets the highest weight by default.
            </p>
            <div className="grid grid-cols-3 gap-4 max-w-lg">
              {(
                [
                  ["Blast radius", pwBlast, setPwBlast],
                  ["Centrality", pwCentrality, setPwCentrality],
                  ["Proximity", pwProximity, setPwProximity],
                ] as [string, string, (v: string) => void][]
              ).map(([label, val, setter]) => (
                <div key={label}>
                  <Label className="text-xs text-muted-foreground mb-1 block">
                    {label}
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    value={val}
                    onChange={(e) => setter(e.target.value)}
                    className="bg-secondary/50 border-border/60 h-9 text-sm"
                  />
                </div>
              ))}
            </div>
            <div className="mt-2">
              <SumBadge sum={pwSum} target={1} />
            </div>
            <FieldError msg={fieldErrors.priority_weights} />
          </div>

          {/* ── Lookahead window ───────────────────────────────────── */}
          <div>
            <SectionLabel>Runway lookahead (days)</SectionLabel>
            <p className="text-xs text-muted-foreground mb-3">
              How far ahead to look when scoring prerequisite proximity. A
              lecture exactly this many days away gets Proximity = 0; a
              lecture tomorrow gets Proximity ≈ 1. Range: 1–60.
            </p>
            <div className="flex items-center gap-3 max-w-xs">
              <Input
                id="lookahead_days"
                type="number"
                min={1}
                max={60}
                step={1}
                value={lookahead}
                onChange={(e) => setLookahead(e.target.value)}
                className="bg-secondary/50 border-border/60 h-9 text-sm w-24"
              />
              <Label htmlFor="lookahead_days" className="text-xs text-muted-foreground">
                days (default 14)
              </Label>
            </div>
            <FieldError msg={fieldErrors.lookahead_days} />
          </div>

          {/* ── Timezone ───────────────────────────────────────────── */}
          <div>
            <SectionLabel>Timezone</SectionLabel>
            <p className="text-xs text-muted-foreground mb-3">
              IANA timezone used to resolve &ldquo;today&rdquo; for plan
              generation and lecture scheduling (e.g.{" "}
              <span className="font-mono text-[11px]">Asia/Kolkata</span>,{" "}
              <span className="font-mono text-[11px]">America/New_York</span>
              ).
            </p>
            <Input
              id="timezone"
              type="text"
              placeholder="Asia/Kolkata"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="bg-secondary/50 border-border/60 h-9 text-sm max-w-xs font-mono"
            />
            <FieldError msg={fieldErrors.timezone} />
          </div>

          {/* ── Save button ────────────────────────────────────────── */}
          <div className="flex items-center gap-4 pt-1">
            <Button
              onClick={handleSave}
              disabled={saving}
              className="bg-primary hover:bg-primary/90 h-9"
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Save className="w-4 h-4 mr-2" />
              )}
              Save settings
            </Button>
            {Object.keys(fieldErrors).length > 0 && (
              <p className="text-xs text-red-400">
                {Object.keys(fieldErrors).length} field
                {Object.keys(fieldErrors).length > 1 ? "s" : ""} could not be
                saved — see errors above.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
