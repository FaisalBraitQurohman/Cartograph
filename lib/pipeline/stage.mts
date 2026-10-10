/**
 * The stages a run passes through, and what each one is allowed to say.
 *
 * A stage is a name from a fixed list rather than free text, so a dashboard can
 * render a known set and a reader never sees a stage nobody defined. The message
 * beside it is free text, because the useful thing to say while parsing is a file
 * count and a count is not one of a fixed list.
 *
 * This module is the only place the list is written down. The database has a check
 * constraint carrying the same vocabulary, and nothing may add a stage here without
 * that constraint being widened — which is the point: two places to change, not one.
 */

export const STAGES = ["fetching", "selecting", "parsing", "storing", "done", "failed"] as const;

export type Stage = (typeof STAGES)[number];

/**
 * The stages a run moves through, in order. `failed` is where it stops instead.
 *
 * Four, not five, and the fifth is the interesting one. `selecting` is in the
 * vocabulary above and in the database constraint, because choosing which files to
 * parse is real work - the parser skips nine of fourteen files on a small
 * repository and says so. But it happens inside `parseRepository`, as part of
 * parsing, and there is no moment between the two to report. Listing it here would
 * draw a step on the progress page that never lights up and never will.
 *
 * It stays in STAGES so the vocabulary and the constraint still agree, which is the
 * relationship the check script enforces.
 */
export const PIPELINE: readonly Stage[] = ["fetching", "parsing", "storing", "done"];

/**
 * The one sentence shown beside each stage, before any run-specific detail.
 *
 * A reader watching a run needs to know what the machine is doing, not which
 * function is running. "Downloading the archive" says the thing; `fetchRepository`
 * says the implementation.
 */
export const STAGE_SUMMARY: Record<Stage, string> = {
  fetching: "Downloading the archive",
  selecting: "Choosing the source files",
  parsing: "Reading imports",
  storing: "Writing the graph",
  done: "Ready",
  failed: "Stopped",
};

/** What the database column may hold, as a comma-separated list, for a migration. */
export const STAGE_LIST_FOR_SQL = STAGES.join(", ");
