import type { ParsedFile, RepositoryParseResult } from "@/parser/types.mts";
import { entryPointRuleFor } from "./entry-points.ts";

/**
 * The two transitive walks, and the four insights.
 *
 * All of it is arithmetic over the file list and the edge list. No model is
 * involved anywhere, and none is needed: every sentence the insight panel shows
 * is one of a fixed handful, chosen by which test a file passed.
 *
 * The walks and the cycles are iterative throughout. A repository of a few
 * hundred files has cycles and long chains in it, and a recursive walk would find
 * out the hard way.
 */

/** How far the walks go before they stop. Deeper returns most of the repository. */
export const WALK_DEPTH = 2;

/** Round numbers, stated in the panel so a reader can hold them in their head. */
export const MANY_IMPORTERS = 10;
export const TOO_MANY_LINES = 400;

/** Enough rows to see the shape of a finding without scrolling through 100 files. */
const INSIGHT_LIMIT = 20;

export interface WalkResult {
  /** Files reached, and how many edges from the start each one is. */
  paths: { path: string; depth: number }[];
  /** True when the walk hit the depth limit with files still beyond it. */
  truncated: boolean;
  /** Files at the far edge of the walk, for the summary line. */
  filesBeyond: number;
}

/**
 * Everything reachable from a file, or everything that can reach it.
 *
 * One function with a direction, because blast radius and dependency chain are the
 * same walk with the arrow pointing the other way, and two implementations of the
 * same walk is two places for them to disagree.
 *
 * `outward` false asks "what breaks if this changes" and follows importers, which
 * is what a blast radius is. True asks "what does this need" and follows imports.
 *
 * The start file is never in its own result, and a file already seen is not
 * revisited: a cycle must not become an infinite walk, and the shortest route to a
 * file is the one worth reporting.
 */
export function walkFrom(
  parse: RepositoryParseResult,
  from: string,
  { outward = false, depth = WALK_DEPTH }: { outward?: boolean; depth?: number } = {},
): WalkResult {
  const neighbours = neighbourIndex(parse, outward);
  const reached = new Map<string, number>();
  // The frontier is a queue of files and their distance. A breadth-first walk
  // reports the shortest route to each file, which is the number a reader wants
  // next to a path.
  let frontier: { path: string; depth: number }[] = [{ path: from, depth: 0 }];
  reached.set(from, 0);

  // The files sitting on the limit, collected as the walk passes them rather than
  // read off `frontier` afterwards. `frontier` is empty by the time the loop exits —
  // it emptied precisely *because* it reached the limit — so reading the boundary
  // from it afterwards finds nothing, and `filesBeyond` was always 0. A walk that
  // stops at two levels then claimed it had stopped short of nothing while quietly
  // dropping everything at three: depth 2 returned 61 files and depth 3 returned 75,
  // and both said there was nothing more.
  const boundary = new Set<string>();

  while (frontier.length > 0) {
    const next: { path: string; depth: number }[] = [];
    for (const { path, depth: current } of frontier) {
      if (current >= depth) {
        // One edge further than we are willing to go. The file itself is already in
        // `reached`; what is being counted is what lies past it.
        for (const neighbour of neighbours.get(path) ?? []) {
          if (neighbour !== from) boundary.add(neighbour);
        }
        continue;
      }
      for (const neighbour of neighbours.get(path) ?? []) {
        if (reached.has(neighbour)) continue;
        reached.set(neighbour, current + 1);
        next.push({ path: neighbour, depth: current + 1 });
      }
    }
    frontier = next;
  }

  reached.delete(from);

  // How much of the boundary the walk actually got to. A boundary file already in
  // `reached` was reached by a shorter route, so it is not "beyond" in any sense the
  // reader cares about — it is in the list above.
  const filesBeyond = [...boundary].filter((path) => !reached.has(path)).length;

  const paths = [...reached]
    .map(([path, level]) => ({ path, depth: level }))
    .sort((left, right) => left.depth - right.depth || (left.path < right.path ? -1 : 1));

  return { paths, truncated: filesBeyond > 0, filesBeyond };
}

/**
 * Both walks for one file, at the default depth.
 *
 * Returned together because the two buttons sit side by side and a reader will
 * press both; a reader who presses blast radius then dependency chain should see
 * two lists arrive rather than one list and then a pause.
 */
