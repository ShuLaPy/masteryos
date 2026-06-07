/**
 * scripts/enrich-problem-bank.ts
 *
 * Enriches problem_bank with company tags and video solutions from the
 * zubyj/leetcode-explained dataset.
 *
 * Run:  npx tsx scripts/enrich-problem-bank.ts
 *
 * Place the dataset at: supabase/seed/problem_data.json
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SECRET_KEY");
    process.exit(1);
}

const supabase = createClient(
    SUPABASE_URL!,
    SERVICE_ROLE_KEY!
);

type RawVideo = { embedded_url: string; channel: string };
type RawCompany = { name: string; score: number };
type RawQuestion = {
    title: string;
    id: number;
    difficulty_lvl: number;
    acceptance: number;
    videos: RawVideo[];
    companies: RawCompany[];
};

type VideoRow = { video_id: string; channel: string; embed_url: string };

/** Derive LeetCode slug from title — matches how LeetCode generates slugs. */
function titleToSlug(title: string): string {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")  // remove special chars (parens, commas, etc.)
        .trim()
        .replace(/\s+/g, "-");         // spaces → hyphens
}

/** Extract YouTube video ID from an embed URL. */
function extractVideoId(embedUrl: string): string {
    // "https://www.youtube.com/embed/KLlXCFG5TnA" → "KLlXCFG5TnA"
    return embedUrl.split("/embed/")[1]?.split("?")[0] ?? "";
}

async function main() {
    const rawPath = join(process.cwd(), "supabase", "seed", "problem_data.json");
    const { questions }: { questions: RawQuestion[] } = JSON.parse(
        readFileSync(rawPath, "utf8")
    );

    // Load all slugs + titles from problem_bank so we only update rows we have.
    const { data: bankRows, error: loadErr } = await supabase
        .from("problem_bank")
        .select("slug, title");
    if (loadErr) { console.error("Failed to load problem_bank:", loadErr.message); process.exit(1); }

    const slugByTitle = new Map<string, string>();
    for (const row of bankRows ?? []) slugByTitle.set(row.title.toLowerCase(), row.slug);
    const bankSlugs = new Set(bankRows?.map((r) => r.slug) ?? []);

    let updated = 0, skipped = 0, noMatch = 0;

    for (const q of questions) {
        // Match by title first (most reliable), fall back to derived slug.
        const derivedSlug = titleToSlug(q.title);
        const slugFromTitle = slugByTitle.get(q.title.toLowerCase());
        const slug = slugFromTitle ?? (bankSlugs.has(derivedSlug) ? derivedSlug : null);

        if (!slug) { noMatch++; continue; }

        // Companies — names only, already sorted by score desc in the dataset.
        const company_tags = q.companies.map((c) => c.name);

        // Videos — store videoId + channel + embedUrl so the UI can derive
        // thumbnail and watch URL without extra parsing.
        const video_solutions: VideoRow[] = q.videos
            .slice(0, 5)
            .map((v) => ({
                video_id: extractVideoId(v.embedded_url),
                channel: v.channel,
                embed_url: v.embedded_url,
            }))
            .filter((v) => v.video_id); // drop any that failed to parse

        const { error } = await supabase
            .from("problem_bank")
            .update({
                company_tags,
                video_solutions,
                acceptance_rate: q.acceptance,
            })
            .eq("slug", slug);

        if (error) { console.error(`Failed ${slug}:`, error.message); }
        else updated++;
    }

    console.log(`\nDone. Updated: ${updated}  Skipped (not in bank): ${skipped}  No match: ${noMatch}`);
    console.log(`Dataset size: ${questions.length}  Bank size: ${bankRows?.length ?? 0}`);

    // Sanity check — show a few enriched rows.
    const { data: sample } = await supabase
        .from("problem_bank")
        .select("slug, company_tags, video_solutions, acceptance_rate")
        .not("company_tags", "eq", "{}")
        .limit(3);

    console.log("\nSample enriched rows:");
    sample?.forEach((r) => {
        console.log(`  ${r.slug}`);
        console.log(`    companies: ${r.company_tags?.slice(0, 3).join(", ")}`);
        console.log(`    videos:    ${(r.video_solutions as VideoRow[])?.length ?? 0} videos`);
        console.log(`    acceptance: ${((r.acceptance_rate ?? 0) * 100).toFixed(1)}%`);
    });
}

main();