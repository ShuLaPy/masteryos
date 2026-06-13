"use client";

import { useState } from "react";
import { Sparkles, Loader2, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface ExternalPromptResponse {
  data: { prompt: string; slotsMeta: unknown[] } | { empty: true } | null;
  error: string | null;
}

export default function ExternalInterviewPrompt() {
  const [prompt, setPrompt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  async function generatePrompt() {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch("/api/interview/external-prompt");
      const json = (await res.json()) as ExternalPromptResponse;

      if (!res.ok) {
        toast.error("Failed to generate prompt. Please try again.");
        return;
      }
      if (json.error) {
        toast.error(json.error);
        return;
      }
      if (json.data && "empty" in json.data && json.data.empty) {
        toast.info(
          "Add or study a few AIML concepts first — then your prompt will have material."
        );
        return;
      }
      if (json.data && "prompt" in json.data) {
        setPrompt(json.data.prompt);
      }
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function copyPrompt() {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      toast.success("Prompt copied — paste it into your LLM");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy to clipboard");
    }
  }

  return (
    <div className="glass rounded-2xl p-6">
      <div className="flex items-start gap-3 mb-4">
        <Sparkles className="w-5 h-5 text-primary shrink-0 mt-0.5" />
        <div>
          <h2 className="text-base font-semibold text-foreground">
            Practice with an external AI
          </h2>
          <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
            Generate a self-contained prompt you can paste into Perplexity, Claude, or Gemini
            to run this same mock interview anywhere.
          </p>
        </div>
      </div>

      <Button
        onClick={generatePrompt}
        disabled={loading}
        className="w-full bg-primary hover:bg-primary/90 text-white glow-violet"
      >
        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin mr-2" />
        ) : (
          <Sparkles className="w-4 h-4 mr-2" />
        )}
        Generate interview prompt
      </Button>

      {prompt && (
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-muted-foreground">
              Copy the prompt below and paste it into any LLM to begin.
            </p>
            <Button
              onClick={copyPrompt}
              size="sm"
              variant="outline"
              className="shrink-0 border-border/60 text-xs gap-1.5"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  Copy
                </>
              )}
            </Button>
          </div>
          <pre className="whitespace-pre-wrap font-mono text-xs text-muted-foreground bg-secondary/50 border border-border/60 rounded-xl p-4 max-h-80 overflow-y-auto leading-relaxed">
            {prompt}
          </pre>
        </div>
      )}
    </div>
  );
}
