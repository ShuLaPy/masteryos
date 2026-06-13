"use client";

/**
 * Shared markdown renderer with LaTeX math support (roadmap Phase 1b).
 *
 * Extends the project's existing `react-markdown` + `remark-gfm` usage (see
 * ConceptNotesCard) with `remark-math` + `rehype-katex` so `$inline$` and
 * `$$block$$` math render via KaTeX. Reused by derivation cards, and later by
 * paper section/equation rendering (Phases 2–3).
 *
 * `throwOnError: false` is deliberate: malformed LaTeX (common in AI output and
 * PDF-extracted equations) degrades to the raw source string instead of crashing
 * the render tree — the binding mitigation for the LaTeX-fidelity risk in the
 * roadmap risk register.
 */

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

interface MathMarkdownProps {
  children: string;
  /** Wrapper class; defaults to the project's `bridge-prose` typography. */
  className?: string;
}

export default function MathMarkdown({
  children,
  className = "bridge-prose",
}: MathMarkdownProps) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }]]}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
