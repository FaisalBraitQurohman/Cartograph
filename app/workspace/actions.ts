"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { requireOrganizationId } from "@/lib/clerk-organization";
import { createServiceSupabaseClient } from "@/lib/supabase/service.mts";
import { ProgressPublisher } from "@/lib/realtime/publish-progress.mts";
import { STAGE_SUMMARY } from "@/lib/pipeline/stage.mts";
import { PipelineError, prepareRun, runStages } from "@/lib/pipeline/pipeline.mts";

/**
 * Start an analysis from the dashboard form.
 *
 * Split around `after()` because the two halves want opposite things. The first has
 * to finish before the response, because the redirect carries an analysis id and the
 * page it points at has to find that row. The second must not, because fetching and
 * parsing a repository takes longer than a request is meant to be held open for.
 *
 * The organization comes off the Clerk session and nowhere else. The service client
 * bypasses row-level security, so this is the one place where an organization id is
 * trusted with no policy behind it - and a form field is exactly what must never be
 * one.
 */
export async function startAnalysis(formData: FormData): Promise<void> {
  await auth.protect();
  const organizationId = await requireOrganizationId();

  const url = formData.get("url");
  if (typeof url !== "string" || url.trim() === "") {
    redirect("/workspace?error=Enter+a+repository+URL");
  }

  const client = createServiceSupabaseClient();

  let prepared;
  try {
    prepared = await prepareRun(client, { organizationId, url: url.trim() });
  } catch (error) {
    // A URL that does not name a repository never becomes a row, because nothing has
    // started and there is nowhere to record it. It travels back on the URL instead,
    // where the page renders it. Everything else about a run is a row - including a
    // repository that does not exist, which fails later and is worth keeping.
    if (error instanceof PipelineError) {
      redirect(`/workspace?error=${encodeURIComponent(error.message)}`);
    }
    throw error;
  }

  if (prepared.existing) {
    // A second paste of the same repository. There is one analysis per repository,
    // and it takes you to that one rather than starting another.
    redirect(`/workspace/analyses/${prepared.analysisId}`);
  }

  // Nobody waits on this. It is the only part of the request that is allowed to take
  // as long as a repository takes.
  after(async () => {
    // The publisher opens one socket for the whole run and closes it after. It is
    // opened here rather than inside `runStages` so a failure to connect cannot stop
    // the analysis - the row in the database is still the record either way.
    const publisher = new ProgressPublisher(prepared.analysisId, organizationId);
    await publisher.open();

    try {
      const result = await runStages(client, prepared, organizationId, {
        onStage: (stage, message) => void publisher.publish(stage, message),
      });

      // `runStages` reports a failure by returning rather than by throwing, and it
      // writes the stage without going through `onStage`, so the terminal state is
      // published here. Otherwise a failed run would leave the page on the last stage
      // that worked.
      //
      // The terminal stage, not `result.stage`: that one names where the run *broke*,
      // which is for the error message and the dashboard row. Publishing "parsing" as
      // the last thing a subscriber hears from a run that has stopped exactly matches
      // the failure this banner exists to avoid — a page that looks like it is still
      // working.
      await publisher.publish(
        result.status === "complete" ? "done" : "failed",
        result.error ?? STAGE_SUMMARY[result.stage],
      );
    } finally {
      await publisher.close();
    }
  });

  redirect(`/workspace/analyses/${prepared.analysisId}`);
}