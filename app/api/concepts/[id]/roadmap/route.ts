import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateConceptRoadmap } from "@/lib/roadmap-generator";
import {
  parseResources,
  DIFFICULTY_LEVELS,
  type DifficultyLevel,
  type ItemStatus,
} from "@/lib/roadmap";

// Roadmap generation is a long single gpt-5.4 call; allow up to a minute.
export const maxDuration = 60;

type RouteContext = { params: Promise<{ id: string }> };

const ITEM_STATUSES: ItemStatus[] = ["not_started", "in_progress", "completed"];

/** GET — the roadmap lifecycle row + its items (flat; the UI builds the tree). */
export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { data: roadmap } = await supabase
    .from("concept_roadmaps")
    .select("id, status, version, error")
    .eq("concept_id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  const { data: items } = await supabase
    .from("roadmap_items")
    .select(
      "id, parent_item_id, depth, sort_order, title, description, difficulty, estimated_minutes, status, notes, resources, depends_on"
    )
    .eq("concept_id", id)
    .eq("user_id", user.id)
    .order("depth", { ascending: true })
    .order("sort_order", { ascending: true });

  return Response.json({ data: { roadmap, items: items ?? [] }, error: null });
}

/**
 * POST — ensure/generate the roadmap. Idempotent via the claim mutex in
 * generateConceptRoadmap. `{ regenerate: true }` flips an existing roadmap back
 * to 'pending' (and bumps version) so it is rebuilt from scratch.
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  // Ownership check.
  const { data: concept } = await supabase
    .from("aiml_concepts")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!concept) {
    return Response.json({ data: null, error: "Concept not found." }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  if (body?.regenerate === true) {
    const { data: existing } = await supabase
      .from("concept_roadmaps")
      .select("version")
      .eq("concept_id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (existing) {
      await supabase
        .from("concept_roadmaps")
        .update({
          status: "pending",
          version: (existing.version ?? 1) + 1,
          status_updated_at: new Date().toISOString(),
        })
        .eq("concept_id", id)
        .eq("user_id", user.id);
    }
  }

  const { data, error } = await generateConceptRoadmap(supabase, user.id, id);
  if (error) {
    return Response.json({ data: null, error }, { status: 502 });
  }
  return Response.json({ data, error: null });
}

/**
 * PATCH — update a single roadmap item (checkoff, notes, resources, and the
 * editable difficulty/estimate). Body: { itemId, status?, notes?, resources?,
 * difficulty?, estimated_minutes? }.
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const body = await request.json().catch(() => null);
  const itemId: unknown = body?.itemId;
  if (typeof itemId !== "string" || itemId.length === 0) {
    return Response.json({ data: null, error: "itemId is required" }, { status: 400 });
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if ("status" in body) {
    if (!ITEM_STATUSES.includes(body.status)) {
      return Response.json({ data: null, error: "Invalid status" }, { status: 400 });
    }
    update.status = body.status;
    update.completed_at = body.status === "completed" ? new Date().toISOString() : null;
  }

  if ("notes" in body) {
    const notes = typeof body.notes === "string" ? body.notes : "";
    update.notes = notes.trim().length > 0 ? notes : null;
  }

  if ("resources" in body) {
    update.resources = parseResources(body.resources);
  }

  if ("difficulty" in body) {
    if (body.difficulty === null) {
      update.difficulty = null;
    } else if ((DIFFICULTY_LEVELS as readonly string[]).includes(body.difficulty)) {
      update.difficulty = body.difficulty as DifficultyLevel;
    } else {
      return Response.json({ data: null, error: "Invalid difficulty" }, { status: 400 });
    }
  }

  if ("estimated_minutes" in body) {
    const n = body.estimated_minutes;
    if (n === null) {
      update.estimated_minutes = null;
    } else if (typeof n === "number" && Number.isFinite(n) && n > 0) {
      update.estimated_minutes = Math.round(n);
    } else {
      return Response.json({ data: null, error: "Invalid estimated_minutes" }, { status: 400 });
    }
  }

  const { data: item, error } = await supabase
    .from("roadmap_items")
    .update(update)
    .eq("id", itemId)
    .eq("user_id", user.id)
    .eq("concept_id", id)
    .select(
      "id, parent_item_id, depth, sort_order, title, description, difficulty, estimated_minutes, status, notes, resources, depends_on"
    )
    .single();

  if (error || !item) {
    return Response.json({ data: null, error: "Failed to update item" }, { status: 500 });
  }

  return Response.json({ data: item, error: null });
}
