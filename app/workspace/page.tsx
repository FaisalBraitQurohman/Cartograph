import { auth } from "@clerk/nextjs/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * The workspace. Protected here rather than in the layout, because a layout is
 * not re-rendered when the page under it changes.
 *
 * Signed-out visitors are redirected to sign-in before this renders.
 */
export default async function WorkspacePage() {
  const { orgId, orgRole, sessionClaims } = await auth.protect();

  // Read straight off the token — no round trip to the identity provider for
  // anything that decides access. orgId is the claim the database policy will
  // read later; nothing downstream needs to ask Clerk again.
  const organizationName = sessionClaims.org_name;

  // The name is only absent if the `org_name` claim is missing from the token
  // template, which is a deployment mistake rather than a runtime condition.
  // Fail loudly instead of rendering a placeholder that hides it.
  if (!organizationName) {
    throw new Error(
      "The session token is missing the `org_name` claim. Add " +
        '{"org_name": "{{org.name}}"} under Sessions -> Customize session ' +
        "token in the Clerk Dashboard.",
    );
  }

  // Constructed here to prove the token travels with the client. No query runs
  // in this phase — there are no tables yet — so the client is deliberately
  // discarded.
  createServerSupabaseClient();

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-sm font-medium">Workspace</h1>

      <dl className="mt-4 grid grid-cols-[8rem_1fr] gap-x-4 gap-y-1 text-xs">
        <dt className="text-text-muted">Organization</dt>
        <dd className="font-mono">{organizationName}</dd>

        <dt className="text-text-muted">Organization ID</dt>
        <dd className="font-mono">{orgId ?? "—"}</dd>

        <dt className="text-text-muted">Your role</dt>
        <dd className="font-mono">{orgRole ?? "—"}</dd>
      </dl>

      <p className="mt-6 text-xs text-text-muted">
        Parsing and the map arrive in the next phase. This page confirms the
        session, the organization and the database client are wired together.
      </p>
    </div>
  );
}
