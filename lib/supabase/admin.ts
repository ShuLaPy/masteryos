import { createClient } from "@supabase/supabase-js";

// Admin client — only use in server-side contexts (API routes, Edge Functions)
// NEVER expose this to the browser
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
