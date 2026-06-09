import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

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

  const settings = ((profile?.settings ?? {}) as Record<string, unknown>);
  return Response.json({
    data: { blind_mode: settings.blind_mode === true },
    error: null,
  });
}

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
    return Response.json({ data: null, error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body.blind_mode !== "boolean") {
    return Response.json(
      { data: null, error: "blind_mode must be a boolean" },
      { status: 400 },
    );
  }

  const { data: profile, error: loadError } = await supabase
    .from("users")
    .select("settings")
    .eq("id", user.id)
    .single();

  if (loadError)
    return Response.json({ data: null, error: "Failed to load settings" }, { status: 500 });

  const current = ((profile?.settings ?? {}) as Record<string, unknown>);
  const merged = { ...current, blind_mode: body.blind_mode };

  const { error: saveError } = await supabase
    .from("users")
    .update({ settings: merged })
    .eq("id", user.id);

  if (saveError)
    return Response.json({ data: null, error: saveError.message }, { status: 500 });

  return Response.json({ data: { blind_mode: body.blind_mode }, error: null });
}
