import { clerkMiddleware } from "@clerk/nextjs/server";

/**
 * Clerk reads the session here. It does not decide who may see what — that is
 * the job of the policy, and of `auth.protect()` in each page.
 *
 * The one exception is an early redirect for signed-out visitors to protected
 * paths. That is a latency optimisation, not the security boundary: the page
 * still calls `auth.protect()`. Doing it here means the response is a real
 * redirect with no page HTML in it, rather than a streamed page that redirects
 * after it has already started rendering.
 */
const PROTECTED_PREFIXES = ["/workspace"];

export default clerkMiddleware(async (auth, req) => {
  const { pathname } = req.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  if (!isProtected) return;

  const { userId, redirectToSignIn } = await auth();
  if (!userId) return redirectToSignIn();
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/:path*",
  ],
};