export function walksFor(
  parse: RepositoryParseResult,
  path: string,
  depth: number = WALK_DEPTH,
): { blast: WalkResult; chain: WalkResult } {
  return {
    blast: walkFrom(parse, path, { outward: false, depth }),
    chain: walkFrom(parse, path, { outward: true, depth }),
  };
}

/**
 * Files and cycles, as facts about the edge list.
 *
 * Each finding carries the fixed sentence the panel will print, decided here rather
 * than written at the point of display, so what the data says and what the reader
 * is told cannot drift apart.
 */
export type InsightKind = "nothing-imports" | "cycle" | "many-importers" | "too-long";

export interface Insight {
  kind: InsightKind;
  /** The fixed sentence. There is no other source for it. */
  sentence: string;
  /** Headline count, for the panel's summary row. */
  count: number;
  /** Rows to list, already capped and ordered. */
  rows: InsightRow[];
  /** The real total behind `rows`, when `rows` is shorter. */
  total: number;
}

export interface InsightRow {
  /** The file this row is about. */
  path: string;
  lines: number;
  /** The figure the row is ranked by, already formatted for display. */
  figure: string;
  /** For a cycle, the file that closes it. Otherwise null. */
  via: string | null;
}

export const INSIGHT_ORDER: readonly InsightKind[] = [
  // Files-nothing-imports leads. It is the one that is explanatory rather than a
  // verdict, and for somebody opening a codebase they did not write it is where
  // reading starts. Cycles and oversized read closer to judging the code, so they
  // sit underneath.
  "nothing-imports",
  "many-importers",
  "too-long",
  "cycle",
];

/** The fixed sentence per kind. Wording lives here and nowhere else. */
const SENTENCE: Record<InsightKind, string> = {
  "nothing-imports":
    "Nothing in this repository imports these. A convention reaches some files — config, tests, pages and entry points — and those are counted separately, so what is left here is referenced by no import at all.",
  "many-importers": "Many files import these. A change to one of them reaches everywhere it points.",
  "too-long": "These files are long. A reader will spend a while in any of them.",
  cycle:
    "These files import each other, in a loop. A reader entering at any point of it cannot tell where the work starts.",
};

export function insightsOf(parse: RepositoryParseResult): Insight[] {
  return INSIGHT_ORDER.map((kind) => buildInsight(parse, kind)).filter(
    (insight): insight is Insight => insight !== null,
  );
}

function buildInsight(parse: RepositoryParseResult, kind: InsightKind): Insight | null {
  const files = new Map(parse.files.map((file) => [file.path, file]));
  const importers = importerCounts(parse);

  if (kind === "nothing-imports") {
    // Only files no convention reaches, and only those nothing imports. Both
    // conditions, or the finding is a statement about the parser's own view.
    const unreachable = (file: ParsedFile): boolean =>
      (importers.get(file.path) ?? 0) === 0 && entryPointRuleFor(file) === null;

    const matched = parse.files.filter(unreachable).sort(byLinesThenPath);
    if (matched.length === 0) return null;
    return {
      kind,
      sentence: SENTENCE[kind],
      count: matched.length,
      rows: matched.slice(0, INSIGHT_LIMIT).map((file) => toRow(file, "—", null)),
      total: matched.length,
    };
  }

  if (kind === "many-importers") {
    const matched = parse.files
      .filter((file) => (importers.get(file.path) ?? 0) >= MANY_IMPORTERS)
      .sort((left, right) => countOf(importers, right) - countOf(importers, left) || byLinesThenPath(left, right));
    if (matched.length === 0) return null;
    return {
      kind,
      sentence: SENTENCE[kind],
      count: matched.length,
      rows: matched
        .slice(0, INSIGHT_LIMIT)
        .map((file) => toRow(file, String(countOf(importers, file)), null)),
      total: matched.length,
    };
  }

  if (kind === "too-long") {
    const matched = parse.files
      .filter((file) => file.lines >= TOO_MANY_LINES)
      .sort((left, right) => right.lines - left.lines || byLinesThenPath(left, right));
    if (matched.length === 0) return null;
    return {
      kind,
      sentence: SENTENCE[kind],
      count: matched.length,
      rows: matched.slice(0, INSIGHT_LIMIT).map((file) => toRow(file, `${file.lines} lines`, null)),
      total: matched.length,
    };
  }

  const loops = cyclesOf(parse);
  if (loops.length === 0) return null;
  const rows = loops
    .slice(0, INSIGHT_LIMIT)
    .map((loop) => toRow(files.get(loop.from) as ParsedFile, `${loop.length} files`, loop.to));
  return { kind, sentence: SENTENCE[kind], count: loops.length, rows, total: loops.length };
}

