"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import {
  FlaskConical, ArrowLeft, Brain, Send, Loader2, Sparkles, CheckCircle2,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface Concept {
  id: string;
  title: string;
  notes: string;
  mastery_score: number | null;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface Evaluation {
  mastery_score: number;
  strong_points: string[];
  weak_points: string[];
  follow_up_cards: { front: string; back: string }[];
}

export default function FeynmanClient({ concepts, userId }: { concepts: Concept[]; userId: string }) {
  const [selected, setSelected] = useState<Concept | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [evalData, setEvalData] = useState<Evaluation | null>(null);
  const [savingEval, setSavingEval] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, evalData]);

  function startSession(concept: Concept) {
    setSelected(concept);
    setMessages([
      {
        role: "assistant",
        content: `Hey! I've been trying to understand "${concept.title}" but I'm really confused. Can you explain it to me simply? Start from the very beginning.`,
      },
    ]);
    setEvalData(null);
  }

  async function sendMessage(text: string) {
    if (!text.trim() || loading || evalData) return;
    const userMsg: ChatMessage = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/ai/feynman", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          concept_id: selected!.id,
          concept_title: selected!.title,
          concept_notes: selected!.notes,
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

      // Check if the reply contains the evaluation JSON block at the end
      if (reply.includes("```json") || reply.includes(`"mastery_score"`)) {
        // Find json
        const match = reply.match(/\{[\s\S]*"mastery_score"[\s\S]*\}/);
        if (match) {
          try {
            const parsed = JSON.parse(match[0]) as Evaluation;
            setEvalData(parsed);
            // Clean up the message to remove JSON
            setMessages((prev) => {
              const updated = [...prev];
              updated[updated.length - 1] = { role: "assistant", content: reply.replace(match[0], "").replace(/```json|```/g, "").trim() || "Let me think about what you said..." };
              return updated;
            });
          } catch (e) {
            console.error("JSON parse error", e);
          }
        }
      }

    } catch {
      toast.error("Failed to communicate with AI");
    } finally {
      setLoading(false);
    }
  }

  async function saveEvaluation() {
    if (!selected || !evalData || savingEval) return;
    setSavingEval(true);
    try {
      const res = await fetch("/api/ai/feynman", {
        method: "PUT", // We use PUT to save the eval
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          concept_id: selected.id,
          conversation: messages,
          evaluation: evalData,
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("Session saved! New SRS cards added.");
      setSelected(null); // Return to list
    } catch {
      toast.error("Failed to save session");
    } finally {
      setSavingEval(false);
    }
  }

  // View: Concept Picker
  if (!selected) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center border border-amber-500/30 glow-emerald">
            <FlaskConical className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Feynman 2.0</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Teach an AI student to master your concepts
            </p>
          </div>
        </div>

        {concepts.length === 0 ? (
          <div className="text-center py-20 glass rounded-2xl">
            <p className="text-muted-foreground">Log AIML concepts first to unlock Feynman mode.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {concepts.map((c) => (
              <motion.div
                key={c.id}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => startSession(c)}
                className="glass rounded-xl p-5 cursor-pointer hover:border-amber-500/30 transition-colors"
              >
                <div className="flex justify-between items-start mb-3">
                  <h3 className="font-semibold text-foreground truncate pr-2">{c.title}</h3>
                  <Badge variant="outline" className={`text-[10px] shrink-0 border-border/60 ${c.mastery_score && c.mastery_score < 0.5 ? "text-orange-400" : "text-muted-foreground"}`}>
                    {Math.round((c.mastery_score ?? 0) * 100)}%
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2 min-h-8">
                  {c.notes || "No notes provided"}
                </p>
                <div className="mt-4 flex items-center text-xs font-medium text-amber-400">
                  Start teaching <ChevronRight className="w-3 h-3 ml-1" />
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // View: Teaching Session
  return (
    <div className="flex flex-col h-screen overflow-hidden relative">
      {/* Background glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Header */}
      <div className="border-b border-border/40 px-6 py-4 flex items-center justify-between bg-background/80 backdrop-blur-sm z-10">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setSelected(null)} className="h-8 w-8">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30 text-[10px]">Teaching</Badge>
              <h1 className="text-lg font-bold text-foreground">{selected.title}</h1>
            </div>
          </div>
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 z-10">
        <AnimatePresence initial={false}>
          {messages.map((msg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex gap-3 max-w-3xl mx-auto ${msg.role === "user" ? "flex-row-reverse" : ""}`}
            >
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                msg.role === "user"
                  ? "bg-amber-500/20 border border-amber-500/30"
                  : "bg-secondary border border-border/60"
              }`}>
                {msg.role === "user" ? (
                  <span className="text-xs font-bold text-amber-400">You</span>
                ) : (
                  <Brain className="w-4 h-4 text-muted-foreground" />
                )}
              </div>
              <div className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}>
                <div className={`rounded-2xl p-4 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-amber-500/15 border border-amber-500/20 rounded-tr-sm text-foreground"
                    : "glass rounded-tl-sm text-foreground"
                }`}>
                  {msg.content || <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Evaluation Block */}
        {evalData && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="max-w-3xl mx-auto mt-8 glass rounded-2xl p-6 border-amber-500/30"
          >
            <div className="flex items-center gap-2 mb-6">
              <Sparkles className="w-5 h-5 text-amber-400" />
              <h2 className="text-xl font-bold gradient-text">Session Complete!</h2>
            </div>
            
            <div className="flex items-center gap-6 mb-8">
              <div className="w-24 h-24 rounded-full bg-secondary flex items-center justify-center relative">
                <svg className="w-full h-full transform -rotate-90 absolute inset-0">
                  <circle cx="48" cy="48" r="44" stroke="currentColor" strokeWidth="4" fill="transparent" className="text-border" />
                  <circle cx="48" cy="48" r="44" stroke="currentColor" strokeWidth="4" fill="transparent" strokeDasharray="276" strokeDashoffset={276 - (276 * evalData.mastery_score)} className="text-amber-400 transition-all duration-1000" />
                </svg>
                <span className="text-2xl font-bold text-foreground">{Math.round(evalData.mastery_score * 100)}%</span>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">Your teaching mastery score</p>
                <p className="text-foreground text-sm leading-relaxed">
                  {evalData.mastery_score >= 0.8 ? "Excellent explanation! You really know this inside out." 
                    : evalData.mastery_score >= 0.5 ? "Good job! You have the core down, just missing a few details." 
                    : "A bit shaky. Let's review the weak points below."}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6 mb-6">
              <div>
                <h3 className="text-sm font-semibold text-emerald-400 mb-2 flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" /> Strong Points</h3>
                <ul className="space-y-1.5">
                  {evalData.strong_points.map((p, i) => <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5"><span className="text-emerald-400 mt-0.5">•</span> <span>{p}</span></li>)}
                </ul>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-red-400 mb-2 flex items-center gap-1.5"><Brain className="w-4 h-4" /> Weak Points</h3>
                <ul className="space-y-1.5">
                  {evalData.weak_points.map((p, i) => <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5"><span className="text-red-400 mt-0.5">•</span> <span>{p}</span></li>)}
                </ul>
              </div>
            </div>

            <div className="bg-secondary/30 rounded-xl p-4 border border-border/60">
              <p className="text-xs font-semibold text-foreground mb-2">We generated {evalData.follow_up_cards.length} new SRS cards for your weak points.</p>
              <Button onClick={saveEvaluation} disabled={savingEval} className="w-full bg-amber-500 hover:bg-amber-600 text-white mt-2">
                {savingEval ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                Save & Finish
              </Button>
            </div>
          </motion.div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      {!evalData && (
        <div className="border-t border-border/40 px-6 py-4 bg-background/80 backdrop-blur-sm z-10">
          <div className="max-w-3xl mx-auto flex gap-3">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage(input);
                }
              }}
              placeholder="Explain it like I'm 5..."
              className="resize-none min-h-[44px] max-h-32 bg-secondary/50 border-border/60 focus:border-amber-500/60 text-sm"
              rows={1}
              disabled={loading}
            />
            <Button
              onClick={() => sendMessage(input)}
              disabled={loading || !input.trim()}
              size="icon"
              className="bg-amber-500 hover:bg-amber-600 text-white shrink-0 h-11 w-11 glow-emerald"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
