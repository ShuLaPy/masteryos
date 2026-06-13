import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { claimConceptsForSeeding, fireAndForgetSeedConcepts } from "@/lib/concept-seeder";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [year, month, day] = s.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  );
}

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { data, error } = await supabase
    .from("lecture_schedules")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (error || !data) {
    return Response.json({ data: null, error: "Not found" }, { status: 404 });
  }
  return Response.json({ data, error: null });
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  // Verify existence and ownership before reading the body
  const { data: existing, error: fetchError } = await supabase
    .from("lecture_schedules")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (fetchError || !existing) {
    return Response.json({ data: null, error: "Not found" }, { status: 404 });
  }

  const body = await request.json();
  const { week_number, title, scheduled_date, prerequisite_concept_ids } = body;

  const invalidFields: string[] = [];
  const updates: Record<string, unknown> = {};

  if (week_number !== undefined) {
    if (!Number.isInteger(week_number) || week_number < 1 || week_number > 99) {
      invalidFields.push("week_number (must be an integer between 1 and 99)");
    } else {
      updates.week_number = week_number;
    }
  }

  if (title !== undefined) {
    if (
      typeof title !== "string" ||
      title.trim().length < 1 ||
      title.trim().length > 200
    ) {
      invalidFields.push("title (must be a non-empty string of 1–200 characters)");
    } else {
      updates.title = title.trim();
    }
  }

  if (scheduled_date !== undefined) {
    if (typeof scheduled_date !== "string" || !isValidDate(scheduled_date)) {
      invalidFields.push("scheduled_date (must be a valid date in YYYY-MM-DD format)");
    } else {
      updates.scheduled_date = scheduled_date;
    }
  }

  let prereqIds: string[] | undefined;
  let prereqFormatError = false;

  if (prerequisite_concept_ids !== undefined) {
    if (!Array.isArray(prerequisite_concept_ids)) {
      invalidFields.push("prerequisite_concept_ids (must be an array of UUIDs)");
      prereqFormatError = true;
    } else if (prerequisite_concept_ids.length > 100) {
      invalidFields.push("prerequisite_concept_ids (must contain at most 100 entries)");
      prereqFormatError = true;
    } else {
      const malformed = prerequisite_concept_ids.filter(
        (pid: unknown) => typeof pid !== "string" || !UUID_RE.test(pid)
      );
      if (malformed.length > 0) {
        invalidFields.push(
          `prerequisite_concept_ids contains malformed UUIDs: ${malformed.join(", ")}`
        );
        prereqFormatError = true;
      } else {
        prereqIds = prerequisite_concept_ids as string[];
      }
    }
  }

  if (invalidFields.length > 0) {
    return Response.json(
      { data: null, error: `Invalid fields: ${invalidFields.join("; ")}` },
      { status: 400 }
    );
  }

  // Validate prerequisite_concept_ids ownership
  if (!prereqFormatError && prereqIds !== undefined) {
    if (prereqIds.length > 0) {
      const { data: foundConcepts, error: conceptsError } = await supabase
        .from("aiml_concepts")
        .select("id")
        .eq("user_id", user.id)
        .in("id", prereqIds);

      if (conceptsError) {
        return Response.json(
          { data: null, error: "Failed to validate prerequisite concepts" },
          { status: 500 }
        );
      }

      const foundSet = new Set((foundConcepts ?? []).map((c) => c.id));
      const invalidIds = prereqIds.filter((pid) => !foundSet.has(pid));
      if (invalidIds.length > 0) {
        return Response.json(
          {
            data: null,
            error: `Invalid or unauthorized prerequisite_concept_ids: ${invalidIds.join(", ")}`,
          },
          { status: 400 }
        );
      }
    }
    updates.prerequisite_concept_ids = prereqIds;
  }

  if (Object.keys(updates).length === 0) {
    return Response.json(
      { data: null, error: "No valid fields provided to update" },
      { status: 400 }
    );
  }

  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("lecture_schedules")
    .update(updates)
    .eq("id", id)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) return Response.json({ data: null, error: error.message }, { status: 500 });

  if (prereqIds !== undefined && prereqIds.length > 0) {
    const conceptsToSeed = await claimConceptsForSeeding(supabase, prereqIds);
    fireAndForgetSeedConcepts(user.id, conceptsToSeed);
  }

  return Response.json({ data, error: null });
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  // Verify existence and ownership before deleting
  const { data: existing, error: fetchError } = await supabase
    .from("lecture_schedules")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (fetchError || !existing) {
    return Response.json({ data: null, error: "Not found" }, { status: 404 });
  }

  const { error } = await supabase
    .from("lecture_schedules")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return Response.json({ data: null, error: error.message }, { status: 500 });
  return Response.json({ data: { id }, error: null });
}
