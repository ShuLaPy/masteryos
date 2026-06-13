/**
 * Dynamic Learning Path (concept roadmap) — pure helpers.
 *
 * A roadmap is an AI-generated, dependency-aware INDEX of topics to study to
 * master a concept (never the educational content itself). It is stored
 * relationally across `concept_roadmaps` (lifecycle) and `roadmap_items` (the
 * tree); see the 20260613100000_concept_roadmaps migration.
 *
 * This module is pure (no Supabase/AI) so the generator, the API route, and the
 * UI can share the same validation/assembly/rollup logic — mirroring the
 * defensive-parsing posture of lib/derivation.ts (`parseDerivationPayload`).
 */

// ── Domain constants ────────────────────────────────────────────────────────

/** Bloom-ordered difficulty bands, foundations → mastery. */
export const DIFFICULTY_LEVELS = [
  "foundational",
  "intermediate",
  "advanced",
  "expert",
] as const;
export type DifficultyLevel = (typeof DIFFICULTY_LEVELS)[number];

/** Kinds of user-attached resource. AI never populates these (no fabricated URLs). */
export const RESOURCE_TYPES = ["youtube", "blog", "paper", "other"] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

export interface ResourceLink {
  type: ResourceType;
  title: string;
  url: string;
}

export type ItemStatus = "not_started" | "in_progress" | "completed";

// Caps so a runaway AI response can never explode the table (plan §2).
export const MAX_PHASES = 6;
export const MAX_TOPICS_PER_PHASE = 12;
export const MAX_SUBTOPICS_PER_TOPIC = 8;

// ── AI generation shape (untrusted) ─────────────────────────────────────────

/** A node as emitted by the model; `depends_on` references other nodes by TITLE. */
export interface RoadmapGenNode {
  title: string;
  description: string;
  difficulty: DifficultyLevel | null;
  estimated_minutes: number | null;
  depends_on: string[];
  children: RoadmapGenNode[];
}

export interface RoadmapGenInput {
  phases: RoadmapGenNode[];
}

// ── DB / tree shapes ─────────────────────────────────────────────────────────

/** A `roadmap_items` row (subset the UI and helpers care about). */
export interface RoadmapItemRow {
  id: string;
  parent_item_id: string | null;
  depth: number;
  sort_order: number;
  title: string;
  description: string | null;
  difficulty: DifficultyLevel | null;
  estimated_minutes: number | null;
  status: ItemStatus;
  notes: string | null;
  resources: ResourceLink[];
  depends_on: string[];
}

/** A node in the assembled tree, with rolled-up completion. */
export interface RoadmapNode extends RoadmapItemRow {
  children: RoadmapNode[];
  /** 0–100. Leaf = status-derived; parent = mean over descendant leaves. */
  completionPct: number;
}

/** A flattened row ready for insertion (ids assigned by the DB). */
export interface RoadmapInsertRow {
  depth: number;
  sort_order: number;
  parent_index: number | null; // index into the flattened array of the parent
  title: string;
  description: string | null;
  difficulty: DifficultyLevel | null;
  estimated_minutes: number | null;
  depends_on_titles: string[];
}

// ── Validation helpers ───────────────────────────────────────────────────────

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function coerceDifficulty(value: unknown): DifficultyLevel | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  return (DIFFICULTY_LEVELS as readonly string[]).includes(v)
    ? (v as DifficultyLevel)
    : null;
}

function coerceMinutes(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return null;
  return Math.min(100000, Math.round(n));
}

function coerceStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isNonEmptyString).map((s) => s.trim());
}

/**
 * Normalize one untrusted node and (recursively) its children up to `maxChildren`.
 * Returns null when the node has no usable title so callers can drop it.
 */
function parseNode(raw: unknown, maxChildren: number): RoadmapGenNode | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (!isNonEmptyString(obj.title)) return null;

  // Children may arrive under `children`, `topics`, or `subtopics`.
  const rawChildren =
    (Array.isArray(obj.children) && obj.children) ||
    (Array.isArray(obj.topics) && obj.topics) ||
    (Array.isArray(obj.subtopics) && obj.subtopics) ||
    [];

  const children: RoadmapGenNode[] = [];
  for (const child of rawChildren as unknown[]) {
    if (children.length >= maxChildren) break;
    const parsed = parseNode(child, MAX_SUBTOPICS_PER_TOPIC);
    if (parsed) children.push(parsed);
  }

  return {
    title: obj.title.trim(),
    description: isNonEmptyString(obj.description) ? obj.description.trim() : "",
    difficulty: coerceDifficulty(obj.difficulty),
    estimated_minutes: coerceMinutes(obj.estimated_minutes),
    depends_on: coerceStringArray(obj.depends_on),
    children,
  };
}

