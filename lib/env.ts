/**
 * Environment is read in exactly one place and checked on boot.
 *
 * A missing value has to crash here rather than surface as a confusing failure
 * three screens later — a Supabase client built with an undefined URL looks
 * fine until the first query.
 *
 * NEXT_PUBLIC_* values are inlined at build time, so this module is importable
 * from both server and client code. Only the server half may touch secrets.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. Add it to .env.local.`,
    );
  }
  return value;
}

/** Readable from the browser. Inlined at build time by Next. */
export const publicEnv = {
  clerkPublishableKey: required(
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  ),
  supabaseUrl: required(
    "NEXT_PUBLIC_SUPABASE_URL",
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  ),
  supabasePublishableKey: required(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  ),
} as const;

/**
 * Server-only. Calling this from a client bundle would throw on the secret,
 * which is the loud failure we want.
 */
export function serverEnv() {
  return {
    clerkSecretKey: required("CLERK_SECRET_KEY", process.env.CLERK_SECRET_KEY),
    /**
     * The Supabase secret key. It bypasses row-level security, so it is not a
     * stand-in for a signed-in request - it is for a process that has no session
     * at all, which is the pipeline run from a terminal. Anything a person
     * triggers goes through the Clerk session instead, where the policy decides.
     */
    supabaseSecretKey: required(
      "SUPABASE_SECRET_KEY",
      process.env.SUPABASE_SECRET_KEY,
    ),
  } as const;
}
