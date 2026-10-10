import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireOrganizationId } from "@/lib/clerk-organization";
import { runFreshness, STALE_AFTER_MINUTES } from "@/lib/analysis-freshness";
import { AnalysisProgressView } from "@/components/analysis-progress-view";
import { type Stage } from "@/lib/pipeline/stage.mts";

/**
 * One run, and where it has got to.
 *
 * The row is read through the ordinary client, so the policy decides whether this
 * organization may see it. Nobody passes an organization in to find out - a query
 * that can be answered by passing the right id is a query whose policy was not
 * written.
 */
export default async function AnalysisPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await auth.protect();
  const { id } = await params;

  const organizationId = await requireOrganizationId();

  const supabase = createServerSupabaseClient();

  // Nothing is selected by organization id. The policy narrows the rows, and the
  // `.eq("id", id)` is which one of them this page is about.
  const { data: analysis, error } = await supabase
    .from("analyses")
    .select(
      "id, status, stage, stage_message, stage_at, created_at, finished_at, error, projects(name, repo_url)",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    // A failed query is not a missing analysis. Showing "not found" for a broken
    // policy hides the break behind a friendly page.
    throw new Error(`Could not read the analysis: ${error.message}`);
  }

  // Either it does not exist, or it belongs to another organization and the policy
  // returned nothing. Both are the same answer to this page and different answers to
  // the database, which is the point of not asking.
  if (!analysis) notFound();

  const freshness = runFreshness({
    stage: analysis.stage as Stage | null,
    status: analysis.status,
    stageAt: analysis.stage_at,
    finished: analysis.finished_at !== null,
  });

  const name = analysis.projects?.name ?? "—";
  const stage = analysis.stage as Stage | null;

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-surface">
      <div className="mx-auto max-w-3xl px-4 py-9 sm:px-6 lg:px-8">
        <p className="text-xs font-medium text-text-muted">{name}</p>
        <h1 className="mt-2 font-mono text-xl font-medium tracking-[-0.02em] text-text">
          {analysis.status === "complete"
            ? "Analysis complete"
            : analysis.status === "failed"
              ? "Analysis failed"
              : "Analysing"}
        </h1>

        {analysis.error ? (
          <div className="mt-4 rounded-md border border-danger/30 bg-danger/10 px-4 py-3">
            <p className="text-xs font-medium text-danger">Stopped in {stage ?? "an unknown stage"}</p>
            <p className="mt-1 text-xs leading-5 text-text">{analysis.error}</p>
          </div>
        ) : null}

        {freshness.stale ? (
          <div className="mt-4 rounded-md border border-border bg-surface-raised px-4 py-3">
            <p className="text-xs font-medium text-text">This run looks abandoned</p>
            <p className="mt-1 text-xs leading-5 text-text-muted">
              Its stage has not moved for over {STALE_AFTER_MINUTES} minutes, and
              nothing in this app times a run out. It may still be going. Re-running
              the repository starts a fresh analysis.
            </p>
          </div>
        ) : null}

        <AnalysisProgressView
          analysisId={analysis.id}
          organizationId={organizationId}
          initialStage={stage}
          initialMessage={analysis.stage_message}
          initialStatus={analysis.status}
          startedAt={analysis.created_at}
          stageAt={analysis.stage_at}
          finishedAt={analysis.finished_at}
        />
      </div>
    </div>
  );
}