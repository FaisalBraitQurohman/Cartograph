import { createClient } from "@supabase/supabase-js";
import { auth } from "@clerk/nextjs/server";
import { publicEnv } from "@/lib/env";

/**
 * Server-side Supabase client.
 *
 * The Clerk session token rides on every request, which is what lets a
 * row-level-security policy read the organization claim. A client built
 * anonymously looks identical until the first policy exists and then returns
 * nothing, so the token is wired in here rather than added later.
 *
 * No cookie handling and no session refresh — sessions belong to Clerk. This
 * client is stateless; the token is fetched per call.
 */
export function createServerSupabaseClient() {
  return createClient(
    publicEnv.supabaseUrl,
    publicEnv.supabasePublishableKey,
    {
      async accessToken() {
        return (await auth()).getToken();
      },
    },
  );
}
