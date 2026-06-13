import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUS_VALUES = ["suggested", "saved", "read", "dismissed"] as const;
type Status = (typeof STATUS_VALUES)[number];

type RouteContext = { params: Promise<{ id: string }> };

/**
 * PATCH /api/papers/[id]
 *
 * Update a recommendation's reading-list status (save / read / dismiss).
 * Body: { status: "suggested" | "saved" | "read" | "dismissed" }
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return Response.json({ data: null, error: "Invalid id" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ data: null, error: "Invalid JSON" }, { status: 400 });
  }

  const status = (body as { status?: unknown })?.status;
  if (typeof status !== "string" || !(STATUS_VALUES as readonly string[]).includes(status)) {
    return Response.json({ data: null, error: "Invalid status" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("paper_recommendations")
    .update({ status: status as Status, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("*")
    .single();

  if (error || !data) {
    return Response.json({ data: null, error: "Not found" }, { status: 404 });
  }
  return Response.json({ data, error: null });
}

/**
 * DELETE /api/papers/[id] — remove a recommendation from the reading list.
 */
export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return Response.json({ data: null, error: "Invalid id" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { error } = await supabase
    .from("paper_recommendations")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    return Response.json({ data: null, error: error.message }, { status: 500 });
  }
  return Response.json({ data: { id }, error: null });
}
