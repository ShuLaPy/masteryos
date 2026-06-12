"use client";

import { useState } from "react";
import {
  CalendarClock, CheckCircle2, Circle, Edit2, Loader2, Plus,
  Trash2, X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LectureScheduleForm, type Concept, type LectureFormData } from "@/components/app/LectureScheduleForm";
import { LectureCaptureModal } from "@/components/app/LectureCaptureModal";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface LectureRow {
  id: string;
  week_number: number;
  title: string;
  scheduled_date: string;
  is_attended: boolean | null;
  prerequisite_concept_ids: string[] | null;
}

interface ScheduleManagerProps {
  initialLectures: LectureRow[];
  concepts: Concept[];
}

// ─── Modal shell ───────────────────────────────────────────────────────────

function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className={`relative z-10 w-full bg-[#111827] rounded-2xl border border-[#1f2937] p-6 shadow-xl overflow-y-auto max-h-[90vh] ${
          wide ? "max-w-2xl" : "max-w-lg"
        }`}
      >
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

// ─── Delete confirmation modal ──────────────────────────────────────────────

function DeleteModal({
  lecture,
  onClose,
  onSuccess,
}: {
  lecture: LectureRow;
  onClose: () => void;
  onSuccess: (lectureId: string) => void;
}) {
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/lectures/${lecture.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const json = (await res.json()) as { error: string | null };
        toast.error(json.error ?? "Failed to delete lecture");
        return;
      }
      toast.success("Lecture deleted");
      onSuccess(lecture.id);
      onClose();
    } catch {
      toast.error("Network error — please try again");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Modal title="Delete lecture?" onClose={onClose}>
      <p className="text-sm text-muted-foreground mb-5">
        This will permanently remove{" "}
        <span className="text-foreground font-medium">
          Week {lecture.week_number}: {lecture.title}
        </span>{" "}
        from your schedule. This action cannot be undone.
      </p>
      <div className="flex gap-3">
        <Button
          onClick={handleDelete}
          disabled={deleting}
          className="bg-destructive hover:bg-destructive/90 h-9 text-white"
        >
          {deleting && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
          Delete
        </Button>
        <Button
          variant="outline"
          onClick={onClose}
          disabled={deleting}
          className="h-9 border-border/60 text-muted-foreground"
        >
          Cancel
        </Button>
      </div>
    </Modal>
  );
}

// ─── Lecture row ────────────────────────────────────────────────────────────

