"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

interface Props {
  initialValue: boolean;
}

export function BlindModeToggle({ initialValue }: Props) {
  const [enabled, setEnabled] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  async function toggle() {
    const next = !enabled;
    setSaving(true);
    try {
      const res = await fetch("/api/dsa/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blind_mode: next }),
      });
      if (!res.ok) throw new Error("Failed");
      setEnabled(next);
      toast.success(next ? "Blind mode on" : "Blind mode off");
      router.refresh();
    } catch {
      toast.error("Failed to save setting");
    } finally {
      setSaving(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={saving}
      title={enabled ? "Blind mode ON — click to disable" : "Blind mode OFF — click to enable"}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all ${
        enabled
          ? "bg-violet-500/20 border-violet-500/30 text-violet-300 hover:bg-violet-500/30"
          : "bg-secondary/50 border-border/60 text-muted-foreground hover:border-border"
      }`}
    >
      {enabled ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
      Blind mode
    </button>
  );
}
