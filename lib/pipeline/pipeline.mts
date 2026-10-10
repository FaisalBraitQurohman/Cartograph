import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { parseRepository } from "../../parser/parse-repository.mts";
import { cleanUp, fetchRepository, FetchError } from "./fetch-repository.mts";
import {
  InvalidRepositoryUrl,
  canonicalUrlFor,
  parseRepositoryUrl,
  type RepositoryRef,
} from "./repository-url.mts";
import { STAGE_SUMMARY, type Stage } from "./stage.mts";
import { storeParse, StoreError, writeStage } from "./store.mts";

/**
 * The run: fetch, parse, store, with a named stage at each step.
 *
 * The stages exist so a person watching knows what the machine is doing, and the
 * catch at the top exists because a run that throws in the middle otherwise leaves a
 * row claiming to be parsing forever. A failure writes which stage it failed in and
 * why — those are the two things somebody needs in order to decide whether to retry.
 *
 * The organization is an argument, not something this function works out, because a
 * pipeline has no caller to read a token from. That makes this the one writer the
 * row-level-security policies do not stand behind: the client carries the secret key
 * and the policies do not apply to it. So `organizationId` is trusted input, and the
 * only thing keeping it honest is that the callers pass a session's organization
 * rather than something a person typed.
 *
 * The parser is imported by relative path rather than by the `@` alias. This is the
 * only value import in the pipeline, and Node cannot resolve the alias — which meant
 * the whole run could not be loaded outside Next, and so could not be checked by
 * anything except a type signature. Type-only imports are erased before resolution
 * and so keep the alias.
 */

type Client = SupabaseClient<Database>;

export interface PipelineOptions {
  /** Called as each stage begins, so a page can show progress. */
  onStage?: (stage: Stage, message: string) => void;
}

export interface PipelineResult {
  analysisId: string;
  status: "complete" | "failed";
  stage: Stage;
  commitSha: string | null;
  filesWritten: number;
  edgesWritten: number;
  error: string | null;
  /** True when this repository already had an analysis and nothing was run. */
  existing: boolean;
}

export class PipelineError extends Error {
  readonly stage: Stage;

  constructor(message: string, stage: Stage) {
    super(message);
    this.name = "PipelineError";
    this.stage = stage;
  }
}

/**
 * What `prepareRun` worked out, before any of it has been fetched.
 *
 * Split from `runAnalysis` because the caller has to know the analysis id *before*
 * the run starts: a progress page is a URL, and the URL needs the id of a row that
 * has to exist. The server action writes the rows, redirects to that page, and only
 * then starts the work - see `runStages`.
 */
export interface PreparedRun {
  analysisId: string;
  projectId: string;
  canonicalUrl: string;
  ref: RepositoryRef;
  /** Set when this repository already had an analysis and nothing needs running. */
  existing: {
    id: string;
    status: string;
    commit_sha: string | null;
    error: string | null;
  } | null;
}

/**
 * Decide what a URL means, and write the rows a run needs before it starts.
 *
 * One analysis per repository. A second paste of the same URL returns the first
 * analysis rather than starting another run, because two maps of one repository that
 * disagree with each other is worse than one map that is a week old.
 *
 * Throws for a URL that does not name a repository. There is no row yet, so there is
 * nowhere to record it, and a page that only ever renders stored rows has nothing to
 * show - the caller has to render this one itself.
 */
export async function prepareRun(
  client: Client,
  input: { organizationId: string; url: string },
): Promise<PreparedRun> {
  let ref: RepositoryRef;
  try {
    ref = parseRepositoryUrl(input.url);
  } catch (error) {
    if (error instanceof InvalidRepositoryUrl) {
      throw new PipelineError(error.message, "fetching");
    }
    throw error;
  }

  const canonical = canonicalUrlFor(ref);
  const existing = await findExisting(client, input.organizationId, canonical);
  if (existing) {
    return {
      analysisId: existing.id,
      projectId: "",
      canonicalUrl: canonical,
      ref,
      existing: {
        id: existing.id,
        status: existing.status,
        commit_sha: existing.commit_sha,
        error: existing.error,
      },
    };
  }

  const { projectId, analysisId } = await createRows(client, input.organizationId, canonical, ref.name);

  // The stage is set at creation rather than left null until the first write. The
  // progress page reads this row the instant it loads, and a null stage there would
  // mean a run that has begun but is not yet in any stage. It also gives the
  // dashboard something to time: an abandoned run is one whose stage_at has stopped
  // moving, and a row that never moved has nothing to compare.
  await writeStage(client, {
    analysisId,
    stage: "fetching",
    message: STAGE_SUMMARY.fetching,
    status: "queued",
  });

  return { analysisId, projectId, canonicalUrl: canonical, ref, existing: null };
}

