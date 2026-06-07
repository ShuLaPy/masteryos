"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { NotebookPen, Loader2, CheckCircle2, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface EnrichApiResult {
  data: { cardsReplaced: number; cardsCreated: number } | null;
  error: string | null;
}

async function postEnrich(conceptId: string, notes: string): Promise<EnrichApiResult> {
  const res = await fetch(`/api/concepts/${conceptId}/enrich`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notes }),
  });
  return res.json() as Promise<EnrichApiResult>;
}

// ─── Shared form ──────────────────────────────────────────────────────────────

export interface ConceptEnrichFormProps {
  conceptId: string;
  conceptTitle: string;
  /**
   * Called after the 1.5 s success flash, with the number of cards generated.
   * Use this to close a modal or navigate away.
   */
  onDone?: (cardsCreated: number) => void;
}

export function ConceptEnrichForm({
  conceptId,
  conceptTitle,
  onDone,
}: ConceptEnrichFormProps) {
  const [notes, setNotes] = useState("");
  const [successCount, setSuccessCount] = useState<number | null>(null);

  const mutation = useMutation({
    mutationFn: (n: string) => postEnrich(conceptId, n),
    onSuccess: (result) => {
      if (result.error || !result.data) return;
      const count = result.data.cardsCreated;
      setSuccessCount(count);
      setTimeout(() => onDone?.(count), 1500);
    },
  });

  const apiError =
    mutation.data?.error ??
    (mutation.isError ? "Request failed — please try again." : null);

  if (successCount !== null) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <CheckCircle2 className="w-10 h-10 text-[#10b981]" />
        <p className="text-sm font-medium text-foreground">
          {successCount} card{successCount !== 1 ? "s" : ""} generated from your notes
        </p>
        <p className="text-xs text-muted-foreground">Just a moment…</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Paste your notes, summary, or key ideas about{" "}
        <span className="font-medium text-foreground">{conceptTitle}</span>
      </p>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        disabled={mutation.isPending}
        placeholder="My understanding of this concept…"
        rows={7}
        className="w-full rounded-lg bg-background border border-[#1f2937] text-sm text-foreground placeholder:text-muted-foreground px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-[#7c3aed]/50 disabled:opacity-50 transition-shadow"
      />
      {apiError && (
        <p className="text-xs text-[#ef4444]" role="alert">
          {apiError}
        </p>
      )}
      <button
        type="button"
        onClick={() => {
          if (!notes.trim() || mutation.isPending) return;
          mutation.mutate(notes);
        }}
        disabled={!notes.trim() || mutation.isPending}
        className="w-full flex items-center justify-center gap-2 rounded-lg bg-[#7c3aed] text-white text-sm font-medium py-2.5 hover:bg-[#6d28d9] active:scale-[0.99] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {mutation.isPending ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Generating cards…
          </>
        ) : (
          "Generate Cards from My Notes"
        )}
      </button>
    </div>
  );
}

// ─── Modal (trigger + dialog) ──────────────────────────────────────────────────

export interface ConceptEnrichModalProps {
  conceptId: string;
  conceptTitle: string;
  /**
   * "primary"  — "Add Notes" pill button (for unstudied cards).
   * "inline"   — amber underline link (for seeded/primer cards).
   */
  variant?: "primary" | "inline";
}

export function ConceptEnrichModal({
  conceptId,
  conceptTitle,
  variant = "primary",
}: ConceptEnrichModalProps) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const handleOpen = () => setOpen(true);

  const handleClose = () => setOpen(false);

  const handleDone = (_cardsCreated: number) => {
    setOpen(false);
    // Refresh server component so card_status badge updates immediately
    router.refresh();
  };

  return (
    <>
      {variant === "primary" ? (
        <button
          type="button"
          onClick={handleOpen}
          className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 transition-colors"
        >
          <NotebookPen className="w-3 h-3" />
          Add Notes
        </button>
      ) : (
        <button
          type="button"
          onClick={handleOpen}
          className="underline underline-offset-2 hover:opacity-80 transition-opacity cursor-pointer text-xs bg-transparent border-0 p-0"
          style={{ color: "#f59e0b" }}
        >
          add your notes for deeper retention
        </button>
      )}

      <Dialog open={open} onOpenChange={(next) => !next && handleClose()}>
        <DialogContent
          showCloseButton={false}
          className="max-w-lg bg-[#111827] border border-[#1f2937]"
        >
          <DialogHeader>
            <div className="flex items-start justify-between gap-3">
              <DialogTitle className="text-base font-semibold text-foreground leading-snug">
                {conceptTitle}
              </DialogTitle>
              <button
                type="button"
                onClick={handleClose}
                aria-label="Close"
                className="shrink-0 mt-0.5 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </DialogHeader>

          <ConceptEnrichForm
            conceptId={conceptId}
            conceptTitle={conceptTitle}
            onDone={handleDone}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
