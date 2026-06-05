import type { SupabaseClient } from "@supabase/supabase-js";

export interface StreakProfile {
  streak_count: number | null;
  streak_last_date: string | null;
  grace_days_remaining: number | null;
}

export interface StreakStatus {
  count: number;
  lastDate: string | null;
  graceRemaining: number;
  isActiveToday: boolean;
  atRisk: boolean;
}

export interface StreakUpdate {
  streak_count: number;
  streak_last_date: string;
  grace_days_remaining: number;
}

function toDateKey(d: Date): string {
  return d.toISOString().split("T")[0];
}

function parseDateKey(key: string): Date {
  const d = new Date(key + "T00:00:00.000Z");
  return d;
}

function daysBetween(a: string, b: string): number {
  const ms = parseDateKey(b).getTime() - parseDateKey(a).getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

function getISOWeekStart(dateKey: string): string {
  const d = parseDateKey(dateKey);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return toDateKey(d);
}

export function getStreakStatus(
  profile: StreakProfile,
  today: Date = new Date()
): StreakStatus {
  const todayKey = toDateKey(today);
  const count = profile.streak_count ?? 0;
  const lastDate = profile.streak_last_date;
  const graceRemaining = profile.grace_days_remaining ?? 1;
  const isActiveToday = lastDate === todayKey;

  let atRisk = false;
  if (lastDate && !isActiveToday) {
    const gap = daysBetween(lastDate, todayKey);
    atRisk = gap === 1 && graceRemaining <= 0;
  }

  return { count, lastDate, graceRemaining, isActiveToday, atRisk };
}

export function computeStreakUpdate(
  profile: StreakProfile,
  activityDate: Date = new Date()
): StreakUpdate {
  const todayKey = toDateKey(activityDate);
  const lastDate = profile.streak_last_date;
  const currentCount = profile.streak_count ?? 0;
  let graceRemaining = profile.grace_days_remaining ?? 1;

  if (lastDate === todayKey) {
    return {
      streak_count: currentCount,
      streak_last_date: todayKey,
      grace_days_remaining: graceRemaining,
    };
  }

  if (!lastDate) {
    return {
      streak_count: 1,
      streak_last_date: todayKey,
      grace_days_remaining: 1,
    };
  }

  const gap = daysBetween(lastDate, todayKey);

  if (gap === 1) {
    const newCount = currentCount + 1;
    const lastWeek = getISOWeekStart(lastDate);
    const thisWeek = getISOWeekStart(todayKey);
    if (lastWeek !== thisWeek) {
      graceRemaining = 1;
    }
    return {
      streak_count: newCount,
      streak_last_date: todayKey,
      grace_days_remaining: graceRemaining,
    };
  }

  if (gap === 2 && graceRemaining > 0) {
    const lastWeek = getISOWeekStart(lastDate);
    const thisWeek = getISOWeekStart(todayKey);
    let newGrace = graceRemaining - 1;
    if (lastWeek !== thisWeek) {
      newGrace = 0;
    }
    return {
      streak_count: currentCount,
      streak_last_date: todayKey,
      grace_days_remaining: newGrace,
    };
  }

  return {
    streak_count: 1,
    streak_last_date: todayKey,
    grace_days_remaining: 1,
  };
}

export async function updateStreak(
  supabase: SupabaseClient,
  userId: string,
  activityDate: Date = new Date()
): Promise<{ data: StreakUpdate | null; error: string | null }> {
  const { data: profile, error: fetchErr } = await supabase
    .from("users")
    .select("streak_count, streak_last_date, grace_days_remaining")
    .eq("id", userId)
    .single();

  if (fetchErr || !profile) {
    return { data: null, error: fetchErr?.message ?? "Profile not found" };
  }

  const update = computeStreakUpdate(profile, activityDate);

  const { error: updateErr } = await supabase
    .from("users")
    .update({
      streak_count: update.streak_count,
      streak_last_date: update.streak_last_date,
      grace_days_remaining: update.grace_days_remaining,
    })
    .eq("id", userId);

  if (updateErr) {
    return { data: null, error: updateErr.message };
  }

  return { data: update, error: null };
}

import { getTodayStartISO, getWeekStartISO } from "@/lib/accountability";
