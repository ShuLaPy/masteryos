"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Brain, Flame, BookOpen, Code2, Cpu, FlaskConical,
  BarChart3, Send, Loader2, Sparkles, Target, TrendingUp,
  ArrowRight, Zap, GraduationCap, CalendarClock, AlertTriangle,
} from "lucide-react";
import { ZonePlanView } from "@/components/app/ZonePlanView";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { InsightCards } from "@/components/app/InsightCards";
import CommitmentWidget from "@/components/app/CommitmentWidget";
import type { LectureIntel } from "@/lib/mentor-context";

interface MentorContext {
  userId: string;
  displayName: string;
  streakCount: number;
  goalMinutes: number;
  dueCount: number;
  weakestConcept: { title: string; mastery: number } | null;
  weakestConcepts: { title: string; mastery: number }[];
  lastDSASolvedAt: string | null;
  mentorMessage: string | null;
  completionPct: number;
  dsaPatterns: Record<string, number>;
  dsaProblemCount7d: number;
  reviewStats: {
    totalCards: number;
    avgStability: number;
    totalLapses: number;
    totalReps: number;
    matureCardCount: number;
    successRate: number;
  };
  weeklyCardsReviewed: number;
  commitment: {
    weeklyGoalMinutes: number;
    actualMinutes: number;
    compliancePct: number;
  };
  generatedPlan: unknown;
  lectureIntel: LectureIntel | null;
}

