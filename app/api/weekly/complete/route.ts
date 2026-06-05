import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getWeekStartISO, parseSettings } from "@/lib/accountability";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const body = await request.json();
  const { concept_ratings, weak_area_focus, daily_goal_minutes, weekly_goal_minutes } = body;

  const { data: profile } = await supabase
    .from("users")
    .select("settings")
    .eq("id", user.id)
    .single();

  const settings = parseSettings(profile?.settings);

  if (concept_ratings && typeof concept_ratings === "object") {
    settings.concept_ratings = {
      ...(settings.concept_ratings ?? {}),
      ...concept_ratings,
    };

    for (const [conceptId, rating] of Object.entries(concept_ratings)) {
      const numRating = Number(rating);
      if (numRating >= 1 && numRating <= 5) {
        await supabase
          .from("aiml_concepts")
          .update({ mastery_score: numRating / 5 })
          .eq("id", conceptId)
          .eq("user_id", user.id);
      }
    }
  }

  if (weak_area_focus) {
    settings.weak_area_focus = weak_area_focus;
  }

  if (weekly_goal_minutes) {
    settings.weekly_goal_minutes = weekly_goal_minutes;
    settings.week_start_date = getWeekStartISO().split("T")[0];
  }

  const userUpdates: Record<string, unknown> = { settings };
  if (daily_goal_minutes && daily_goal_minutes >= 15 && daily_goal_minutes <= 480) {
    userUpdates.daily_goal_minutes = daily_goal_minutes;
  }

  const { error } = await supabase.from("users").update(userUpdates).eq("id", user.id);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}
