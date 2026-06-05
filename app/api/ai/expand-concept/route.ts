import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateText } from "@/lib/openai";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { title } = await request.json();
  if (!title) return Response.json({ error: "Title required" }, { status: 400 });

  const prompt = `Explain the machine learning / computer science concept "${title}" in detail but keep it highly structured. 
Provide:
- A one-sentence intuition.
- The mathematical or structural mechanism (keep it simple).
- A real-world analogy.
- When to use it vs when not to.

Format as clean markdown.`;

  const { data, error } = await generateText(
    "You are an expert computer science and AI educator.",
    prompt,
    1000
  );

  if (error || !data) {
    return Response.json({ error: "Failed to generate notes" }, { status: 500 });
  }

  return Response.json({ notes: data });
}
