import { OrganizationProfile } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";

/**
 * Organization management, hosted in-app rather than in Clerk's Account Portal
 * so the invitation email lands the invitee on this app's own sign-in page
 * (NEXT_PUBLIC_CLERK_SIGN_IN_URL) instead of Clerk's hosted one.
 *
 * The Members tab is where an admin invites someone by email. That UI is
 * Clerk's, not ours — the spec forbids a hand-written invite form, and the
 * prebuilt component is what the sign-in scaffolding already provides.
 *
 * Protected here, not in the layout, because a layout is not re-rendered when
 * the page under it changes.
 */
export default async function OrganizationPage() {
  await auth.protect();

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <OrganizationProfile
        routing="path"
        path="/workspace/organization"
        afterLeaveOrganizationUrl="/workspace"
      />
    </div>
  );
}
