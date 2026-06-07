import { redirect } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import { CalendarClock, GraduationCap, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { dbCardToFSRS, getRetrievability } from "@/lib/fsrs";
import { PreClassPrepCard } from "@/components/app/PreClassPrepCard";

export const metadata = { title: "Pre-Class Prep — MasteryOS" };

const DEFAULT_WEAKNESS_THRESHOLD = 0.85; // spec §3 / AGENTS.md

/** Validate an IANA timezone via Intl; fall back to UTC (spec §9.4 / AGENTS.md). */
function resolveTimeZone(tz: unknown): string {
  if (typeof tz === "string" && tz.length > 0) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return tz;
    } catch {
      // fall through to UTC
    }
  }
  return "UTC";
}

/** Clamp the weakness threshold to (0, 1]; else fall back to default (spec §3). */
function resolveThreshold(value: unknown): number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= 1
    ? value
    : DEFAULT_WEAKNESS_THRESHOLD;
}

/** Minimal card shape needed to derive retrievability via FSRS. */
type Card = {
  source_id: string;
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  state: string;
  last_review: string | null;
};

export default async function PreClassPrepPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // ── Resolve "today" in the user's timezone (spec §9.4) ──────────────────────
  const { data: profile } = await supabase
    .from("users")
    .select("settings")
    .eq("id", user.id)
    .single();

  const settings = (profile?.settings ?? {}) as {
    timezone?: unknown;
    weakness_threshold?: unknown;
  };
  const timeZone = resolveTimeZone(settings.timezone);
  const weaknessThreshold = resolveThreshold(settings.weakness_threshold);
  const today = formatInTimeZone(new Date(), timeZone, "yyyy-MM-dd");

  // ── Next_Lecture: earliest un-attended lecture on/after today ───────────────
  // (tie → lowest week_number; same ordering key as the DB index / planning engine)
  const { data: schedules } = await supabase
    .from("lecture_schedules")
    .select("id, title, scheduled_date, week_number, prerequisite_concept_ids, is_attended")
    .eq("user_id", user.id)
    .gte("scheduled_date", today)
    .eq("is_attended", false)
    .order("scheduled_date", { ascending: true })
    .order("week_number", { ascending: true })
    .limit(1);

  const nextLecture = schedules?.[0] ?? null;

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <Header />
      {!nextLecture ? (
        <EmptyState message="No upcoming lecture scheduled." />
      ) : (
        <PrepBody
          supabase={supabase}
          userId={user.id}
          lecture={nextLecture}
          weaknessThreshold={weaknessThreshold}
        />
      )}
    </div>
  );
}

function Header() {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
        <GraduationCap className="w-6 h-6 text-primary" /> Pre-Class Prep
      </h1>
      <p className="text-muted-foreground text-sm mt-1">
        Refresh the prerequisites your next lecture depends on, weakest first.
      </p>
    </div>
  );
}

