// Minimal arXiv API client — server-side only.
//
// Queries the free arXiv Atom API (https://export.arxiv.org/api/query) and parses
// the feed into ArxivPaper objects. The Atom format arXiv returns is small and
// regular, so we parse the handful of fields we need directly rather than pulling
// in an XML dependency. Follows the repo-wide { data, error } tuple convention.

const ARXIV_ENDPOINT = "https://export.arxiv.org/api/query";
const REQUEST_TIMEOUT_MS = 15_000;

export interface ArxivPaper {
  arxivId: string; // e.g. "1706.03762v7"
  title: string;
  authors: string[];
  abstract: string;
  categories: string[]; // arXiv categories, e.g. ["cs.CL", "cs.LG"]
  publishedAt: string | null; // ISO timestamp
  absUrl: string; // HTML landing page
  pdfUrl: string;
}

/** Decode the XML entities arXiv emits in titles/abstracts. */
function decodeEntities(raw: string): string {
  return raw
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) =>
      String.fromCodePoint(parseInt(code, 16))
    )
    .replace(/&amp;/g, "&"); // ampersand last so we don't double-decode
}

/** Collapse the newlines/indentation arXiv wraps long text fields in. */
function normalizeText(raw: string): string {
  return decodeEntities(raw).replace(/\s+/g, " ").trim();
}

/** First inner text of `<tag>…</tag>` within a block, or "" if absent. */
function firstTag(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return match ? match[1] : "";
}

function parseEntry(block: string): ArxivPaper | null {
  const idRaw = firstTag(block, "id").trim(); // http://arxiv.org/abs/1706.03762v7
  const arxivId = idRaw.split("/abs/")[1]?.trim();
  if (!arxivId) return null;

  const title = normalizeText(firstTag(block, "title"));
  if (!title) return null;

  const abstract = normalizeText(firstTag(block, "summary"));

  const authors = Array.from(
    block.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/gi)
  )
    .map((m) => normalizeText(m[1]))
    .filter(Boolean);

  // Categories live in <category term="..."/> and <arxiv:primary_category term="..."/>.
  const categories = Array.from(
    new Set(
      Array.from(block.matchAll(/<category[^>]*\bterm="([^"]+)"/gi)).map((m) => m[1])
    )
  );

  const published = firstTag(block, "published").trim();

  return {
    arxivId,
    title,
    authors,
    abstract,
    categories,
    publishedAt: published || null,
    absUrl: `https://arxiv.org/abs/${arxivId}`,
    pdfUrl: `https://arxiv.org/pdf/${arxivId}`,
  };
}

/**
 * Search arXiv and return parsed papers.
 *
 * @param query       free-text query (will be URL-encoded; passed as `all:`)
 * @param maxResults  cap on results (arXiv hard-caps generously; we keep it small)
 */
export async function searchArxiv(
  query: string,
  maxResults = 10
): Promise<{ data: ArxivPaper[] | null; error: string | null }> {
  const trimmed = query.trim();
  if (!trimmed) return { data: [], error: null };

  const params = new URLSearchParams({
    search_query: `all:${trimmed}`,
    start: "0",
    max_results: String(Math.max(1, Math.min(maxResults, 30))),
    sortBy: "relevance",
    sortOrder: "descending",
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${ARXIV_ENDPOINT}?${params.toString()}`, {
      headers: { "User-Agent": "MasteryOS/1.0 (research paper recommendations)" },
      signal: controller.signal,
    });
    if (!res.ok) {
      return { data: null, error: `arXiv responded with ${res.status}` };
    }
    const xml = await res.text();
    const papers = Array.from(xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi))
      .map((m) => parseEntry(m[1]))
      .filter((p): p is ArxivPaper => p !== null);
    return { data: papers, error: null };
  } catch (err) {
    const message =
      err instanceof Error
        ? err.name === "AbortError"
          ? "arXiv request timed out"
          : err.message
        : "Unknown error";
    return { data: null, error: message };
  } finally {
    clearTimeout(timeout);
  }
}
