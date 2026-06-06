/**
 * Concept graph utilities for the Bridge & Runway intelligence layer.
 *
 * Implements Centrality and Blast Radius as defined in docs/bridge-runway-spec.md §4.2.
 * Both values are derived purely from the aiml_concepts prerequisite graph and the
 * lecture_schedules table — no FSRS fields are touched here.
 */

import type { Tables } from "@/types/database";

export type ConceptRow = Tables<"aiml_concepts">;
export type LectureRow = Tables<"lecture_schedules">;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build a reverse-adjacency map: prereqId → Set of concept ids that directly
 * list it as a prerequisite. One pass over the concept list.
 */
function buildDependentsMap(concepts: ConceptRow[]): Map<string, Set<string>> {
  const dependents = new Map<string, Set<string>>();
  for (const c of concepts) {
    if (!dependents.has(c.id)) dependents.set(c.id, new Set());
    for (const prereqId of c.prerequisites ?? []) {
      if (!dependents.has(prereqId)) dependents.set(prereqId, new Set());
      dependents.get(prereqId)!.add(c.id);
    }
  }
  return dependents;
}

/**
 * BFS from startId through graph, counting reachable nodes (start excluded).
 * Handles cycles via a visited set that is pre-seeded with startId.
 */
function countReachable(
  startId: string,
  graph: Map<string, Set<string>>
): number {
  const visited = new Set<string>([startId]);
  const queue: string[] = [startId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const neighbor of graph.get(current) ?? []) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  return visited.size - 1; // subtract the start node itself
}

/**
 * Returns true when targetPrereqId appears anywhere in the transitive prerequisite
 * chain of conceptId. BFS follows forward prerequisite edges (concept → its prereqs).
 * Cycles are safe: visited set prevents re-queuing.
 * A concept is NOT considered a prerequisite of itself.
 */
function isTransitivePrereq(
  targetPrereqId: string,
  conceptId: string,
  prereqsOf: Map<string, Set<string>>
): boolean {
  if (conceptId === targetPrereqId) return false;
  const visited = new Set<string>([conceptId]);
  const queue: string[] = [conceptId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const prereq of prereqsOf.get(current) ?? []) {
      if (prereq === targetPrereqId) return true;
      if (!visited.has(prereq)) {
        visited.add(prereq);
        queue.push(prereq);
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Computes normalized transitive fan-out (Centrality C) for every concept.
 *
 * Algorithm (spec §4.2):
 *   1. Build a reverse-dependency graph: for each concept with prerequisites [P…],
 *      register the concept as a dependent of each P.
 *   2. BFS from every concept through the dependents graph to count how many
 *      other concepts transitively rely on it (its "fan-out").
 *   3. Divide each fan-out by the global maximum to normalise to [0, 1].
 *      The most foundational concept scores 1; a leaf concept scores 0.
 *
 * Returns a map from concept id → C ∈ [0, 1].
 * Wrapped in { data, error } because callers should handle a malformed graph
 * without crashing the planning engine.
 */
export function computeCentrality(
  concepts: ConceptRow[]
): { data: Map<string, number> | null; error: string | null } {
  try {
    if (concepts.length === 0) {
      return { data: new Map(), error: null };
    }

    const dependents = buildDependentsMap(concepts);

    let maxFanOut = 0;
    const fanOut = new Map<string, number>();
    for (const c of concepts) {
      const count = countReachable(c.id, dependents);
      fanOut.set(c.id, count);
      if (count > maxFanOut) maxFanOut = count;
    }

    const centrality = new Map<string, number>();
    for (const [id, count] of fanOut) {
      centrality.set(id, maxFanOut === 0 ? 0 : count / maxFanOut);
    }

    return { data: centrality, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error in computeCentrality";
    return { data: null, error: message };
  }
}

/**
 * Computes Blast Radius B of a prerequisite concept relative to the next lecture (spec §4.2).
 *
 *   B = |{ Ci ∈ nextLecture.extracted_concept_ids : prereqId ∈ transitivePrereqs(Ci) }|
 *       ─────────────────────────────────────────────────────────────────────────────────
 *                         |nextLecture.extracted_concept_ids|
 *
 * In plain English: the fraction of this lecture's concepts that (directly or
 * transitively) depend on prereqId. High B → reviewing this prereq has maximum
 * leverage for the upcoming lecture.
 *
 * Returns 0 when the lecture has no extracted_concept_ids yet (pre-attendance).
 * Always returns a value in [0, 1]. Pure computation — never throws.
 */
export function computeBlastRadius(
  prereqId: string,
  nextLecture: LectureRow,
  allConcepts: ConceptRow[]
): number {
  const lectureConceptIds = nextLecture.extracted_concept_ids ?? [];
  if (lectureConceptIds.length === 0) return 0;

  // Forward adjacency: concept id → Set of its direct prerequisite ids.
  const prereqsOf = new Map<string, Set<string>>();
  for (const c of allConcepts) {
    prereqsOf.set(c.id, new Set(c.prerequisites ?? []));
  }

  let dependentCount = 0;
  for (const conceptId of lectureConceptIds) {
    if (isTransitivePrereq(prereqId, conceptId, prereqsOf)) {
      dependentCount++;
    }
  }

  return dependentCount / lectureConceptIds.length;
}