async function PrepBody({
  supabase,
  userId,
  lecture,
  weaknessThreshold,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  lecture: {
    id: string;
    title: string;
    scheduled_date: string;
    week_number: number;
    prerequisite_concept_ids: string[] | null;
  };
  weaknessThreshold: number;
}) {
  const prereqIds = lecture.prerequisite_concept_ids ?? [];

  // Load prerequisite concepts (titles) + their cards in parallel.
  const [conceptsRes, cardsRes] = await Promise.all([
    prereqIds.length > 0
      ? supabase
          .from("aiml_concepts")
          .select("id, title")
          .eq("user_id", userId)
          .in("id", prereqIds)
      : Promise.resolve({ data: [] as { id: string; title: string }[] }),
    prereqIds.length > 0
      ? supabase
          .from("srs_cards")
          .select(
            "source_id, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review"
          )
          .eq("user_id", userId)
          .eq("source_type", "aiml_concept")
          .in("source_id", prereqIds)
      : Promise.resolve({ data: [] as Card[] }),
  ]);

  const concepts = (conceptsRes.data ?? []) as { id: string; title: string }[];
  const cards = (cardsRes.data ?? []) as Card[];

  // Index cards by their source concept.
  const cardsByConcept = new Map<string, Card[]>();
  for (const card of cards) {
    const list = cardsByConcept.get(card.source_id);
    if (list) list.push(card);
    else cardsByConcept.set(card.source_id, [card]);
  }

  // Classify each prereq: weak / unstudied / strong.
  type Weak = { id: string; title: string; retrievability: number };
  const weak: Weak[] = [];
  const unstudied: { id: string; title: string }[] = [];

  for (const concept of concepts) {
    const conceptCards = cardsByConcept.get(concept.id) ?? [];
    if (conceptCards.length === 0) {
      unstudied.push({ id: concept.id, title: concept.title });
      continue;
    }
    // New cards (stability=0) have never been reviewed — treat as retrievability 0,
    // not 1.0 (which getRetrievability returns for scheduling purposes).
    const allNew = conceptCards.every((c) => c.stability === 0);
    if (allNew) {
      unstudied.push({ id: concept.id, title: concept.title });
      continue;
    }
    const minRetrievability = Math.min(
      ...conceptCards.map((c) => {
        const fsrsCard = dbCardToFSRS(c);
        return fsrsCard.stability === 0 ? 0 : getRetrievability(fsrsCard);
      })
    );
    if (minRetrievability < weaknessThreshold) {
      weak.push({ id: concept.id, title: concept.title, retrievability: minRetrievability });
    }
    // else: strong → not surfaced individually
  }

  // Weak prereqs sorted by retrievability ascending (weakest first).
  weak.sort((a, b) => a.retrievability - b.retrievability);

  const lectureDate = formatInTimeZone(
    new Date(`${lecture.scheduled_date}T00:00:00Z`),
    "UTC",
    "EEEE, MMMM d, yyyy"
  );

  const nothingToReview = weak.length === 0 && unstudied.length === 0;

  return (
    <>
      {/* Next lecture header */}
      <div className="glass rounded-2xl p-5 mb-6 border-primary/20">
        <div className="flex items-center gap-2 text-xs text-primary font-medium mb-1">
          <CalendarClock className="w-4 h-4" /> Next lecture · Week {lecture.week_number}
        </div>
        <h2 className="text-xl font-semibold text-foreground">{lecture.title}</h2>
        <p className="text-sm text-muted-foreground mt-1">{lectureDate}</p>
      </div>

      {nothingToReview ? (
        <div className="glass rounded-2xl p-8 text-center border-emerald-500/20">
          <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-4">
            <ShieldCheck className="w-7 h-7 text-emerald-400" />
          </div>
          <p className="text-foreground font-medium">
            Every prerequisite is ready. No pre-class review needed.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {weak.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-foreground mb-3">
                Weak prerequisites{" "}
                <span className="text-muted-foreground font-normal">
                  ({weak.length})
                </span>
              </h3>
              <div className="space-y-2">
                {weak.map((c) => (
                  <PreClassPrepCard
                    key={c.id}
                    title={c.title}
                    status="weak"
                    retrievability={c.retrievability}
                  />
                ))}
              </div>
            </section>
          )}

          {unstudied.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-foreground mb-3">
                Not yet studied{" "}
                <span className="text-muted-foreground font-normal">
                  ({unstudied.length})
                </span>
              </h3>
              <div className="space-y-2">
                {unstudied.map((c) => (
                  <PreClassPrepCard key={c.id} title={c.title} status="unstudied" />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="glass rounded-2xl p-8 text-center border-border/60">
      <div className="w-14 h-14 rounded-2xl bg-secondary flex items-center justify-center mx-auto mb-4">
        <CalendarClock className="w-7 h-7 text-muted-foreground" />
      </div>
      <p className="text-muted-foreground">{message}</p>
    </div>
  );
}
