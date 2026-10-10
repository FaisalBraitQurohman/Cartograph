import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { listAnalyses } from "@/lib/analyses";
import { runFreshness, STALE_AFTER_MINUTES } from "@/lib/analysis-freshness";
import { NewAnalysisForm } from "@/components/new-analysis-form";
import { startAnalysis } from "@/app/workspace/actions";
import type { Stage } from "@/lib/pipeline/stage.mts";

/**
 * The workspace.
 *
 * The table is every analysis in the current organization, and no `where
 * organization_id = ...` appears anywhere on this path. That is the point: the
 * query says "all analyses", and the row-level-security policy decides that
 * "all" means "all of the ones belonging to whoever is signed in". Switching
 * organization through the header re-renders this component with a different
 * token, so the same query returns a different list — the acceptance check the
 * spec asks for, without a second code path to keep in step.
 *
 * Protected here rather than in the layout, because a layout is not re-rendered
 * when the page under it changes. Signed-out visitors are redirected to sign-in
 * before this renders.
 */
export default async function WorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { sessionClaims } = await auth.protect();
  const { error } = await searchParams;

  // Read straight off the token — no round trip to the identity provider for
  // anything that decides access. This is the claim the database policy reads;
  // the page only displays it.
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

  const analyses = await listAnalyses();
  const completedCount = analyses.filter(
    (analysis) => analysis.status === "complete",
  ).length;
  const activeCount = analyses.filter(
    (analysis) => analysis.status === "queued" || analysis.status === "parsing",
  ).length;
  const failedCount = analyses.filter(
    (analysis) => analysis.status === "failed",
  ).length;

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-surface">
      <div className="mx-auto max-w-[1500px] px-4 py-9 sm:px-6 lg:px-8">
        <div className="flex flex-col justify-between gap-8 sm:flex-row sm:items-end">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
              Workspace
            </div>
            <h1 className="mt-3 text-2xl font-semibold leading-none tracking-[-0.03em] text-text">
              Analysis Runs
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-5 text-text-muted">
              Repositories mapped in this organization.
            </p>
          </div>
          <div className="flex items-center gap-2 self-start rounded-md border border-border bg-surface-raised px-3 py-2 text-xs sm:self-auto">
            <OrganizationGlyph />
            <span className="font-medium text-text">{organizationName}</span>
          </div>
        </div>

        <section className="mt-8">
          <NewAnalysisForm action={startAnalysis} error={error ?? null} />
        </section>

        <dl className="metric-grid mt-9">
          <Metric label="Total runs" value={analyses.length} />
          <Metric label="Complete" value={completedCount} tone="positive" />
          <Metric label="In progress" value={activeCount} tone="accent" />
          <Metric label="Failed" value={failedCount} tone="negative" />
        </dl>

        <section className="mt-8 overflow-hidden rounded-lg border border-border bg-surface-raised/35">
          <div className="flex flex-col justify-between gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:px-5">
            <div>
              <h2 className="text-sm font-semibold text-text">Repositories</h2>
              <p className="mt-1 text-xs leading-4 text-text-muted">
                Most recent runs appear first.
              </p>
            </div>
            <span className="font-mono text-[11px] tabular-nums text-text-muted">
              {analyses.length.toString().padStart(2, "0")} runs
            </span>
          </div>

          {analyses.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[760px] w-full border-collapse text-xs">
                <caption className="sr-only">
                  Analysis runs for {organizationName}
                </caption>
                <thead>
                  <tr className="border-b border-border text-left text-[11px] font-medium text-text-muted">
                    <th className="w-[34%] px-5 py-3 font-medium" scope="col">
                      Repository
                    </th>
                    <th className="w-[26%] px-4 py-3 font-medium" scope="col">
                      State
                    </th>
                    <th className="px-4 py-3 text-right font-medium" scope="col">
                      Commit
                    </th>
                    <th className="px-4 py-3 text-right font-medium" scope="col">
                      Started
                    </th>
                    <th className="px-5 py-3 text-right font-medium" scope="col">
                      Finished
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {analyses.map((analysis) => (
                    <AnalysisRow key={analysis.id} analysis={analysis} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

type Analysis = Awaited<ReturnType<typeof listAnalyses>>[number];

function AnalysisRow({ analysis }: { analysis: Analysis }) {
  const freshness = runFreshness({
    stage: analysis.stage as Stage | null,
    status: analysis.status,
    stageAt: analysis.stage_at,
    finished: analysis.finished_at !== null,
  });

  return (
    <tr className="group border-b border-border align-top last:border-b-0 hover:bg-surface-raised">
      <td className="px-5 py-4 font-mono text-[13px] text-text">
        <div className="flex items-center gap-3">
          <RepositoryGlyph />
          <Link
            href={`/workspace/analyses/${analysis.id}`}
            className="underline-offset-4 hover:underline"
          >
            {analysis.projects?.name ?? "—"}
          </Link>
        </div>
      </td>
      <td className="px-4 py-4">
        <div className="flex items-start gap-2.5">
          <StatusPill status={analysis.status} />
          {/* Nothing in this app times a run out, so a run whose stage has stopped
              moving is the only sign it was abandoned. Marked rather than repaired:
              deciding a run should be failed is a write somebody has to choose. */}
          {freshness.stale ? (
            <span
              className="shrink-0 rounded border border-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-text-muted"
              title={`No stage change for over ${STALE_AFTER_MINUTES} minutes. Nothing times a run out, so this may simply be slow.`}
            >
              stalled
            </span>
          ) : null}
          {analysis.error ? (
            <span className="max-w-[230px] text-[11px] leading-4 text-text-muted">
              {analysis.error}
            </span>
          ) : null}
        </div>
      </td>
      <td className="px-4 py-4 text-right font-mono text-[11px] text-text-muted">
        {shortSha(analysis.commit_sha)}
      </td>
      <td className="px-4 py-4 text-right tabular-nums text-text-muted">
        {formatWhen(analysis.created_at)}
      </td>
      <td className="px-5 py-4 text-right tabular-nums text-text-muted">
        {analysis.finished_at ? formatWhen(analysis.finished_at) : "—"}
      </td>
    </tr>
  );
}

function Metric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "positive" | "accent" | "negative";
}) {
  const valueColor = {
    neutral: "text-text",
    positive: "text-incoming",
    accent: "text-accent",
    negative: "text-danger",
  }[tone];

  return (
    <div className="metric-cell">
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className={`mt-2 font-mono text-2xl font-medium leading-none tracking-[-0.04em] tabular-nums ${valueColor}`}>
        {value.toString().padStart(2, "0")}
      </dd>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const styles = {
    queued: "border-border text-text-muted",
    parsing: "border-accent/40 bg-accent/10 text-accent",
    complete: "border-incoming/30 bg-incoming/10 text-incoming",
    failed: "border-danger/30 bg-danger/10 text-danger",
  }[status] ?? "border-border text-text-muted";
  const dotColor = {
    queued: "bg-text-muted",
    parsing: "bg-accent",
    complete: "bg-incoming",
    failed: "bg-danger",
  }[status] ?? "bg-text-muted";
  const label = status === "parsing" ? "Parsing" : status.charAt(0).toUpperCase() + status.slice(1);

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-medium ${styles}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} aria-hidden="true" />
      {label}
    </span>
  );
}

function EmptyState() {
  return (
    <div className="flex min-h-64 items-center justify-center px-6 py-16 text-center">
      <div className="max-w-sm">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-dashed border-border text-text-muted">
          <RepositoryGlyph />
        </div>
        <h3 className="mt-4 text-sm font-medium text-text">No analyses yet</h3>
        <p className="mt-1 text-xs leading-5 text-text-muted">
          This organization has not run a repository analysis.
        </p>
      </div>
    </div>
  );
}

function OrganizationGlyph() {
  return (
    <svg aria-hidden="true" className="h-4 w-4 text-accent" viewBox="0 0 16 16" fill="none">
      <path d="M8 1.75 13 4.5v5L8 12.25 3 9.5v-5L8 1.75Z" stroke="currentColor" strokeWidth="1.25" />
      <path d="m5.25 5.75 2.75 1.5 2.75-1.5M8 7.25v3.25" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  );
}

function RepositoryGlyph() {
  return (
    <svg aria-hidden="true" className="h-4 w-4 shrink-0 text-text-muted" viewBox="0 0 16 16" fill="none">
      <path d="M3.25 3.25h6.5l3 3v6.5h-9.5v-9.5Z" stroke="currentColor" strokeWidth="1.25" />
      <path d="M9.75 3.5v3h2.75M5.25 9h5.5M5.25 11h3.5" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  );
}

/**
 * Seven characters, the length git itself abbreviates to by default. A commit
 * that was never resolved shows an em dash rather than a blank, so an empty
 * cell is never mistaken for a rendering bug.
 */
function shortSha(sha: string | null): string {
  return sha ? sha.slice(0, 7) : "—";
}

/** Coarse and relative. A timestamp to the second is noise in a list. */
function formatWhen(iso: string): string {
  const then = new Date(iso).getTime();
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));

  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}


