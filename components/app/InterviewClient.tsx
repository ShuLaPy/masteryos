"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  MessageSquare, Brain, Send, Loader2, SkipForward, Play, GraduationCap, Code2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import InterviewScorecard, { type ScorecardData } from "@/components/app/InterviewScorecard";
import ExternalInterviewPrompt from "@/components/app/ExternalInterviewPrompt";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface SlotMeta {
  slotIndex: number;
  title: string;
  bucket: "this_week" | "mixed" | "weak";
  difficultyBand: "easy" | "medium" | "hard";
  targetDifficulty: number;
}

interface SlotGradeBlock {
  slot_index?: number;
  slot_grade?: number;
  strong_points?: string[];
  weak_points?: string[];
  follow_up_card?: { front: string; back: string } | null;
}

export interface ExistingSession {
  sessionId: string;
  status: "active" | "complete" | "abandoned";
  slotsMeta: SlotMeta[];
  transcript: ChatMessage[];
  currentSlot: number;
  overallScore: number | null;
}

type Phase = "idle" | "active" | "complete";

const BUCKET_LABEL: Record<SlotMeta["bucket"], string> = {
  this_week: "This week",
  mixed: "Mixed recall",
  weak: "Weak spot",
};

// ─── JSON extraction (interviewer embeds grade / scorecard JSON in its reply) ──

