import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

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

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { data, error } = await supabase
    .from("lecture_schedules")
    .select("*")
    .eq("user_id", user.id)
    .order("scheduled_date", { ascending: true })
    .order("week_number", { ascending: true });

  if (error) return Response.json({ data: null, error: error.message }, { status: 500 });
  return Response.json({ data, error: null });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const body = await request.json();
  const { week_number, title, scheduled_date, prerequisite_concept_ids } = body;

  const invalidFields: string[] = [];

  if (
    week_number === undefined ||
    week_number === null ||
    !Number.isInteger(week_number) ||
    week_number < 1 ||
    week_number > 99
  ) {
    invalidFields.push("week_number (must be an integer between 1 and 99)");
  }

  if (
    !title ||
    typeof title !== "string" ||
    title.trim().length < 1 ||
    title.trim().length > 200
  ) {
    invalidFields.push("title (must be a non-empty string of 1–200 characters)");
  }

  if (
    !scheduled_date ||
    typeof scheduled_date !== "string" ||
    !isValidDate(scheduled_date)
  ) {
    invalidFields.push("scheduled_date (must be a valid date in YYYY-MM-DD format)");
  }

  let prereqIds: string[] = [];
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
        (id: unknown) => typeof id !== "string" || !UUID_RE.test(id)
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

  // Validate prerequisite_concept_ids ownership (only when format is valid)
  if (!prereqFormatError && prereqIds.length > 0) {
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
    const invalidIds = prereqIds.filter((id) => !foundSet.has(id));
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

  const { data, error } = await supabase
    .from("lecture_schedules")
    .insert({
      user_id: user.id,
      week_number,
      title: (title as string).trim(),
      scheduled_date,
      prerequisite_concept_ids: prereqIds,
    })
    .select()
    .single();

  if (error) return Response.json({ data: null, error: error.message }, { status: 500 });
  return Response.json({ data, error: null }, { status: 201 });
}
