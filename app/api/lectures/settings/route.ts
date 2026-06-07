import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

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

interface BridgeSettings {
  weakness_threshold: number;
  zone_allocation_preferences: ZoneAllocationPreferences;
  priority_weights: PriorityWeights;
  lookahead_days: number;
  timezone: string;
}

// ─── Defaults (spec §9) ────────────────────────────────────────────────────

const DEFAULTS: BridgeSettings = {
  weakness_threshold: 0.85,
  zone_allocation_preferences: {
    immediate_recall: 40,
    prerequisite_runway: 40,
    general_srs: 20,
  },
  priority_weights: { centrality: 0.3, blast: 0.45, proximity: 0.25 },
  lookahead_days: 14,
  timezone: "UTC",
};

// ─── Validators (each returns null on success, error string on failure) ────

function validateWeaknessThreshold(v: unknown): string | null {
  if (typeof v !== "number" || !Number.isFinite(v))
    return "Must be a number between 0.0 and 1.0";
  if (v < 0 || v > 1)
    return `${v} is out of range — must be between 0.0 and 1.0 inclusive`;
  return null;
}

function validateZoneAllocationPreferences(v: unknown): string | null {
  if (!v || typeof v !== "object" || Array.isArray(v))
    return "Must be an object { immediate_recall, prerequisite_runway, general_srs }";

  const obj = v as Record<string, unknown>;
  const keys = ["immediate_recall", "prerequisite_runway", "general_srs"] as const;
  const fieldErrors: string[] = [];

  for (const key of keys) {
    const val = obj[key];
    if (typeof val !== "number" || !Number.isFinite(val))
      fieldErrors.push(`${key} must be a number`);
    else if (val < 0 || val > 100)
      fieldErrors.push(`${key} must be between 0 and 100`);
  }

  if (fieldErrors.length > 0) return fieldErrors.join("; ");

  const sum =
    (obj.immediate_recall as number) +
    (obj.prerequisite_runway as number) +
    (obj.general_srs as number);

  if (Math.round(sum) !== 100)
    return `The three percentages must sum to exactly 100 (got ${sum})`;

  return null;
}

function validatePriorityWeights(v: unknown): string | null {
  if (!v || typeof v !== "object" || Array.isArray(v))
    return "Must be an object { centrality, blast, proximity }";

  const obj = v as Record<string, unknown>;
  const keys = ["centrality", "blast", "proximity"] as const;
  const fieldErrors: string[] = [];

  for (const key of keys) {
    const val = obj[key];
    if (typeof val !== "number" || !Number.isFinite(val))
      fieldErrors.push(`${key} must be a number`);
    else if (val < 0 || val > 1)
      fieldErrors.push(`${key} must be between 0.0 and 1.0`);
  }

  if (fieldErrors.length > 0) return fieldErrors.join("; ");

  const sum =
    (obj.centrality as number) + (obj.blast as number) + (obj.proximity as number);

  // Floating-point tolerance: accept sums within 0.001 of 1.0
  if (Math.abs(sum - 1) > 0.001)
    return `The three weights must sum to 1.0 (got ${sum.toFixed(4)})`;

  return null;
}

function validateLookaheadDays(v: unknown): string | null {
  if (typeof v !== "number" || !Number.isFinite(v) || !Number.isInteger(v))
    return "Must be an integer";
  if (v < 1 || v > 60)
    return `${v} is out of range — must be between 1 and 60`;
  return null;
}

