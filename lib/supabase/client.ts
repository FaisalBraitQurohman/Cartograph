"use client";

import { useMemo } from "react";
import { createClient } from "@supabase/supabase-js";
import { useSession } from "@clerk/nextjs";
import { publicEnv } from "@/lib/env";

/**
 * Browser Supabase client, carrying the Clerk session token the same way the
 * server one does.
 *
 * A hook rather than a module singleton: the token comes from the Clerk
 * session, so the client has to be built inside a component that can read it.
 */
export function useSupabaseClient() {
  const { session } = useSession();

  return useMemo(
    () =>
      createClient(
        publicEnv.supabaseUrl,
        publicEnv.supabasePublishableKey,
        {
          async accessToken() {
            return session?.getToken() ?? null;
          },
        },
      ),
    [session],
  );
}
