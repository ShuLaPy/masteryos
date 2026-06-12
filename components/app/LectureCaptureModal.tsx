"use client";

import { useState } from "react";
import { Brain, Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { LectureRow } from "@/components/app/ScheduleManager";

// ─── Types ─────────────────────────────────────────────────────────────────

interface GapSummary {
  recalled: number;
  partial: number;
  missed: number;
  distorted: number;
}

interface IngestResponse {
  data: {
    conceptsExtracted?: number;
    cardsCreated?: number;
    gapSummary?: GapSummary | null;
  } | null;
  error: string | null;
}

type Step = "dump" | "notes" | "done";

// ─── Modal shell (mirrors ScheduleManager's Modal) ─────────────────────────

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-2xl bg-[#111827] rounded-2xl border border-[#1f2937] p-6 shadow-xl overflow-y-auto max-h-[90vh]">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-secondary transition-colors"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── Gap summary chips ──────────────────────────────────────────────────────

function GapChips({ summary }: { summary: GapSummary }) {
  const chips = [
    { label: "Recalled", count: summary.recalled, cls: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" },
    { label: "Partial", count: summary.partial, cls: "text-amber-400 bg-amber-500/10 border-amber-500/20" },
    { label: "Missed", count: summary.missed, cls: "text-red-400 bg-red-500/10 border-red-500/20" },
    { label: "Distorted", count: summary.distorted, cls: "text-red-400 bg-red-500/10 border-red-500/20" },
  ].filter((c) => c.count > 0);

  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((c) => (
        <span
          key={c.label}
          className={`text-[11px] font-medium px-2 py-1 rounded-full border ${c.cls}`}
        >
          {c.count} {c.label.toLowerCase()}
        </span>
      ))}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────

/**
 * Two-step post-lecture capture (free recall before notes — retrieval practice):
 *   Step 1: brain dump typed from memory, saved immediately so abandoning the
 *           modal still preserves it.
 *   Step 2: paste lecture notes → AI ingestion + gap analysis vs the brain dump.
 */
export function LectureCaptureModal({
  lecture,
  onClose,
  onSuccess,
}: {
  lecture: LectureRow;
  onClose: () => void;
  onSuccess: (lectureId: string) => void;
}) {
  const [step, setStep] = useState<Step>("dump");
  const [brainDump, setBrainDump] = useState("");
  const [material, setMaterial] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [result, setResult] = useState<IngestResponse["data"]>(null);

  async function post(body: Record<string, string>) {
    const res = await fetch(`/api/lectures/${lecture.id}/attend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as IngestResponse;
    return { res, json };
  }

  // Step 1 — save free recall, then move to notes.
  async function handleSaveBrainDump() {
    setSubmitting(true);
    try {
      const { res, json } = await post({ brain_dump: brainDump.trim() });
      if (!res.ok) {
        toast.error(json.error ?? "Failed to save recall");
        return;
      }
      onSuccess(lecture.id); // lecture is now attended
      toast.success("Free recall saved");
      setStep("notes");
    } catch {
      toast.error("Network error — please try again");
    } finally {
      setSubmitting(false);
    }
  }

  // Skip recall → mark attended, go straight to notes.
  async function handleSkipBrainDump() {
    setSubmitting(true);
    try {
      const { res, json } = await post({});
      if (!res.ok) {
        toast.error(json.error ?? "Failed to mark as attended");
        return;
      }
      onSuccess(lecture.id);
      setStep("notes");
    } catch {
      toast.error("Network error — please try again");
    } finally {
      setSubmitting(false);
    }
  }

  // Escape hatch — attended, no capture at all.
  async function handleJustAttend() {
    setSubmitting(true);
    try {
      const { res, json } = await post({});
      if (!res.ok) {
        toast.error(json.error ?? "Failed to mark as attended");
        return;
      }
      onSuccess(lecture.id);
      toast.success("Lecture marked as attended");
      onClose();
    } catch {
      toast.error("Network error — please try again");
    } finally {
      setSubmitting(false);
    }
  }

  // Step 2 — ingest notes (gap analysis runs against the stored brain dump).
  async function handleIngest() {
    setSubmitting(true);
    setIngesting(true);
    try {
      const { res, json } = await post({ material: material.trim() });
      if (!res.ok) {
        if (res.status === 422) {
          toast.error("AI couldn't extract enough concepts — try with more detailed notes");
        } else {
          toast.error(json.error ?? "Failed to ingest notes");
        }
        return;
      }
      onSuccess(lecture.id);
      setResult(json.data);
      setStep("done");
      toast.success("Lecture ingested — new SRS cards created!");
    } catch {
      toast.error("Network error — please try again");
    } finally {
      setSubmitting(false);
      setIngesting(false);
    }
  }

  return (
    <ModalShell title={`Capture · ${lecture.title}`} onClose={onClose}>
      {step === "dump" && (
        <div className="space-y-4">
          <div className="flex items-start gap-2.5 rounded-xl border border-primary/20 bg-primary/5 p-3">
            <Brain className="w-4 h-4 text-primary mt-0.5 shrink-0" />
            <p className="text-sm text-muted-foreground">
              <span className="text-foreground font-medium">Before opening your notes</span> —
              type everything you remember from the lecture, from memory. Retrieving it
              now is what makes it stick, and the AI will use this to find what you missed.
            </p>
          </div>

          <Textarea
            placeholder="Everything you remember — concepts, formulas, examples, even half-remembered ideas…"
            value={brainDump}
            onChange={(e) => setBrainDump(e.target.value)}
            rows={10}
            className="bg-secondary/50 border-border/60 focus:border-primary/60 text-sm resize-none"
            disabled={submitting}
          />

          <div className="flex items-center gap-3 pt-1">
            <Button
              onClick={handleSaveBrainDump}
              disabled={submitting || brainDump.trim().length === 0}
              className="bg-primary hover:bg-primary/90 h-9"
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Save recall & continue
            </Button>
            <Button
              variant="outline"
              onClick={handleSkipBrainDump}
              disabled={submitting}
              className="h-9 border-border/60 text-muted-foreground"
            >
              Skip recall
            </Button>
            <button
              onClick={handleJustAttend}
              disabled={submitting}
              className="ml-auto text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Just mark attended
            </button>
          </div>
        </div>
      )}

      {step === "notes" && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Now paste your lecture notes, slides text, or transcript. The AI will extract
            concepts, compare them against your recall, and generate flashcards — extra
            cards for anything you missed.
          </p>

          <Textarea
            placeholder="Paste lecture notes, slides text, or transcript here…"
            value={material}
            onChange={(e) => setMaterial(e.target.value)}
            rows={10}
            className="bg-secondary/50 border-border/60 focus:border-primary/60 text-sm resize-none"
            disabled={submitting}
          />

          {ingesting && (
            <p className="text-xs text-primary flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Extracting concepts, comparing with your recall, generating cards — this may
              take 10–20 seconds…
            </p>
          )}

          <div className="flex items-center gap-3 pt-1">
            <Button
              onClick={handleIngest}
              disabled={submitting || material.trim().length === 0}
              className="bg-primary hover:bg-primary/90 h-9"
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Upload className="w-4 h-4 mr-2" />
              )}
              Upload & ingest
            </Button>
            <button
              onClick={onClose}
              disabled={submitting}
              className="ml-auto text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Add notes later
            </button>
          </div>
        </div>
      )}

      {step === "done" && (
        <div className="space-y-4">
          <p className="text-sm text-foreground font-medium">
            {result?.conceptsExtracted ?? 0} concepts extracted ·{" "}
            {result?.cardsCreated ?? 0} cards created
          </p>

          {result?.gapSummary ? (
            <>
              <p className="text-sm text-muted-foreground">
                How your free recall compared with the lecture material — missed concepts
                got extra cards and jump to the front of today&apos;s Immediate Recall zone:
              </p>
              <GapChips summary={result.gapSummary} />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Cards are due today — review them while the lecture is fresh.
            </p>
          )}

          <div className="pt-1">
            <Button onClick={onClose} className="bg-primary hover:bg-primary/90 h-9">
              Done
            </Button>
          </div>
        </div>
      )}
    </ModalShell>
  );
}
