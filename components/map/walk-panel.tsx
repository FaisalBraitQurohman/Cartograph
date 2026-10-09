"use client";

import type { WalkResult } from "@/lib/graph/insights.ts";
import { FileName } from "./path-list";

/**
 * What a transitive walk found, as a list.
 *
 * Both walks land here. Blast radius and dependency chain are one function with a
 * direction, so there is one thing that renders a result and one number that says
 * it stopped short rather than ran out of files.
 *
 * Nothing in this component fetches. A walk is arithmetic over the edge list, which
 * is already in the browser, so the list appears on the same frame as the click and
 * there is no spinner that could imply otherwise.
 */
export function WalkPanel({
  title,
  subtitle,
  empty,
  result,
  depth,
  selected,
  hovered,
  onSelect,
  onHover,
}: {
  title: string;
  subtitle: string;
  /** What an empty result means for this walk. The two directions are opposites. */
  empty: string;
  result: WalkResult;
  depth: number;
  selected: string | null;
  hovered: string | null;
  onSelect: (path: string) => void;
  onHover: (path: string | null) => void;
}) {
  if (result.paths.length === 0) {
    return (
      <section>
        <Header title={title} subtitle={subtitle} />
        {/*
          `empty` rather than a sentence written here. The two walks are opposites —
          one asks what reaches this file and the other what this file needs — so a
          single sentence read as "nothing reaches this file" under a dependency
          chain, which says the reverse of what an empty chain means.
        */}
        <p className="px-3.5 py-2 text-[10.5px] leading-[15px] text-text-muted">
          {empty} within {depth} levels.
        </p>
      </section>
    );
  }

  const byDepth = new Map<number, number>();
  for (const path of result.paths) {
    byDepth.set(path.depth, (byDepth.get(path.depth) ?? 0) + 1);
  }

  return (
    <section>
      <Header title={title} subtitle={subtitle} />

      <div className="flex gap-3 border-b border-border px-3.5 py-1.5 text-[9.5px] tabular-nums text-text-muted">
        {[...byDepth.keys()]
          .sort((left, right) => left - right)
          .map((level) => (
            <span key={level}>
              {level} {level === 1 ? "level" : "levels"}: {byDepth.get(level)}
            </span>
          ))}
      </div>

      <ul>
        {result.paths.map((entry) => {
          const chosen = selected === entry.path;
          const pointed = hovered === entry.path && !chosen;
          return (
            <li key={entry.path}>
              <button
                className={`flex w-full items-baseline gap-2 border-l-2 py-[3px] pl-3.5 pr-3.5 text-left font-mono text-[10.5px] leading-[15px] ${
                  chosen
                    ? "border-accent bg-accent/10 text-text"
                    : pointed
                      ? "border-accent/50 bg-accent/5 text-text"
                      : "border-transparent text-text-muted hover:bg-surface-raised hover:text-text"
                }`}
                onBlur={() => onHover(null)}
                onClick={() => onSelect(entry.path)}
                onFocus={() => onHover(entry.path)}
                onMouseEnter={() => onHover(entry.path)}
                onMouseLeave={() => onHover(null)}
                title={entry.path}
                type="button"
              >
                {/*
                  The level is set in the margin rather than in the path, because
                  the level is what is being read down this column and indenting the
                  path would move the part somebody is scanning for.
                */}
                <span className="w-3 shrink-0 text-right text-[9.5px] tabular-nums text-text-muted">
                  {entry.depth}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  <FileName path={entry.path} />
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {/*
        Saying the walk stopped short, with how much. Without it, a list of 60 files
        at two levels reads as "these 60 files and nothing further", which is a claim
        about the repository rather than about the depth limit.
      */}
      {result.truncated ? (
        <p className="border-t border-border px-3.5 py-2 text-[10px] leading-[15px] text-text-muted">
          Stopped at {depth} levels. {result.filesBeyond} more file
          {result.filesBeyond === 1 ? "" : "s"} beyond that, not listed.
        </p>
      ) : null}
    </section>
  );
}

function Header({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="px-3.5 py-2">
      <h3 className="text-[10px] font-medium uppercase tracking-[0.06em] text-text-muted">{title}</h3>
      <p className="mt-0.5 text-[10px] leading-[15px] text-text-muted">{subtitle}</p>
    </div>
  );
}
