/**
 * scripts/backfill-problem-elo.ts
 *
 * Backfills problem_bank.elo_rating with real, contest-derived per-problem Elo
 * ratings from the zerotrac/leetcode_problem_rating dataset. A problem's rating
 * is the LeetCode user rating at which there is ~50% probability of solving it
 * in-contest (computed via MLE) — exactly the Elo scale the ZPD selector and the
 * Glicko mastery update reason on.
 *
 * This is the highest-leverage data unlock for the ZPD system: with a real Elo,
 * problem selection matches difficulty continuously (instead of 3 coarse buckets)
 * and the Glicko update scores each attempt against the true problem difficulty.
 * Until this runs, the system degrades gracefully to an acceptance-rate pseudo-Elo
 * (see lib/zpd.ts → problemElo), so it is fully optional.
 *
 * Source format (tab-separated): Rating \t ID \t Title \t Title ZH \t Title Slug
 *   \t Contest Slug \t Problem Index. We use column 0 (Rating) and column 4
 *   (Title Slug), matched against problem_bank.slug.
 *
 * Note: zerotrac only covers weekly/biweekly CONTEST problems, so many catalog
 * problems won't match — that is expected; unmatched rows keep elo_rating = NULL.
 *
 * Run:  npx tsx scripts/backfill-problem-elo.ts
 *   Optionally place a local copy at supabase/seed/leetcode_ratings.txt to avoid
 *   the network fetch (it is used automatically when present).
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY)
 */

import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SECRET_KEY",
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const RATINGS_URL =
  "https://raw.githubusercontent.com/zerotrac/leetcode_problem_rating/main/ratings.txt";
const LOCAL_PATH = join(process.cwd(), "supabase", "seed", "leetcode_ratings.txt");

/** Load the raw ratings file — prefer a local copy, else fetch from GitHub. */
async function loadRatingsText(): Promise<string> {
  if (existsSync(LOCAL_PATH)) {
    console.log(`Reading local ratings file: ${LOCAL_PATH}`);
    return readFileSync(LOCAL_PATH, "utf8");
  }
  console.log(`Fetching ratings from ${RATINGS_URL}`);
  const res = await fetch(RATINGS_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch ratings.txt: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

/** Parse the tab-separated ratings file into a slug → rounded-Elo map. */
function parseRatings(text: string): Map<string, number> {
  const bySlug = new Map<string, number>();
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const cols = line.split("\t");
    if (cols.length < 5) continue;
    const rating = Number.parseFloat(cols[0]);
    const slug = cols[4]?.trim();
    if (!slug || !Number.isFinite(rating)) continue; // skips the header row too
    bySlug.set(slug, Math.round(rating));
  }
  return bySlug;
}

async function main() {
  const eloBySlug = parseRatings(await loadRatingsText());
  console.log(`Parsed ${eloBySlug.size} problem ratings.`);

  // Load catalog slugs (and current elo so we can report new vs refreshed).
  const { data: bankRows, error: loadErr } = await supabase
    .from("problem_bank")
    .select("slug, elo_rating");
  if (loadErr) {
    console.error("Failed to load problem_bank:", loadErr.message);
    process.exit(1);
  }

  let updated = 0;
  let unchanged = 0;
  let noMatch = 0;
  let failed = 0;

  for (const row of bankRows ?? []) {
    const elo = eloBySlug.get(row.slug);
    if (elo == null) {
      noMatch++;
      continue;
    }
    if (row.elo_rating === elo) {
      unchanged++;
      continue;
    }
    const { error } = await supabase
      .from("problem_bank")
      .update({ elo_rating: elo })
      .eq("slug", row.slug);
    if (error) {
      failed++;
      console.error(`Failed ${row.slug}:`, error.message);
    } else {
      updated++;
    }
  }

  console.log(
    `\nDone. Updated: ${updated}  Unchanged: ${unchanged}  No match (kept NULL): ${noMatch}  Failed: ${failed}`,
  );
  console.log(`Catalog size: ${bankRows?.length ?? 0}  Dataset size: ${eloBySlug.size}`);

  // Sanity check — show a few enriched rows across the difficulty range.
  const { data: sample } = await supabase
    .from("problem_bank")
    .select("slug, difficulty, elo_rating")
    .not("elo_rating", "is", null)
    .order("elo_rating", { ascending: true })
    .limit(5);
  console.log("\nSample (easiest by Elo):");
  sample?.forEach((r) =>
    console.log(`  ${r.elo_rating}  ${r.difficulty.padEnd(6)}  ${r.slug}`),
  );
}

main();
