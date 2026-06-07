/**
 * lib/pattern-map.ts
 *
 * Single source of truth for the DSA pattern taxonomy.
 *
 * The AlgoMaster 300 list uses ~59 fine-grained groups and LeetCode uses ~59
 * topic tags. Both are normalized here into 25 canonical patterns that the
 * Pattern Mastery model, Coach, and priority engine reason about.
 *
 * To re-tag the whole problem bank, edit the maps below and re-run
 * `npx tsx scripts/seed-problem-bank.ts` — the CSV stays raw; mapping is code.
 */

export const CANONICAL_PATTERNS = [
  "arrays", "strings", "two_pointers", "sliding_window", "prefix_sum", "hashing",
  "binary_search", "sorting", "linked_list", "stack", "monotonic_stack", "heap",
  "tree", "bst", "trie", "graph_traversal", "advanced_graph", "backtracking",
  "dynamic_programming", "greedy", "intervals", "bit_manipulation", "math_geometry",
  "design", "matrix",
] as const;

export type CanonicalPattern = (typeof CANONICAL_PATTERNS)[number];

/** AlgoMaster group (the CSV `pattern` column) -> primary canonical pattern. */
export const GROUP_MAP: Record<string, CanonicalPattern> = {
  "Arrays": "arrays",
  "Strings": "strings",
  "String Matching": "strings",
  "Bit Manipulation": "bit_manipulation",
  "Hash Tables": "hashing",
  "Two Pointers": "two_pointers",
  "Fast and Slow Pointers": "two_pointers",
  "Prefix Sum": "prefix_sum",
  "Sliding Window - Fixed Size": "sliding_window",
  "Sliding Window - Dynamic Size": "sliding_window",
  "Monotonic Queue": "sliding_window",
  "Kadane's Algorithm": "dynamic_programming",
  "Matrix (2D Array)": "matrix",
  "Stacks": "stack",
  "Queues": "stack",
  "Monotonic Stack": "monotonic_stack",
  "Linked List": "linked_list",
  "LinkedList In-place Reversal": "linked_list",
  "Heaps": "heap",
  "Two Heaps": "heap",
  "Top K Elements": "heap",
  "K-Way Merge": "heap",
  "Binary Search": "binary_search",
  "Tree Traversal - Pre Order": "tree",
  "Tree Traversal - In Order": "tree",
  "Tree Traversal - Post-Order": "tree",
  "Tree Traversal - Level Order": "tree",
  "Tree / Graph DP": "dynamic_programming",
  "BST / Ordered Set": "bst",
  "Tries": "trie",
  "Depth First Search (DFS)": "graph_traversal",
  "Breadth First Search (BFS)": "graph_traversal",
  "Shortest Path": "advanced_graph",
  "Topological Sort": "advanced_graph",
  "Union Find": "advanced_graph",
  "Minimum Spanning Tree": "advanced_graph",
  "Eulerian Circuit": "advanced_graph",
  "Backtracking": "backtracking",
  "1-D DP": "dynamic_programming",
  "String DP": "dynamic_programming",
  "2D Grid DP": "dynamic_programming",
  "0/1 Knapsack": "dynamic_programming",
  "Unbounded Knapsack": "dynamic_programming",
  "Longest Increasing Subsequence (LIS)": "dynamic_programming",
  "Digit DP": "dynamic_programming",
  "Bitmask DP": "dynamic_programming",
  "Probability DP": "dynamic_programming",
  "State Machine DP": "dynamic_programming",
  "Greedy": "greedy",
  "Intervals": "intervals",
  "Line Sweep": "intervals",
  "Data Structure Design": "design",
  "Binary Indexed Tree / Segment Tree": "design",
  "Maths / Geometry": "math_geometry",
  "Divide and Conquer": "math_geometry",
  "Recursion": "math_geometry",
  "Merge Sort": "sorting",
  "QuickSort / QuickSelect": "sorting",
  "Bucket Sort": "sorting",
};

