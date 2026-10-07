import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

/**
 * The root is a router, not a page. It sends the visitor wherever they belong
 * instead of showing a landing screen: signed-out visitors go straight to the
 * sign-in screen, signed-in visitors go to their workspace.
 *
 * `redirect()` resolves before any page HTML is produced, so the visitor never
 * sees the root render — they only ever see the destination.
 */
export default async function Home() {
  const { isAuthenticated } = await auth();
  redirect(isAuthenticated ? "/workspace" : "/sign-in");
}
