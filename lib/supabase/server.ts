import { createClient } from "@supabase/supabase-js";
import { auth } from "@clerk/nextjs/server";
import { publicEnv } from "@/lib/env";
import type { Database } from "@/types/database";

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
 *
 * Typed against the generated schema so a query cannot name a column or a
 * relationship that does not exist. The types in `types/database.ts` are
 * generated from the linked project and committed, so the build does not depend
 * on a live database.
 */
export function createServerSupabaseClient() {
  return createClient<Database>(
    publicEnv.supabaseUrl,
    publicEnv.supabasePublishableKey,
    {
      async accessToken() {
        return (await auth()).getToken();
      },
    },
  );
}

