"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, ArrowLeftRight, Loader2, RefreshCw, Sparkles, Unplug } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

// ─── Minimal markdown → HTML (no external library) ─────────────────────────
// Content is AI-generated on the server (trusted source), so
// dangerouslySetInnerHTML is acceptable; HTML entities in text nodes are
// escaped before inline substitutions to prevent accidental XSS.

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function applyInline(text: string): string {
  let out = escapeHtml(text);
  out = out.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>");
  out = out.replace(/`([^`]+?)`/g, "<code>$1</code>");
  return out;
}

function markdownToHtml(md: string): string {
  const parts: string[] = [];
  let inUl = false;
  let inOl = false;

  function closeList() {
    if (inUl) { parts.push("</ul>"); inUl = false; }
    if (inOl) { parts.push("</ol>"); inOl = false; }
  }

  for (const rawLine of md.split("\n")) {
    const t = rawLine.trimEnd().trimStart();

    if (t.startsWith("### ")) {
      closeList();
      parts.push(`<h3>${applyInline(t.slice(4))}</h3>`);
    } else if (t.startsWith("## ")) {
      closeList();
      parts.push(`<h2>${applyInline(t.slice(3))}</h2>`);
    } else if (t.startsWith("# ")) {
      closeList();
      parts.push(`<h1>${applyInline(t.slice(2))}</h1>`);
    } else if (t.startsWith("- ") || t.startsWith("* ")) {
      if (!inUl) { closeList(); parts.push("<ul>"); inUl = true; }
      parts.push(`<li>${applyInline(t.slice(2))}</li>`);
    } else if (/^\d+\.\s/.test(t)) {
      if (!inOl) { closeList(); parts.push("<ol>"); inOl = true; }
      parts.push(`<li>${applyInline(t.replace(/^\d+\.\s/, ""))}</li>`);
    } else if (t === "") {
      closeList();
    } else {
      closeList();
      parts.push(`<p>${applyInline(t)}</p>`);
    }
  }

  closeList();
  return parts.join("");
}

// ─── Types ─────────────────────────────────────────────────────────────────

type BridgeData =
  | { synthesis: string; generated_at: string; cached?: true }
  | { message: string };

// ─── Page ──────────────────────────────────────────────────────────────────

export default function BridgePage() {
  // fetchKey increments on each refresh; useEffect reacts to it.
  // loading starts true so the first render shows the spinner immediately.
  const [fetchKey, setFetchKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<BridgeData | null>(null);
  const [networkError, setNetworkError] = useState(false);

  // All setState calls are inside async .then()/.catch() — never synchronously
  // in the effect body — to satisfy react-hooks/set-state-in-effect.
  useEffect(() => {
    let cancelled = false;

    fetch("/api/lectures/bridge")
      .then((res) => {
        if (!res.ok) throw new Error("non-2xx");
        return res.json() as Promise<{ data: BridgeData | null; error: string | null }>;
      })
      .then((json) => {
        if (cancelled) return;
        setData(json.data ?? { message: "synthesis could not be generated" });
        setNetworkError(false);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setNetworkError(true);
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [fetchKey]);

  // Reset to loading state in the handler (outside the effect) so subsequent
  // renders show the spinner while the new fetch is in-flight.
  function handleRefresh() {
    setLoading(true);
    setData(null);
    setNetworkError(false);
    setFetchKey((k) => k + 1);
  }

  // ── Derived state ──────────────────────────────────────────────────────

  const isMessage = data && "message" in data;
  const isSynthesis = data && "synthesis" in data;
  const noLectures =
    isMessage && (data as { message: string }).message === "no lectures scheduled";
  const couldNotGenerate =
    isMessage &&
    (data as { message: string }).message === "synthesis could not be generated";

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link href="/schedule">
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" /> Bridge Document
            </h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              Structural link between your last lecture and the next one
            </p>
          </div>
        </div>
        {!loading && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            className="border-border/60 text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Refresh
          </Button>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="glass rounded-2xl p-12 flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-muted-foreground text-sm">
            Synthesizing concepts&hellip; this may take a moment.
          </p>
        </div>
      )}

      {/* Network / unknown error */}
      {!loading && networkError && (
        <div className="glass rounded-2xl p-8 text-center border-destructive/20">
          <Unplug className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-foreground font-medium mb-1">
            Could not reach the bridge endpoint.
          </p>
          <p className="text-muted-foreground text-sm mb-4">
            Check your connection and try again.
          </p>
          <Button variant="outline" size="sm" onClick={handleRefresh}>
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Retry
          </Button>
        </div>
      )}

      {/* Graceful message states */}
      {!loading && !networkError && isMessage && (
        <div className="glass rounded-2xl p-8 text-center border-border/60">
          <ArrowLeftRight className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          {noLectures && (
            <p className="text-muted-foreground">No lectures scheduled.</p>
          )}
          {couldNotGenerate && (
            <>
              <p className="text-foreground font-medium mb-1">
                Synthesis could not be generated.
              </p>
              <p className="text-muted-foreground text-sm mb-4">
                The AI was unable to produce a bridge document right now.
              </p>
              <Button variant="outline" size="sm" onClick={handleRefresh}>
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Try again
              </Button>
            </>
          )}
        </div>
      )}

      {/* Bridge synthesis */}
      {!loading && !networkError && isSynthesis && (
        <div className="glass rounded-2xl p-6 border-primary/20">
          {/* Cached badge */}
          {(data as { cached?: true }).cached && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-4">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400" />
              Served from cache
            </div>
          )}

          {/* Rendered markdown */}
          <div
            className="bridge-prose"
            dangerouslySetInnerHTML={{
              __html: markdownToHtml((data as { synthesis: string }).synthesis),
            }}
          />

          {/* Footer */}
          <div className="mt-6 pt-4 border-t border-border/40 text-xs text-muted-foreground">
            Generated{" "}
            {new Date(
              (data as { generated_at: string }).generated_at
            ).toLocaleString()}
          </div>
        </div>
      )}
    </div>
  );
}
