"use client";

import { useState } from "react";
import { Sparkles, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type State = "idle" | "loading" | "done" | "error";

// Renders inline **bold** and `code` spans
function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={i} className="px-1 py-0.5 rounded text-xs font-mono bg-secondary/60 text-emerald-300">
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

// Parses the structured markdown the AI blueprint always emits:
//   ## Headings, - bullet lists, **bold**, `code`, plain paragraphs
function MarkdownBlueprint({ text }: { text: string }) {
  const lines = text.split("\n");
  const nodes: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("## ")) {
      nodes.push(
        <h2
          key={key++}
          className="text-sm font-semibold text-violet-300 mt-6 mb-2 pb-1.5 border-b border-violet-500/20 first:mt-0 uppercase tracking-wide"
        >
          {line.slice(3)}
        </h2>
      );
      i++;
    } else if (/^[-*] /.test(line)) {
      const bullets: string[] = [];
      while (i < lines.length && /^[-*] /.test(lines[i])) {
        bullets.push(lines[i].slice(2));
        i++;
      }
      nodes.push(
        <ul key={key++} className="my-2 ml-3 space-y-1.5 list-none">
          {bullets.map((b, idx) => (
            <li key={idx} className="text-sm text-foreground/80 flex gap-2 leading-relaxed">
              <span className="text-violet-400 mt-0.5 shrink-0">·</span>
              <span>{renderInline(b)}</span>
            </li>
          ))}
        </ul>
      );
    } else if (line.trim() === "") {
      i++;
    } else {
      nodes.push(
        <p key={key++} className="text-sm text-foreground/80 leading-relaxed my-1.5">
          {renderInline(line)}
        </p>
      );
      i++;
    }
  }

  return <>{nodes}</>;
}

export function AIExplainSection({ problemId }: { problemId: string }) {
  const [state, setState] = useState<State>("idle");
  const [explanation, setExplanation] = useState<string | null>(null);
  const [cached, setCached] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function fetchExplanation(force = false) {
    setState("loading");
    setErrorMsg(null);
    try {
      const res = await fetch("/api/dsa/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ problemId, force }),
      });
      const json = (await res.json()) as {
        data: { explanation: string; cached: boolean } | null;
        error: string | null;
      };
      if (!res.ok || json.error || !json.data) {
        setState("error");
        setErrorMsg(json.error ?? "Generation failed");
        return;
      }
      setExplanation(json.data.explanation);
      setCached(json.data.cached);
      setState("done");
    } catch (err) {
      setState("error");
      setErrorMsg(err instanceof Error ? err.message : "Network error");
    }
  }

  if (state === "idle") {
    return (
      <Button
        onClick={() => fetchExplanation()}
        variant="outline"
        size="sm"
        className="gap-2 border-violet-500/30 text-violet-300 hover:bg-violet-500/10 hover:text-violet-200"
      >
        <Sparkles className="w-3.5 h-3.5" />
        AI Explain
      </Button>
    );
  }

  if (state === "loading") {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin text-violet-400" />
          <span>Generating blueprint…</span>
        </div>
        <div className="glass rounded-xl p-5 space-y-3 animate-pulse">
          {[55, 75, 40, 80, 60, 45, 70].map((w, i) => (
            <div key={i} className="h-2.5 rounded bg-secondary/60" style={{ width: `${w}%` }} />
          ))}
        </div>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="flex items-start gap-3">
        <p className="flex-1 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
          {errorMsg ?? "Failed to generate explanation."}
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 text-xs text-muted-foreground"
          onClick={() => fetchExplanation()}
        >
          Retry
        </Button>
      </div>
    );
  }

  // done
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-violet-400" />
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            AI Blueprint
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={`text-[10px] px-1.5 py-0.5 ${
              cached
                ? "border-emerald-500/30 text-emerald-400"
                : "border-violet-500/30 text-violet-400"
            }`}
          >
            {cached ? "Cached" : "Just generated"}
          </Badge>
          <button
            onClick={() => fetchExplanation(true)}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
            title="Regenerate"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>
      </div>
      <div className="glass rounded-xl p-5 border border-violet-500/15">
        {explanation && <MarkdownBlueprint text={explanation} />}
      </div>
    </div>
  );
}
