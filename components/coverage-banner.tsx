"use client";

import { useState } from "react";

/**
 * The coverage banner.
 *
 * It exists because a graph of a real repository is always a graph of part of it,
 * and the difference between "partial on purpose" and "incomplete by accident" is
 * the whole product. So the banner leads with the figure that means the map cannot be
 * trusted — imports that pointed inside the repository and could not be matched — and
 * treats bare module specifiers as what they are: a decision, not a failure.
 *
 * An earlier version of this led with "percentage of imports resolved", which put a
 * React app at 23% and read like something was broken. Nothing was: every relative
 * import resolved, and the other three quarters were `react` and `vite`. A figure
 * that is low for structural reasons is worse than no figure, because it teaches the
 * reader to ignore the banner.
 *
 * It collapses, and it collapses to one line that still names the figure. A banner
 * that can be dismissed entirely is one that gets dismissed and forgotten.
 */
export function CoverageBanner({
  resolved,
  outside,
  excluded,
  unresolved,
  filesParsed,
  filesFound,
  filesSkipped,
}: {
  resolved: number;
  outside: number;
  excluded: number;
  unresolved: number;
  filesParsed: number;
  filesFound: number;
  filesSkipped: number;
}) {
  const [open, setOpen] = useState(false);

  // Clean when nothing inside the repository failed to resolve. That is the whole
  // claim the map is making: every line it drew was drawn from a real import of a
  // real file.
  const clean = unresolved === 0;

  // Two sentences, built once, because the two cases above differ only in the claim
  // they make and the figures are the same either way. Assembled here rather than
  // written out twice so the two cannot drift.
  //
  // The import figure is counted against imports that could have become lines, not
  // against every import written. "17 of 72" against all specifiers reads as 55
  // lost, when 54 of those are `react` and `next` and their code is not in this
  // repository at all. So the denominator is the imports that pointed inside, and
  // the packages are reported beside it as a decision rather than a shortfall.
  const inside = resolved + unresolved;

  // The packages and the excluded ones are the same kind of fact — an import that was
  // never a candidate for a line — so they are joined into one clause.
  const notCandidates = [
    outside > 0 ? `${outside} ${plural(outside, "import was a package", "imports were packages")}` : null,
    excluded > 0 ? `${excluded} ${plural(excluded, "was excluded", "were excluded")}` : null,
  ].filter((part): part is string => part !== null);

  // Order is the point, and the claim comes first. The denominator sentence is what the
  // map is asserting; the packages are a fact about the repository that is neither a
  // success nor a failure. An earlier version ran them together as "the other 54",
  // which read as though they were the remainder of a count they have nothing to do
  // with. A repository with no imports inside it is a real case, and "0 of 0 imports
  // became lines" says nothing while looking like it does, so that half is dropped and
  // the file counts carry the line.
  const importLine = [
    inside > 0
      ? `${resolved} of ${inside} imports written inside the repository became lines.`
      : unresolved > 0
        ? `${unresolved} ${plural(unresolved, "import")} could not be resolved.`
        : null,
    notCandidates.length > 0 ? `${joinClause(notCandidates)}.` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" ");

  const fileLine = `${filesParsed} of ${filesFound} files parsed, ${filesSkipped} skipped.`;
  const breakdown = importLine.length > 0 ? `${importLine} ${fileLine}` : fileLine;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-10 flex justify-center px-4 pb-4">
      <div className="pointer-events-auto w-full max-w-2xl rounded-lg border border-border bg-surface-raised/95 shadow-lg">
        <div className="flex items-start gap-3 px-4 py-3">
          <span
            aria-hidden="true"
            className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
              clean ? "bg-incoming" : "bg-danger"
            }`}
          />
          <p className="min-w-0 flex-1 text-xs leading-4 text-text">
            {clean ? (
              <>
                <span className="font-medium">
                  Every import that pointed inside this repository resolved.
                </span>{" "}
                <span className="text-text-muted">{breakdown}</span>
              </>
            ) : (
              <>
                <span className="font-medium text-danger">
                  {unresolved} {plural(unresolved, "import")} could not be resolved.
                </span>{" "}
                <span className="text-text-muted">
                  They pointed inside this repository and no file matched, so nothing
                  was drawn for them. {breakdown}
                </span>
              </>
            )}
          </p>
          {/*
            A button, drawn as one. It used to be bare text with a hover underline,
            which read as a link sitting in the sentence and got missed - the whole
            reason the banner carries a "Why?" at all is that the figures invite the
            question. Border and surface match the zoom control, so the two small
            controls in this app look like the same kind of thing.
          */}
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="shrink-0 cursor-pointer rounded-[4px] border border-border bg-surface-raised px-2 py-1 text-[11px] leading-none text-text-muted hover:border-text-muted/40 hover:text-text"
          >
            {open ? "Hide" : "Why?"}
          </button>
        </div>

        {open ? (
          <div className="border-t border-border px-4 py-3 text-[11px] leading-5 text-text-muted">
            <p>
              The map draws one file per line, and a line is only drawn when an import
              in the code was resolved to a file that exists. Imports of packages are
              not drawn and are not counted against the map — their code is not in this
              repository.
            </p>
            <p className="mt-2">
              {unresolved === 0
                ? "Nothing is missing. Every import written in the parsed files either became a line or is reported above."
                : "The unresolved ones are listed on the analysis page, each with the specifier as written and the line it was written on."}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Agreement, for a number that is usually small.
 *
 * "1 were excluded" is the kind of thing nobody reads past, but a banner that gets
 * its own grammar wrong is a banner whose figures get read a second time.
 */
function plural(count: number, one: string, many = `${one}s`): string {
  return count === 1 ? one : many;
}

/**
 * Join parts into "a, b and c", so a two-part case does not read "a, and b".
 */
function joinClause(parts: string[]): string {
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}