function LectureTableRow({
  lecture,
  isNext,
  concepts,
  onEdit,
  onDelete,
  onAttend,
}: {
  lecture: LectureRow;
  isNext: boolean;
  concepts: Concept[];
  onEdit: (l: LectureRow) => void;
  onDelete: (l: LectureRow) => void;
  onAttend: (l: LectureRow) => void;
}) {
  const attended = !!lecture.is_attended;
  const prereqCount = lecture.prerequisite_concept_ids?.length ?? 0;
  const dateLabel = new Date(`${lecture.scheduled_date}T00:00:00Z`).toLocaleDateString(
    "en-US",
    { weekday: "short", month: "short", day: "numeric" }
  );

  return (
    <tr className={`border-b border-border/30 hover:bg-white/[0.02] transition-colors ${attended ? "opacity-60" : ""}`}>
      {/* Week */}
      <td className="px-4 py-3 whitespace-nowrap">
        <div
          className={`inline-flex w-8 h-8 rounded-lg items-center justify-center text-xs font-bold ${
            isNext
              ? "bg-primary/15 text-primary border border-primary/25"
              : attended
              ? "bg-secondary text-muted-foreground"
              : "bg-secondary text-muted-foreground"
          }`}
        >
          W{lecture.week_number}
        </div>
      </td>

      {/* Title */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2 flex-wrap">
          {isNext && (
            <span className="text-[10px] font-medium text-primary bg-primary/10 border border-primary/20 px-1.5 py-0.5 rounded-full whitespace-nowrap">
              Next
            </span>
          )}
          <span className="text-sm text-foreground">{lecture.title}</span>
        </div>
      </td>

      {/* Date */}
      <td className="px-4 py-3 whitespace-nowrap text-sm text-muted-foreground">
        {dateLabel}
      </td>

      {/* Prereqs */}
      <td className="px-4 py-3 text-center">
        {prereqCount > 0 ? (
          <Badge variant="secondary" className="text-[10px] font-normal">
            {prereqCount}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>

      {/* Status */}
      <td className="px-4 py-3 whitespace-nowrap">
        {attended ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400">
            <CheckCircle2 className="w-3.5 h-3.5" /> Attended
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <Circle className="w-3.5 h-3.5" /> Upcoming
          </span>
        )}
      </td>

      {/* Actions */}
      <td className="px-4 py-3 whitespace-nowrap">
        <div className="flex items-center gap-1">
          {!attended && (
            <button
              onClick={() => onAttend(lecture)}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400 hover:text-emerald-300 px-2 py-1 rounded-lg hover:bg-emerald-500/10 transition-colors"
              title="Mark as attended"
            >
              <CheckCircle2 className="w-3.5 h-3.5" /> Attend
            </button>
          )}
          <button
            onClick={() => onEdit(lecture)}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            title="Edit"
          >
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onDelete(lecture)}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
            title="Delete"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ─── Main component ────────────────────────────────────────────────────────

export function ScheduleManager({ initialLectures, concepts }: ScheduleManagerProps) {
  const [lectures, setLectures] = useState<LectureRow[]>(initialLectures);
  const [modal, setModal] = useState<"add" | "edit" | "delete" | "attend" | null>(null);
  const [selected, setSelected] = useState<LectureRow | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const nextLecture =
    lectures.find((l) => l.scheduled_date >= today && !l.is_attended) ?? null;

  function openAdd() {
    setSelected(null);
    setModal("add");
  }
  function openEdit(l: LectureRow) {
    setSelected(l);
    setModal("edit");
  }
  function openDelete(l: LectureRow) {
    setSelected(l);
    setModal("delete");
  }
  function openAttend(l: LectureRow) {
    setSelected(l);
    setModal("attend");
  }
  function closeModal() {
    setModal(null);
    setSelected(null);
  }

  function handleAddSuccess(newLecture: LectureFormData & { id: string }) {
    const row: LectureRow = {
      id: newLecture.id,
      week_number: newLecture.week_number,
      title: newLecture.title,
      scheduled_date: newLecture.scheduled_date,
      is_attended: false,
      prerequisite_concept_ids: newLecture.prerequisite_concept_ids,
    };
    setLectures((prev) =>
      [...prev, row].sort((a, b) => {
        if (a.scheduled_date !== b.scheduled_date)
          return a.scheduled_date < b.scheduled_date ? -1 : 1;
        return a.week_number - b.week_number;
      })
    );
    closeModal();
  }

  function handleEditSuccess(updated: LectureFormData & { id: string }) {
    setLectures((prev) =>
      prev
        .map((l) =>
          l.id === updated.id
            ? {
                ...l,
                week_number: updated.week_number,
                title: updated.title,
                scheduled_date: updated.scheduled_date,
                prerequisite_concept_ids: updated.prerequisite_concept_ids,
              }
            : l
        )
        .sort((a, b) => {
          if (a.scheduled_date !== b.scheduled_date)
            return a.scheduled_date < b.scheduled_date ? -1 : 1;
          return a.week_number - b.week_number;
        })
    );
    closeModal();
  }

  function handleDeleteSuccess(id: string) {
    setLectures((prev) => prev.filter((l) => l.id !== id));
  }

  function handleAttendSuccess(id: string) {
    setLectures((prev) =>
      prev.map((l) => (l.id === id ? { ...l, is_attended: true } : l))
    );
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <CalendarClock className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Lectures</h2>
          <span className="text-xs text-muted-foreground">{lectures.length} total</span>
        </div>
        <Button
          onClick={openAdd}
          className="bg-primary hover:bg-primary/90 h-8 text-xs gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" /> Add Lecture
        </Button>
      </div>

      {/* Table */}
      {lectures.length === 0 ? (
        <div className="glass rounded-2xl p-12 text-center">
          <CalendarClock className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-50" />
          <p className="text-foreground font-medium mb-1">No lectures scheduled</p>
          <p className="text-sm text-muted-foreground mb-5">
            Add your 32-week IIT AIML lecture schedule to start planning.
          </p>
          <Button onClick={openAdd} className="bg-primary hover:bg-primary/90 h-9">
            <Plus className="w-4 h-4 mr-2" /> Add first lecture
          </Button>
        </div>
      ) : (
        <div className="glass rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border/40 bg-white/[0.02]">
                  <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Week</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Title</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Date</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-center">Prereqs</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {lectures.map((lecture) => (
                  <LectureTableRow
                    key={lecture.id}
                    lecture={lecture}
                    isNext={lecture.id === nextLecture?.id}
                    concepts={concepts}
                    onEdit={openEdit}
                    onDelete={openDelete}
                    onAttend={openAttend}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add modal */}
      {modal === "add" && (
        <Modal title="Add lecture" onClose={closeModal}>
          <LectureScheduleForm
            concepts={concepts}
            onSuccess={handleAddSuccess}
            onCancel={closeModal}
          />
        </Modal>
      )}

      {/* Edit modal */}
      {modal === "edit" && selected && (
        <Modal title="Edit lecture" onClose={closeModal}>
          <LectureScheduleForm
            initialData={{
              id: selected.id,
              week_number: selected.week_number,
              title: selected.title,
              scheduled_date: selected.scheduled_date,
              prerequisite_concept_ids: selected.prerequisite_concept_ids ?? [],
            }}
            concepts={concepts}
            onSuccess={handleEditSuccess}
            onCancel={closeModal}
          />
        </Modal>
      )}

      {/* Capture modal (brain dump → notes ingestion) */}
      {modal === "attend" && selected && (
        <LectureCaptureModal
          lecture={selected}
          onClose={closeModal}
          onSuccess={handleAttendSuccess}
        />
      )}

      {/* Delete confirmation */}
      {modal === "delete" && selected && (
        <DeleteModal
          lecture={selected}
          onClose={closeModal}
          onSuccess={handleDeleteSuccess}
        />
      )}
    </>
  );
}
