import { NextRequest } from "next/server";
import { generateJSON } from "@/lib/openai";
import { DSA_PATTERNS } from "@/app/(dashboard)/dsa/page";

export async function POST(request: NextRequest) {
  const { title, url } = await request.json();
  if (!title && !url) {
    return Response.json({ error: "Title or URL required" }, { status: 400 });
  }

  const prompt = `Given the LeetCode/DSA problem title "${title}" and url "${url}", suggest the most likely algorithmic patterns from this exact list:
[${DSA_PATTERNS.join(", ")}]

Respond with ONLY a JSON object containing a "patterns" array of strings (exact matches from the list). Limit to 1-3 patterns.`;

  const { data, error } = await generateJSON<{ patterns: string[] }>(
    "You are an expert competitive programmer. Output JSON only.",
    prompt,
    200
  );

  if (error || !data) {
    return Response.json({ error: "Failed to suggest patterns" }, { status: 500 });
  }

  // Filter to ensure exact matches
  const validPatterns = data.patterns.filter((p) => DSA_PATTERNS.includes(p));

  return Response.json({ patterns: validPatterns });
}
