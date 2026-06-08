"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { BookOpen, Plus, Pencil, Loader2 } from "lucide-react";

type CardStatus = "none" | "seeded" | "learned";

interface EnrichResult {
  data: { cardsReplaced: number; cardsCreated: number } | null;
  error: string | null;
}

async function postEnrich(conceptId: string, notes: string): Promise<EnrichResult> {
  const res = await fetch(`/api/concepts/${conceptId}/enrich`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notes }),
  });
  return res.json() as Promise<EnrichResult>;
}

export function ConceptNotesCard({
  conceptId,
  initialNotes,
  initialCardStatus,
}: {
  conceptId: string;
  initialNotes: string | null;
  initialCardStatus: string | null;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<CardStatus>(
    initialCardStatus === "seeded" || initialCardStatus === "learned"
      ? initialCardStatus
      : "none"
  );
  const [notes, setNotes] = useState<string | null>(initialNotes);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const mutation = useMutation({
    mutationFn: (next: string) => postEnrich(conceptId, next),
    onSuccess: (result) => {
      if (result.error || !result.data) return;
      setNotes(draft.trim());
      setStatus("learned");
      setEditing(false);
      // Re-run the server component so the Generated Flashcards section
      // re-renders with the newly generated cards.
      router.refresh();
    },
  });

  const apiError =
    mutation.data?.error ??
    (mutation.isError ? "Something went wrong — please try again." : null);

  function autoResize(el: HTMLTextAreaElement | null) {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  useEffect(() => {
    if (editing) autoResize(textareaRef.current);
  }, [editing]);

  function startEditing() {
    // Pre-fill only when the user has their own notes (learned); seeded
    // notes are auto-generated, so start blank.
    setDraft(status === "learned" ? notes ?? "" : "");
    mutation.reset();
    setEditing(true);
  }

  function cancelEditing() {
    setEditing(false);
    mutation.reset();
  }

  function submit() {
    if (!draft.trim() || mutation.isPending) return;
    mutation.mutate(draft);
  }

  return (
    <div className="glass rounded-2xl p-6">
      <div className="flex items-start justify-between gap-3 mb-4">
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-primary" /> Concept Notes
        </h2>

        {!editing &&
          (status === "learned" ? (
            <button
              type="button"
              onClick={startEditing}
              className="shrink-0 flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-border/60 text-muted-foreground hover:text-foreground hover:bg-secondary/40 transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" /> Edit Notes
            </button>
          ) : (
            <button
              type="button"
              onClick={startEditing}
              className="shrink-0 flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border transition-colors"
              style={
                status === "seeded"
                  ? {
                      color: "#f59e0b",
                      borderColor: "rgba(245, 158, 11, 0.3)",
                      backgroundColor: "rgba(245, 158, 11, 0.1)",
                    }
                  : {
                      color: "#7c3aed",
                      borderColor: "rgba(124, 58, 237, 0.3)",
                      backgroundColor: "rgba(124, 58, 237, 0.1)",
                    }
              }
            >
              <Plus className="w-3.5 h-3.5" /> Add Notes
            </button>
          ))}
      </div>

      {editing ? (
        <div className="space-y-3">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              autoResize(e.target);
            }}
            disabled={mutation.isPending}
            rows={4}
            placeholder="Paste your notes, summary, or key ideas about this concept..."
            className="w-full rounded-xl bg-background border border-border text-sm text-foreground placeholder:text-muted-foreground px-3 py-2.5 resize-none overflow-hidden leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#7c3aed]/50 disabled:opacity-60 transition-shadow"
          />

          {apiError && (
            <p className="text-xs" style={{ color: "#ef4444" }} role="alert">
              {apiError}
            </p>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={!draft.trim() || mutation.isPending}
              className="flex items-center justify-center gap-2 rounded-lg bg-[#7c3aed] text-white text-sm font-medium px-4 py-2 hover:bg-[#6d28d9] active:scale-[0.99] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {mutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Generating Cards…
                </>
              ) : (
                "Generate Cards"
              )}
            </button>
            <button
              type="button"
              onClick={cancelEditing}
              disabled={mutation.isPending}
              className="rounded-lg text-sm font-medium px-4 py-2 text-muted-foreground hover:text-foreground hover:bg-secondary/40 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="prose prose-invert prose-sm max-w-none text-muted-foreground whitespace-pre-wrap">
          {notes || "No notes provided for this concept."}
        </div>
      )}
    </div>
  );
}
