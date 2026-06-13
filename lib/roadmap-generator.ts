/**
 * Concept roadmap generation (Dynamic Learning Path).
 *
 * Single generation authority, callable from two places:
 *   - app/api/aiml/concepts (create-route, fire-and-forget) — pre-warms the
 *     roadmap so it's often ready by the time the page opens.
 *   - app/api/concepts/[id]/roadmap (POST, awaited) — the authoritative path
 *     that also backstops a fire-and-forget that Vercel froze post-response.
 *
 * Both can run for the same concept, so generation is gated by the same
 * claim/stale-reclaim mutex as lib/concept-seeder.ts (`claimConceptsForSeeding`):
 * exactly one caller flips the `concept_roadmaps` row to 'generating' and does
 * the work; everyone else no-ops.
 */

import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateJSON } from "@/lib/openai";
import {
  parseRoadmapGeneration,
  flattenForInsert,
  type RoadmapGenInput,
} from "@/lib/roadmap";
import type { Database } from "@/types/database";

/** Generation runs well under a minute; a frozen claim older than this is reclaimable. */
const STALE_MS = 10 * 60 * 1000;

const MODEL = "gpt-5.4";

const SYSTEM_PROMPT =
  "You are an expert AI/ML curriculum designer. You build rigorous, dependency-aware syllabi that take a learner from foundational understanding to complete technical mastery of a concept, ordered by Bloom's taxonomy (remember/understand → apply → analyze → create). You output ONLY the index of topics to study — never the educational content itself.";

