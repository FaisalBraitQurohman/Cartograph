/**
 * Boot-time check. Next calls register() once per server start, so a missing
 * variable stops the process here instead of failing on the first request.
 *
 * Guarded to the nodejs runtime: the edge runtime has no business holding the
 * Clerk secret, and this module must not drag it in.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { publicEnv, serverEnv } = await import("./lib/env");
  // Touching the exports is the check — each throws on a missing value.
  void publicEnv;
  void serverEnv();
}