/**
 * Import cycles, iteratively.
 *
 * Three-colour depth-first search over an explicit stack: a file is unvisited,
 * on the current path, or finished. Meeting a file still on the path is a cycle,
 * and meeting a finished one is not — which is the whole difference between
 * finding every cycle in a graph and reporting the same one repeatedly.
 *
 * No recursion anywhere in here. A repository with a few hundred files has cycles
 * long enough to be interesting, and a recursive walk of the same graph is a
 * stack overflow waiting for the largest repository somebody pastes in.
 */
export function cyclesOf(parse: RepositoryParseResult): { from: string; to: string; length: number }[] {
  const imports = neighbourIndex(parse, true);
  const UNVISITED = 0;
  const ON_PATH = 1;
  const DONE = 2;

  const colour = new Map<string, number>();
  const found = new Map<string, { from: string; to: string; length: number }>();
  const order = parse.files.map((file) => file.path);

  for (const start of order) {
    if (colour.get(start) !== undefined) continue;

    // The stack holds the path currently being walked, and the index into each
    // node's import list. That index is what makes it iterative rather than
    // recursive: the walk resumes where it left off instead of calling itself.
    const path: string[] = [start];
    const cursor: number[] = [0];
    colour.set(start, ON_PATH);

    while (path.length > 0) {
      const depth = path.length - 1;
      const node = path[depth] as string;
      const next = imports.get(node) ?? [];
      const index = cursor[depth] as number;

      if (index >= next.length) {
        colour.set(node, DONE);
        path.pop();
        cursor.pop();
        continue;
      }

      cursor[depth] = index + 1;
      const child = next[index] as string;
      const state = colour.get(child) ?? UNVISITED;

      if (state === ON_PATH) {
        // A back edge: `child` is somewhere above us on this very path. The loop
        // runs from `child` down to here and back.
        const from = child;
        const startIndex = path.indexOf(child);
        const length = path.length - startIndex;
        // One cycle per pair. The same loop found from a different member of it is
        // the same loop, and listing it twice makes a repository look worse than it is.
        const key = `${from}|${node}`;
        if (!found.has(key)) found.set(key, { from: node, to: child, length });
        continue;
      }

      if (state === DONE) continue;

      colour.set(child, ON_PATH);
      path.push(child);
      cursor.push(0);
    }
  }

  return [...found.values()].sort(
    (left, right) => right.length - left.length || compare(left.from, right.from),
  );
}

/** How many distinct files import each file. */
export function importerCounts(parse: RepositoryParseResult): Map<string, number> {
  const sets = new Map<string, Set<string>>();
  for (const edge of parse.edges) {
    const existing = sets.get(edge.to);
    if (existing) existing.add(edge.from);
    else sets.set(edge.to, new Set([edge.from]));
  }
  return new Map([...sets].map(([path, sources]) => [path, sources.size]));
}

/**
 * Files each file imports, or files that import it.
 *
 * Sorted, so the walk visits a file's neighbours in the same order every time and
 * the reported depth for any file is the same on every run.
 */
function neighbourIndex(
  parse: RepositoryParseResult,
  outward: boolean,
): Map<string, string[]> {
  const sets = new Map<string, Set<string>>();
  for (const edge of parse.edges) {
    const key = outward ? edge.from : edge.to;
    const value = outward ? edge.to : edge.from;
    const existing = sets.get(key);
    if (existing) existing.add(value);
    else sets.set(key, new Set([value]));
  }
  return new Map([...sets].map(([path, neighbours]) => [path, [...neighbours].sort(compare)]));
}

function toRow(file: ParsedFile, figure: string, via: string | null): InsightRow {
  return { path: file.path, lines: file.lines, figure, via };
}

function countOf(counts: ReadonlyMap<string, number>, file: ParsedFile): number {
  return counts.get(file.path) ?? 0;
}

function byLinesThenPath(left: ParsedFile, right: ParsedFile): number {
  if (left.lines !== right.lines) return right.lines - left.lines;
  return compare(left.path, right.path);
}

/** Code-unit ordering rather than `localeCompare`, which varies by machine. */
function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
