"use client";

import { useState, useCallback, useRef } from "react";
import Link from "next/link";
import { Search, Brain, Code2, Loader2, X, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { motion, AnimatePresence } from "framer-motion";

interface SearchResult {
  source_type: "aiml_concept" | "dsa_problem";
  source_id: string;
  similarity: number;
  title: string;
  subtitle: string;
}

export function SemanticSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const search = useCallback(async (searchQuery: string) => {
    if (searchQuery.trim().length < 3) {
      setResults([]);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: searchQuery, limit: 8 }),
      });
      const data = await res.json();
      if (data.results) {
        setResults(data.results);
      }
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleChange = (value: string) => {
    setQuery(value);
    setOpen(true);

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      search(value);
    }, 400);
  };

  const handleClear = () => {
    setQuery("");
    setResults([]);
    setOpen(false);
  };

  return (
    <div className="relative w-full max-w-md">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Semantic search concepts & problems..."
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => query.length >= 3 && setOpen(true)}
          className="pl-9 pr-9 bg-secondary/50 border-border/60 focus:border-primary/50"
        />
        {query && (
          <button
            onClick={handleClear}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <AnimatePresence>
        {open && (query.length >= 3 || results.length > 0) && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="absolute top-full mt-2 left-0 right-0 z-50 glass rounded-xl border border-border/60 shadow-2xl overflow-hidden"
          >
            {loading ? (
              <div className="flex items-center justify-center py-6 gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                <span className="text-sm text-muted-foreground">Searching semantically...</span>
              </div>
            ) : results.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-6 gap-2">
                <Sparkles className="w-5 h-5 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  {query.length >= 3 ? "No results found" : "Type at least 3 characters"}
                </p>
              </div>
            ) : (
              <div className="max-h-80 overflow-y-auto">
                <div className="px-3 py-2 border-b border-border/60">
                  <p className="text-xs text-muted-foreground font-medium">
                    {results.length} result{results.length !== 1 ? "s" : ""} found
                  </p>
                </div>
                {results.map((result) => (
                  <Link
                    key={`${result.source_type}-${result.source_id}`}
                    href={result.source_type === "aiml_concept" ? `/aiml/${result.source_id}` : `/dsa`}
                    onClick={() => setOpen(false)}
                    className="flex items-start gap-3 px-3 py-3 hover:bg-secondary/60 transition-colors border-b border-border/30 last:border-b-0"
                  >
                    {result.source_type === "aiml_concept" ? (
                      <Brain className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                    ) : (
                      <Code2 className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {result.title}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {result.subtitle}
                      </p>
                    </div>
                    <Badge variant="outline" className="text-[10px] shrink-0 text-blue-400 border-blue-500/30">
                      {Math.round(result.similarity * 100)}%
                    </Badge>
                  </Link>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
