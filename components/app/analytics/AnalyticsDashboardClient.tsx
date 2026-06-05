"use client";

import { BarChart3, Brain, Target, Zap, Clock, Code2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import type {
  AnalyticsKPIs,
  CalibrationPoint,
  ConceptRetention,
  DailyActivity,
  ForecastDay,
  GraphLink,
  GraphNode,
  PacePrediction,
  PatternStat,
  TimelinePoint,
} from "@/lib/analytics";
import RetentionHeatmap from "./RetentionHeatmap";
import ProgressTimeline from "./ProgressTimeline";
import PatternBreakdown from "./PatternBreakdown";
import KnowledgeGraph from "./KnowledgeGraph";
import CalibrationChart from "./CalibrationChart";
import StudyCalendar from "./StudyCalendar";
import ReviewForecast from "./ReviewForecast";
import PacePredictor from "./PacePredictor";

export interface AnalyticsDashboardData {
  kpis: AnalyticsKPIs;
  retentionGrid: ConceptRetention[];
  timeline: TimelinePoint[];
  patternBreakdown: PatternStat[];
  graph: { nodes: GraphNode[]; links: GraphLink[] };
  calibration: CalibrationPoint[];
  studyActivity: { calendar: DailyActivity[]; dailyMinutes: DailyActivity[] };
  forecast: ForecastDay[];
  pace: PacePrediction;
}

interface AnalyticsDashboardClientProps {
  data: AnalyticsDashboardData;
}

function ChartCard({
  title,
  description,
  children,
  className = "",
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`glass rounded-2xl p-6 ${className}`}>
      <h2 className="text-sm font-semibold text-foreground mb-1">{title}</h2>
      {description && (
        <p className="text-xs text-muted-foreground mb-4">{description}</p>
      )}
      {!description && <div className="mb-4" />}
      {children}
    </div>
  );
}

