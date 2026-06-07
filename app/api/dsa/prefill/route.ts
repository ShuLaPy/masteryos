import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { searchParams } = request.nextUrl;
  const urlParam = searchParams.get("url");
  const slugParam = searchParams.get("slug");

  let slug: string | null = null;

  if (urlParam) {
    try {
      const parsed = new URL(urlParam);
      slug = parsed.pathname.split("/").filter(Boolean)[1] ?? null;
    } catch {
      return Response.json({ data: null, error: "Invalid URL parameter" }, { status: 400 });
    }
  } else if (slugParam) {
    slug = slugParam;
  }

  if (!slug) {
    return Response.json({ data: null, error: "Provide a slug or url query parameter" }, { status: 400 });
  }

  const { data: row, error: dbError } = await supabase
    .from("problem_bank")
    .select("slug, title, difficulty, patterns, leetcode_url, company_tags, video_solutions")
    .eq("slug", slug)
    .maybeSingle();

  if (dbError) {
    return Response.json({ data: null, error: dbError.message }, { status: 500 });
  }

  return Response.json({ data: { prefill: row ?? null }, error: null });
}