/** Tailwind bg color for a 0–1 readiness score (matches getRetentionColor tiers). */
function readinessBg(score: number): string {
  if (score >= 0.85) return "bg-emerald-400";
  if (score >= 0.65) return "bg-amber-400";
  if (score >= 0.4) return "bg-orange-400";
  return "bg-red-400";
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const quickActions = [
  { label: "Start Review", href: "/review", icon: BookOpen, color: "text-violet-400", bg: "bg-violet-500/10 border-violet-500/20", desc: "Spaced repetition session" },
  { label: "Log DSA Problem", href: "/dsa/log", icon: Code2, color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20", desc: "Record today's problem" },
  { label: "Add Concept", href: "/aiml/new", icon: Cpu, color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/20", desc: "Log what you learned" },
  { label: "Feynman Mode", href: "/feynman", icon: FlaskConical, color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20", desc: "Teach to master" },
  { label: "Class Prep", href: "/schedule/prep", icon: GraduationCap, color: "text-teal-400", bg: "bg-teal-500/10 border-teal-500/20", desc: "Review prereqs before lecture" },
  { label: "This week's Bridge", href: "/schedule/bridge", icon: Sparkles, color: "text-fuchsia-400", bg: "bg-fuchsia-500/10 border-fuchsia-500/20", desc: "Lecture synthesis & gaps" },
];

const starters = [
  "What should I focus on today?",
  "How is my retention looking?",
  "What's my weakest area right now?",
  "Give me a study plan for the next 3 days",
];

export default function MentorHomeClient({ ctx }: { ctx: MentorContext }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [greeting, setGreeting] = useState(ctx.mentorMessage);
  const bottomRef = useRef<HTMLDivElement>(null);

  const hour = new Date().getHours();
  const timeGreeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  useEffect(() => {
    if (!greeting) {
      // Generate greeting if none cached
      fetchGreeting();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function fetchGreeting() {
    try {
      const res = await fetch("/api/ai/mentor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "greeting", ctx }),
      });
      const data = await res.json();
      if (data.message) setGreeting(data.message);
    } catch {
      setGreeting(`${timeGreeting}, ${ctx.displayName}! Ready to make progress today?`);
    }
  }

  async function sendMessage(text: string) {
    if (!text.trim() || loading) return;
    const userMsg: ChatMessage = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/ai/mentor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "chat",
          ctx,
          messages: [...messages, userMsg],
        }),
      });

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let reply = "";

      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          reply += chunk;
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = { role: "assistant", content: reply };
            return updated;
          });
        }
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "I'm having trouble connecting right now. Please try again." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  const daysSinceDSA = ctx.lastDSASolvedAt
    ? Math.floor((Date.now() - new Date(ctx.lastDSASolvedAt).getTime()) / 86400000)
    : null;

  const nextLecture = ctx.lectureIntel?.upcoming?.[0] ?? null;
  const nextLecturePrereqGaps =
    nextLecture?.prereqs.filter((p) => p.status !== "strong") ?? [];

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Left panel — Chat */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="border-b border-border/40 px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-foreground">
              {timeGreeting}, <span className="gradient-text">{ctx.displayName}</span>
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">Your AI mentor is ready</p>
          </div>
          <div className="flex items-center gap-3">
            {ctx.streakCount > 0 && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20">
                <Flame className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-xs font-medium text-amber-300">{ctx.streakCount} days</span>
              </div>
            )}
            {ctx.dueCount > 0 && (
              <Link href="/review">
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-violet-500/10 border border-violet-500/20 hover:bg-violet-500/20 transition-colors">
                  <BookOpen className="w-3.5 h-3.5 text-violet-400" />
                  <span className="text-xs font-medium text-violet-300">{ctx.dueCount} due</span>
                </div>
              </Link>
            )}
          </div>
        </div>

        {/* Chat area */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Mentor greeting card */}
          {greeting && messages.length === 0 && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex gap-3"
            >
              <div className="w-8 h-8 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center shrink-0 mt-0.5">
                <Brain className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1">
                <div className="glass rounded-2xl rounded-tl-sm p-4 max-w-2xl">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-semibold text-primary">AI Mentor</span>
                    <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-primary/30 text-primary/70">GPT-4o</Badge>
                  </div>
                  <div className="bridge-prose text-sm text-foreground leading-relaxed">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{greeting}</ReactMarkdown>
                  </div>
                </div>
                {/* Starter prompts */}
                <div className="flex flex-wrap gap-2 mt-2">
                  {starters.map((s) => (
                    <button
                      key={s}
                      onClick={() => sendMessage(s)}
                      className="text-xs px-3 py-1.5 rounded-full border border-border/60 text-muted-foreground hover:border-primary/40 hover:text-primary transition-all"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {/* Chat messages */}
          <AnimatePresence initial={false}>
            {messages.map((msg, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                  msg.role === "user"
                    ? "bg-primary/20 border border-primary/30"
                    : "bg-secondary border border-border/60"
                }`}>
                  {msg.role === "user" ? (
                    <span className="text-xs font-bold text-primary">
                      {ctx.displayName[0].toUpperCase()}
                    </span>
                  ) : (
                    <Brain className="w-4 h-4 text-muted-foreground" />
                  )}
                </div>
                <div className={`max-w-2xl ${msg.role === "user" ? "items-end" : "items-start"} flex flex-col`}>
                  <div className={`rounded-2xl p-4 text-sm leading-relaxed ${
                    msg.role === "user"
                      ? "bg-primary/20 border border-primary/20 rounded-tr-sm text-foreground"
                      : "glass rounded-tl-sm text-foreground"
                  }`}>
                    {msg.content ? (
                      msg.role === "assistant" ? (
                        <div className="bridge-prose">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                        </div>
                      ) : (
                        <span className="whitespace-pre-wrap">{msg.content}</span>
                      )
                    ) : (
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <Loader2 className="w-3 h-3 animate-spin" /> Thinking...
                      </span>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          <div ref={bottomRef} />
        </div>

        {/* Input area */}
        <div className="border-t border-border/40 px-6 py-4">
          <div className="flex gap-3">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage(input);
                }
              }}
              placeholder="Ask your mentor anything..."
              className="resize-none min-h-[44px] max-h-32 bg-secondary/50 border-border/60 focus:border-primary/60 text-sm"
              rows={1}
            />
            <Button
              onClick={() => sendMessage(input)}
              disabled={loading || !input.trim()}
              size="icon"
              className="bg-primary hover:bg-primary/90 shrink-0 h-11 w-11"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">
            Press Enter to send · Shift+Enter for new line
          </p>
        </div>
      </div>

      {/* Right panel — Stats + Quick Actions */}
      <div className="w-80 shrink-0 border-l border-border/40 p-4 space-y-4 overflow-y-auto">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">
          Today at a glance
        </h2>

        {/* Stats cards */}
        <div className="space-y-2">
          {/* Next lecture readiness — the headline "what's coming" signal */}
          {nextLecture && (
            <div className={`glass rounded-xl p-4 ${nextLecture.imminent && nextLecturePrereqGaps.length > 0 ? "border-red-500/30" : ""}`}>
              <div className="flex items-center gap-2 mb-2">
                <CalendarClock className="w-3.5 h-3.5 text-primary" />
                <span className="text-xs font-medium text-muted-foreground">Next lecture</span>
                {nextLecture.imminent && (
                  <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-300 border border-red-500/20 uppercase tracking-wide">
                    Soon
                  </span>
                )}
              </div>
              <p className="text-sm font-semibold text-foreground truncate">{nextLecture.title}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {nextLecture.daysUntil === 0
                  ? "Today"
                  : nextLecture.daysUntil === 1
                    ? "Tomorrow"
                    : `in ${nextLecture.daysUntil} days`}{" "}
                · {Math.round(nextLecture.readinessScore * 100)}% ready
              </p>
              <div className="mt-2 h-1.5 rounded-full bg-secondary overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${readinessBg(nextLecture.readinessScore)}`}
                  style={{ width: `${Math.round(nextLecture.readinessScore * 100)}%` }}
                />
              </div>
              {nextLecturePrereqGaps.length > 0 && (
                <div className="mt-2.5 pt-2.5 border-t border-border/40 space-y-1.5">
                  {nextLecturePrereqGaps.slice(0, 3).map((p) => (
                    <div key={p.conceptId} className="flex items-center gap-1.5">
                      <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
                      <span className="text-[10px] text-foreground truncate">{p.title}</span>
                      <span className={`ml-auto text-[9px] uppercase tracking-wide shrink-0 ${p.status === "unstudied" ? "text-red-400" : "text-amber-400"}`}>
                        {p.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <Link
                href="/schedule/prep"
                className="mt-2.5 inline-flex items-center gap-1 text-[10px] font-medium text-primary hover:text-primary/80 transition-colors"
              >
                Prep now <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          )}

          <div className="glass rounded-xl p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-violet-500/15 flex items-center justify-center">
              <BookOpen className="w-4 h-4 text-violet-400" />
            </div>
            <div>
              <p className="text-xl font-bold text-foreground">{ctx.dueCount}</p>
              <p className="text-xs text-muted-foreground">cards due today</p>
            </div>
          </div>

          <div className="glass rounded-xl p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-amber-500/15 flex items-center justify-center">
              <Flame className="w-4 h-4 text-amber-400" />
            </div>
            <div>
              <p className="text-xl font-bold text-foreground">{ctx.streakCount}</p>
              <p className="text-xs text-muted-foreground">day streak</p>
            </div>
          </div>

          {/* Review performance */}
          <div className="glass rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Target className="w-3.5 h-3.5 text-primary" />
              <span className="text-xs font-medium text-muted-foreground">Retention</span>
            </div>
            <div className="flex items-baseline gap-1">
              <p className={`text-xl font-bold ${ctx.reviewStats.successRate >= 85 ? "text-emerald-400" : ctx.reviewStats.successRate >= 70 ? "text-amber-400" : "text-red-400"}`}>
                {ctx.reviewStats.successRate}%
              </p>
              <span className="text-xs text-muted-foreground">success rate</span>
            </div>
            <div className="flex gap-3 mt-2 text-[10px] text-muted-foreground">
              <span>{ctx.weeklyCardsReviewed} reviewed this week</span>
              <span>·</span>
              <span>{ctx.reviewStats.matureCardCount} mature</span>
            </div>
          </div>

          {ctx.weakestConcept && (
            <div className="glass rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-xs font-medium text-muted-foreground">Needs attention</span>
              </div>
              {ctx.weakestConcepts.slice(0, 3).map((concept) => (
                <div key={concept.title} className="mb-2 last:mb-0">
                  <p className="text-sm font-medium text-foreground truncate">{concept.title}</p>
                  <div className="mt-1 h-1.5 rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full bg-amber-400/70"
                      style={{ width: `${concept.mastery}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{concept.mastery}% mastery</p>
                </div>
              ))}
            </div>
          )}

          {daysSinceDSA !== null && (
            <div className={`glass rounded-xl p-4 ${daysSinceDSA > 2 ? "border-orange-500/30" : ""}`}>
              <div className="flex items-center gap-3">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${daysSinceDSA > 2 ? "bg-orange-500/15" : "bg-emerald-500/15"}`}>
                  <Code2 className={`w-4 h-4 ${daysSinceDSA > 2 ? "text-orange-400" : "text-emerald-400"}`} />
                </div>
                <div>
                  <p className="text-xl font-bold text-foreground">{daysSinceDSA}d</p>
                  <p className="text-xs text-muted-foreground">since last DSA</p>
                </div>
              </div>
              {ctx.dsaProblemCount7d > 0 && (
                <div className="mt-2 pt-2 border-t border-border/40">
                  <p className="text-[10px] text-muted-foreground mb-1">{ctx.dsaProblemCount7d} problems this week</p>
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(ctx.dsaPatterns).slice(0, 4).map(([pattern, count]) => (
                      <span key={pattern} className="text-[9px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">
                        {pattern} ×{count}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <CommitmentWidget
          weeklyGoalMinutes={ctx.commitment.weeklyGoalMinutes}
          actualMinutes={ctx.commitment.actualMinutes}
          compliancePct={ctx.commitment.compliancePct}
        />

        {/* Today's study plan zones */}
        <ZonePlanView rawPlan={ctx.generatedPlan} />

        {/* Quick Actions */}
        <div>
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-2">
            Quick actions
          </h2>
          <div className="space-y-2">
            {quickActions.map((action) => {
              const Icon = action.icon;
              return (
                <Link key={action.href} href={action.href}>
                  <motion.div
                    whileHover={{ x: 2 }}
                    whileTap={{ scale: 0.98 }}
                    className={`flex items-center gap-3 p-3 rounded-xl border ${action.bg} hover:opacity-90 transition-all cursor-pointer`}
                  >
                    <Icon className={`w-4 h-4 ${action.color} shrink-0`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">{action.label}</p>
                      <p className="text-[10px] text-muted-foreground">{action.desc}</p>
                    </div>
                    <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                  </motion.div>
                </Link>
              );
            })}
          </div>
        </div>

        {/* Cross-Domain Insights */}
        <InsightCards />

        {/* Links to analytics */}
        <Link href="/analytics">
          <motion.div
            whileHover={{ scale: 1.01 }}
            className="glass rounded-xl p-4 flex items-center gap-3 cursor-pointer hover:border-primary/30 transition-colors"
          >
            <div className="w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-primary" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">Full Analytics</p>
              <p className="text-[10px] text-muted-foreground">Retention, patterns, progress</p>
            </div>
            <ArrowRight className="w-3 h-3 text-muted-foreground" />
          </motion.div>
        </Link>
      </div>
    </div>
  );
}
