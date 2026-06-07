"use client";

import { motion } from "framer-motion";
import { ExternalLink, Lightbulb, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export interface Suggestion {
  slug: string;
  title: string;
  difficulty: string;
  url: string;
  patterns: string[];
  target_pattern: string;
}

function difficultyStyle(d: string): string {
  if (d === "easy") return "text-emerald-400 bg-emerald-500/15 border-emerald-500/25";
  if (d === "medium") return "text-amber-400 bg-amber-500/15 border-amber-500/25";
  return "text-red-400 bg-red-500/15 border-red-500/25";
}

interface Props {
  suggestions: Suggestion[];
}

export default function SuggestedProblemList({ suggestions }: Props) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Lightbulb className="w-4 h-4 text-primary" />
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          Do Next
        </h2>
        <span className="text-xs text-muted-foreground">ZPD-matched problems</span>
      </div>

      {suggestions.length === 0 ? (
        <div className="glass rounded-xl p-6 text-center text-sm text-muted-foreground">
          No suggestions yet — log a few problems first to build your pattern profile.
        </div>
      ) : (
        <div className="space-y-2">
          {suggestions.map((s, i) => (
            <motion.a
              key={s.slug}
              href={s.url}
              target="_blank"
              rel="noreferrer"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.07, duration: 0.3 }}
              className="glass rounded-xl p-4 flex items-center gap-3 group hover:border-primary/30 hover:bg-primary/5 transition-colors block"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  <span className="text-sm font-medium text-foreground group-hover:text-primary transition-colors truncate">
                    {s.title}
                  </span>
                  <Badge
                    className={`capitalize text-[10px] px-1.5 py-0 h-4 border shrink-0 ${difficultyStyle(s.difficulty)}`}
                  >
                    {s.difficulty}
                  </Badge>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] text-muted-foreground">focus:</span>
                  <Badge className="text-[10px] bg-primary/15 text-primary border-primary/25 border px-1.5 py-0 h-4">
                    {s.target_pattern.replace(/_/g, " ")}
                  </Badge>
                </div>
              </div>
              <div className="shrink-0 flex items-center gap-1.5 text-muted-foreground group-hover:text-primary transition-colors">
                <span className="text-xs hidden sm:block">Open</span>
                <ExternalLink className="w-3.5 h-3.5" />
                <ArrowRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </motion.a>
          ))}
        </div>
      )}
    </div>
  );
}
