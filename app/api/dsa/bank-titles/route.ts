import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(_request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { data, error } = await supabase
    .from("problem_bank")
    .select("slug, title")
    .order("title")
    .limit(3000);

  if (error) return Response.json({ data: null, error: error.message }, { status: 500 });

  return Response.json({ data, error: null });
}
