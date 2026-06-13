"use client";

/**
 * Concept-detail sidebar action to generate derivation/math-mastery cards
 * (roadmap Phase 1b, goal 4). Mirrors ConceptNotesCard's mutation + router.refresh
 * pattern. Lists derivations already generated (from aiml_concepts.derivations).
 */

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Sigma, Loader2 } from "lucide-react";

interface DerivationRef {
  title: string;
  card_id: string;
  generated_at: string;
}

interface DerivationResult {
  data: { derivationsCreated: number } | null;
  error: string | null;
}

async function postDerivations(conceptId: string): Promise<DerivationResult> {
  const res = await fetch(`/api/concepts/${conceptId}/derivations`, { method: "POST" });
  return res.json() as Promise<DerivationResult>;
}

export function DerivationDrillCard({
  conceptId,
  initialDerivations,
  hasNotes,
}: {
  conceptId: string;
  initialDerivations: DerivationRef[];
  hasNotes: boolean;
}) {
  const router = useRouter();
  const [derivations, setDerivations] = useState<DerivationRef[]>(initialDerivations);
  const [msg, setMsg] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => postDerivations(conceptId),
    onSuccess: (result) => {
      if (result.error || !result.data) {
        setMsg(result.error ?? "Something went wrong.");
        return;
      }
      setMsg(`${result.data.derivationsCreated} derivation drill${result.data.derivationsCreated !== 1 ? "s" : ""} added to your review queue.`);
      router.refresh();
    },
    onError: () => setMsg("Something went wrong — please try again."),
  });

  return (
    <div className="glass rounded-2xl p-6 border-primary/20">
      <h2 className="text-lg font-semibold text-foreground mb-2 flex items-center gap-2">
        <Sigma className="w-5 h-5 text-primary" /> Derivation Drills
      </h2>
      <p className="text-xs text-muted-foreground mb-4">
        Master the math: reproduce key derivations step-by-step under spaced repetition.
      </p>

      {derivations.length > 0 && (
        <ul className="space-y-2 mb-4">
          {derivations.map((d) => (
            <li
              key={d.card_id}
              className="text-sm text-foreground bg-secondary/50 rounded-lg px-3 py-2 border border-border/60"
            >
              {d.title}
            </li>
          ))}
        </ul>
      )}

      {msg && <p className="text-xs text-emerald-400 mb-3">{msg}</p>}

      <button
        type="button"
        onClick={() => {
          setMsg(null);
          setDerivations((prev) => prev); // keep current list; route.refresh repopulates
          mutation.mutate();
        }}
        disabled={!hasNotes || mutation.isPending}
        className="w-full flex items-center justify-center gap-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium px-4 py-2 hover:bg-primary/90 active:scale-[0.99] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {mutation.isPending ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" /> Generating…
          </>
        ) : derivations.length > 0 ? (
          "Generate more derivations"
        ) : (
          "Generate derivation drill"
        )}
      </button>
      {!hasNotes && (
        <p className="text-[11px] text-muted-foreground mt-2">
          Add notes to this concept first.
        </p>
      )}
    </div>
  );
}