function extractJsonBlocks(text: string): Record<string, unknown>[] {
  const objs: Record<string, unknown>[] = [];
  const fenceRe = /```json\s*([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(text)) !== null) {
    try {
      objs.push(JSON.parse(m[1].trim()) as Record<string, unknown>);
    } catch {
      /* ignore malformed block */
    }
  }
  if (objs.length === 0) {
    // Fallback: greedy brace match (Feynman precedent) for un-fenced JSON.
    const slot = text.match(/\{[\s\S]*"slot_grade"[\s\S]*\}/);
    if (slot) {
      try {
        objs.push(JSON.parse(slot[0]) as Record<string, unknown>);
      } catch {
        /* ignore */
      }
    }
    const score = text.match(/\{[\s\S]*"overall_score"[\s\S]*\}/);
    if (score) {
      try {
        objs.push(JSON.parse(score[0]) as Record<string, unknown>);
      } catch {
        /* ignore */
      }
    }
  }
  return objs;
}

function stripJson(text: string): string {
  return text
    .replace(/```json\s*[\s\S]*?```/g, "")
    .replace(/```/g, "")
    .replace(/\{[\s\S]*"slot_grade"[\s\S]*\}/g, "")
    .replace(/\{[\s\S]*"overall_score"[\s\S]*\}/g, "")
    .trim();
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function InterviewClient({
  existingSession,
}: {
  existingSession: ExistingSession | null;
}) {
  // Restore prior session state on mount.
  const restored = useMemo(() => {
    if (!existingSession) return null;
    const cleaned = (existingSession.transcript ?? []).map((m) => ({
      role: m.role,
      content: m.role === "assistant" ? stripJson(m.content) || m.content : m.content,
    }));
    let scorecard: ScorecardData | null = null;
    for (const m of existingSession.transcript ?? []) {
      const block = extractJsonBlocks(m.content).find((b) => "overall_score" in b);
      if (block) scorecard = block as unknown as ScorecardData;
    }
    return { cleaned, scorecard };
  }, [existingSession]);

  const [phase, setPhase] = useState<Phase>(
    existingSession?.status === "complete"
      ? "complete"
      : existingSession?.status === "active"
        ? "active"
        : "idle"
  );
  const [sessionId, setSessionId] = useState<string | null>(existingSession?.sessionId ?? null);
  const [slotsMeta, setSlotsMeta] = useState<SlotMeta[]>(existingSession?.slotsMeta ?? []);
  const [messages, setMessages] = useState<ChatMessage[]>(restored?.cleaned ?? []);
  const [currentSlot, setCurrentSlot] = useState<number>(existingSession?.currentSlot ?? 0);
  const [results, setResults] = useState<{ slotIndex: number; grade: number }[]>([]);
  const [scorecard, setScorecard] = useState<ScorecardData | null>(restored?.scorecard ?? null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [codeMode, setCodeMode] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, scorecard]);

  const totalSlots = slotsMeta.length;
  const activeSlot = slotsMeta[Math.min(currentSlot, totalSlots - 1)];

  // ── Start a new interview ──
  async function startInterview() {
    if (starting) return;
    setStarting(true);
    try {
      const res = await fetch("/api/interview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error ?? "Failed to start");
      if (json.data?.empty) {
        toast.info("Add or study a few AIML concepts first — then your interview will have material.");
        return;
      }
      setSessionId(json.data.sessionId);
      setSlotsMeta(json.data.slotsMeta ?? []);
      setCurrentSlot(json.data.currentSlot ?? 0);
      if (json.data.resumed) {
        const cleaned = (json.data.transcript ?? []).map((m: ChatMessage) => ({
          role: m.role,
          content: m.role === "assistant" ? stripJson(m.content) || m.content : m.content,
        }));
        setMessages(cleaned);
        setPhase(json.data.status === "complete" ? "complete" : "active");
      } else {
        setMessages([{ role: "assistant", content: json.data.firstQuestion }]);
        setPhase("active");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to start interview");
    } finally {
      setStarting(false);
    }
  }

  // ── Apply a per-slot grade (shadow writes happen server-side) ──
  async function applyGrade(block: SlotGradeBlock) {
    if (!sessionId) return;
    const slotIndex = typeof block.slot_index === "number" ? block.slot_index : currentSlot;
    try {
      const res = await fetch("/api/interview/grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          slot_index: slotIndex,
          slot_grade: block.slot_grade,
          strong_points: block.strong_points ?? [],
          weak_points: block.weak_points ?? [],
          follow_up_card: block.follow_up_card ?? null,
        }),
      });
      const json = await res.json();
      if (json.data) {
        setCurrentSlot(json.data.nextSlotIndex);
        if (typeof block.slot_grade === "number") {
          setResults((prev) =>
            prev.some((r) => r.slotIndex === slotIndex)
              ? prev
              : [...prev, { slotIndex, grade: block.slot_grade as number }]
          );
        }
      }
    } catch {
      /* non-fatal — the conversation continues */
    }
  }

  async function finishSession(overallScore: number, transcript: ChatMessage[]) {
    if (!sessionId) return;
    try {
      await fetch("/api/interview", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "finish",
          sessionId,
          overall_score: overallScore,
          transcript,
        }),
      });
    } catch {
      /* best effort */
    }
  }

  // ── Send the candidate's answer and stream the interviewer's reply ──
  async function sendMessage(text: string) {
    if (!text.trim() || loading || phase !== "active" || !sessionId) return;
    const userMsg: ChatMessage = { role: "user", content: text };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/interview/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, messages: nextMessages }),
      });

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let reply = "";
      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          reply += decoder.decode(value);
          // Show the reply with JSON stripped, live.
          const visibleLive = stripJson(reply) || reply;
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = { role: "assistant", content: visibleLive };
            return updated;
          });
        }
      }

      // Final parse once the stream is complete.
      const blocks = extractJsonBlocks(reply);
      const gradeBlock = blocks.find((b) => "slot_grade" in b) as SlotGradeBlock | undefined;
      const scorecardBlock = blocks.find((b) => "overall_score" in b) as
        | (ScorecardData & Record<string, unknown>)
        | undefined;

      const visible = stripJson(reply) || "Let's keep going.";
      const finalMessages = [...nextMessages, { role: "assistant" as const, content: visible }];
      setMessages(finalMessages);

      if (gradeBlock) await applyGrade(gradeBlock);
      if (scorecardBlock) {
        setScorecard(scorecardBlock);
        setPhase("complete");
        await finishSession(
          typeof scorecardBlock.overall_score === "number" ? scorecardBlock.overall_score : 0,
          finalMessages
        );
      }
    } catch {
      toast.error("Failed to reach the interviewer");
    } finally {
      setLoading(false);
    }
  }

  // ── Force-advance when the interviewer is stuck on a slot ──
  async function skipSlot() {
    if (!sessionId || loading || phase !== "active") return;
    setLoading(true);
    try {
      await fetch("/api/interview/grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, slot_index: currentSlot, force: true }),
      });
      setCurrentSlot((s) => s + 1);
    } finally {
      setLoading(false);
    }
    await sendMessage("Let's move on to the next concept, please.");
  }

  // ─── Idle / start screen ───
  if (phase === "idle") {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center border border-primary/30 glow-violet">
            <MessageSquare className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Weekly Mock Interview</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Explain your way to mastery — graded like the real thing
            </p>
          </div>
        </div>

        <div className="glass rounded-2xl p-6 mb-6">
          <div className="flex items-start gap-3 mb-4">
            <GraduationCap className="w-5 h-5 text-primary shrink-0 mt-0.5" />
            <p className="text-sm text-foreground leading-relaxed">
              A senior AI/ML interviewer will work through ~5 of your concepts — mixing what you
              learned <span className="text-primary font-medium">this week</span>, older ideas pulled
              back for <span className="text-primary font-medium">recall</span>, and your{" "}
              <span className="text-primary font-medium">weak spots</span> — and{" "}
              <span className="text-primary font-medium">drills into each one</span> with real
              follow-up questions until it&apos;s clear how well you know it. If a concept involves an
              algorithm, you might be asked to sketch or derive it. Explaining out loud is what locks
              it in.
            </p>
          </div>
          <ul className="text-xs text-muted-foreground space-y-1.5 ml-8 mb-6">
            <li>• Answer in your own words — the act of explaining reinforces retention.</li>
            <li>• Strong answers raise a concept&apos;s mastery; gaps become new review cards.</li>
            <li>• You get a readiness debrief at the end. One interview per week.</li>
          </ul>
          <Button
            onClick={startInterview}
            disabled={starting}
            className="w-full bg-primary hover:bg-primary/90 text-white glow-violet"
          >
            {starting ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <Play className="w-4 h-4 mr-2" />
            )}
            Start this week&apos;s interview
          </Button>
        </div>
        <ExternalInterviewPrompt />
      </div>
    );
  }

  // ─── Active / complete chat view ───
  const gradeBySlot = new Map(results.map((r) => [r.slotIndex, r.grade]));

  return (
    <div className="flex flex-col h-screen overflow-hidden relative">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-primary/10 rounded-full blur-3xl pointer-events-none" />

      {/* Header + progress */}
      <div className="border-b border-border/40 px-6 py-4 bg-background/80 backdrop-blur-sm z-10">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/20 border border-primary/30 flex items-center justify-center">
              <MessageSquare className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h1 className="text-base font-bold text-foreground leading-none">Mock Interview</h1>
              <p className="text-[11px] text-muted-foreground mt-1">
                {phase === "complete"
                  ? "Complete"
                  : `Concept ${Math.min(currentSlot + 1, totalSlots)} of ${totalSlots}`}
                {activeSlot && phase === "active" && (
                  <> · {BUCKET_LABEL[activeSlot.bucket]} · {activeSlot.difficultyBand}</>
                )}
              </p>
            </div>
          </div>
          {/* Slot dots */}
          <div className="hidden sm:flex items-center gap-1.5">
            {slotsMeta.map((s) => {
              const grade = gradeBySlot.get(s.slotIndex);
              const done = s.slotIndex < currentSlot;
              const color =
                grade != null
                  ? grade >= 3
                    ? "bg-emerald-400"
                    : grade >= 2
                      ? "bg-amber-400"
                      : "bg-red-400"
                  : done
                    ? "bg-muted-foreground"
                    : s.slotIndex === currentSlot
                      ? "bg-primary"
                      : "bg-border";
              return (
                <span
                  key={s.slotIndex}
                  className={`h-1.5 rounded-full transition-all ${color} ${
                    s.slotIndex === currentSlot ? "w-4" : "w-1.5"
                  }`}
                  title={s.title}
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* Chat / scorecard */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 z-10">
        <AnimatePresence initial={false}>
          {messages.map((msg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex gap-3 max-w-3xl mx-auto ${msg.role === "user" ? "flex-row-reverse" : ""}`}
            >
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                  msg.role === "user"
                    ? "bg-primary/20 border border-primary/30"
                    : "bg-secondary border border-border/60"
                }`}
              >
                {msg.role === "user" ? (
                  <span className="text-xs font-bold text-primary">You</span>
                ) : (
                  <Brain className="w-4 h-4 text-muted-foreground" />
                )}
              </div>
              <div className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"} max-w-[85%]`}>
                <div
                  className={`rounded-2xl p-4 text-sm leading-relaxed ${
                    msg.role === "user"
                      ? "bg-primary/15 border border-primary/20 rounded-tr-sm text-foreground whitespace-pre-wrap"
                      : "glass rounded-tl-sm text-foreground"
                  }`}
                >
                  {msg.role === "assistant" ? (
                    msg.content ? (
                      <div className="bridge-prose text-sm leading-relaxed">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                      </div>
                    ) : (
                      <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                    )
                  ) : (
                    msg.content
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {phase === "complete" && scorecard && (
          <div className="pt-4">
            <InterviewScorecard scorecard={scorecard} />
            <p className="text-center text-xs text-muted-foreground mt-6">
              Your next interview unlocks next week. Strong answers raised mastery; gaps were turned
              into review cards.
            </p>
            <div className="max-w-3xl mx-auto mt-6">
              <ExternalInterviewPrompt />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      {phase === "active" && (
        <div className="border-t border-border/40 px-6 py-4 bg-background/80 backdrop-blur-sm z-10">
          <div className="max-w-3xl mx-auto">
            <div className="flex gap-3">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  // In code mode, Enter inserts a newline; otherwise Enter sends.
                  if (e.key === "Enter" && !e.shiftKey && !codeMode) {
                    e.preventDefault();
                    sendMessage(input);
                  }
                }}
                placeholder={
                  codeMode
                    ? "Write your code / pseudocode…  (Enter = newline, click Send to submit)"
                    : "Explain your answer out loud, in your own words…  (Shift+Enter for a newline)"
                }
                className={`resize-none min-h-[44px] max-h-60 bg-secondary/50 border-border/60 focus:border-primary/60 text-sm ${
                  codeMode ? "font-mono" : ""
                }`}
                rows={codeMode ? 6 : 1}
                disabled={loading}
              />
              <div className="flex flex-col gap-2 shrink-0">
                <Button
                  onClick={() => sendMessage(input)}
                  disabled={loading || !input.trim()}
                  size="icon"
                  className="bg-primary hover:bg-primary/90 text-white h-11 w-11 glow-violet"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </Button>
              </div>
            </div>
            <div className="flex items-center justify-between mt-2">
              <button
                onClick={() => setCodeMode((v) => !v)}
                className={`text-[11px] flex items-center gap-1 transition-colors ${
                  codeMode ? "text-primary" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Code2 className="w-3 h-3" /> {codeMode ? "Exit code mode" : "Code mode"}
              </button>
              <button
                onClick={skipSlot}
                disabled={loading}
                className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-50"
              >
                <SkipForward className="w-3 h-3" /> Skip this concept
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
