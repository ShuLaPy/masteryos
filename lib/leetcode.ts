export interface LCProblem {
  title: string;
  titleSlug: string;
  difficulty: string;
  content: string;
  topicTags: { name: string }[];
  exampleTestcases: string;
  hints: string[];
}

const QUERY = `
query questionData($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    title
    titleSlug
    difficulty
    content
    topicTags { name }
    exampleTestcases
    hints
  }
}
`;

export async function fetchLeetCodeProblem(titleSlug: string): Promise<LCProblem | null> {
  try {
    const res = await fetch("https://leetcode.com/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Referer": "https://leetcode.com/",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Origin": "https://leetcode.com",
      },
      body: JSON.stringify({ query: QUERY, variables: { titleSlug } }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return null;

    const json = await res.json() as { data?: { question?: LCProblem | null } };
    return json.data?.question ?? null;
  } catch {
    return null;
  }
}

export function extractLCSlug(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes("leetcode.com")) return null;
    const parts = parsed.pathname.split("/").filter(Boolean);
    // pathname: /problems/<slug>/
    const idx = parts.indexOf("problems");
    if (idx !== -1 && parts[idx + 1]) return parts[idx + 1];
    return null;
  } catch {
    return null;
  }
}