function buildUserPrompt(concept: {
  title: string;
  concept_type: string | null;
  tags: string[] | null;
  notes: string | null;
}): string {
  const context = [
    `Concept: ${concept.title}`,
    concept.concept_type ? `Type: ${concept.concept_type}` : "",
    concept.tags?.length ? `Tags: ${concept.tags.join(", ")}` : "",
    concept.notes?.trim() ? `Learner's existing notes:\n${concept.notes.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return `${context}

Generate a comprehensive Learning Path (a hierarchical INDEX of topics) for mastering "${concept.title}". If a learner completes every item, they should be able to confidently claim full technical mastery of this concept.

Structure:
- 4 to 6 "phases" ordered foundations → mastery (Bloom progression).
- Each phase has 5 to 12 "topics".
- A topic MAY have a few "subtopics" (only when it genuinely decomposes — do not pad).

For EVERY node (phase, topic, subtopic) provide:
- "title": short and specific.
- "description": ONE line stating what this covers. This is an index entry, NOT a lesson — do NOT write the educational content, explanations, examples, or links.
- "difficulty": one of "foundational" | "intermediate" | "advanced" | "expert".
- "estimated_minutes": realistic focused-study minutes for this single node (integer).
- "depends_on": array of the EXACT titles of earlier nodes that must be understood first (use [] if none).

Hard rules:
- Output ONLY the index/topics to study. NEVER include the educational content, prose explanations, code, or example walk-throughs.
- Do NOT include any URLs, links, or resource references — none.
- "depends_on" must reference titles that appear elsewhere in this same output.

Return ONLY valid JSON, no markdown:
{ "phases": [ { "title": "string", "description": "string", "difficulty": "foundational", "estimated_minutes": 30, "depends_on": [], "topics": [ { "title": "string", "description": "string", "difficulty": "intermediate", "estimated_minutes": 45, "depends_on": ["..."], "subtopics": [ { "title": "string", "description": "string", "difficulty": "advanced", "estimated_minutes": 30, "depends_on": [] } ] } ] } ] }`;
}

type Result = { data: { status: string } | null; error: string | null };

async function markFailed(
  supabase: SupabaseClient<Database>,
  roadmapId: string,
  message: string
): Promise<void> {
  await supabase
    .from("concept_roadmaps")
    .update({
      status: "failed",
      error: message.slice(0, 500),
      status_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", roadmapId);
}

/** Turn the validated tree into insert-ready rows with ids/parents/deps resolved. */
function buildItemRows(
  input: RoadmapGenInput,
  userId: string,
  roadmapId: string,
  conceptId: string
) {
  const flat = flattenForInsert(input);
  const indexToId = flat.map(() => crypto.randomUUID());

  // First occurrence of a title wins (dependency targets are unique by intent).
  const titleToId = new Map<string, string>();
  flat.forEach((row, i) => {
    if (!titleToId.has(row.title)) titleToId.set(row.title, indexToId[i]);
  });

  const nowISO = new Date().toISOString();
  return flat.map((row, i) => {
    const selfId = indexToId[i];
    const depends_on = row.depends_on_titles
      .map((t) => titleToId.get(t))
      .filter((id): id is string => Boolean(id) && id !== selfId);

    return {
      id: selfId,
      user_id: userId,
      roadmap_id: roadmapId,
      concept_id: conceptId,
      parent_item_id: row.parent_index === null ? null : indexToId[row.parent_index],
      depth: row.depth,
      sort_order: row.sort_order,
      title: row.title,
      description: row.description,
      difficulty: row.difficulty,
      estimated_minutes: row.estimated_minutes,
      status: "not_started",
      resources: [],
      depends_on,
      created_at: nowISO,
      updated_at: nowISO,
    };
  });
}

/**
 * Claim and generate a concept's roadmap. Idempotent: returns early (without
 * regenerating) when the roadmap is already 'ready' or freshly 'generating'.
 */
export async function generateConceptRoadmap(
  supabase: SupabaseClient<Database>,
  userId: string,
  conceptId: string
): Promise<Result> {
  const now = new Date();
  const staleCutoff = new Date(now.getTime() - STALE_MS).toISOString();

  // 1. Try to claim an existing reclaimable row (pending/failed/stale-generating).
  const { data: claimed } = await supabase
    .from("concept_roadmaps")
    .update({ status: "generating", status_updated_at: now.toISOString() })
    .eq("user_id", userId)
    .eq("concept_id", conceptId)
    .or(
      `status.eq.pending,status.eq.failed,and(status.eq.generating,status_updated_at.lt.${staleCutoff})`
    )
    .select("id")
    .maybeSingle();

  let roadmapId = claimed?.id ?? null;

  if (!roadmapId) {
    // Nothing reclaimable: it's ready, freshly generating, or doesn't exist yet.
    const { data: existing } = await supabase
      .from("concept_roadmaps")
      .select("id, status")
      .eq("user_id", userId)
      .eq("concept_id", conceptId)
      .maybeSingle();

    if (existing) {
      return { data: { status: existing.status }, error: null };
    }

    // Doesn't exist — insert our own 'generating' claim. A unique-constraint
    // violation here means another caller just created it; back off cleanly.
    const { data: inserted, error: insErr } = await supabase
      .from("concept_roadmaps")
      .insert({
        user_id: userId,
        concept_id: conceptId,
        status: "generating",
        status_updated_at: now.toISOString(),
        model: MODEL,
      })
      .select("id")
      .single();

    if (insErr || !inserted) {
      return { data: { status: "generating" }, error: null };
    }
    roadmapId = inserted.id;
  }

  // 2. We own the claim — do the work.
  try {
    const { data: concept } = await supabase
      .from("aiml_concepts")
      .select("title, concept_type, tags, notes")
      .eq("id", conceptId)
      .eq("user_id", userId)
      .single();

    if (!concept) {
      await markFailed(supabase, roadmapId, "Concept not found.");
      return { data: null, error: "Concept not found." };
    }

    const { data: gen, error: aiError } = await generateJSON<RoadmapGenInput>(
      SYSTEM_PROMPT,
      buildUserPrompt(concept),
      4096,
      MODEL
    );

    const parsed = gen ? parseRoadmapGeneration(gen) : null;
    if (!parsed) {
      const msg = aiError ?? "AI returned an unusable roadmap.";
      await markFailed(supabase, roadmapId, msg);
      return { data: null, error: msg };
    }

    // Replace any prior items (regeneration safety).
    await supabase.from("roadmap_items").delete().eq("roadmap_id", roadmapId);

    const rows = buildItemRows(parsed, userId, roadmapId, conceptId);
    const { error: itemErr } = await supabase.from("roadmap_items").insert(rows);
    if (itemErr) {
      await markFailed(supabase, roadmapId, itemErr.message);
      return { data: null, error: itemErr.message };
    }

    await supabase
      .from("concept_roadmaps")
      .update({
        status: "ready",
        model: MODEL,
        error: null,
        status_updated_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq("id", roadmapId);

    return { data: { status: "ready" }, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await markFailed(supabase, roadmapId, message).catch(() => { });
    return { data: null, error: message };
  }
}
