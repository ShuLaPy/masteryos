"use client";

import { useState } from "react";
import { Zap, Brain, Code2, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";

interface Connection {
  aiml_concept: { id: string; title: string };
  dsa_problem: { id: string; title: string };
  similarity: number;
  explanation: string;
  why_it_matters: string;
}

export function InsightCards() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);

  const discoverConnections = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/ai/discover-connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threshold: 0.6, max_pairs: 5 }),
      });
      const data = await res.json();
      if (data.connections) {
        setConnections(data.connections);
      }
    } catch {
      // Silent fail
    } finally {
      setLoading(false);
      setFetched(true);
    }
  };

  if (!fetched) {
    return (
      <div className="glass rounded-2xl p-6 border-amber-500/20">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Zap className="w-5 h-5 text-amber-400" /> Cross-Domain Insights
          </h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Discover hidden connections between your AIML concepts and DSA patterns using semantic similarity.
        </p>
        <Button
          onClick={discoverConnections}
          disabled={loading}
          className="bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 border border-amber-500/30"
          variant="outline"
        >
          {loading ? (
            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Discovering...</>
          ) : (
            <><Zap className="w-4 h-4 mr-2" /> Discover Connections</>
          )}
        </Button>
      </div>
    );
  }

  if (connections.length === 0) {
    return (
      <div className="glass rounded-2xl p-6 border-amber-500/20">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Zap className="w-5 h-5 text-amber-400" /> Cross-Domain Insights
          </h2>
          <Button
            onClick={discoverConnections}
            disabled={loading}
            size="sm"
            variant="ghost"
            className="text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          No connections found yet. Add more concepts and problems to discover cross-domain insights.
        </p>
      </div>
    );
  }

  return (
    <div className="glass rounded-2xl p-6 border-amber-500/20">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <Zap className="w-5 h-5 text-amber-400" /> Cross-Domain Insights
        </h2>
        <Button
          onClick={discoverConnections}
          disabled={loading}
          size="sm"
          variant="ghost"
          className="text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>
      <div className="space-y-4">
        <AnimatePresence>
          {connections.map((conn, i) => (
            <motion.div
              key={`${conn.aiml_concept.id}-${conn.dsa_problem.id}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              className="bg-secondary/50 rounded-xl p-4 border border-amber-500/20"
            >
              <div className="flex items-center gap-2 mb-2">
                <div className="flex items-center gap-1.5 text-xs">
                  <Brain className="w-3.5 h-3.5 text-primary" />
                  <span className="font-medium text-foreground">{conn.aiml_concept.title}</span>
                </div>
                <span className="text-muted-foreground text-xs">↔</span>
                <div className="flex items-center gap-1.5 text-xs">
                  <Code2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="font-medium text-foreground">{conn.dsa_problem.title}</span>
                </div>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {conn.explanation}
              </p>
              <p className="text-xs text-amber-400/80 mt-2 italic">
                {conn.why_it_matters}
              </p>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
