"use client";

/**
 * One node of a concept's Learning Path tree, rendered recursively (phase →
 * topic → subtopic). Leaves carry a 3-state checkoff control; every node has an
 * expandable area for per-item notes and user-attached resources. All edits go
 * through PATCH /api/concepts/[id]/roadmap and bubble up via onItemChange so the
 * parent can re-roll completion %.
 */

import { useState } from "react";
import {
  ChevronRight,
  Clock,
  Circle,
  CircleDot,
  CheckCircle2,
  Plus,
  X,
  Video,
  FileText,
  Link as LinkIcon,
} from "lucide-react";
import type {
  RoadmapNode,
  RoadmapItemRow as ItemRow,
  ItemStatus,
  ResourceType,
} from "@/lib/roadmap";
import { RESOURCE_TYPES } from "@/lib/roadmap";

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

export function RoadmapItemRow({
  node,
  conceptId,
  idToTitle,
  onItemChange,
}: {
  node: RoadmapNode;
  conceptId: string;
  idToTitle: Map<string, string>;
  onItemChange: (row: ItemRow) => void;
}) {
  const isLeaf = node.children.length === 0;
  const isPhase = node.depth === 0;
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notesDraft, setNotesDraft] = useState(node.notes ?? "");

  const apply = async (changes: Record<string, unknown>) => {
    setSaving(true);
    const updated = await patchItem(conceptId, node.id, changes);
    setSaving(false);
    if (updated) onItemChange(updated);
  };

  const cycleStatus = () => apply({ status: NEXT_STATUS[node.status] });

  const deps = node.depends_on
    .map((id) => idToTitle.get(id))
    .filter((t): t is string => Boolean(t));

  return (
    <div className={isPhase ? "rounded-xl border border-border/60 bg-secondary/30 p-4" : ""}>
      <div className="flex items-start gap-3">
        {/* Status control (leaf) or rolled-up % (parent) */}
        {isLeaf ? (
          <button
            type="button"
            onClick={cycleStatus}
            disabled={saving}
            aria-label={`Mark ${node.title} (${node.status})`}
            className="mt-0.5 shrink-0 transition-transform active:scale-90 disabled:opacity-50"
          >
            {node.status === "completed" ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            ) : node.status === "in_progress" ? (
              <CircleDot className="w-5 h-5 text-amber-400" />
            ) : (
              <Circle className="w-5 h-5 text-muted-foreground" />
            )}
          </button>
        ) : (
          <div className="mt-0.5 shrink-0 w-10 text-center">
            <span
              className={`text-xs font-bold ${
                node.completionPct === 100 ? "text-emerald-400" : "text-muted-foreground"
              }`}
            >
              {node.completionPct}%
            </span>
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="flex items-center gap-1 text-left group"
            >
              <ChevronRight
                className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${
                  expanded ? "rotate-90" : ""
                }`}
              />
              <span
                className={`${isPhase ? "text-base font-semibold" : "text-sm font-medium"} ${
                  node.status === "completed" ? "text-muted-foreground line-through" : "text-foreground"
                }`}
              >
                {node.title}
              </span>
            </button>

            {node.difficulty && (
              <span
                className={`text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded border ${
                  DIFFICULTY_STYLE[node.difficulty] ?? "text-muted-foreground border-border"
                }`}
              >
                {node.difficulty}
              </span>
            )}
            {node.estimated_minutes != null && (
              <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                <Clock className="w-3 h-3" /> {node.estimated_minutes}m
              </span>
            )}
            {node.resources.length > 0 && (
              <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                <LinkIcon className="w-3 h-3" /> {node.resources.length}
              </span>
            )}
          </div>

          {node.description && (
            <p className="text-xs text-muted-foreground mt-0.5 ml-[18px]">{node.description}</p>
          )}
          {deps.length > 0 && (
            <p className="text-[11px] text-muted-foreground/80 mt-0.5 ml-[18px]">
              ↳ after: {deps.join(", ")}
            </p>
          )}

          {expanded && (
            <div className="mt-3 ml-[18px] space-y-3">
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
                  rows={2}
                  placeholder="Your notes for this topic…"
                  className="mt-1 w-full text-xs bg-secondary/50 border border-border/60 rounded-lg p-2 text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 resize-y"
                />
              </div>

              {/* Resources */}
              <ResourcesEditor
                resources={node.resources}
                disabled={saving}
                onChange={(resources) => apply({ resources })}
              />
            </div>
          )}
        </div>
      </div>

      {/* Children */}
      {!isLeaf && (
        <div className={`mt-2 space-y-2 ${isPhase ? "ml-1" : "ml-4 border-l border-border/60 pl-4"}`}>
          {node.children.map((child) => (
            <RoadmapItemRow
              key={child.id}
              node={child}
              conceptId={conceptId}
              idToTitle={idToTitle}
              onItemChange={onItemChange}
            />
          ))}
        </div>
      )}
    </div>
  );
}

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
        <ul className="mt-1 space-y-1">
          {resources.map((r, i) => {
            const Icon = RESOURCE_ICON[r.type] ?? LinkIcon;
            return (
              <li key={`${r.url}-${i}`} className="flex items-center gap-2 text-xs">
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
                  aria-label="Remove resource"
                  className="ml-auto text-muted-foreground hover:text-red-400 disabled:opacity-50"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-1.5 flex items-center gap-1.5">
        <select
          value={type}
          onChange={(e) => setType(e.target.value as ResourceType)}
          className="text-xs bg-secondary/50 border border-border/60 rounded-md px-1.5 py-1 text-foreground"
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
          placeholder="https://…"
          className="text-xs bg-secondary/50 border border-border/60 rounded-md px-2 py-1 text-foreground flex-1 min-w-0 focus:outline-none focus:ring-1 focus:ring-primary/40"
        />
        <button
          type="button"
          onClick={add}
          disabled={disabled || !title.trim() || !url.trim()}
          className="flex items-center gap-1 text-xs font-medium bg-primary text-primary-foreground rounded-md px-2 py-1 hover:bg-primary/90 disabled:opacity-50"
        >
          <Plus className="w-3 h-3" /> Add
        </button>
      </div>
    </div>
  );
}
