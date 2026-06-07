import { AlertTriangle, HelpCircle } from "lucide-react";
import { getRetentionColor } from "@/lib/fsrs";
import { ConceptEnrichModal } from "@/components/app/ConceptEnrichModal";

/**
 * One prerequisite row in the Pre-Class Prep view (spec §7 / Req 7).
 *
 * Visual states (driven by `status` + `cardStatus`):
 *
 *   "weak" + cardStatus="learned"  → retention % + color band. Current behavior.
 *   "weak" + cardStatus="seeded"   → retention % + color band + amber "Primer only"
 *                                    note with a modal trigger to the enrich flow.
 *   "unstudied"                    → "not yet studied" label + "Add Notes" modal trigger.
 *                                    No retention percentage.
 *
 * Server Component — all interactivity is delegated to ConceptEnrichModal (Client).
 */
export interface PreClassPrepCardProps {
  title: string;
  status: "weak" | "unstudied";
  /** Min retrievability across the concept's cards (0–1). Omitted when unstudied. */
  retrievability?: number | null;
  /** card_status column from aiml_concepts. Drives primer badge on seeded cards. */
  cardStatus?: "learned" | "seeded" | "none" | null;
  /** Concept ID — passed to ConceptEnrichModal to build the API call. */
  conceptId?: string;
}

export function PreClassPrepCard({
  title,
  status,
  retrievability,
  cardStatus,
  conceptId,
}: PreClassPrepCardProps) {
  if (status === "unstudied") {
    return (
      <div className="glass rounded-xl p-4 flex items-center gap-4 border-border/60">
        {/* Neutral band — no retention to show */}
        <div className="w-1.5 self-stretch rounded-full bg-muted-foreground/30 shrink-0" />
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium text-foreground truncate">{title}</h3>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <HelpCircle className="w-4 h-4" />
            <span className="text-xs">not yet studied</span>
          </div>
          {conceptId && (
            <ConceptEnrichModal
              conceptId={conceptId}
              conceptTitle={title}
              variant="primary"
            />
          )}
        </div>
      </div>
    );
  }

  // Weak: percentage + color band (applies to both "learned" and "seeded").
  const r = retrievability ?? 0;
  const pct = Math.round(r * 100);
  const textColor = getRetentionColor(r); // e.g. "text-amber-400"
  const bandColor = textColor.replace("text-", "bg-"); // e.g. "bg-amber-400"
  const isSeeded = cardStatus === "seeded";

  return (
    <div className="glass rounded-xl p-4 flex items-start gap-4 border-border/60">
      {/* Vertical retention color band */}
      <div className={`w-1.5 self-stretch rounded-full shrink-0 ${bandColor}`} />
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-medium text-foreground truncate mb-2">{title}</h3>
        {/* Horizontal retention bar */}
        <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
          <div
            className={`h-full rounded-full ${bandColor}`}
            style={{ width: `${Math.max(pct, 2)}%` }}
          />
        </div>
        {isSeeded && conceptId && (
          <p className="mt-2 text-xs" style={{ color: "#f59e0b" }}>
            Primer only —{" "}
            <ConceptEnrichModal
              conceptId={conceptId}
              conceptTitle={title}
              variant="inline"
            />
          </p>
        )}
      </div>
      <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
        <AlertTriangle className={`w-4 h-4 ${textColor}`} />
        <span className={`text-sm font-semibold ${textColor}`}>{pct}%</span>
      </div>
    </div>
  );
}
