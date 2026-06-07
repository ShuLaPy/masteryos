import { AlertTriangle, HelpCircle } from "lucide-react";
import { getRetentionColor } from "@/lib/fsrs";

/**
 * One prerequisite row in the Pre-Class Prep view (spec §7 / Req 7).
 *
 *   - "weak"      → shows the min retrievability as a % plus a retention color
 *                   band (emerald/amber/orange/red) from {@link getRetentionColor}.
 *   - "unstudied" → labeled "not yet studied", NO percentage (the concept has no
 *                   cards, so retrievability is undefined).
 *
 * Pure presentational Server Component — no client-side JS. Colors map to the
 * design-system tokens in CLAUDE.md (emerald = success, amber = warning,
 * orange/red = error gradient) via the Tailwind classes getRetentionColor emits.
 */
export interface PreClassPrepCardProps {
  title: string;
  status: "weak" | "unstudied";
  /** Min retrievability across the concept's cards (0–1). Omitted when unstudied. */
  retrievability?: number | null;
}

export function PreClassPrepCard({
  title,
  status,
  retrievability,
}: PreClassPrepCardProps) {
  if (status === "unstudied") {
    return (
      <div className="glass rounded-xl p-4 flex items-center gap-4 border-border/60">
        {/* Neutral band — no retention to show */}
        <div className="w-1.5 self-stretch rounded-full bg-muted-foreground/30 shrink-0" />
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium text-foreground truncate">{title}</h3>
        </div>
        <div className="flex items-center gap-1.5 text-muted-foreground shrink-0">
          <HelpCircle className="w-4 h-4" />
          <span className="text-xs">not yet studied</span>
        </div>
      </div>
    );
  }

  // Weak: percentage + color band.
  const r = retrievability ?? 0;
  const pct = Math.round(r * 100);
  const textColor = getRetentionColor(r); // e.g. "text-amber-400"
  const bandColor = textColor.replace("text-", "bg-"); // e.g. "bg-amber-400"

  return (
    <div className="glass rounded-xl p-4 flex items-center gap-4 border-border/60">
      {/* Vertical retention color band */}
      <div className={`w-1.5 self-stretch rounded-full shrink-0 ${bandColor}`} />
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-medium text-foreground truncate mb-2">{title}</h3>
        {/* Horizontal band filled proportional to retention */}
        <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
          <div
            className={`h-full rounded-full ${bandColor}`}
            style={{ width: `${Math.max(pct, 2)}%` }}
          />
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <AlertTriangle className={`w-4 h-4 ${textColor}`} />
        <span className={`text-sm font-semibold ${textColor}`}>{pct}%</span>
      </div>
    </div>
  );
}
