"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Sparkles, Loader2, Code2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { DSA_PATTERNS } from "../page";

export default function LogDSAPage() {
  const router = useRouter();
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
        // Merge without duplicates
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
            <Input
              id="url"
              placeholder="https://leetcode.com/problems/..."
              value={form.url}
              onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
              className="bg-secondary/50"
            />
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
