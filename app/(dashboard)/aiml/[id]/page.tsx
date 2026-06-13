import { createClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Sparkles, Clock } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { RelatedConcepts } from "@/components/app/RelatedConcepts";
import { PrerequisitesEditor } from "@/components/app/PrerequisitesEditor";
import { ConceptNotesCard } from "@/components/app/ConceptNotesCard";
import { DerivationDrillCard } from "@/components/app/DerivationDrillCard";

export const metadata = { title: "Concept Details — MasteryOS" };

export default async function AIMLConceptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) redirect("/login");

  const { data: concept } = await supabase
    .from("aiml_concepts")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!concept) {
    notFound();
  }

  const { data: cards } = await supabase
    .from("srs_cards")
    .select("front, back, state, due")
    .eq("source_id", concept.id)
    .eq("user_id", user.id);

  const conceptCards = cards ?? [];

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <div>
        <Link href="/aiml" className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground mb-4 transition-colors">
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to AIML Track
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Badge variant="outline" className="text-primary border-primary/30 bg-primary/10">
                Week {concept.week_number}
              </Badge>
              {concept.concept_type && (
                <Badge variant="outline" className="text-muted-foreground capitalize">
                  {concept.concept_type}
                </Badge>
              )}
            </div>
            <h1 className="text-3xl font-bold text-foreground mb-2">{concept.title}</h1>
            <div className="flex items-center gap-2">
              {(concept.tags ?? []).map((tag: string) => (
                <Badge key={tag} variant="secondary" className="text-xs">
                  {tag}
                </Badge>
              ))}
            </div>
          </div>
          
          <div className="text-right glass p-4 rounded-xl">
            <p className="text-sm font-medium text-muted-foreground mb-1">Mastery Score</p>
            <p className={`text-3xl font-bold ${concept.mastery_score >= 0.8 ? 'text-emerald-400' : concept.mastery_score >= 0.5 ? 'text-amber-400' : 'text-orange-400'}`}>
              {Math.round((concept.mastery_score ?? 0) * 100)}%
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-2 space-y-6">
          <ConceptNotesCard
            conceptId={concept.id}
            initialNotes={concept.notes}
            initialCardStatus={concept.card_status}
            initialCardCount={conceptCards.length}
          />
        </div>

        <div className="space-y-6">
          <div className="glass rounded-2xl p-6 border-emerald-500/20">
            <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-emerald-400" /> Generated Flashcards
            </h2>
            <div className="space-y-4">
              {conceptCards.length === 0 ? (
                <p className="text-sm text-muted-foreground">No cards generated yet.</p>
              ) : (
                conceptCards.map((card, i) => (
                  <div key={i} className="bg-secondary/50 rounded-xl p-4 border border-border/60">
                    <p className="text-sm font-medium text-foreground mb-2">{card.front}</p>
                    <p className="text-xs text-muted-foreground mb-3">{card.back}</p>
                    <div className="flex items-center justify-between text-[10px] uppercase font-bold tracking-wider">
                      <span className={card.state === 'review' ? 'text-primary' : 'text-muted-foreground'}>{card.state}</span>
                      <span className="text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" /> 
                        {new Date(card.due).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <DerivationDrillCard
            conceptId={concept.id}
            initialDerivations={
              Array.isArray(concept.derivations)
                ? (concept.derivations as unknown as {
                    title: string;
                    card_id: string;
                    generated_at: string;
                  }[])
                : []
            }
            hasNotes={Boolean(concept.notes && concept.notes.trim().length > 0)}
          />

          <RelatedConcepts sourceId={concept.id} sourceType="aiml_concept" />

          <PrerequisitesEditor
            conceptId={concept.id}
            initialPrerequisites={concept.prerequisites ?? []}
          />
        </div>
      </div>
    </div>
  );
}
