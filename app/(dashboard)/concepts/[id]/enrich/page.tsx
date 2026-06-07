"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, BookOpen } from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { ConceptEnrichForm } from "@/components/app/ConceptEnrichModal";

export default function ConceptEnrichPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const conceptId = params.id;

  const [conceptTitle, setConceptTitle] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("aiml_concepts")
      .select("title")
      .eq("id", conceptId)
      .single()
      .then(({ data, error }) => {
        if (error || !data) {
          setNotFound(true);
        } else {
          setConceptTitle(data.title);
        }
      });
  }, [conceptId]);

  if (notFound) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <p className="text-muted-foreground text-sm">Concept not found.</p>
        <Link
          href="/schedule/prep"
          className="mt-4 inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
        >
          <ArrowLeft className="w-4 h-4" /> Back to prep
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <Link
          href="/schedule/prep"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="w-4 h-4" /> Back to prep
        </Link>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <BookOpen className="w-6 h-6 text-primary" /> Add Notes
        </h1>
        {conceptTitle && (
          <p className="text-muted-foreground text-sm mt-1">{conceptTitle}</p>
        )}
      </div>

      {/* Form card */}
      <div className="glass rounded-2xl p-6 border-border/60">
        {conceptTitle === null ? (
          <div className="space-y-3 animate-pulse">
            <div className="h-4 bg-secondary rounded w-3/4" />
            <div className="h-40 bg-secondary rounded" />
            <div className="h-10 bg-secondary rounded" />
          </div>
        ) : (
          <ConceptEnrichForm
            conceptId={conceptId}
            conceptTitle={conceptTitle}
            onDone={() => router.push("/schedule/prep")}
          />
        )}
      </div>
    </div>
  );
}
