"use client";

import { useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface Concept {
  id: string;
  title: string;
}

export interface LectureFormData {
  id?: string;
  week_number: number;
  title: string;
  scheduled_date: string;
  prerequisite_concept_ids: string[];
}

interface LectureScheduleFormProps {
  /** When provided → PATCH mode; otherwise → POST mode. */
  initialData?: LectureFormData | null;
  concepts: Concept[];
  onSuccess: (lecture: LectureFormData & { id: string }) => void;
  onCancel: () => void;
}

// ─── Validation (mirrors API rules) ────────────────────────────────────────

interface FieldErrors {
  week_number?: string;
  title?: string;
  scheduled_date?: string;
}

function validate(
  weekStr: string,
  title: string,
  date: string
): FieldErrors {
  const errs: FieldErrors = {};

  const week = Number(weekStr);
  if (!Number.isInteger(week) || week < 1 || week > 99)
    errs.week_number = "Must be an integer between 1 and 99";

  const t = title.trim();
  if (t.length < 1 || t.length > 200)
    errs.title = "Must be between 1 and 200 characters";

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    errs.scheduled_date = "Must be a valid date (YYYY-MM-DD)";
  } else {
    const [y, m, d] = date.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (
      dt.getUTCFullYear() !== y ||
      dt.getUTCMonth() !== m - 1 ||
      dt.getUTCDate() !== d
    )
      errs.scheduled_date = "Date is not valid";
  }

  return errs;
}

// ─── Component ─────────────────────────────────────────────────────────────

export function LectureScheduleForm({
  initialData,
  concepts,
  onSuccess,
  onCancel,
}: LectureScheduleFormProps) {
  const isEdit = !!initialData?.id;

  const [weekStr, setWeekStr] = useState(
    initialData?.week_number != null ? String(initialData.week_number) : ""
  );
  const [title, setTitle] = useState(initialData?.title ?? "");
  const [date, setDate] = useState(initialData?.scheduled_date ?? "");
  const [prereqIds, setPrereqIds] = useState<string[]>(
    initialData?.prerequisite_concept_ids ?? []
  );
  const [conceptSearch, setConceptSearch] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);

  // Build a title lookup map for display
  const conceptById = new Map(concepts.map((c) => [c.id, c.title]));

  const filteredConcepts = concepts.filter(
    (c) =>
      !prereqIds.includes(c.id) &&
      c.title.toLowerCase().includes(conceptSearch.toLowerCase())
  );

  function addPrereq(c: Concept) {
    setPrereqIds((prev) => [...prev, c.id]);
    setConceptSearch("");
  }

  function removePrereq(id: string) {
    setPrereqIds((prev) => prev.filter((x) => x !== id));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const fieldErrors = validate(weekStr, title, date);
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) return;

    setSaving(true);
    try {
      const body = {
        week_number: Number(weekStr),
        title: title.trim(),
        scheduled_date: date,
        prerequisite_concept_ids: prereqIds,
      };

      const url = isEdit
        ? `/api/lectures/${initialData!.id}`
        : "/api/lectures";
      const method = isEdit ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const json = (await res.json()) as {
        data: (LectureFormData & { id: string }) | null;
        error: string | null;
      };

      if (!res.ok || json.error) {
        toast.error(json.error ?? "Failed to save lecture");
        return;
      }

      toast.success(isEdit ? "Lecture updated" : "Lecture added");
      onSuccess(json.data!);
    } catch {
      toast.error("Network error — lecture not saved");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Week number */}
      <div>
        <Label htmlFor="lsf-week" className="text-xs font-medium text-muted-foreground mb-1.5 block">
          Week number <span className="text-red-400">*</span>
        </Label>
        <Input
          id="lsf-week"
          type="number"
          min={1}
          max={99}
          step={1}
          value={weekStr}
          onChange={(e) => {
            setWeekStr(e.target.value);
            setErrors((prev) => ({ ...prev, week_number: undefined }));
          }}
          placeholder="1–99"
          className="bg-secondary/50 border-border/60 h-9 text-sm w-28"
        />
        {errors.week_number && (
          <p className="text-xs text-red-400 mt-1">{errors.week_number}</p>
        )}
      </div>

      {/* Title */}
      <div>
        <Label htmlFor="lsf-title" className="text-xs font-medium text-muted-foreground mb-1.5 block">
          Title <span className="text-red-400">*</span>
        </Label>
        <Input
          id="lsf-title"
          type="text"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setErrors((prev) => ({ ...prev, title: undefined }));
          }}
          placeholder="e.g. Introduction to Transformers"
          className="bg-secondary/50 border-border/60 h-9 text-sm"
        />
        {errors.title && (
          <p className="text-xs text-red-400 mt-1">{errors.title}</p>
        )}
      </div>

      {/* Date */}
      <div>
        <Label htmlFor="lsf-date" className="text-xs font-medium text-muted-foreground mb-1.5 block">
          Scheduled date <span className="text-red-400">*</span>
        </Label>
        <Input
          id="lsf-date"
          type="date"
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
            setErrors((prev) => ({ ...prev, scheduled_date: undefined }));
          }}
          className="bg-secondary/50 border-border/60 h-9 text-sm w-48"
        />
        {errors.scheduled_date && (
          <p className="text-xs text-red-400 mt-1">{errors.scheduled_date}</p>
        )}
      </div>

      {/* Prerequisite concepts multi-select */}
      <div>
        <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">
          Prerequisite concepts
        </Label>

        {/* Selected badges */}
        {prereqIds.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {prereqIds.map((id) => (
              <Badge
                key={id}
                variant="secondary"
                className="gap-1 pr-1 text-xs"
              >
                {conceptById.get(id) ?? id.slice(0, 8) + "…"}
                <button
                  type="button"
                  onClick={() => removePrereq(id)}
                  className="hover:text-destructive"
                >
                  <X className="w-3 h-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}

        {/* Search */}
        <Input
          type="text"
          placeholder="Search concepts to add…"
          value={conceptSearch}
          onChange={(e) => setConceptSearch(e.target.value)}
          className="bg-secondary/50 border-border/60 h-9 text-sm"
        />

        {conceptSearch && (
          <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-border/60 bg-secondary/30">
            {filteredConcepts.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                No concepts found
              </p>
            ) : (
              filteredConcepts.slice(0, 8).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => addPrereq(c)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-primary/10 transition-colors flex items-center gap-2"
                >
                  <Plus className="w-3 h-3 text-primary shrink-0" />
                  {c.title}
                </button>
              ))
            )}
          </div>
        )}

        {concepts.length === 0 && (
          <p className="text-xs text-muted-foreground mt-1">
            Add AIML concepts first to link them as prerequisites.
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-3 pt-1">
        <Button
          type="submit"
          disabled={saving}
          className="bg-primary hover:bg-primary/90 h-9"
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
          {isEdit ? "Save changes" : "Add lecture"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={saving}
          className="h-9 border-border/60 text-muted-foreground"
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
