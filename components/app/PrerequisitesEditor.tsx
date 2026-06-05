"use client";

import { useState, useEffect } from "react";
import { X, Plus, GitBranch, Loader2, Pencil, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";

interface Concept {
  id: string;
  title: string;
}

interface PrerequisitesEditorProps {
  conceptId: string;
  initialPrerequisites: string[];
}

export function PrerequisitesEditor({
  conceptId,
  initialPrerequisites,
}: PrerequisitesEditorProps) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [prerequisites, setPrerequisites] = useState<string[]>(initialPrerequisites);
  const [allConcepts, setAllConcepts] = useState<Concept[]>([]);
  const [search, setSearch] = useState("");

  // Load all concepts (excluding self) when entering edit mode
  useEffect(() => {
    if (!editing) return;
    const supabase = createClient();
    supabase
      .from("aiml_concepts")
      .select("id, title")
      .neq("id", conceptId)
      .order("title")
      .then(({ data }) => {
        if (data) setAllConcepts(data);
      });
  }, [editing, conceptId]);

  // Resolve titles for display (even when not in edit mode)
  const [resolvedTitles, setResolvedTitles] = useState<Record<string, string>>({});
  useEffect(() => {
    if (prerequisites.length === 0) return;
    const supabase = createClient();
    supabase
      .from("aiml_concepts")
      .select("id, title")
      .in("id", prerequisites)
      .then(({ data }) => {
        if (data) {
          const map: Record<string, string> = {};
          data.forEach((c) => { map[c.id] = c.title; });
          setResolvedTitles(map);
        }
      });
  }, [prerequisites]);

  function addPrerequisite(concept: Concept) {
    if (!prerequisites.includes(concept.id)) {
      setPrerequisites((prev) => [...prev, concept.id]);
      setResolvedTitles((prev) => ({ ...prev, [concept.id]: concept.title }));
    }
    setSearch("");
  }

  function removePrerequisite(id: string) {
    setPrerequisites((prev) => prev.filter((x) => x !== id));
  }

  function cancelEdit() {
    setPrerequisites(initialPrerequisites);
    setSearch("");
    setEditing(false);
  }

  async function savePrerequisites() {
    setSaving(true);
    try {
      const res = await fetch("/api/aiml/concepts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: conceptId, prerequisites }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      toast.success("Prerequisites updated");
      setEditing(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update prerequisites");
    } finally {
      setSaving(false);
    }
  }

  const filtered = allConcepts.filter(
    (c) =>
      c.title.toLowerCase().includes(search.toLowerCase()) &&
      !prerequisites.includes(c.id)
  );

  return (
    <div className="glass rounded-2xl p-6 border-amber-500/20">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <GitBranch className="w-5 h-5 text-amber-400" /> Prerequisites
        </h2>
        {!editing ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setEditing(true)}
            className="h-7 text-xs text-muted-foreground hover:text-foreground"
          >
            <Pencil className="w-3 h-3 mr-1" /> Edit
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={cancelEdit}
              className="h-7 text-xs text-muted-foreground"
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={savePrerequisites}
              disabled={saving}
              className="h-7 text-xs bg-primary hover:bg-primary/90"
            >
              {saving ? (
                <Loader2 className="w-3 h-3 animate-spin mr-1" />
              ) : (
                <Check className="w-3 h-3 mr-1" />
              )}
              Save
            </Button>
          </div>
        )}
      </div>

      {/* Current prerequisites */}
      {prerequisites.length === 0 && !editing ? (
        <p className="text-sm text-muted-foreground">
          No prerequisites set.{" "}
          <button
            onClick={() => setEditing(true)}
            className="text-primary underline underline-offset-2 hover:text-primary/80"
          >
            Add one
          </button>
        </p>
      ) : (
        <div className="flex flex-wrap gap-2 mb-3">
          {prerequisites.map((id) => {
            const title = resolvedTitles[id] ?? id.slice(0, 8) + "…";
            return editing ? (
              <Badge key={id} variant="secondary" className="gap-1 pr-1 text-xs">
                {title}
                <button type="button" onClick={() => removePrerequisite(id)}>
                  <X className="w-3 h-3 hover:text-destructive" />
                </button>
              </Badge>
            ) : (
              <Link key={id} href={`/aiml/${id}`}>
                <Badge
                  variant="secondary"
                  className="text-xs cursor-pointer hover:border-amber-500/40 transition-colors"
                >
                  {title}
                </Badge>
              </Link>
            );
          })}
        </div>
      )}

      {/* Search to add */}
      {editing && (
        <div className="space-y-2 mt-3">
          <div className="relative">
            <Input
              placeholder="Search concepts to add..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-secondary/50 border-border/60 focus:border-primary/60 text-sm"
            />
          </div>
          {search && (
            <div className="max-h-36 overflow-y-auto rounded-lg border border-border/60 bg-secondary/30">
              {filtered.length === 0 ? (
                <p className="px-3 py-2 text-xs text-muted-foreground">No concepts found</p>
              ) : (
                filtered.slice(0, 8).map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => addPrerequisite(c)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-primary/10 transition-colors flex items-center gap-2"
                  >
                    <Plus className="w-3 h-3 text-primary shrink-0" />
                    {c.title}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
