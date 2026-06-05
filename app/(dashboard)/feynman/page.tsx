import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import FeynmanClient from "@/components/app/FeynmanClient";

export const metadata = { title: "Feynman 2.0 — MasteryOS" };

export default async function FeynmanPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Fetch all user concepts
  const { data: concepts } = await supabase
    .from("aiml_concepts")
    .select("id, title, notes, mastery_score")
    .eq("user_id", user.id)
    .order("mastery_score", { ascending: true }); // Weakest first

  return <FeynmanClient concepts={concepts ?? []} userId={user.id} />;
}
