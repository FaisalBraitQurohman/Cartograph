import type { Stage } from "@/lib/pipeline/stage.mts";

/**
 * Whether a run is still working or was abandoned.
 *
 * A pure function over two columns, because there is no queue and no timeout
 * anywhere in this pipeline: a process that stops mid-parse leaves a row that will
 * say "parsing" forever, and nothing else will ever move it. `stage_at` is when the
 * stage last moved, so a run whose stage has not moved for a while is a run nobody
 * is working on any more.
 *
 * This is deliberately not a repair. Nothing here unsticks a run, because deciding
 * that an abandoned run should be failed is a write somebody has to choose to make.
 * What it does is make the difference legible without opening it.
 */

/** Minutes without a stage change before an unfinished run is called abandoned. */
export const STALE_AFTER_MINUTES = 5;

/** What the row says. */
export interface RunState {
  stage: Stage | null;
  status: string;
  stageAt: string | null;
  /** Whether the run has finished, one way or another. */
  finished: boolean;
}

export interface RunFreshness extends RunState {
  stale: boolean;
}

/** The stages a run can still be in. Everything else has stopped on purpose. */
const UNFINISHED_STAGES: readonly Stage[] = ["fetching", "parsing", "storing"];

export function runFreshness(row: RunState): RunFreshness {
  const unfinished =
    !row.finished &&
    row.stage !== null &&
    UNFINISHED_STAGES.includes(row.stage);

  if (!unfinished || row.stageAt === null) {
    return { ...row, stale: false };
  }

  const minutes = (Date.now() - new Date(row.stageAt).getTime()) / 60_000;
  return { ...row, stale: minutes > STALE_AFTER_MINUTES };
}