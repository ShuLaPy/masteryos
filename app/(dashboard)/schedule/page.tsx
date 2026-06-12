import { redirect } from "next/navigation";
import Link from "next/link";
import { CalendarClock, GraduationCap, Settings2, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { ScheduleManager } from "@/components/app/ScheduleManager";
import { LectureLifecycle } from "@/components/app/LectureLifecycle";
import { ScheduleSettingsPanel, type BridgeSettings } from "@/components/app/ScheduleSettingsPanel";
import { ReadinessDashboard } from "@/components/app/ReadinessDashboard";

export const metadata = { title: "Schedule — MasteryOS" };

const SETTINGS_DEFAULTS: BridgeSettings = {
  weakness_threshold: 0.85,
  zone_allocation_preferences: { immediate_recall: 40, prerequisite_runway: 40, general_srs: 20 },
  priority_weights: { centrality: 0.3, blast: 0.45, proximity: 0.25 },
  lookahead_days: 14,
  timezone: "UTC",
};

function resolveSettings(stored: Record<string, unknown>): BridgeSettings {
  return {
    weakness_threshold:
      typeof stored.weakness_threshold === "number"
        ? stored.weakness_threshold
        : SETTINGS_DEFAULTS.weakness_threshold,
    zone_allocation_preferences:
      stored.zone_allocation_preferences &&
      typeof stored.zone_allocation_preferences === "object"
        ? {
            ...SETTINGS_DEFAULTS.zone_allocation_preferences,
            ...(stored.zone_allocation_preferences as object),
          }
        : SETTINGS_DEFAULTS.zone_allocation_preferences,
    priority_weights:
      stored.priority_weights && typeof stored.priority_weights === "object"
        ? { ...SETTINGS_DEFAULTS.priority_weights, ...(stored.priority_weights as object) }
        : SETTINGS_DEFAULTS.priority_weights,
    lookahead_days:
      typeof stored.lookahead_days === "number"
        ? stored.lookahead_days
        : SETTINGS_DEFAULTS.lookahead_days,
    timezone:
      typeof stored.timezone === "string" ? stored.timezone : SETTINGS_DEFAULTS.timezone,
  };
}

export default async function SchedulePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [schedulesRes, conceptsRes, profileRes] = await Promise.all([
    supabase
      .from("lecture_schedules")
      .select("id, week_number, title, scheduled_date, is_attended, prerequisite_concept_ids")
      .eq("user_id", user.id)
      .order("scheduled_date", { ascending: true })
      .order("week_number", { ascending: true }),
    supabase
      .from("aiml_concepts")
      .select("id, title")
      .eq("user_id", user.id)
      .order("title", { ascending: true }),
    supabase.from("users").select("settings").eq("id", user.id).single(),
  ]);

  const lectures = (schedulesRes.data ?? []).map((l) => ({
    id: l.id,
    week_number: l.week_number,
    title: l.title,
    scheduled_date: l.scheduled_date,
    is_attended: l.is_attended,
    prerequisite_concept_ids: l.prerequisite_concept_ids as string[] | null,
  }));

  const concepts = (conceptsRes.data ?? []).map((c) => ({
    id: c.id,
    title: c.title,
  }));

  const settings = resolveSettings(
    ((profileRes.data?.settings ?? {}) as Record<string, unknown>)
  );

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <CalendarClock className="w-6 h-6 text-primary" /> Lecture Schedule
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage your 32-week IIT AIML schedule and study planning.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/schedule/prep"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-lg border border-border/60 hover:border-primary/30 transition-colors"
          >
            <GraduationCap className="w-3.5 h-3.5" /> Pre-Class Prep
          </Link>
          <Link
            href="/schedule/bridge"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-lg border border-border/60 hover:border-primary/30 transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5" /> Bridge
          </Link>
        </div>
      </div>

      {/* ── Active lecture lifecycles (Prep → Attend → Capture → Reinforce) ── */}
      <LectureLifecycle />

      {/* ── Schedule manager (table + modals) ───────────────────── */}
      <ScheduleManager initialLectures={lectures} concepts={concepts} />

      {/* ── Readiness dashboard ─────────────────────────────────── */}
      <div>
        <h2 className="text-sm font-semibold text-foreground mb-3">Readiness</h2>
        <ReadinessDashboard />
      </div>

      {/* ── Planning settings accordion ─────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Settings2 className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Planning Settings</h2>
        </div>
        <ScheduleSettingsPanel initialSettings={settings} />
      </div>
    </div>
  );
}
