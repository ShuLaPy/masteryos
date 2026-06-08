"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { BookOpen, Pencil, Loader2 } from "lucide-react";

interface PatchResult {
  data: { approach_notes: string | null } | null;
  error: string | null;
}

async function patchApproachNotes(
  problemId: string,
  approachNotes: string
): Promise<PatchResult> {
  const res = await fetch(`/api/dsa/problems/${problemId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approach_notes: approachNotes }),
  });
  return res.json() as Promise<PatchResult>;
}

export function ApproachLearnings({
  problemId,
  initialNotes,
}: {
  problemId: string;
  initialNotes: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  // Local source of truth for read mode — optimistically advanced on save.
  const [notes, setNotes] = useState<string | null>(initialNotes);
  const [draft, setDraft] = useState(initialNotes ?? "");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const mutation = useMutation({
    mutationFn: (next: string) => patchApproachNotes(problemId, next),
    onMutate: (next: string) => {
      setErrorMsg(null);
      const previous = notes;
      // Optimistically reflect the new content.
      setNotes(next.trim() ? next : null);
      return { previous };
    },
    onSuccess: (result, _next, context) => {
      if (result.error || !result.data) {
        // Roll back and keep the user in edit mode to retry.
        setNotes(context?.previous ?? null);
        setErrorMsg(result.error ?? "Failed to save. Please try again.");
        return;
      }
      setNotes(result.data.approach_notes);
      setEditing(false);
      // Sync the server component (e.g. cleared AI explanation cache).
      router.refresh();
    },
    onError: (_err, _next, context) => {
      setNotes(context?.previous ?? null);
      setErrorMsg("Failed to save. Please try again.");
    },
  });

  // Auto-resize the textarea to its content height while editing.
  function autoResize(el: HTMLTextAreaElement | null) {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  useEffect(() => {
    if (editing) autoResize(textareaRef.current);
  }, [editing]);

  function startEditing() {
    setDraft(notes ?? "");
    setErrorMsg(null);
    setEditing(true);
  }

  function cancelEditing() {
    setEditing(false);
    setErrorMsg(null);
    setDraft(notes ?? "");
  }

  function save() {
    if (mutation.isPending) return;
    mutation.mutate(draft);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <BookOpen className="w-3.5 h-3.5 text-emerald-400" />
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Approach &amp; Learnings
          </p>
        </div>
        {!editing && (
          <button
            type="button"
            onClick={startEditing}
            aria-label="Edit approach and learnings"
            className="shrink-0 text-muted-foreground hover:text-emerald-400 transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
        )}
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
            placeholder="Describe your approach, the key insight, and what you learned…"
            className="w-full min-h-[120px] rounded-xl bg-secondary/40 border border-border/40 text-sm text-foreground placeholder:text-muted-foreground font-mono leading-relaxed px-4 py-3 resize-none overflow-hidden focus:outline-none focus:ring-2 focus:ring-[#7c3aed]/50 disabled:opacity-50 transition-shadow"
          />
          {errorMsg && (
            <p className="text-xs text-[#ef4444]" role="alert">
              {errorMsg}
            </p>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={mutation.isPending}
              className="flex items-center gap-2 rounded-lg bg-[#7c3aed] text-white text-xs font-medium px-3.5 py-1.5 hover:bg-[#6d28d9] active:scale-[0.99] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {mutation.isPending ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Saving…
                </>
              ) : (
                "Save"
              )}
            </button>
            <button
              type="button"
              onClick={cancelEditing}
              disabled={mutation.isPending}
              className="rounded-lg border border-border/60 text-muted-foreground text-xs font-medium px-3.5 py-1.5 hover:text-foreground hover:bg-secondary/40 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : notes ? (
        <p className="text-sm text-foreground whitespace-pre-wrap font-mono leading-relaxed bg-secondary/40 rounded-xl p-4 border border-border/40">
          {notes}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground italic p-4 bg-secondary/20 rounded-xl border border-border/30">
          No approach notes were logged for this problem.
        </p>
      )}
    </div>
  );
}
