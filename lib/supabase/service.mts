import { createClient } from "@supabase/supabase-js";
import { publicEnv, serverEnv } from "../env.ts";
import type { Database } from "@/types/database";

/**
 * The Supabase client for a process with no signed-in user behind it.
 *
 * Three clients, three jobs. `client.ts` is the browser, `server.ts` is a request
 * carrying a Clerk token, and this is the third case: a run from a terminal with no
 * session, no token, and therefore no organization for a policy to read. The
 * publishable key would be accepted by the server and then return nothing from every
 * table, because `current_organization_id()` is null and `organization_id = null`
 * matches no row.
 *
 * The secret key gets past that by bypassing row-level security entirely. That is
 * the whole reason it is here and the whole reason it is dangerous: nothing in the
 * database stops this client writing into an organization it was never asked about.
 * The caller owns `organizationId`, so a caller that reads it off a request body
 * turns the pipeline into a way to write rows into someone else's team.
 *
 * `.mts`, with a relative import into `env.ts`, unlike its two siblings, because
 * this one has to load in a plain `node` process. The `@` alias is a TypeScript
 * resolution feature and Node does not have it.
 */
export function createServiceSupabaseClient() {
  return createClient<Database>(publicEnv.supabaseUrl, serverEnv().supabaseSecretKey, {
    // No session is stored and none is refreshed. There is no user here to have one,
    // and leaving the default on would let this client hold a session it has no
    // business holding.
    auth: { persistSession: false, autoRefreshToken: false },
  });
}