/**
 * LeetCode topic tag (the CSV `topics` column) -> canonical secondary pattern.
 * null = intentionally skipped (too generic to be a useful skill signal).
 * Enrichment recovers the real technique for problems filed under generic
 * buckets like "Arrays"/"Strings".
 */
export const TOPIC_MAP: Record<string, CanonicalPattern | null> = {
  "array": null, "string": null, "simulation": null, "interactive": null, "randomized": null,
  "two-pointers": "two_pointers", "sliding-window": "sliding_window", "prefix-sum": "prefix_sum",
  "binary-search": "binary_search", "backtracking": "backtracking",
  "dynamic-programming": "dynamic_programming", "memoization": "dynamic_programming",
  "greedy": "greedy", "bit-manipulation": "bit_manipulation", "bitmask": "bit_manipulation",
  "union-find": "advanced_graph", "topological-sort": "advanced_graph", "shortest-path": "advanced_graph",
  "minimum-spanning-tree": "advanced_graph", "eulerian-circuit": "advanced_graph", "graph": "graph_traversal",
  "depth-first-search": "graph_traversal", "breadth-first-search": "graph_traversal",
  "monotonic-stack": "monotonic_stack", "monotonic-queue": "sliding_window",
  "stack": "stack", "queue": "stack", "heap-priority-queue": "heap",
  "linked-list": "linked_list", "doubly-linked-list": "linked_list",
  "trie": "trie", "binary-search-tree": "bst", "ordered-set": "bst",
  "tree": "tree", "binary-tree": "tree",
  "divide-and-conquer": "math_geometry", "recursion": "math_geometry", "math": "math_geometry",
  "geometry": "math_geometry", "probability-and-statistics": "math_geometry", "game-theory": "math_geometry",
  "matrix": "matrix", "sorting": "sorting", "merge-sort": "sorting", "quickselect": "sorting",
  "bucket-sort": "sorting", "radix-sort": "sorting", "counting": "hashing", "hash-table": "hashing",
  "hash-function": "hashing", "rolling-hash": "strings", "string-matching": "strings", "suffix-array": "strings",
  "design": "design", "data-stream": "design", "iterator": "design", "segment-tree": "design",
  "binary-indexed-tree": "design", "line-sweep": "intervals",
};

/**
 * Interview/foundational importance per pattern (0..1). Feeds the "Frequency"
 * term in PatternPriority (DSA spec §7). Tune to your goals.
 */
export const PATTERN_IMPORTANCE: Record<CanonicalPattern, number> = {
  arrays: 0.95, hashing: 0.95, graph_traversal: 0.95, dynamic_programming: 0.95,
  two_pointers: 0.90, binary_search: 0.90, tree: 0.90, sliding_window: 0.85,
  strings: 0.80, linked_list: 0.80, stack: 0.80, heap: 0.80, backtracking: 0.75,
  greedy: 0.75, prefix_sum: 0.70, sorting: 0.70, advanced_graph: 0.70, matrix: 0.70,
  bst: 0.65, intervals: 0.65, design: 0.65, monotonic_stack: 0.60,
  trie: 0.55, bit_manipulation: 0.55, math_geometry: 0.55,
};

/**
 * Resolve a problem's canonical patterns from its AlgoMaster group + LeetCode
 * topics. Primary (group) first, then topic-derived secondaries, deduped.
 */
export function toPatterns(group: string, topicsPipeJoined: string): CanonicalPattern[] {
  const out: CanonicalPattern[] = [];
  const primary = GROUP_MAP[group.trim()];
  if (primary) out.push(primary);
  for (const raw of topicsPipeJoined.split("|")) {
    const t = raw.trim();
    if (!t) continue;
    const mapped = TOPIC_MAP[t];
    if (mapped && !out.includes(mapped)) out.push(mapped);
  }
  return out;
}
