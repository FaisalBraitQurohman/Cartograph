import { auth } from "@clerk/nextjs/server";

/**
 * The organization this request is acting for.
 *
 * Clerk has two session-token shapes and they disagree about the name: version 1
 * carries `org_id`, version 2 carries the organization under `o` and types
 * `org_id` as `never`. The database has to cope with both - `current_organization_id()`
 * reads one and falls back to the other - so this reads them the same way rather
 * than picking the one that happened to be true today.
 *
 * `orgId` off Clerk's own auth object rather than off `sessionClaims` directly,
 * because Clerk has already resolved whichever shape this token is and the two
 * can never be read inconsistently by accident.
 *
 * Throws when there is no active organization rather than returning null. A user
 * with no organization is a real state, but the only thing this app lets them do
 * is choose one, and letting a request through with an undefined organization
 * would mean writing rows that belong to nobody.
 */
export async function requireOrganizationId(): Promise<string> {
  const { orgId } = await auth();

  if (!orgId) {
    throw new Error(
      "This request has no active organization. Select or create one in the " +
        "organization switcher first.",
    );
  }

  return orgId;
}