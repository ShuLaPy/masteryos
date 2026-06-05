"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Network, Brain, Code2, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface RelatedItem {
  source_type: "aiml_concept" | "dsa_problem";
  source_id: string;
  similarity: number;
  title: string;
  subtitle: string;
  mastery_score?: number;
}

interface RelatedConceptsProps {
  sourceId: string;
  sourceType: "aiml_concept" | "dsa_problem";
}

export function RelatedConcepts({ sourceId, sourceType }: RelatedConceptsProps) {
  const [related, setRelated] = useState<RelatedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchRelated() {
      try {
        const res = await fetch(
          `/api/embeddings/related?source_id=${sourceId}&source_type=${sourceType}&limit=5`
        );
        const data = await res.json();
        if (data.related) {
          setRelated(data.related);
        } else if (data.error) {
          setError(data.error);
        }
      } catch {
        setError("Failed to load related items");
      } finally {
        setLoading(false);
      }
    }

    fetchRelated();
  }, [sourceId, sourceType]);

  if (loading) {
    return (
      <div className="glass rounded-2xl p-6 border-blue-500/20">
        <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
          <Network className="w-5 h-5 text-blue-400" /> Related Concepts
        </h2>
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (error || related.length === 0) {
    return (
      <div className="glass rounded-2xl p-6 border-blue-500/20">
        <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
          <Network className="w-5 h-5 text-blue-400" /> Related Concepts
        </h2>
        <p className="text-sm text-muted-foreground">
          {error ?? "No related items found yet. Embeddings are generated when you add concepts and problems."}
        </p>
      </div>
    );
  }

  return (
    <div className="glass rounded-2xl p-6 border-blue-500/20">
      <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
        <Network className="w-5 h-5 text-blue-400" /> Related Concepts
      </h2>
      <div className="space-y-3">
        {related.map((item) => (
          <Link
            key={`${item.source_type}-${item.source_id}`}
            href={item.source_type === "aiml_concept" ? `/aiml/${item.source_id}` : `/dsa`}
            className="block bg-secondary/50 rounded-xl p-3 border border-border/60 hover:border-blue-500/40 transition-colors group"
          >
            <div className="flex items-start gap-2">
              {item.source_type === "aiml_concept" ? (
                <Brain className="w-4 h-4 text-primary mt-0.5 shrink-0" />
              ) : (
                <Code2 className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate group-hover:text-blue-400 transition-colors">
                  {item.title}
                </p>
                {item.subtitle && (
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    {item.subtitle}
                  </p>
                )}
              </div>
              <Badge variant="outline" className="text-[10px] shrink-0 text-blue-400 border-blue-500/30">
                {Math.round(item.similarity * 100)}%
              </Badge>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