function validateTimezone(v: unknown): string | null {
  if (typeof v !== "string" || v.trim().length === 0)
    return "Must be a non-empty IANA timezone string (e.g. Asia/Kolkata)";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: v });
    return null;
  } catch {
    return `"${v}" is not a recognized IANA timezone`;
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Overlay stored settings onto the defaults so every key always has a value.
 * Unknown keys in stored settings are silently preserved (forward-compat).
 */
function resolveSettings(stored: Record<string, unknown>): BridgeSettings {
  return {
    weakness_threshold:
      typeof stored.weakness_threshold === "number"
        ? stored.weakness_threshold
        : DEFAULTS.weakness_threshold,

    zone_allocation_preferences:
      stored.zone_allocation_preferences &&
      typeof stored.zone_allocation_preferences === "object"
        ? {
            ...DEFAULTS.zone_allocation_preferences,
            ...(stored.zone_allocation_preferences as object),
          }
        : DEFAULTS.zone_allocation_preferences,

    priority_weights:
      stored.priority_weights && typeof stored.priority_weights === "object"
        ? { ...DEFAULTS.priority_weights, ...(stored.priority_weights as object) }
        : DEFAULTS.priority_weights,

    lookahead_days:
      typeof stored.lookahead_days === "number"
        ? stored.lookahead_days
        : DEFAULTS.lookahead_days,

    timezone:
      typeof stored.timezone === "string" ? stored.timezone : DEFAULTS.timezone,
  };
}

// ─── Routes ────────────────────────────────────────────────────────────────

/** GET /api/lectures/settings — return current settings (with defaults for missing fields). */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { data: profile, error } = await supabase
    .from("users")
    .select("settings")
    .eq("id", user.id)
    .single();

  if (error)
    return Response.json({ data: null, error: "Failed to load settings" }, { status: 500 });

  const stored = ((profile?.settings ?? {}) as Record<string, unknown>);
  return Response.json({ data: resolveSettings(stored), error: null });
}

/**
 * PATCH /api/lectures/settings — validate each provided field independently.
 *
 * Rules (spec §10.6):
 *   - Only the keys present in the request body are validated and saved.
 *   - A valid field is merged into existing settings; an invalid one is rejected.
 *   - Other existing settings are never touched.
 *   - Response: { data: { saved: string[] }, errors: { [field]: string } }
 *     errors is an empty object (not null) when everything succeeds.
 */
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json(
      { data: null, error: "Request body must be valid JSON" },
      { status: 400 }
    );
  }

  // Load current settings first so we can merge valid updates in.
  const { data: profile, error: loadError } = await supabase
    .from("users")
    .select("settings")
    .eq("id", user.id)
    .single();

  if (loadError)
    return Response.json({ data: null, error: "Failed to load settings" }, { status: 500 });

  const current = ((profile?.settings ?? {}) as Record<string, unknown>);
  const saved: string[] = [];
  const errors: Record<string, string> = {};
  const updates: Record<string, unknown> = {};

  // Validate each recognised field independently.
  if ("weakness_threshold" in body) {
    const err = validateWeaknessThreshold(body.weakness_threshold);
    if (err) errors.weakness_threshold = err;
    else { updates.weakness_threshold = body.weakness_threshold; saved.push("weakness_threshold"); }
  }

  if ("zone_allocation_preferences" in body) {
    const err = validateZoneAllocationPreferences(body.zone_allocation_preferences);
    if (err) errors.zone_allocation_preferences = err;
    else { updates.zone_allocation_preferences = body.zone_allocation_preferences; saved.push("zone_allocation_preferences"); }
  }

  if ("priority_weights" in body) {
    const err = validatePriorityWeights(body.priority_weights);
    if (err) errors.priority_weights = err;
    else { updates.priority_weights = body.priority_weights; saved.push("priority_weights"); }
  }

  if ("lookahead_days" in body) {
    const err = validateLookaheadDays(body.lookahead_days);
    if (err) errors.lookahead_days = err;
    else { updates.lookahead_days = body.lookahead_days; saved.push("lookahead_days"); }
  }

  if ("timezone" in body) {
    const err = validateTimezone(body.timezone);
    if (err) errors.timezone = err;
    else { updates.timezone = body.timezone; saved.push("timezone"); }
  }

  // Persist merged settings (only when at least one field is valid).
  if (saved.length > 0) {
    const merged = { ...current, ...updates };
    const { error: saveError } = await supabase
      .from("users")
      .update({ settings: merged })
      .eq("id", user.id);

    if (saveError)
      return Response.json(
        { data: null, error: `Failed to save settings: ${saveError.message}` },
        { status: 500 }
      );
  }

  return Response.json({ data: { saved }, errors });
}