export default function AnalyticsDashboardClient({ data }: AnalyticsDashboardClientProps) {
  const { kpis } = data;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center border border-primary/30 glow-violet">
          <BarChart3 className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Analytics</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Data-driven insights into your learning progress
          </p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="glass rounded-xl p-5">
          <div className="flex items-center gap-2 text-primary mb-2">
            <Zap className="w-4 h-4" />
            <span className="text-xs font-semibold uppercase tracking-wider">Current Streak</span>
          </div>
          <p className="text-3xl font-bold text-foreground">{kpis.streak}</p>
          <p className="text-xs text-muted-foreground mt-1">Days in a row</p>
        </div>

        <div className="glass rounded-xl p-5">
          <div className="flex items-center gap-2 text-violet-400 mb-2">
            <Brain className="w-4 h-4" />
            <span className="text-xs font-semibold uppercase tracking-wider">Memory State</span>
          </div>
          <p className="text-3xl font-bold text-foreground">{kpis.reviewCards}</p>
          <p className="text-xs text-muted-foreground mt-1">Cards in mature review</p>
        </div>

        <div className="glass rounded-xl p-5">
          <div className="flex items-center gap-2 text-emerald-400 mb-2">
            <Clock className="w-4 h-4" />
            <span className="text-xs font-semibold uppercase tracking-wider">Time Invested</span>
          </div>
          <p className="text-3xl font-bold text-foreground">{kpis.timeSpentMins}</p>
          <p className="text-xs text-muted-foreground mt-1">Minutes active reviewing</p>
        </div>

        <div className="glass rounded-xl p-5">
          <div className="flex items-center gap-2 text-amber-400 mb-2">
            <Target className="w-4 h-4" />
            <span className="text-xs font-semibold uppercase tracking-wider">Total Reps</span>
          </div>
          <p className="text-3xl font-bold text-foreground">{kpis.totalReviews}</p>
          <p className="text-xs text-muted-foreground mt-1">Flashcard reviews</p>
        </div>
      </div>

      {/* Memory + Domain summary */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="glass rounded-2xl p-6">
          <h2 className="text-sm font-semibold text-foreground mb-4">Memory Distribution</h2>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-muted-foreground">Learning (New)</span>
                <span className="font-medium">{kpis.learningCards}</span>
              </div>
              <Progress
                value={kpis.totalCards > 0 ? (kpis.learningCards / kpis.totalCards) * 100 : 0}
                className="h-2 bg-secondary"
              />
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-muted-foreground">Review (Mature)</span>
                <span className="font-medium text-primary">{kpis.reviewCards}</span>
              </div>
              <Progress
                value={kpis.totalCards > 0 ? (kpis.reviewCards / kpis.totalCards) * 100 : 0}
                className="h-2 bg-primary/20"
              />
            </div>
          </div>
          <div className="mt-6 p-4 rounded-xl bg-secondary/30 border border-border/60">
            <p className="text-xs text-muted-foreground">
              Average memory stability is{" "}
              <span className="font-semibold text-foreground">
                {kpis.avgStability.toFixed(1)} days
              </span>
              .
            </p>
          </div>
        </div>

        <div className="glass rounded-2xl p-6">
          <h2 className="text-sm font-semibold text-foreground mb-4">Domain Mastery</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col items-center justify-center p-4 rounded-xl border border-border/40 bg-secondary/20">
              <Brain className="w-8 h-8 text-violet-400 mb-3" />
              <p className="text-2xl font-bold text-foreground">
                {Math.round(kpis.avgMastery * 100)}%
              </p>
              <p className="text-xs text-muted-foreground mt-1">AIML Mastery</p>
              <p className="text-[10px] text-muted-foreground mt-1">
                {kpis.totalConcepts} concepts
              </p>
            </div>
            <div className="flex flex-col items-center justify-center p-4 rounded-xl border border-border/40 bg-secondary/20">
              <Code2 className="w-8 h-8 text-emerald-400 mb-3" />
              <p className="text-2xl font-bold text-foreground">
                {kpis.avgDSAConf.toFixed(1)}
                <span className="text-sm text-muted-foreground">/5</span>
              </p>
              <p className="text-xs text-muted-foreground mt-1">DSA Confidence</p>
              <p className="text-[10px] text-muted-foreground mt-1">
                {kpis.totalDSA} problems
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Progress Timeline — full width */}
      <ChartCard
        title="Progress Timeline"
        description="8-month view: AIML mastery, DSA patterns, retention vs target"
        className="mb-8"
      >
        <ProgressTimeline data={data.timeline} />
      </ChartCard>

      {/* Forecast + Pace */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <ChartCard title="7-Day Review Forecast" description="Cards due each day">
          <ReviewForecast data={data.forecast} />
        </ChartCard>
        <ChartCard title="DSA Pace" className="flex flex-col justify-center">
          <PacePredictor data={data.pace} />
        </ChartCard>
      </div>

      {/* Heatmap + Study Calendar */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <ChartCard
          title="Retention Heatmap"
          description="FSRS retrievability per AIML concept"
        >
          <RetentionHeatmap data={data.retentionGrid} />
        </ChartCard>
        <ChartCard title="Study Activity" description="Review calendar and daily time">
          <StudyCalendar
            calendar={data.studyActivity.calendar}
            dailyMinutes={data.studyActivity.dailyMinutes}
          />
        </ChartCard>
      </div>

      {/* Pattern Breakdown + Calibration */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <ChartCard title="Pattern Mastery Breakdown" description="All 25 DSA patterns">
          <PatternBreakdown data={data.patternBreakdown} />
        </ChartCard>
        <ChartCard
          title="Calibration Chart"
          description="Predicted confidence vs actual recall success"
        >
          <CalibrationChart data={data.calibration} />
        </ChartCard>
      </div>

      {/* Knowledge Graph — full width */}
      <ChartCard
        title="AIML Knowledge Graph"
        description="Concept dependencies colored by mastery"
      >
        <KnowledgeGraph nodes={data.graph.nodes} links={data.graph.links} />
      </ChartCard>
    </div>
  );
}
