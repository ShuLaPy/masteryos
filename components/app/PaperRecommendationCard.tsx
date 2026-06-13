"use client";

import Link from "next/link";
import {
  ExternalLink,
  BookmarkPlus,
  Check,
  X,
  Trash2,
  RotateCcw,
  GraduationCap,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { PaperRecommendation } from "@/lib/paper-recommender";

type Status = PaperRecommendation["status"];

interface Props {
  paper: PaperRecommendation;
  onSetStatus: (status: Status) => void;
  onDelete: () => void;
  busy?: boolean;
}

function formatYear(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : String(d.getUTCFullYear());
}

function authorLine(authors: string[]): string {
  if (authors.length === 0) return "Unknown authors";
  if (authors.length <= 3) return authors.join(", ");
  return `${authors.slice(0, 3).join(", ")} +${authors.length - 3} more`;
}

export default function PaperRecommendationCard({
  paper,
  onSetStatus,
  onDelete,
  busy,
}: Props) {
  const year = formatYear(paper.published_at);
  const ready = paper.readiness === "ready";
  const relevance =
    typeof paper.relevance_score === "number"
      ? Math.round(paper.relevance_score * 100)
      : null;

  return (
    <div className="glass rounded-xl p-5 transition-all hover:border-primary/30">
      {/* Meta row */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <Badge
          className={
            ready
              ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/25"
              : "bg-amber-500/15 text-amber-300 border-amber-500/25"
          }
        >
          {ready ? (
            <GraduationCap className="w-3 h-3 mr-1" />
          ) : (
            <AlertTriangle className="w-3 h-3 mr-1" />
          )}
          {ready ? "Ready to read" : "Stretch"}
        </Badge>
        {relevance !== null && (
          <span className="text-[11px] text-muted-foreground">{relevance}% fit</span>
        )}
        {paper.categories.slice(0, 3).map((c) => (
          <span
            key={c}
            className="text-[10px] text-muted-foreground bg-secondary px-2 py-0.5 rounded-full"
          >
            {c}
          </span>
        ))}
      </div>

      {/* Title + link */}
      <a
        href={paper.abs_url ?? "#"}
        target="_blank"
        rel="noopener noreferrer"
        className="group inline-flex items-start gap-1.5"
      >
        <h3 className="text-base font-semibold text-foreground group-hover:text-primary transition-colors leading-snug">
          {paper.title}
        </h3>
        <ExternalLink className="w-3.5 h-3.5 mt-1 shrink-0 text-muted-foreground group-hover:text-primary" />
      </a>
      <p className="text-xs text-muted-foreground mt-1">
        {authorLine(paper.authors)}
        {year ? ` · ${year}` : ""}
      </p>

      {/* Rationale */}
      {paper.alignment_rationale && (
        <p className="text-sm text-foreground/80 mt-3 leading-relaxed">
          {paper.alignment_rationale}
        </p>
      )}

      {/* Matched concepts */}
      {paper.matched_concept_titles.length > 0 && (
        <div className="mt-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">
            Builds on what you know
          </p>
          <div className="flex flex-wrap gap-1.5">
            {paper.matched_concept_titles.map((title, i) => {
              const id = paper.matched_concept_ids[i];
              const chip = (
                <span className="text-[11px] text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                  {title}
                </span>
              );
              return id ? (
                <Link key={id} href={`/aiml/${id}`} className="hover:opacity-80">
                  {chip}
                </Link>
              ) : (
                <span key={`${title}-${i}`}>{chip}</span>
              );
            })}
          </div>
        </div>
      )}

      {/* Gap concepts (informational) */}
      {paper.gap_concepts.length > 0 && (
        <div className="mt-3 rounded-lg bg-amber-500/[0.07] border border-amber-500/20 p-3">
          <p className="text-[11px] uppercase tracking-wide text-amber-300/90 mb-1.5">
            Brush up first
          </p>
          <ul className="space-y-1.5">
            {paper.gap_concepts.map((g, i) => (
              <li key={`${g.title}-${i}`} className="text-xs text-foreground/80">
                <span className="font-medium text-amber-200">{g.title}</span>
                {g.reading_suggestion ? (
                  <span className="text-muted-foreground"> — {g.reading_suggestion}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2 mt-4">
        {paper.status === "dismissed" ? (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => onSetStatus("suggested")}
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1" /> Restore
            </Button>
            <Button size="sm" variant="destructive" disabled={busy} onClick={onDelete}>
              <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
            </Button>
          </>
        ) : (
          <>
            {paper.status !== "saved" && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => onSetStatus("saved")}
              >
                <BookmarkPlus className="w-3.5 h-3.5 mr-1" /> Save
              </Button>
            )}
            {paper.status !== "read" && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => onSetStatus("read")}
              >
                <Check className="w-3.5 h-3.5 mr-1" /> Mark read
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => onSetStatus("dismissed")}
            >
              <X className="w-3.5 h-3.5 mr-1" /> Dismiss
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
