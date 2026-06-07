/**
 * scripts/seed-problem-bank.ts
 *
 * Reads the raw AlgoMaster export (supabase/seed/algomaster_problems.csv),
 * normalizes patterns via lib/pattern-map.ts, and upserts into
 * public.problem_bank using the Supabase service-role client.
 *
 * Run:  npx tsx scripts/seed-problem-bank.ts
 *
 * Env (already in .env.local):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Idempotent: upserts on `slug`.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { toPatterns, CANONICAL_PATTERNS } from "../lib/pattern-map";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SECRET_KEY");
  process.exit(1);
}

const VALID_DIFFICULTIES = new Set(["easy", "medium", "hard"]);

/** CSV parser that respects quoted fields containing commas. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "", row: string[] = [], inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function load() {
  const csvPath = join(process.cwd(), "supabase", "seed", "algomaster_problems.csv");
  const records = parseCsv(readFileSync(csvPath, "utf8"));
  const [header, ...lines] = records;
  const ix = (name: string) => header.indexOf(name);
  const col = { slug: ix("slug"), title: ix("title"), difficulty: ix("difficulty"),
                topics: ix("topics"), pattern: ix("pattern"), url: ix("leetcode_url") };

  const rows: { slug: string; title: string; difficulty: string; patterns: string[]; leetcode_url: string }[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  lines.forEach((c, n) => {
    const line = n + 2;
    const slug = c[col.slug]?.trim();
    const title = c[col.title]?.trim();
    const difficulty = c[col.difficulty]?.trim().toLowerCase();
    const patterns = toPatterns(c[col.pattern] ?? "", c[col.topics] ?? "");
    const leetcode_url = c[col.url]?.trim();

    if (!slug) errors.push(`Line ${line}: missing slug`);
    if (!title) errors.push(`Line ${line}: missing title`);
    if (!VALID_DIFFICULTIES.has(difficulty)) errors.push(`Line ${line}: bad difficulty "${difficulty}"`);
    if (!patterns.length) errors.push(`Line ${line} (${slug}): no canonical pattern resolved`);
    if (!leetcode_url) errors.push(`Line ${line}: missing leetcode_url`);
    if (seen.has(slug)) errors.push(`Line ${line}: duplicate slug "${slug}"`);
    seen.add(slug);

    if (slug && title && VALID_DIFFICULTIES.has(difficulty) && patterns.length && leetcode_url)
      rows.push({ slug, title, difficulty, patterns, leetcode_url });
  });

  if (errors.length) { console.error(`${errors.length} problem(s):\n${errors.join("\n")}`); process.exit(1); }
  return rows;
}

async function main() {
  const rows = load();
  const supabase = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);

  let n = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
    const { error } = await supabase.from("problem_bank").upsert(batch, { onConflict: "slug" });
    if (error) { console.error(`Batch ${i / 100 + 1} failed:`, error.message); process.exit(1); }
    n += batch.length;
  }

  const dist = new Map<string, number>();
  rows.forEach((r) => r.patterns.forEach((p) => dist.set(p, (dist.get(p) ?? 0) + 1)));
  console.log(`Upserted ${n} problems.\n`);
  for (const p of CANONICAL_PATTERNS) console.log(`  ${p.padEnd(20)} ${dist.get(p) ?? 0}`);
  const orphan = CANONICAL_PATTERNS.filter((p) => !dist.has(p));
  if (orphan.length) console.warn(`\nPatterns with zero problems: ${orphan.join(", ")}`);
}

main();
