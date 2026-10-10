"use client";

import { useMemo, useState } from "react";
import { entryPointCounts, ENTRY_POINT_RULES } from "@/lib/graph/entry-points.ts";
import { insightsOf, MANY_IMPORTERS, TOO_MANY_LINES, type Insight } from "@/lib/graph/insights.ts";
import type { RepositoryParseResult } from "@/parser/types.mts";
import { FileName } from "./path-list";

/**
 * The insights panel, collapsed until it is asked for.
 *
 * Four facts about the edge list and nothing else. No model was asked what was odd
 * about this repository, and no sentence here was written: each one is a fixed
 * string chosen by which test a file passed, and the same repository always produces
 * the same four panels.
 *
 * It starts closed and sits at the bottom, because this explains a codebase and does
 * not grade one. A pane that opened on a list of its own findings would be presenting
 * a verdict nobody asked for, and the first thing anybody should read is what the
 * repository is.
 */
export function InsightsPanel({
  parse,
  hovered,
  onSelect,
  onHover,
}: {
  parse: RepositoryParseResult;
  hovered: string | null;
  onSelect: (path: string) => void;
  onHover: (path: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [openKind, setOpenKind] = useState<Insight["kind"] | null>(null);

  const insights = useMemo(() => insightsOf(parse), [parse]);
  const conventions = useMemo(() => entryPointCounts(parse), [parse]);
  const total = insights.reduce((sum, insight) => sum + insight.total, 0);

  if (insights.length === 0) {
    return (
      <section className="border-t border-border px-3.5 py-2.5">
        <h3 className="text-[10px] font-medium uppercase tracking-[0.06em] text-text-muted">
          Insights
        </h3>
        <p className="mt-1 text-[10px] leading-[15px] text-text-muted">
          Nothing to report on this repository.
        </p>
      </section>
    );
  }

  const active = insights.find((insight) => insight.kind === openKind) ?? insights[0];

  return (
    <section className="border-t border-border">
      <button
        aria-expanded={open}
        className="flex w-full cursor-pointer items-baseline gap-2 px-3.5 py-2.5 text-left hover:bg-surface-raised"
        onClick={() => setOpen(!open)}
        type="button"
      >
        <h3 className="flex-1 text-[10px] font-medium uppercase tracking-[0.06em] text-text-muted">
          Insights
        </h3>
        {/*
          The count is of files across all four, and the chevron is a character
          rather than a rotated element — nothing on this panel animates, and a
          rotation would be motion that nothing was clicked to justify.
        */}
        <span className="text-[9.5px] tabular-nums text-text-muted">{total} files</span>
        <span aria-hidden="true" className="text-[9px] text-text-muted">
          {open ? "▾" : "▸"}
        </span>
      </button>

      {open ? (
        <div>
          <ul className="border-t border-border">
            {insights.map((insight) => (
              <li key={insight.kind}>
                <button
                  aria-expanded={openKind === insight.kind}
                  className={`flex w-full cursor-pointer items-baseline gap-2 border-l-2 px-3.5 py-[5px] text-left text-[10.5px] ${
                    active === insight ? "border-accent text-text" : "border-transparent text-text-muted"
                  } hover:bg-surface-raised`}
                  onClick={() => setOpenKind(active === insight ? null : insight.kind)}
                  type="button"
                >
                  <span className="min-w-0 flex-1 truncate">{labelOf(insight.kind)}</span>
                  <span className="shrink-0 tabular-nums">
                    {shown(insight.total, insight.rows.length)}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <div className="border-t border-border px-3.5 py-2">
            <p className="text-[10px] leading-[15px] text-text-muted">{active.sentence}</p>
            {active.kind === "many-importers" || active.kind === "too-long" ? (
              <p className="mt-1 text-[9.5px] leading-[14px] text-text-muted">
                {active.kind === "many-importers"
                  ? `A file counts here at ${MANY_IMPORTERS} or more importers.`
                  : `A file counts here at ${TOO_MANY_LINES} lines or more.`}
              </p>
            ) : null}
          </div>

          <ul className="border-t border-border">
            {active.rows.map((row) => {
              const chosen = false;
              const pointed = hovered === row.path && !chosen;
              return (
                <li key={row.path}>
                  <button
                    className={`flex w-full items-baseline gap-2 border-l-2 px-3.5 py-[3px] text-left font-mono text-[10.5px] leading-[15px] ${
                      pointed
                        ? "border-accent/50 bg-accent/5 text-text"
                        : "border-transparent text-text-muted hover:bg-surface-raised hover:text-text"
                    }`}
                    onBlur={() => onHover(null)}
                    onClick={() => onSelect(row.path)}
                    onFocus={() => onHover(row.path)}
                    onMouseEnter={() => onHover(row.path)}
                    onMouseLeave={() => onHover(null)}
                    title={row.via ? `${row.path} → ${row.via}` : row.path}
                    type="button"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      <FileName path={row.path} />
                    </span>
                    {/*
                      A cycle's second file, in the title only. Printing it as a row
                      of its own would put one file in the list twice and read as two
                      findings.
                    */}
                    {row.via ? (
                      <span className="shrink-0 font-sans text-[9px] text-text-muted">loop</span>
                    ) : (
                      <span className="shrink-0 tabular-nums">{row.figure}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>

          <ConventionCounts counts={conventions} />
        </div>
      ) : null}
    </section>
  );
}

/**
 * What the conventions set aside, as counts.
 *
 * Not the files themselves: they were not findings, and listing sixteen of them
 * under a heading that says "insights" would turn an exclusion into an accusation.
 * The counts are here so the exclusions can be audited rather than trusted, and a
 * convention that quietly matched everything would be indistinguishable from one
 * that matched nothing.
 */
function ConventionCounts({ counts }: { counts: ReadonlyMap<string, number> }) {
  const rows = ENTRY_POINT_RULES.map((rule) => ({ rule, count: counts.get(rule.id) ?? 0 })).filter(
    (row) => row.count > 0,
  );
  if (rows.length === 0) return null;

  return (
    <div className="border-t border-border px-3.5 py-2">
      <p className="text-[9.5px] leading-[14px] text-text-muted">
        Not counted as unreferenced, because a convention reaches them rather than an
        import:
      </p>
      <ul className="mt-1">
        {rows.map(({ rule, count }) => (
          <li className="flex items-baseline gap-2 text-[9.5px] leading-[14px] text-text-muted" key={rule.id}>
            <span className="min-w-0 flex-1 truncate" title={rule.reason}>
              {rule.label}
            </span>
            <span className="shrink-0 tabular-nums">{count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function labelOf(kind: Insight["kind"]): string {
  switch (kind) {
    case "nothing-imports":
      return "Nothing imports these";
    case "many-importers":
      return `Many files import these (${MANY_IMPORTERS}+)`;
    case "too-long":
      return `Long files (${TOO_MANY_LINES}+ lines)`;
    case "cycle":
      return "Import cycles";
  }
}

/** How many of a total a list is showing. Says "all" when nothing was cut. */
function shown(total: number, listed: number): string {
  return total === listed ? String(total) : `${listed}/${total}`;
}