/** The whole run, for a caller that has no page to redirect to first. */
export async function runAnalysis(
  client: Client,
  input: { organizationId: string; url: string },
  options: PipelineOptions = {},
): Promise<PipelineResult> {
  const prepared = await prepareRun(client, input);
  return runStages(client, prepared, input.organizationId, options);
}

/**
 * Fetch, parse and store a repository that has already been prepared.
 *
 * Separate from `prepareRun` because the two have to happen either side of a
 * response. Whoever owns the work needs the id first; whoever finishes it must not
 * be holding the request open.
 */
export async function runStages(
  client: Client,
  prepared: PreparedRun,
  organizationId: string,
  options: PipelineOptions = {},
): Promise<PipelineResult> {
  const { ref, existing } = prepared;

  if (existing) {
    return {
      analysisId: existing.id,
      status: existing.status === "complete" ? "complete" : "failed",
      stage: "done",
      commitSha: existing.commit_sha,
      filesWritten: 0,
      edgesWritten: 0,
      error: existing.error,
      existing: true,
    };
  }

  const analysisId = prepared.analysisId;
  let stage: Stage = "fetching";

  try {
    // `stage` is the stage *in progress*, and it moves before the work rather than
    // after. The catch below falls back to it for an error that is not one of ours —
    // a bug in the parser, say — and a fallback that names the previous stage would
    // report a parse failure as a fetch failure.
    stage = "fetching";
    await stage_(client, analysisId, "fetching", null, options);
    const fetched = await fetchRepository(ref);

    try {
      stage = "parsing";
      await stage_(client, analysisId, "parsing", null, options);
      const parse = parseRepository(fetched.path);

      stage = "storing";
      await stage_(client, analysisId, "storing", null, options);
      const stored = await storeParse(client, {
        analysisId,
        organizationId,
        files: parse.files,
        edges: parse.edges,
        coverage: parse.coverage,
        summary: parse.summary,
        skipped: parse.skipped,
      });

      await finish(client, analysisId, "complete", fetched.commitSha, parse.parserVersion, options);
      stage = "done";

      return {
        analysisId,
        status: "complete",
        stage,
        // The commit the map is a snapshot of, out of the archive's own header. Null
        // when the archive did not carry one, which is the honest answer rather than
        // substituting anything else into a column named for it.
        commitSha: fetched.commitSha,
        filesWritten: stored.filesWritten,
        edgesWritten: stored.edgesWritten,
        error: null,
        existing: false,
      };
    } finally {
      // Whatever happened inside, the fetched copy is deleted. A repository left in
      // a temporary directory is somebody else's code sitting on this disk.
      cleanUp(fetched);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failedStage = error instanceof PipelineError || error instanceof FetchError
      ? error.stage
      : error instanceof StoreError
        ? "storing"
        : stage;
    stage = failedStage;

    // The catch. Without it a thrown error leaves the row in the stage it last
    // reached, which for a parse of a real repository is a long time.
    try {
      await writeStage(client, {
        analysisId,
        stage: "failed",
        message,
        status: "failed",
        error: message,
        finished: true,
      });
    } catch (writeFailure) {
      // The original failure is the one worth reporting. A failure to record a
      // failure is a second problem on top of it, and it must not replace it.
      console.error(
        `Analysis ${analysisId} failed in ${failedStage}: ${message}. Recording the failure also failed: ${
          writeFailure instanceof Error ? writeFailure.message : String(writeFailure)
        }`,
      );
    }

    return {
      analysisId,
      status: "failed",
      stage,
      commitSha: null,
      filesWritten: 0,
      edgesWritten: 0,
      error: message,
      existing: false,
    };
  }
}

async function stage_(
  client: Client,
  analysisId: string,
  stage: Stage,
  message: string | null,
  options: PipelineOptions,
): Promise<void> {
  const text = message ?? STAGE_SUMMARY[stage];
  await writeStage(client, {
    analysisId,
    stage,
    message: text,
    status: stage === "fetching" ? "queued" : "parsing",
  });
  options.onStage?.(stage, text);
}

/**
 * Mark a run complete, and stamp it with the commit it mapped.
 *
 * The commit is what a later run compares against to decide whether the repository
 * has moved on, so it is written to `commit_sha` — the column named for it. It used
 * to hold the parser's version, which was the only thing available at the time and
 * was never what the name said: a run of the same repository at the same commit
 * reported a different "commit" every time the parser changed.
 *
 * The version is still shown, in the stage message, where a person reading the
 * progress page can see which parser produced the map. Losing it from the row
 * entirely would be the other mistake.
 */
async function finish(
  client: Client,
  analysisId: string,
  status: "complete",
  commitSha: string | null,
  parserVersion: string,
  options: PipelineOptions,
): Promise<void> {
  // The message names both, because they answer different questions: which snapshot
  // this map is of, and which parser drew it. The column takes only the first.
  const message =
    commitSha === null
      ? `Mapped at an unknown commit (parser ${parserVersion})`
      : `${commitSha.slice(0, 12)} (parser ${parserVersion})`;

  await writeStage(client, {
    analysisId,
    stage: "done",
    message,
    status,
    commitSha,
    finished: true,
  });
  options.onStage?.("done", message);
}

async function findExisting(
  client: Client,
  organizationId: string,
  repoUrl: string,
): Promise<{ id: string; status: string; commit_sha: string | null; error: string | null } | null> {
  const { data, error } = await client
    .from("analyses")
    .select("id, status, commit_sha, error, projects!inner(repo_url)")
    .eq("organization_id", organizationId)
    .eq("projects.repo_url", repoUrl)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    // Not a fallback: if this cannot be read then the uniqueness below is also a
    // guess, and "paste the same URL twice" would quietly create two analyses.
    throw new PipelineError(
      `Could not check for an existing analysis: ${error.message}`,
      "fetching",
    );
  }

  const row = data?.[0];
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    commit_sha: row.commit_sha,
    error: row.error,
  };
}

