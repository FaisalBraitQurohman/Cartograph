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
    <div className="flex min-h-screen flex-col bg-surface">
      <header className="shrink-0 border-b border-border bg-surface-raised/80">
        <div className="mx-auto flex h-14 max-w-[1500px] items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-white" aria-hidden="true">
                <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none">
                  <circle cx="4" cy="4" r="1.5" fill="currentColor" />
                  <circle cx="12" cy="4" r="1.5" fill="currentColor" />
                  <circle cx="8" cy="12" r="1.5" fill="currentColor" />
                  <path d="m5.25 4.75 1.5 5M10.75 4.75l-1.5 5M5.5 4h5" stroke="currentColor" strokeWidth="1" />
                </svg>
              </span>
              <div className="leading-none">
                <span className="block font-mono text-sm font-semibold tracking-[-0.02em] text-text">cartograph</span>
                <span className="mt-1 block text-[10px] text-text-muted">repository maps</span>
              </div>
            </div>
            <span className="hidden h-5 w-px bg-border sm:block" aria-hidden="true" />
            <span className="hidden text-xs text-text-muted sm:block">Workspace</span>
          </div>
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
                  "rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-text shadow-none",
              },
            }}
          />
          <div className="flex items-center gap-3">
            <ThemeControl />
            <UserButton
              appearance={{ elements: { avatarBox: "h-7 w-7 ring-1 ring-border" } }}
            />
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
