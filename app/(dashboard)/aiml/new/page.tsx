"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft, Sparkles, Loader2, Plus, X, Brain,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";

const CONCEPT_TYPES = ["theory", "math", "implementation", "system", "all"];

interface ExistingConcept {
  id: string;
  title: string;
}

export default function NewConceptPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [form, setForm] = useState({
    title: "",
    week_number: "",
    concept_type: "theory",
    notes: "",
    tags: [] as string[],
    source: "self_study",
  });
  const [tagInput, setTagInput] = useState("");
  const [prerequisites, setPrerequisites] = useState<string[]>([]);
  const [existingConcepts, setExistingConcepts] = useState<ExistingConcept[]>([]);
  const [prereqSearch, setPrereqSearch] = useState("");

  useEffect(() => {
    async function loadConcepts() {
      const supabase = createClient();
      const { data } = await supabase
        .from("aiml_concepts")
        .select("id, title")
        .order("title");
      if (data) setExistingConcepts(data);
    }
    loadConcepts();
  }, []);

  function addTag() {
    const t = tagInput.trim().toLowerCase();
    if (t && !form.tags.includes(t)) {
      setForm((f) => ({ ...f, tags: [...f.tags, t] }));
    }
    setTagInput("");
  }

  function removeTag(tag: string) {
    setForm((f) => ({ ...f, tags: f.tags.filter((t) => t !== tag) }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) { toast.error("Title is required"); return; }
    setLoading(true);

    try {
      const res = await fetch("/api/aiml/concepts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          week_number: form.week_number ? parseInt(form.week_number) : null,
          prerequisites,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save");

      toast.success(`"${form.title}" saved! ${data.cards_generated ?? 0} SRS cards generated.`);
      router.push("/aiml");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save concept");
    } finally {
      setLoading(false);
    }
  }

  async function autoGenerateNotes() {
    if (!form.title.trim()) { toast.error("Enter a title first"); return; }
    setAiLoading(true);
    try {
      const res = await fetch("/api/ai/expand-concept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: form.title }),
      });
      const data = await res.json();
      if (data.notes) setForm((f) => ({ ...f, notes: data.notes }));
    } catch {
      toast.error("AI expansion failed");
    } finally {
      setAiLoading(false);
    }
  }

  const typeColors: Record<string, string> = {
    theory: "bg-blue-500/15 text-blue-300 border-blue-500/25",
    math: "bg-violet-500/15 text-violet-300 border-violet-500/25",
    implementation: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
    system: "bg-amber-500/15 text-amber-300 border-amber-500/25",
    all: "bg-pink-500/15 text-pink-300 border-pink-500/25",
  };

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <Link href="/aiml">
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-xl font-bold text-foreground">Add AIML Concept</h1>
          <p className="text-xs text-muted-foreground mt-0.5">AI will auto-generate SRS flashcards</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Title + week */}
        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2 space-y-2">
            <Label htmlFor="title">Concept title *</Label>
            <Input
              id="title"
              placeholder="e.g. Attention Mechanism"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              className="bg-secondary/50 border-border/60 focus:border-primary/60"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="week">Week #</Label>
            <Input
              id="week"
              type="number"
              min={1}
              max={52}
              placeholder="e.g. 5"
              value={form.week_number}
              onChange={(e) => setForm((f) => ({ ...f, week_number: e.target.value }))}
              className="bg-secondary/50 border-border/60 focus:border-primary/60"
            />
          </div>
        </div>

        {/* Type selector */}
        <div className="space-y-2">
          <Label>Concept type</Label>
          <div className="flex flex-wrap gap-2">
            {CONCEPT_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setForm((f) => ({ ...f, concept_type: t }))}
                className={`px-3 py-1.5 rounded-lg border text-xs font-medium capitalize transition-all ${
                  form.concept_type === t
                    ? typeColors[t]
                    : "border-border/60 text-muted-foreground hover:border-border"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Notes */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="notes">Notes (markdown supported)</Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={autoGenerateNotes}
              disabled={aiLoading}
              className="h-6 text-[11px] text-primary hover:text-primary/80"
            >
              {aiLoading ? (
                <Loader2 className="w-3 h-3 animate-spin mr-1" />
              ) : (
                <Sparkles className="w-3 h-3 mr-1" />
              )}
              AI expand
            </Button>
          </div>
          <Textarea
            id="notes"
            placeholder="Explain the concept in your own words. The more detail, the better your SRS cards will be."
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            className="bg-secondary/50 border-border/60 focus:border-primary/60 min-h-48 resize-none font-mono text-sm"
          />
        </div>

        {/* Prerequisites */}
        <div className="space-y-2">
          <Label>Prerequisites</Label>
          <Input
            placeholder="Search existing concepts..."
            value={prereqSearch}
            onChange={(e) => setPrereqSearch(e.target.value)}
            className="bg-secondary/50 border-border/60 focus:border-primary/60"
          />
          {prerequisites.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {prerequisites.map((id) => {
                const concept = existingConcepts.find((c) => c.id === id);
                return (
                  <Badge key={id} variant="secondary" className="gap-1 pr-1 text-xs">
                    {concept?.title ?? id.slice(0, 8)}
                    <button
                      type="button"
                      onClick={() => setPrerequisites((p) => p.filter((x) => x !== id))}
                    >
                      <X className="w-3 h-3 hover:text-destructive" />
                    </button>
                  </Badge>
                );
              })}
            </div>
          )}
          {prereqSearch && (
            <div className="max-h-32 overflow-y-auto rounded-lg border border-border/60 bg-secondary/30">
              {existingConcepts
                .filter(
                  (c) =>
                    c.title.toLowerCase().includes(prereqSearch.toLowerCase()) &&
                    !prerequisites.includes(c.id)
                )
                .slice(0, 8)
                .map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setPrerequisites((p) => [...p, c.id]);
                      setPrereqSearch("");
                    }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-primary/10 transition-colors"
                  >
                    {c.title}
                  </button>
                ))}
            </div>
          )}
        </div>

        {/* Tags */}
        <div className="space-y-2">
          <Label>Tags</Label>
          <div className="flex gap-2">
            <Input
              placeholder="Add a tag, press Enter"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
              className="bg-secondary/50 border-border/60 focus:border-primary/60"
            />
            <Button type="button" variant="outline" onClick={addTag} className="shrink-0">
              <Plus className="w-4 h-4" />
            </Button>
          </div>
          {form.tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {form.tags.map((tag) => (
                <Badge
                  key={tag}
                  variant="secondary"
                  className="gap-1 pr-1 text-xs"
                >
                  {tag}
                  <button type="button" onClick={() => removeTag(tag)}>
                    <X className="w-3 h-3 hover:text-destructive" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </div>

        {/* Source */}
        <div className="space-y-2">
          <Label>Source</Label>
          <div className="flex gap-2 flex-wrap">
            {["self_study", "iit_lecture", "course", "book", "paper"].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setForm((f) => ({ ...f, source: s }))}
                className={`px-3 py-1.5 rounded-lg border text-xs capitalize transition-all ${
                  form.source === s
                    ? "bg-primary/15 border-primary/30 text-primary"
                    : "border-border/60 text-muted-foreground hover:border-border"
                }`}
              >
                {s.replace("_", " ")}
              </button>
            ))}
          </div>
        </div>

        {/* AI card info */}
        <div className="flex items-start gap-3 p-4 rounded-xl bg-primary/5 border border-primary/15">
          <Brain className="w-4 h-4 text-primary mt-0.5 shrink-0" />
          <p className="text-xs text-muted-foreground leading-relaxed">
            On save, OpenAI will analyze your notes and auto-generate{" "}
            <span className="text-primary font-medium">3–5 SRS flashcards</span> covering key
            definitions, intuitions, and common misconceptions. The richer your notes, the better
            the cards.
          </p>
        </div>

        <div className="flex gap-3 justify-end">
          <Link href="/aiml">
            <Button variant="outline" type="button">Cancel</Button>
          </Link>
          <Button
            type="submit"
            disabled={loading}
            className="bg-primary hover:bg-primary/90 glow-violet"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Sparkles className="w-4 h-4 mr-2" />}
            {loading ? "Saving & generating cards..." : "Save concept"}
          </Button>
        </div>
      </form>
    </div>
  );
}