/**
 * The project and the analysis row, written together.
 *
 * The unique index on (organization_id, repo_url) is what actually guarantees one
 * analysis per repository. Two concurrent pastes of the same URL will both try to
 * insert a project, one will lose, and that one returns the winner's analysis rather
 * than a duplicate.
 */
async function createRows(
  client: Client,
  organizationId: string,
  repoUrl: string,
  name: string,
): Promise<{ projectId: string; analysisId: string }> {
  const { data: project, error: projectError } = await client
    .from("projects")
    .insert({ organization_id: organizationId, name, repo_url: repoUrl })
    .select("id")
    .single();

  if (projectError) {
    // 23505 is the unique violation. The repository is already here — created by a
    // run that has not written its analysis yet, or by one that did.
    if (projectError.code === "23505") {
      const { data: found, error: lookupError } = await client
        .from("projects")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("repo_url", repoUrl)
        .single();

      if (lookupError) {
        throw new PipelineError(
          `This repository already exists but could not be read: ${lookupError.message}`,
          "fetching",
        );
      }

      // The project exists, so an analysis for it may exist too — this path is
      // reached exactly when another run got here first, and that run wrote its own
      // analysis. Creating a second one would break the one-analysis-per-repository
      // rule that `prepareRun` just checked for and missed, and the two would
      // disagree with each other. Only a project with no analysis at all gets a new
      // one, which is the case where a previous run inserted its project and then
      // died before inserting its analysis.
      const { data: existing, error: existingError } = await client
        .from("analyses")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("project_id", found.id)
        .order("created_at", { ascending: false })
        .limit(1);

      if (existingError) {
        throw new PipelineError(
          `This repository already exists but its analyses could not be read: ${existingError.message}`,
          "fetching",
        );
      }

      const first = existing?.[0];
      if (first) return { projectId: found.id, analysisId: first.id };

      return { projectId: found.id, analysisId: await createAnalysis(client, organizationId, found.id) };
    }
    throw new PipelineError(`Could not record the repository: ${projectError.message}`, "fetching");
  }

  return { projectId: project.id, analysisId: await createAnalysis(client, organizationId, project.id) };
}

async function createAnalysis(client: Client, organizationId: string, projectId: string): Promise<string> {
  const { data, error } = await client
    .from("analyses")
    .insert({ organization_id: organizationId, project_id: projectId, status: "queued" })
    .select("id")
    .single();

  if (error) {
    throw new PipelineError(`Could not start the analysis: ${error.message}`, "fetching");
  }
  return data.id;
}
