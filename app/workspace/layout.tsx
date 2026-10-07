import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { ThemeControl } from "@/components/theme-control";

/**
 * The application shell. Everything later renders inside this, so it is built
 * once and not rearranged — later phases add panels within <main>.
 *
 * Deliberately not protected here: a layout is not re-rendered when the page
 * under it changes, so each page runs its own auth check.
 */
export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-border px-3">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs font-medium">cartograph</span>
          <OrganizationSwitcher
            hidePersonal
            afterSelectOrganizationUrl="/workspace"
            afterCreateOrganizationUrl="/workspace"
            // "Manage" navigates to the page we host instead of opening Clerk's
            // Account Portal, so invitations stay inside the app.
            organizationProfileMode="navigation"
            organizationProfileUrl="/workspace/organization"
            appearance={{
              elements: {
                rootBox: "text-xs",
                organizationSwitcherTrigger:
                  "rounded border border-border px-2 py-0.5 text-xs",
              },
            }}
          />
        </div>
        <div className="flex items-center gap-3">
          <ThemeControl />
          <UserButton
            appearance={{ elements: { avatarBox: "h-6 w-6" } }}
          />
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
