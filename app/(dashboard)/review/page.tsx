import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import ReviewClient from "@/components/app/ReviewClient";

export const metadata = { title: "Daily Review — MasteryOS" };

export default async function ReviewPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: dueCards } = await supabase
    .from("srs_cards")
    .select("*")
    .eq("user_id", user.id)
    .lte("due", new Date().toISOString())
    .order("due", { ascending: true })
    .limit(50);

  return <ReviewClient cards={dueCards ?? []} userId={user.id} />;
}
