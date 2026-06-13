"use client";

/**
 * One node of a concept's Learning Path tree, rendered recursively (phase →
 * topic → subtopic). Leaves carry a 3-state checkoff control; every node has an
 * expandable area for per-item notes and user-attached resources. All edits go
 * through PATCH /api/concepts/[id]/roadmap and bubble up via onItemChange so the
 * parent can re-roll completion %. Dependency gating is visual-only — controls
 * remain clickable so the user is never trapped.
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronDown,
  Clock,
  Circle,
  CircleDot,
  CheckCircle2,
  Lock,
  Plus,
  X,
  Video,
  FileText,
  Link as LinkIcon,
  StickyNote,
} from "lucide-react";
import type {
  RoadmapNode,
  RoadmapItemRow as ItemRow,
  ItemStatus,
  ResourceType,
} from "@/lib/roadmap";
import { RESOURCE_TYPES, isUnlocked } from "@/lib/roadmap";

// ── Styling maps ──────────────────────────────────────────────────────────────

const DIFFICULTY_STYLE: Record<string, string> = {
  foundational: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
  intermediate: "text-primary border-primary/30 bg-primary/10",
  advanced: "text-amber-400 border-amber-500/30 bg-amber-500/10",
  expert: "text-red-400 border-red-500/30 bg-red-500/10",
};

const RESOURCE_ICON: Record<ResourceType, typeof LinkIcon> = {
  youtube: Video,
  blog: FileText,
  paper: FileText,
  other: LinkIcon,
};

const NEXT_STATUS: Record<ItemStatus, ItemStatus> = {
  not_started: "in_progress",
  in_progress: "completed",
  completed: "not_started",
};

const STATUS_NEXT_LABEL: Record<ItemStatus, string> = {
  not_started: "Mark in progress",
  in_progress: "Mark complete",
  completed: "Reset to not started",
};

// ── API call ──────────────────────────────────────────────────────────────────

async function patchItem(
  conceptId: string,
  itemId: string,
  changes: Record<string, unknown>
): Promise<ItemRow | null> {
  const res = await fetch(`/api/concepts/${conceptId}/roadmap`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ itemId, ...changes }),
  });
  const json = (await res.json()) as { data: ItemRow | null; error: string | null };
  return json.error ? null : json.data;
}

// ── RoadmapItemRow (topic / subtopic) ────────────────────────────────────────

export function RoadmapItemRow({
  node,
  conceptId,
  idToTitle,
  statusById,
  onItemChange,
  isNextActionable,
}: {
  node: RoadmapNode;
  conceptId: string;
  idToTitle: Map<string, string>;
  /** Live status map so dependency gating reflects optimistic updates. */
  statusById: Map<string, ItemStatus>;
  onItemChange: (row: ItemRow) => void;
  /** Highlights this item as the next recommended action. */
  isNextActionable?: boolean;
}) {
  const isLeaf = node.children.length === 0;
  const [expanded, setExpanded] = useState(isNextActionable ?? false);
  const [saving, setSaving] = useState(false);
  const [notesDraft, setNotesDraft] = useState(node.notes ?? "");

  const unlocked = isUnlocked(node, statusById);
  const isLocked = isLeaf && !unlocked && node.status === "not_started";

  const deps = node.depends_on
    .map((id) => idToTitle.get(id))
    .filter((t): t is string => Boolean(t));

  const apply = async (changes: Record<string, unknown>) => {
    setSaving(true);
    const updated = await patchItem(conceptId, node.id, changes);
    setSaving(false);
    if (updated) onItemChange(updated);
  };

  const cycleStatus = () => apply({ status: NEXT_STATUS[node.status] });

  // ── Status icon ─────────────────────────────────────────────────────────
  const statusIcon =
    node.status === "completed" ? (
      <CheckCircle2 className="w-4.5 h-4.5 text-emerald-400 shrink-0" />
    ) : node.status === "in_progress" ? (
      <CircleDot className="w-4.5 h-4.5 text-amber-400 shrink-0" />
    ) : isLocked ? (
      <Lock className="w-4 h-4 text-muted-foreground/50 shrink-0" />
    ) : (
      <Circle className="w-4.5 h-4.5 text-muted-foreground/60 shrink-0" />
    );

  const indentClass = node.depth === 2 ? "ml-5 border-l border-border/40 pl-4" : "";

  return (
    <div
      className={indentClass}
      // Allow the parent's "Continue" button to programmatically scroll here.
      id={isLeaf ? `roadmap-item-${node.id}` : undefined}
      tabIndex={isLeaf && isNextActionable ? -1 : undefined}
    >
      {/* Row header */}
      <div
        className={`flex items-start gap-2.5 py-2 px-2 rounded-lg transition-colors ${
          isNextActionable
            ? "bg-primary/5 border border-primary/20"
            : "hover:bg-secondary/40"
        } ${isLocked ? "opacity-60" : ""}`}
      >
        {/* Tri-state button (leaf) or rolled-up % (parent) */}
        {isLeaf ? (
          <button
            type="button"
            onClick={cycleStatus}
            disabled={saving}
            aria-label={`${STATUS_NEXT_LABEL[node.status]} — ${node.title}`}
            title={STATUS_NEXT_LABEL[node.status]}
            className="mt-0.5 shrink-0 transition-transform active:scale-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded-full"
          >
            {statusIcon}
          </button>
        ) : (
          <div className="mt-0.5 shrink-0 w-9 text-center" aria-label={`${node.completionPct}% complete`}>
            <span
              className={`text-[11px] font-bold tabular-nums ${
                node.completionPct === 100 ? "text-emerald-400" : "text-muted-foreground"
              }`}
            >
              {node.completionPct}%
            </span>
          </div>
        )}

        {/* Main content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Title + expand toggle */}
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="flex items-center gap-1.5 text-left group min-w-0"
              aria-expanded={expanded}
              aria-label={`${expanded ? "Collapse" : "Expand"} ${node.title}`}
            >
              <span
                className={`text-sm font-medium leading-snug ${
                  node.status === "completed"
                    ? "text-muted-foreground line-through"
                    : "text-foreground"
                }`}
              >
                {node.title}
              </span>
              {isNextActionable && (
                <span className="text-[10px] font-bold text-primary bg-primary/15 border border-primary/30 px-1.5 py-0.5 rounded-full shrink-0">
                  Next
                </span>
              )}
              <ChevronDown
                className={`w-3.5 h-3.5 text-muted-foreground/60 transition-transform shrink-0 ${
                  expanded ? "rotate-180" : ""
                }`}
              />
            </button>

            {/* Difficulty pill */}
            {node.difficulty && (
              <span
                className={`text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded border shrink-0 ${
                  DIFFICULTY_STYLE[node.difficulty] ?? "text-muted-foreground border-border"
                }`}
              >
                {node.difficulty}
              </span>
            )}

            {/* Time chip */}
            {node.estimated_minutes != null && (
              <span className="text-[10px] text-muted-foreground flex items-center gap-0.5 shrink-0">
                <Clock className="w-3 h-3" />
                {node.estimated_minutes}m
              </span>
            )}

            {/* Notes indicator */}
            {node.notes && node.notes.trim().length > 0 && (
              <span className="text-[10px] text-muted-foreground/70 flex items-center gap-0.5 shrink-0" title="Has notes">
                <StickyNote className="w-3 h-3" />
              </span>
            )}

            {/* Resources count */}
            {node.resources.length > 0 && (
              <span className="text-[10px] text-muted-foreground/70 flex items-center gap-0.5 shrink-0" title={`${node.resources.length} resource${node.resources.length !== 1 ? "s" : ""}`}>
                <LinkIcon className="w-3 h-3" />
                {node.resources.length}
              </span>
            )}
          </div>

          {/* Lock line — shown when deps unmet, collapsed view */}
          {isLocked && deps.length > 0 && !expanded && (
            <p className="text-[11px] text-muted-foreground/60 mt-0.5 flex items-center gap-1">
              <Lock className="w-3 h-3 shrink-0" />
              Unlocks after:{" "}
              <span className="font-medium">{deps.join(", ")}</span>
            </p>
          )}
        </div>
      </div>

      {/* Expanded detail */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="detail"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="pl-7 pr-2 pb-3 pt-1 space-y-3">
              {/* Description */}
              {node.description && (
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {node.description}
                </p>
              )}

              {/* Dependency chips (expanded view) */}
              {deps.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  <span className="text-[11px] text-muted-foreground/70">Depends on:</span>
                  {deps.map((dep) => (
                    <span
                      key={dep}
                      className="text-[11px] bg-secondary/60 border border-border/50 rounded-full px-2 py-0.5 text-muted-foreground"
                    >
                      {dep}
                    </span>
                  ))}
                </div>
              )}

              {/* Notes */}
              <div>
                <label className="text-[11px] uppercase font-bold tracking-wider text-muted-foreground">
                  Notes
                </label>
                <textarea
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  onBlur={() => {
                    if (notesDraft !== (node.notes ?? "")) apply({ notes: notesDraft });
                  }}
                  rows={3}
                  placeholder="Your notes for this topic…"
                  className="mt-1 w-full text-xs bg-secondary/50 border border-border/60 rounded-lg p-2.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 resize-y leading-relaxed"
                />
              </div>

              {/* Resources */}
              <ResourcesEditor
                resources={node.resources}
                disabled={saving}
                onChange={(resources) => apply({ resources })}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Children (subtopics) */}
      {!isLeaf && (
        <div className="mt-1 space-y-0.5">
          {node.children.map((child) => (
            <RoadmapItemRow
              key={child.id}
              node={child}
              conceptId={conceptId}
              idToTitle={idToTitle}
              statusById={statusById}
              onItemChange={onItemChange}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── ResourcesEditor ───────────────────────────────────────────────────────────

function ResourcesEditor({
  resources,
  disabled,
  onChange,
}: {
  resources: { type: ResourceType; title: string; url: string }[];
  disabled: boolean;
  onChange: (resources: { type: ResourceType; title: string; url: string }[]) => void;
}) {
  const [type, setType] = useState<ResourceType>("youtube");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");

  const add = () => {
    if (!title.trim() || !url.trim()) return;
    onChange([...resources, { type, title: title.trim(), url: url.trim() }]);
    setTitle("");
    setUrl("");
  };

  return (
    <div>
      <label className="text-[11px] uppercase font-bold tracking-wider text-muted-foreground">
        Resources
      </label>
      {resources.length > 0 && (
        <ul className="mt-1.5 space-y-1.5">
          {resources.map((r, i) => {
            const Icon = RESOURCE_ICON[r.type] ?? LinkIcon;
            return (
              <li key={`${r.url}-${i}`} className="flex items-center gap-2 text-xs bg-secondary/30 rounded-md px-2 py-1.5">
                <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <a
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline truncate"
                >
                  {r.title}
                </a>
                <button
                  type="button"
                  onClick={() => onChange(resources.filter((_, idx) => idx !== i))}
                  disabled={disabled}
                  aria-label={`Remove resource: ${r.title}`}
                  className="ml-auto text-muted-foreground hover:text-red-400 disabled:opacity-50 shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-2 flex items-center gap-1.5">
        <select
          value={type}
          onChange={(e) => setType(e.target.value as ResourceType)}
          className="text-xs bg-secondary/50 border border-border/60 rounded-md px-1.5 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
        >
          {RESOURCE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          className="text-xs bg-secondary/50 border border-border/60 rounded-md px-2 py-1 text-foreground w-28 focus:outline-none focus:ring-1 focus:ring-primary/40"
        />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
          placeholder="https://…"
          className="text-xs bg-secondary/50 border border-border/60 rounded-md px-2 py-1 text-foreground flex-1 min-w-0 focus:outline-none focus:ring-1 focus:ring-primary/40"
        />
        <button
          type="button"
          onClick={add}
          disabled={disabled || !title.trim() || !url.trim()}
          className="flex items-center gap-1 text-xs font-medium bg-primary text-primary-foreground rounded-md px-2 py-1 hover:bg-primary/90 disabled:opacity-50 shrink-0"
        >
          <Plus className="w-3 h-3" /> Add
        </button>
      </div>
    </div>
  );
}
