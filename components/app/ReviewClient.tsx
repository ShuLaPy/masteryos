"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  CheckCircle2, RotateCcw, ChevronRight, Zap, Trophy, Brain,
  Clock, Target, ArrowLeft, Eye, EyeOff,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

interface SRSCard {
  id: string;
  card_type: string;
  front: string;
  back: string;
  source_type: string;
  reps: number;
  lapses: number;
  stability: number;
}

interface ReviewClientProps {
  cards: SRSCard[];
  userId: string;
}

const RATINGS = [
  { value: 1, label: "Again", color: "bg-red-500/20 border-red-500/40 text-red-300 hover:bg-red-500/30", key: "1" },
  { value: 2, label: "Hard", color: "bg-orange-500/20 border-orange-500/40 text-orange-300 hover:bg-orange-500/30", key: "2" },
  { value: 3, label: "Good", color: "bg-emerald-500/20 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30", key: "3" },
  { value: 4, label: "Easy", color: "bg-violet-500/20 border-violet-500/40 text-violet-300 hover:bg-violet-500/30", key: "4" },
];

export default function ReviewClient({ cards, userId }: ReviewClientProps) {
  const [queue, setQueue] = useState(cards);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(cards.length === 0);
  const [results, setResults] = useState<{ again: number; hard: number; good: number; easy: number }>({
    again: 0, hard: 0, good: 0, easy: 0,
  });
  const [startTime, setStartTime] = useState(Date.now());

  const total = cards.length;
  const reviewed = currentIdx;
  const progress = total > 0 ? (reviewed / total) * 100 : 0;
  const current = queue[currentIdx];

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (!flipped) {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          setFlipped(true);
        }
      } else {
        const rating = parseInt(e.key);
        if (rating >= 1 && rating <= 4) submitRating(rating);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flipped, currentIdx]);

  async function submitRating(rating: number) {
    if (submitting || !current) return;
    setSubmitting(true);

    const duration = Math.round((Date.now() - startTime) / 1000);

    try {
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ card_id: current.id, rating, duration_seconds: duration }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Review failed");
      }

      const label = RATINGS.find((r) => r.value === rating)?.label.toLowerCase() as keyof typeof results;
      setResults((prev) => ({ ...prev, [label]: prev[label] + 1 }));

      if (currentIdx + 1 >= queue.length) {
        setDone(true);
      } else {
        setCurrentIdx((i) => i + 1);
        setFlipped(false);
        setStartTime(Date.now());
      }
    } catch {
      toast.error("Failed to save review. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="flex items-center justify-center min-h-screen p-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center max-w-md"
        >
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: "spring", bounce: 0.5 }}
            className="w-20 h-20 rounded-full bg-emerald-500/20 border-2 border-emerald-500/40 flex items-center justify-center mx-auto mb-6 glow-emerald"
          >
            <Trophy className="w-9 h-9 text-emerald-400" />
          </motion.div>

          <h1 className="text-3xl font-bold gradient-text mb-2">
            {total === 0 ? "All clear!" : "Review complete!"}
          </h1>
          <p className="text-muted-foreground mb-8">
            {total === 0
              ? "No cards due right now. Come back later or log new concepts."
              : `You reviewed ${total} card${total !== 1 ? "s" : ""}. Great work!`}
          </p>

          {total > 0 && (
            <div className="grid grid-cols-4 gap-3 mb-8">
              {[
                { label: "Again", val: results.again, color: "text-red-400" },
                { label: "Hard", val: results.hard, color: "text-orange-400" },
                { label: "Good", val: results.good, color: "text-emerald-400" },
                { label: "Easy", val: results.easy, color: "text-violet-400" },
              ].map((r) => (
                <div key={r.label} className="glass rounded-xl p-3 text-center">
                  <p className={`text-2xl font-bold ${r.color}`}>{r.val}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{r.label}</p>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-3 justify-center">
            <Link href="/">
              <Button variant="outline" className="border-border/60">
                <ArrowLeft className="w-4 h-4 mr-2" /> Back to Mentor
              </Button>
            </Link>
            <Link href="/aiml/new">
              <Button className="bg-primary hover:bg-primary/90">
                Add concepts <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </Link>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link href="/">
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-lg font-semibold">Daily Review</h1>
            <p className="text-xs text-muted-foreground">{reviewed} of {total} cards</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="w-3.5 h-3.5" />
            <span>Space to flip · 1-4 to rate</span>
          </div>
          <Badge variant="outline" className="border-primary/30 text-primary">
            {total - reviewed} remaining
          </Badge>
        </div>
      </div>

      {/* Progress */}
      <Progress value={progress} className="mb-8 h-1.5 bg-secondary" />

      {/* Card */}
      <div className="flex-1 flex items-center justify-center">
        <div className="w-full max-w-2xl">
          {/* Card type badge */}
          <div className="flex justify-center mb-4">
            <Badge className="bg-primary/10 text-primary border-primary/20 capitalize">
              {current?.card_type ?? "card"} · #{reviewed + 1}
            </Badge>
          </div>

          {/* Flip card */}
          <div
            className="relative cursor-pointer"
            onClick={() => !flipped && setFlipped(true)}
            style={{ perspective: "1200px" }}
          >
            <motion.div
              style={{ transformStyle: "preserve-3d" }}
              animate={{ rotateY: flipped ? 180 : 0 }}
              transition={{ duration: 0.45, ease: [0.4, 0, 0.2, 1] }}
              className="relative"
            >
              {/* Front */}
              <div
                className="glass rounded-2xl p-10 min-h-64 flex flex-col items-center justify-center text-center"
                style={{ backfaceVisibility: "hidden" }}
              >
                <p className="text-xs font-semibold text-primary mb-4 uppercase tracking-widest">Question</p>
                <p className="text-xl font-medium text-foreground leading-relaxed">{current?.front}</p>
                {!flipped && (
                  <div className="mt-8 flex items-center gap-2 text-muted-foreground text-sm">
                    <Eye className="w-4 h-4" />
                    <span>Click or press Space to reveal</span>
                  </div>
                )}
              </div>

              {/* Back */}
              <div
                className="absolute inset-0 glass rounded-2xl p-10 min-h-64 flex flex-col items-center justify-center text-center border-primary/20"
                style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
              >
                <p className="text-xs font-semibold text-emerald-400 mb-4 uppercase tracking-widest">Answer</p>
                <p className="text-lg text-foreground leading-relaxed">{current?.back}</p>
              </div>
            </motion.div>
          </div>

          {/* Rating buttons */}
          <AnimatePresence>
            {flipped && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 12 }}
                className="mt-6 space-y-3"
              >
                <p className="text-center text-xs text-muted-foreground mb-3">
                  How well did you recall this?
                </p>
                <div className="grid grid-cols-4 gap-3">
                  {RATINGS.map((r) => (
                    <motion.button
                      key={r.value}
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => submitRating(r.value)}
                      disabled={submitting}
                      className={`py-3 rounded-xl border font-medium text-sm transition-all ${r.color} disabled:opacity-50`}
                    >
                      <span className="block text-lg font-bold mb-0.5">{r.key}</span>
                      {r.label}
                    </motion.button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