/**
 * Validate/normalize raw AI JSON into a {@link RoadmapGenInput}. Returns null
 * when no usable phase survives, so the generator can mark the roadmap 'failed'.
 */
export function parseRoadmapGeneration(raw: unknown): RoadmapGenInput | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const rawPhases = Array.isArray(obj.phases) ? obj.phases : null;
  if (!rawPhases) return null;

  const phases: RoadmapGenNode[] = [];
  for (const phase of rawPhases as unknown[]) {
    if (phases.length >= MAX_PHASES) break;
    const parsed = parseNode(phase, MAX_TOPICS_PER_PHASE);
    if (parsed) phases.push(parsed);
  }

  if (phases.length === 0) return null;
  return { phases };
}

// ── Flatten (for insertion) ──────────────────────────────────────────────────

/**
 * Depth-first flatten of the validated tree into ordered insert rows. Each row
 * records the array index of its parent (resolved to a real uuid by the caller
 * after insertion) and carries `depends_on` titles for a second resolution pass.
 */
export function flattenForInsert(input: RoadmapGenInput): RoadmapInsertRow[] {
  const rows: RoadmapInsertRow[] = [];

  const walk = (node: RoadmapGenNode, depth: number, parentIndex: number | null, order: number) => {
    const selfIndex = rows.length;
    rows.push({
      depth,
      sort_order: order,
      parent_index: parentIndex,
      title: node.title,
      description: node.description || null,
      difficulty: node.difficulty,
      estimated_minutes: node.estimated_minutes,
      depends_on_titles: node.depends_on,
    });
    node.children.forEach((child, i) => walk(child, depth + 1, selfIndex, i));
  };

  input.phases.forEach((phase, i) => walk(phase, 0, null, i));
  return rows;
}

// ── Build tree (for rendering) ────────────────────────────────────────────────

/**
 * Assemble flat DB rows into a nested tree, sorted by (depth, sort_order), with
 * completion rolled up: leaf = completed ? 100 : 0; parent = mean of its
 * descendant leaves' completion. `in_progress` counts as 0% complete but is
 * still surfaced distinctly by the UI via `status`.
 */
export function buildRoadmapTree(rows: RoadmapItemRow[]): RoadmapNode[] {
  const byId = new Map<string, RoadmapNode>();
  for (const row of rows) {
    byId.set(row.id, { ...row, children: [], completionPct: 0 });
  }

  const roots: RoadmapNode[] = [];
  for (const node of byId.values()) {
    if (node.parent_item_id && byId.has(node.parent_item_id)) {
      byId.get(node.parent_item_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortRec = (nodes: RoadmapNode[]) => {
    nodes.sort((a, b) => a.sort_order - b.sort_order);
    nodes.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);

  // Roll up completion bottom-up; return [completedLeaves, totalLeaves].
  const rollup = (node: RoadmapNode): [number, number] => {
    if (node.children.length === 0) {
      const done = node.status === "completed" ? 1 : 0;
      node.completionPct = done * 100;
      return [done, 1];
    }
    let completed = 0;
    let total = 0;
    for (const child of node.children) {
      const [c, t] = rollup(child);
      completed += c;
      total += t;
    }
    node.completionPct = total === 0 ? 0 : Math.round((completed / total) * 100);
    return [completed, total];
  };
  roots.forEach(rollup);

  return roots;
}

/** Overall roadmap completion (0–100) = completed leaves / total leaves. */
export function computeOverallProgress(roots: RoadmapNode[]): {
  overallPct: number;
  totalLeaves: number;
  completedLeaves: number;
} {
  let total = 0;
  let completed = 0;
  const visit = (node: RoadmapNode) => {
    if (node.children.length === 0) {
      total += 1;
      if (node.status === "completed") completed += 1;
    } else {
      node.children.forEach(visit);
    }
  };
  roots.forEach(visit);
  return {
    overallPct: total === 0 ? 0 : Math.round((completed / total) * 100),
    totalLeaves: total,
    completedLeaves: completed,
  };
}

/**
 * Validate/normalize an untrusted `resources` value (DB jsonb or PATCH body)
 * into a clean {@link ResourceLink}[]. Drops malformed entries.
 */
export function parseResources(raw: unknown): ResourceLink[] {
  if (!Array.isArray(raw)) return [];
  const out: ResourceLink[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (!isNonEmptyString(e.title) || !isNonEmptyString(e.url)) continue;
    const type =
      typeof e.type === "string" && (RESOURCE_TYPES as readonly string[]).includes(e.type)
        ? (e.type as ResourceType)
        : "other";
    out.push({ type, title: e.title.trim(), url: e.url.trim() });
  }
  return out;
}
