export function getWeekStartDate(date: Date = new Date()): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().split("T")[0];
}

export function getWeekStartISO(date: Date = new Date()): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString();
}

export function getTodayDateKey(): string {
  return new Date().toISOString().split("T")[0];
}

export function getTodayStartISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export interface UserSettings {
  weekly_goal_minutes?: number;
  week_start_date?: string;
  weak_area_focus?: string;
  concept_ratings?: Record<string, number>;
}

export function parseSettings(raw: unknown): UserSettings {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as UserSettings;
  }
  return {};
}
