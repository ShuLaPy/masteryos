"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Sparkles, Loader2, Code2, CheckCircle2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { DSA_PATTERNS, normalizePatterns } from "@/lib/constants";

type VideoRow = { video_id: string; channel: string; embed_url: string };
type BankTitle = { slug: string; title: string };
type PrefillData = {
  slug: string;
  title: string;
  difficulty: string;
  patterns: string[];
  leetcode_url: string;
  company_tags: string[];
  video_solutions: VideoRow[];
};
type PrefillResponse = { data: { prefill: PrefillData | null } | null; error: string | null };
type BankTitlesResponse = { data: BankTitle[] | null; error: string | null };

export default function LogDSAPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [form, setForm] = useState({
    title: "",
    url: "",
    difficulty: "medium",
    patterns: [] as string[],
    approach_notes: "",
    time_taken_minutes: "",
    confidence: "3",
  });

  // Stored separately — not submitted, used by future display features (Phase D).
  const [prefillMeta, setPrefillMeta] = useState<{
    company_tags: string[];
    video_solutions: VideoRow[];
  } | null>(null);
  const [prefillBanner, setPrefillBanner] = useState(false);

  // Debounced URL drives the TanStack query.
  const [debouncedUrl, setDebouncedUrl] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedUrl(form.url), 600);
    return () => clearTimeout(t);
  }, [form.url]);

  // On mount: pre-populate from ?url= or ?slug= query params
  useEffect(() => {
    const urlParam = searchParams.get("url");
    const slugParam = searchParams.get("slug");

    if (urlParam) {
      // Set both the visible input and the debounced value immediately so the
      // prefill query fires without waiting 600ms.
      setForm((f) => ({ ...f, url: urlParam }));
      setDebouncedUrl(urlParam);
      return;
    }

    if (slugParam) {
      fetch(`/api/dsa/prefill?slug=${encodeURIComponent(slugParam)}`)
        .then((r) => r.json() as Promise<PrefillResponse>)
        .then((json) => {
          if (json.data?.prefill) applyPrefill(json.data.prefill);
        })
        .catch(() => toast.error("Failed to load problem details"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount

  // Bank title dropdown state.
  const [titleQuery, setTitleQuery] = useState("");
  const [showDrop, setShowDrop] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click.
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
        setShowDrop(false);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  // TanStack Query: prefill from URL (fires after debounce).
  const { data: urlPrefillRes, isFetching: urlFetching } = useQuery<PrefillResponse>({
    queryKey: ["prefill-url", debouncedUrl],
    queryFn: async () => {
      const res = await fetch(`/api/dsa/prefill?url=${encodeURIComponent(debouncedUrl)}`);
      return res.json();
    },
    enabled: !!debouncedUrl && debouncedUrl.includes("leetcode.com"),
    staleTime: 5 * 60 * 1000,
  });

  // TanStack Query: all bank titles for the searchable dropdown.
  const { data: bankTitlesRes } = useQuery<BankTitlesResponse>({
    queryKey: ["bank-titles"],
    queryFn: async () => {
      const res = await fetch("/api/dsa/bank-titles");
      return res.json();
    },
    staleTime: 10 * 60 * 1000,
  });

  // Auto-apply URL-based prefill when the query resolves.
  useEffect(() => {
    const prefill = urlPrefillRes?.data?.prefill;
    if (!prefill) return;
    const normalizedPatterns = normalizePatterns(prefill.patterns ?? []);
    setForm((f) => ({
      ...f,
      title: prefill.title ?? f.title,
      difficulty: prefill.difficulty ?? f.difficulty,
      patterns: normalizedPatterns.length ? normalizedPatterns : f.patterns,
    }));
    setPrefillMeta({
      company_tags: prefill.company_tags ?? [],
      video_solutions: prefill.video_solutions ?? [],
    });
    setPrefillBanner(true);
  }, [urlPrefillRes]);

  // Apply prefill from a slug (dropdown selection).
  function applyPrefill(prefill: PrefillData) {
    const normalizedPatterns = normalizePatterns(prefill.patterns ?? []);
    setForm((f) => ({
      ...f,
      title: prefill.title ?? f.title,
      difficulty: prefill.difficulty ?? f.difficulty,
      patterns: normalizedPatterns.length ? normalizedPatterns : f.patterns,
      url: prefill.leetcode_url || f.url,
    }));
    setPrefillMeta({
      company_tags: prefill.company_tags ?? [],
      video_solutions: prefill.video_solutions ?? [],
    });
    setPrefillBanner(true);
    setShowDrop(false);
    setTitleQuery("");
  }

  async function selectFromBank(slug: string) {
    setShowDrop(false);
    try {
      const res = await fetch(`/api/dsa/prefill?slug=${encodeURIComponent(slug)}`);
      const json: PrefillResponse = await res.json();
      if (json.data?.prefill) applyPrefill(json.data.prefill);
    } catch {
      toast.error("Failed to load problem details");
    }
  }

  const bankTitles = bankTitlesRes?.data ?? [];
  const filteredBank =
    titleQuery.length >= 1
      ? bankTitles
          .filter((b) => b.title.toLowerCase().includes(titleQuery.toLowerCase()))
          .slice(0, 8)
      : [];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) { toast.error("Title is required"); return; }
    setLoading(true);

    try {
      const res = await fetch("/api/dsa/problems", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          time_taken_minutes: form.time_taken_minutes ? parseInt(form.time_taken_minutes) : null,
          confidence: parseInt(form.confidence),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save");

      toast.success(`Problem saved! ${data.cards_generated} pattern cards added.`);
      router.push("/dsa");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setLoading(false);
    }
  }

  async function suggestPatterns() {
    if (!form.title.trim() && !form.url.trim()) {
      toast.error("Enter a title or URL first");
      return;
    }
    setAiLoading(true);
    try {
      const res = await fetch("/api/ai/suggest-patterns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: form.title, url: form.url }),
      });
      const data = await res.json();
      if (data.patterns && Array.isArray(data.patterns)) {
        const newPatterns = Array.from(new Set([...form.patterns, ...data.patterns]));
        setForm((f) => ({ ...f, patterns: newPatterns }));
        toast.success("Patterns suggested!");
      }
    } catch {
      toast.error("Failed to suggest patterns");
    } finally {
      setAiLoading(false);
    }
  }

  function togglePattern(pattern: string) {
    setForm((f) => {
      const current = new Set(f.patterns);
      if (current.has(pattern)) current.delete(pattern);
      else current.add(pattern);
      return { ...f, patterns: Array.from(current) };
    });
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <Link href="/dsa">
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-xl font-bold text-foreground">Log DSA Problem</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Track patterns to master algorithms</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">

        {/* Search problem bank — fills the form on selection */}
        <div className="space-y-1.5" ref={dropRef}>
          <Label className="text-xs text-muted-foreground">Quick-fill from problem bank</Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search by problem title…"
              value={titleQuery}
              onChange={(e) => { setTitleQuery(e.target.value); setShowDrop(true); }}
              onFocus={() => { if (titleQuery) setShowDrop(true); }}
              className="bg-secondary/50 pl-8"
            />
            {showDrop && filteredBank.length > 0 && (
              <div className="absolute z-50 top-full mt-1 w-full rounded-xl border border-border bg-card shadow-xl overflow-hidden">
                {filteredBank.map((b) => (
                  <button
                    key={b.slug}
                    type="button"
                    className="w-full px-3 py-2 text-sm text-left text-foreground hover:bg-secondary/60 transition-colors border-b border-border/40 last:border-0"
                    onMouseDown={(e) => { e.preventDefault(); selectFromBank(b.slug); }}
                  >
                    {b.title}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Prefill banner */}
        {prefillBanner && (
          <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-violet-500/10 border border-violet-500/20">
            <div className="flex items-center gap-2 text-xs text-violet-300">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              Pre-filled from your problem bank
              {prefillMeta && prefillMeta.company_tags.length > 0 && (
                <span className="text-violet-400/60">· {prefillMeta.company_tags.slice(0, 3).join(", ")}</span>
              )}
            </div>
            <button type="button" onClick={() => setPrefillBanner(false)} className="text-muted-foreground hover:text-foreground transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Problem Title *</Label>
            <Input
              id="title"
              placeholder="e.g. 1. Two Sum"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              className="bg-secondary/50"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="url">URL (optional)</Label>
            <div className="relative">
              <Input
                id="url"
                placeholder="https://leetcode.com/problems/…"
                value={form.url}
                onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                className="bg-secondary/50 pr-8"
              />
              {urlFetching && (
                <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-muted-foreground" />
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Paste a LeetCode URL to auto-fill title, difficulty, and patterns.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Difficulty</Label>
            <div className="flex gap-2">
              {["easy", "medium", "hard"].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, difficulty: d }))}
                  className={`flex-1 py-1.5 rounded-lg border text-xs capitalize font-medium transition-all ${
                    form.difficulty === d
                      ? d === "easy" ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400"
                        : d === "medium" ? "bg-amber-500/15 border-amber-500/30 text-amber-400"
                        : "bg-red-500/15 border-red-500/30 text-red-400"
                      : "border-border/60 text-muted-foreground hover:border-border"
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="confidence">Confidence (1 = confused, 5 = mastered)</Label>
            <div className="flex gap-1.5">
              {[1, 2, 3, 4, 5].map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, confidence: c.toString() }))}
                  className={`flex-1 py-1.5 rounded-lg border text-xs font-bold transition-all ${
                    parseInt(form.confidence) === c
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-secondary/50 border-border/60 text-muted-foreground hover:border-border"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Patterns</Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={suggestPatterns}
              disabled={aiLoading}
              className="h-6 text-[11px] text-emerald-400 hover:text-emerald-300"
            >
              {aiLoading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Sparkles className="w-3 h-3 mr-1" />}
              Auto-suggest
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto p-3 rounded-xl border border-border/60 bg-secondary/20">
            {DSA_PATTERNS.map((p) => {
              const selected = form.patterns.includes(p);
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => togglePattern(p)}
                  className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors border ${
                    selected
                      ? "bg-emerald-500/20 border-emerald-500/30 text-emerald-300"
                      : "bg-secondary border-transparent text-muted-foreground hover:bg-secondary/80"
                  }`}
                >
                  {p}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="notes">Approach & Learnings</Label>
          <Textarea
            id="notes"
            placeholder="What was the trick? Time/space complexity? Mistakes made?"
            value={form.approach_notes}
            onChange={(e) => setForm((f) => ({ ...f, approach_notes: e.target.value }))}
            className="bg-secondary/50 min-h-24 font-mono text-sm"
          />
        </div>

        <div className="flex items-center gap-3 p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/15">
          <Code2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground leading-relaxed">
            Logging this will track your pattern mastery. If you select a new pattern, AI will generate SRS flashcards to help you remember the structure of that pattern.
          </p>
        </div>

        <div className="flex gap-3 justify-end">
          <Link href="/dsa">
            <Button variant="outline" type="button">Cancel</Button>
          </Link>
          <Button type="submit" disabled={loading} className="bg-emerald-500 hover:bg-emerald-600 text-white glow-emerald">
            {loading && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
            Save problem
          </Button>
        </div>
      </form>
    </div>
  );
}
