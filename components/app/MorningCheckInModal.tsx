"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Flame, BookOpen, X, Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export interface CheckInProps {
  streakCount: number;
  graceRemaining: number;
  dueCount: number;
  mentorMessage: string | null;
  dailyGoalMinutes: number;
  displayName: string;
}

interface MorningCheckInModalProps extends CheckInProps {
  shouldShow: boolean;
}

export default function MorningCheckInModal({
  shouldShow,
  streakCount,
  graceRemaining,
  dueCount,
  mentorMessage,
  dailyGoalMinutes,
  displayName,
}: MorningCheckInModalProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const dismissKey = `checkin-dismissed-${new Date().toISOString().split("T")[0]}`;

  function getGreeting() {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    if (hour < 21) return "Good evening";
    return "Good night";
  }

  useEffect(() => {
    const hour = new Date().getHours();
    const dismissed = sessionStorage.getItem(dismissKey) === "1";
    if (shouldShow && hour >= 6 && !dismissed) {
      setOpen(true);
    }
  }, [shouldShow, dismissKey]);

  function dismiss() {
    sessionStorage.setItem(dismissKey, "1");
    setOpen(false);
  }

  async function beginSession() {
    setLoading(true);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_type: "srs_review",
          planned_minutes: dailyGoalMinutes,
        }),
      });
      if (!res.ok) throw new Error("Failed to start session");
      sessionStorage.setItem(dismissKey, "1");
      setOpen(false);
      router.push("/review");
    } catch {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) dismiss(); else setOpen(v); }}>
      <DialogContent className="sm:max-w-md bg-card border-border/60">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Sparkles className="w-5 h-5 text-primary" />
            {getGreeting()}, {displayName.split(" ")[0]}
          </DialogTitle>
        </DialogHeader>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          <div className="text-sm text-muted-foreground leading-relaxed prose prose-sm prose-invert max-w-none [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {mentorMessage ??
                "Ready to build your streak today? Start with a focused review session."}
            </ReactMarkdown>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="glass rounded-xl p-3 text-center">
              <Flame className="w-5 h-5 text-amber-400 mx-auto mb-1" />
              <p className="text-xl font-bold text-foreground">{streakCount}</p>
              <p className="text-[10px] text-muted-foreground">day streak</p>
            </div>
            <div className="glass rounded-xl p-3 text-center">
              <BookOpen className="w-5 h-5 text-violet-400 mx-auto mb-1" />
              <p className="text-xl font-bold text-foreground">{dueCount}</p>
              <p className="text-[10px] text-muted-foreground">cards due</p>
            </div>
          </div>

          {graceRemaining > 0 && streakCount > 0 && (
            <p className="text-xs text-amber-400/80 text-center">
              {graceRemaining} grace day{graceRemaining !== 1 ? "s" : ""} remaining this week
            </p>
          )}

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1 border-border/60" onClick={dismiss}>
              <X className="w-4 h-4 mr-1" /> Later
            </Button>
            <Button
              className="flex-1 bg-primary hover:bg-primary/90 glow-violet"
              onClick={beginSession}
              disabled={loading}
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Begin Session"}
            </Button>
          </div>
        </motion.div>
      </DialogContent>
    </Dialog>
  );
}
