/**
 * Concept graph metrics for the "Bridge & Runway" intelligence layer
 * (docs/bridge-runway-spec.md §4.2, §10.2).
 *
 * The prerequisite graph is encoded on `aiml_concepts.prerequisites` — for a
 * concept Y, `Y.prerequisites = [X, …]` means "Y depends on X". The reverse
 * relation ("X is a prerequisite of Y") is what makes a concept *central*: the
 * more downstream concepts transitively rest on X, the more leverage refreshing
 * X has.
 *
 *   computeCentrality  — normalized transitive fan-out per concept (global).
 *   computeBlastRadius — fraction of a lecture's concepts that rest on a prereq.
 *
 * Both are structural (memory-independent), so they never touch FSRS state.
 */

import type { Tables } from "@/types/database";

/**
 * The graph math needs only `id`/`prerequisites` from an `aiml_concepts` row, so
 * the param is a structural subset of the DB type — full rows satisfy it, and so
 * do the minimal shapes the planning engine builds.
 */
type ConceptRow = Pick<Tables<"aiml_concepts">, "id" | "prerequisites">;

/** Blast radius reads only `prerequisite_concept_ids` from a `lecture_schedules` row. */
type LectureRow = Pick<Tables<"lecture_schedules">, "prerequisite_concept_ids">;

/** Deduplicate while preserving first-seen order. */
function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}

/**
 * Build the reverse adjacency of the prerequisite graph:
 *   dependents.get(X) = set of concepts that list X as a direct prerequisite.
 * Prerequisite references to ids not present in `concepts` are ignored (dangling
 * edges), and self-edges are dropped, so the graph stays well-formed.
 */
function buildDependents(concepts: ConceptRow[]): Map<string, Set<string>> {
  const known = new Set(concepts.map((c) => c.id));
  const dependents = new Map<string, Set<string>>();

  for (const concept of concepts) {
    for (const prereqId of concept.prerequisites ?? []) {
      if (!known.has(prereqId) || prereqId === concept.id) continue;
      let set = dependents.get(prereqId);
      if (!set) {
        set = new Set<string>();
        dependents.set(prereqId, set);
      }
      set.add(concept.id);
    }
  }
  return dependents;
}

/**
 * All concepts that depend — directly or transitively — on `startId`, excluding
 * `startId` itself. Iterative DFS with a visited set, so cycles in malformed
 * data cannot cause an infinite loop.
 */
function downstreamClosure(
  startId: string,
  dependents: Map<string, Set<string>>
): Set<string> {
  const seen = new Set<string>();
  const stack: string[] = [...(dependents.get(startId) ?? [])];

  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (id === startId || seen.has(id)) continue;
    seen.add(id);
    const next = dependents.get(id);
    if (next) {
      for (const n of next) {
        if (!seen.has(n)) stack.push(n);
      }
    }
  }
  return seen;
}

/**
 * Centrality = normalized transitive fan-out per concept (spec §4.2).
 *
 * Formula: for each concept X, count |{ Y : Y transitively depends on X }| over
 * the reverse prerequisite graph, then divide by the maximum fan-out across all
 * concepts so the most-central concept scores 1.0 and a leaf scores 0. Max-
 * normalization (rather than /N) keeps the metric discriminative for ranking and
 * comparable in magnitude to blast radius and proximity. With no edges, every
 * concept is 0.
 *
 * @param concepts All `aiml_concepts` rows forming the graph.
 * @returns Map of concept id → centrality ∈ [0, 1].
 */
export function computeCentrality(concepts: ConceptRow[]): Map<string, number> {
  const dependents = buildDependents(concepts);

  const fanOut = new Map<string, number>();
  let maxFanOut = 0;
  for (const concept of concepts) {
    const count = downstreamClosure(concept.id, dependents).size;
    fanOut.set(concept.id, count);
    if (count > maxFanOut) maxFanOut = count;
  }

  const centrality = new Map<string, number>();
  for (const [id, count] of fanOut) {
    centrality.set(id, maxFanOut > 0 ? count / maxFanOut : 0);
  }
  return centrality;
}

/**
 * Blast radius = the lecture-specific "how much does THIS lecture rest on the
 * prereq" (spec §4.2).
 *
 * Formula: B = |{ c ∈ nextLecture.prerequisite_concept_ids : c depends, directly
 * or transitively, on prereqId }| / |nextLecture.prerequisite_concept_ids|. We
 * measure against the lecture's *prerequisites* (not its extracted concepts):
 * those are populated before the lecture is attended, so blast radius is
 * meaningful for Runway ranking immediately, rather than only post-attendance.
 * The prereq itself is never counted as depending on itself, so B ∈ [0, 1].
 * Returns 0 when the lecture has no prerequisite concepts.
 *
 * @param prereqId The candidate prerequisite being scored.
 * @param nextLecture The upcoming lecture whose prereq set defines the radius.
 * @param allConcepts All `aiml_concepts` rows forming the graph.
 * @returns blast radius ∈ [0, 1].
 */
export function computeBlastRadius(
  prereqId: string,
  nextLecture: LectureRow,
  allConcepts: ConceptRow[]
): number {
  const lectureConceptIds = unique(nextLecture.prerequisite_concept_ids ?? []);
  if (lectureConceptIds.length === 0) return 0;

  const dependents = buildDependents(allConcepts);
  const downstream = downstreamClosure(prereqId, dependents);

  let dependentCount = 0;
  for (const conceptId of lectureConceptIds) {
    if (conceptId !== prereqId && downstream.has(conceptId)) dependentCount++;
  }
  return dependentCount / lectureConceptIds.length;
}
