"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import Link from "next/link";
import {
  ArrowLeft,
  Building2,
  Clock,
  Sparkles,
  Loader2,
  ExternalLink,
  CheckSquare,
  ChevronDown,
  Search,
  BookCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

type SessionProblem = {
  slug: string;
  title: string;
  difficulty: string;
  url: string;
  patterns: string[];
  rationale: string;
  already_logged: boolean;
};

type SessionResult = {
  company: string;
  session: SessionProblem[];
  totalEstimatedMinutes: number;
};

type CompaniesResponse = {
  data: { companies: string[] } | null;
  error: string | null;
};

type SessionResponse = {
  data: SessionResult | null;
  error: string | null;
};

function difficultyColor(diff: string) {
  if (diff === "easy") return "text-emerald-400 bg-emerald-500/15 border-emerald-500/25";
  if (diff === "medium") return "text-amber-400 bg-amber-500/15 border-amber-500/25";
  return "text-red-400 bg-red-500/15 border-red-500/25";
}

const DIFFICULTY_MINUTES: Record<string, number> = { easy: 20, medium: 35, hard: 50 };

export default function CompanyPracticePage() {
  const [company, setCompany] = useState("");
  const [timeBudget, setTimeBudget] = useState(60);
  const [companySearch, setCompanySearch] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const { data: companiesData, isLoading: companiesLoading } =
    useQuery<CompaniesResponse>({
      queryKey: ["dsa-companies"],
      queryFn: () =>
        fetch("/api/dsa/company-session").then((r) => r.json()) as Promise<CompaniesResponse>,
      staleTime: 5 * 60 * 1000,
    });

  const companies = companiesData?.data?.companies ?? [];

  const filtered = useMemo(
    () =>
      companySearch.trim()
        ? companies.filter((c) =>
            c.toLowerCase().includes(companySearch.toLowerCase()),
          )
        : companies,
    [companies, companySearch],
  );

  const mutation = useMutation<SessionResponse, Error, { company: string; timeBudgetMinutes: number }>({
    mutationFn: (vars) =>
      fetch("/api/dsa/company-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vars),
      }).then((r) => r.json()) as Promise<SessionResponse>,
    onError: (err) => toast.error(err.message ?? "Failed to build session"),
    onSuccess: (res) => {
      if (res.error) toast.error(res.error);
    },
  });

  const session = mutation.data?.data ?? null;

  const handleBuild = () => {
    if (!company) {
      toast.error("Please select a company first");
      return;
    }
    setChecked(new Set());
    mutation.mutate({ company, timeBudgetMinutes: timeBudget });
  };

  const toggleCheck = (slug: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/dsa">
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Building2 className="w-5 h-5 text-violet-400" /> Company Practice
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Targeted session built from your weakest patterns + company focus areas
          </p>
        </div>
      </div>

      {/* Session builder form */}
      <div className="glass rounded-xl p-5 space-y-4">
        {/* Company picker */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Company
          </label>
          <div className="relative">
            <button
              type="button"
              onClick={() => setPickerOpen((v) => !v)}
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground hover:border-primary/50 transition-colors"
            >
              <span className={company ? "text-foreground" : "text-muted-foreground"}>
                {company || "Select a company…"}
              </span>
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            </button>

            {pickerOpen && (
              <div className="absolute z-20 mt-1 w-full rounded-lg border border-border bg-[#111827] shadow-xl">
                <div className="p-2 border-b border-border">
                  <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-background">
                    <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <input
                      autoFocus
                      placeholder="Search…"
                      value={companySearch}
                      onChange={(e) => setCompanySearch(e.target.value)}
                      className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
                    />
                  </div>
                </div>
                <div className="max-h-56 overflow-y-auto py-1">
                  {companiesLoading && (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                    </div>
                  )}
                  {!companiesLoading && filtered.length === 0 && (
                    <p className="text-xs text-muted-foreground px-3 py-2">No matches</p>
                  )}
                  {filtered.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => {
                        setCompany(c);
                        setPickerOpen(false);
                        setCompanySearch("");
                      }}
                      className={`w-full text-left text-sm px-3 py-2 hover:bg-primary/10 transition-colors ${
                        c === company ? "text-primary font-medium" : "text-foreground"
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Time budget */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" /> Time budget (minutes)
          </label>
          <Input
            type="number"
            min={5}
            max={480}
            value={timeBudget}
            onChange={(e) => setTimeBudget(Number(e.target.value))}
            className="w-32"
          />
        </div>

        <Button
          onClick={handleBuild}
          disabled={mutation.isPending || !company}
          className="bg-violet-600 hover:bg-violet-700 text-white w-full sm:w-auto"
        >
          {mutation.isPending ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Building…
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4 mr-2" /> Build my session
            </>
          )}
        </Button>
      </div>

      {/* Session results */}
      {session && (
        <div className="space-y-3">
          {/* Session header */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-foreground">
                {session.company} Session
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {session.session.length} problem{session.session.length !== 1 ? "s" : ""} ·{" "}
                ~{session.totalEstimatedMinutes} min estimated ·{" "}
                {checked.size}/{session.session.length} done
              </p>
            </div>
            {session.session.length > 0 && (
              <div className="flex items-center gap-2">
                <div className="text-xs text-muted-foreground">
                  {Math.round((checked.size / session.session.length) * 100)}% complete
                </div>
                <div className="w-24 h-1.5 rounded-full bg-border overflow-hidden">
                  <div
                    className="h-full bg-violet-500 transition-all"
                    style={{
                      width: `${Math.round((checked.size / session.session.length) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {session.session.length === 0 ? (
            <div className="glass rounded-xl p-8 text-center">
              <Building2 className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">
                No unsolved {session.company} problems found in the bank for your current skill
                level.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {session.session.map((prob, idx) => (
                <div
                  key={prob.slug}
                  className={`glass rounded-xl p-4 border transition-all ${
                    checked.has(prob.slug)
                      ? "border-emerald-500/30 opacity-60"
                      : "border-transparent hover:border-primary/20"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {/* Checkbox */}
                    <button
                      type="button"
                      onClick={() => toggleCheck(prob.slug)}
                      className={`mt-0.5 shrink-0 transition-colors ${
                        checked.has(prob.slug)
                          ? "text-emerald-400"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <CheckSquare className="w-4 h-4" />
                    </button>

                    {/* Step number */}
                    <span className="shrink-0 mt-0.5 text-xs font-bold text-muted-foreground w-4">
                      {idx + 1}.
                    </span>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <a
                          href={prob.url}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium text-foreground hover:text-primary transition-colors flex items-center gap-1"
                        >
                          {prob.title}
                          <ExternalLink className="w-3 h-3 opacity-60 shrink-0" />
                        </a>
                        <Badge
                          className={`capitalize text-[10px] px-1.5 py-0 border ${difficultyColor(prob.difficulty)}`}
                        >
                          {prob.difficulty}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          ~{DIFFICULTY_MINUTES[prob.difficulty] ?? 35}m
                        </span>
                        {prob.already_logged && (
                          <span className="flex items-center gap-0.5 text-[10px] text-emerald-400 font-medium">
                            <BookCheck className="w-3 h-3" /> Logged
                          </span>
                        )}
                      </div>

                      {prob.rationale && (
                        <p className="text-xs text-muted-foreground mt-1 italic leading-snug">
                          {prob.rationale}
                        </p>
                      )}

                      <div className="flex flex-wrap gap-1 mt-2">
                        {prob.patterns.map((pat) => (
                          <Badge
                            key={pat}
                            variant="outline"
                            className="text-[10px] border-border/40 text-muted-foreground py-0 px-1.5"
                          >
                            {pat}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    {/* Log attempt link */}
                    <Link
                      href={`/dsa/log?url=${encodeURIComponent(prob.url)}`}
                      className={`shrink-0 text-[10px] whitespace-nowrap mt-1 transition-colors ${
                        prob.already_logged
                          ? "text-muted-foreground hover:text-foreground"
                          : "text-primary hover:text-primary/80"
                      }`}
                    >
                      {prob.already_logged ? "Log again →" : "Log attempt →"}
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
