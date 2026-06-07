export const DSA_PATTERNS = [
  "Arrays", "Sliding Window", "Two Pointers", "Fast & Slow Pointers", "Prefix Sum",
  "Binary Search", "Sorting", "Recursion", "Backtracking", "Dynamic Programming (1D)",
  "Dynamic Programming (2D)", "Greedy", "Divide & Conquer", "Linked Lists", "Stacks",
  "Queues", "Trees (BFS)", "Trees (DFS)", "Binary Search Trees", "Heaps / Priority Queues",
  "Tries", "Graphs (BFS)", "Graphs (DFS)", "Topological Sort", "Union Find"
];

/** Maps canonical snake_case patterns (from problem_bank) to DSA_PATTERNS display names. */
export const CANONICAL_TO_DISPLAY: Record<string, string> = {
  arrays: "Arrays",
  two_pointers: "Two Pointers",
  sliding_window: "Sliding Window",
  prefix_sum: "Prefix Sum",
  binary_search: "Binary Search",
  sorting: "Sorting",
  backtracking: "Backtracking",
  dynamic_programming: "Dynamic Programming (1D)",
  greedy: "Greedy",
  linked_list: "Linked Lists",
  stack: "Stacks",
  monotonic_stack: "Stacks",
  heap: "Heaps / Priority Queues",
  tree: "Trees (BFS)",
  bst: "Binary Search Trees",
  trie: "Tries",
  graph_traversal: "Graphs (BFS)",
  advanced_graph: "Topological Sort",
};

/** Maps DSA_PATTERNS display names to canonical snake_case for mastery tracking. */
export const DISPLAY_TO_CANONICAL: Record<string, string> = {
  "Arrays": "arrays",
  "Sliding Window": "sliding_window",
  "Two Pointers": "two_pointers",
  "Fast & Slow Pointers": "two_pointers",
  "Prefix Sum": "prefix_sum",
  "Binary Search": "binary_search",
  "Sorting": "sorting",
  "Recursion": "backtracking",
  "Backtracking": "backtracking",
  "Dynamic Programming (1D)": "dynamic_programming",
  "Dynamic Programming (2D)": "dynamic_programming",
  "Greedy": "greedy",
  "Divide & Conquer": "math_geometry",
  "Linked Lists": "linked_list",
  "Stacks": "stack",
  "Queues": "stack",
  "Trees (BFS)": "tree",
  "Trees (DFS)": "tree",
  "Binary Search Trees": "bst",
  "Heaps / Priority Queues": "heap",
  "Tries": "trie",
  "Graphs (BFS)": "graph_traversal",
  "Graphs (DFS)": "graph_traversal",
  "Topological Sort": "advanced_graph",
  "Union Find": "advanced_graph",
};

/**
 * Normalize any pattern string to its DSA_PATTERNS display name.
 * Handles both canonical snake_case (from problem_bank) and already-correct
 * display names. Returns null if no match is found.
 */
export function normalizePattern(pat: string): string | null {
  if (DSA_PATTERNS.includes(pat)) return pat;
  const mapped = CANONICAL_TO_DISPLAY[pat];
  return mapped ?? null;
}

/**
 * Normalize an array of patterns (any format) to deduplicated DSA_PATTERNS
 * display names, dropping any that have no known mapping.
 */
export function normalizePatterns(patterns: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const p of patterns) {
    const norm = normalizePattern(p);
    if (norm && !seen.has(norm)) {
      seen.add(norm);
      result.push(norm);
    }
  }
  return result;
}
