import type { ParsedFile, RepositoryParseResult } from "@/parser/types.mts";
import { bucketOf, categoryLabel, countUnplaced, ROOT_BUCKET, type CategorySet } from "./categories.ts";
import { entryPointRuleFor } from "./entry-points.ts";
import { detectFrameworks, type DetectedFramework } from "./framework.ts";
import type { MapGraph } from "./graph.ts";

/**
 * What the right-hand pane says, as pure functions over the parsed repository.
 *
 * Nothing here fetches, and nothing here is React. Every figure the pane prints
 * is arithmetic over the file list and the edge list, which is what lets the same
 * numbers be checked from a terminal rather than read off a screen.
 *
 * A count and its list are never computed separately. The lists are built first
 * and the counts come off their length, so a figure that says seven over six rows
 * is not a state this file can produce.
 */

/** Enough of the most-imported list to see the shape of it without scrolling. */
const TOP_IMPORTED = 12;

/** Enough orphans to start reading from, with the real total beside them. */
const TOP_ORPHANS = 12;

export interface FileSummary {
  path: string;
  /** How many distinct files import it. */
  fanIn: number;
  /** How many distinct files it imports. */
  fanOut: number;
  lines: number;
}

/**
 * The repository as a whole, for the pane's resting state.
 *
 * Deselecting returns here rather than to an empty column, so this is the first
 * thing anyone sees and it has to answer "what is this repository" on its own.
 */
export interface RepositoryDetail {
  kind: "repository";
  name: string;
  /**
   * The parse this repository was described from, for the insights panel.
   *
   * The same reason a file carries its parse: the insights are arithmetic over the
   * edge list, and a pane that had to be handed the parse separately is a pane that
   * can be handed a different one.
   */
  parse: RepositoryParseResult;
  frameworks: DetectedFramework[];
  fileCount: number;
  /** Files discovery found but parsing did not take, with coverage saying why. */
  skippedCount: number;
  /** Import edges resolved to a file inside the repository. */
  importCount: number;
  /** Import statements that pointed outside the repository and were not edges. */
  externalImportCount: number;
  /** Import statements that could not be resolved at all, with examples beside it. */
  unresolvedImportCount: number;
  /**
   * Routes, which the parser does not extract.
   *
   * Typed as `false` rather than omitted, so a component cannot read a route count
   * off this by accident and print one. The project refuses approximate routes: if
   * a route's method and path cannot both be recovered from the syntax, there is
   * nothing to show, and "0 routes" would say this repository has none when it
   * only says they were never looked for.
   */
  routesParsed: false;
  /**
   * Files the grouping convention had nowhere to place.
   *
   * The category grouping cuts at one depth, and a file in a folder shallower than
   * that depth is counted on the repository root's row rather than attributed to a
   * folder it is not in. This is the number of files in that position, so the
   * classification's coverage is visible rather than assumed.
   */
  unplacedCount: number;
  /**
   * The most depended-on files, ordered by how many things import them.
   *
   * Capped, with the real total beside it. A capped list whose total is not shown
   * would be a tidy picture standing in for a hundred and six files.
   */
  mostImported: FileSummary[];
  mostImportedTotal: number;
  /** Files nothing imports and no convention reaches either, where reading starts. */
  orphans: FileSummary[];
  orphanTotal: number;
  /**
   * Files nothing imports that a convention does reach — tests, configs, entry
   * points. Reported as a count so the two lists reconcile and so the size of the
   * convention's reach is visible rather than assumed.
   */
  reachedByConvention: number;
}

export interface FileDetail {
  kind: "file";
  path: string;
  folder: string;
  language: ParsedFile["language"];
  lines: number;
  /**
   * The parse this file was described from.
   *
   * Carried rather than passed alongside, because the two walks need the edge list
   * and threading it through every component as a second prop is how one of them
   * ends up describing a different repository than the pane above it.
   */
  parse: RepositoryParseResult;
  /** The bucket the file sits in, which is the category it is shown under. */
  category: { id: string; label: string; swatch: number };
  /** Files this one imports, deduplicated, sorted. */
  imports: FileSummary[];
  /** Files that import this one, deduplicated, sorted. */
  importedBy: FileSummary[];
}

/**
 * One part of a folder: a subfolder of it, or the files written directly into it.
 *
 * Deliberately not a category. The categories group the whole repository at one
 * depth, so a folder sitting inside one of them is entirely one category and the
 * breakdown would be a single row for almost every folder. What someone opening
 * `packages/kit/src/runtime` wants is how it divides up, and that division is its
 * own — which is why the swatch travels as `null` rather than borrowing a hue that
 * already means a category somewhere else on screen.
 */
export interface FolderPart {
  id: string;
  label: string;
  /** Files in this part. */
  fileCount: number;
  /** Lines in this part. */
  lines: number;
  /** The category the part sits in, for the one row that shows a swatch. */
  swatch: number | null;
}

export interface FolderDetail {
  kind: "folder";
  path: string;
  fileCount: number;
  lines: number;
  fanIn: number;
  fanOut: number;
  /** How the folder divides up: its subfolders and its own loose files. */
  parts: FolderPart[];
  /** Distinct directed file pairs inside this folder, which a collapsed box cannot draw. */
  internalEdgeCount: number;
}

export type Detail = RepositoryDetail | FileDetail | FolderDetail;

/** Whatever is selected, described. Nothing selected is the repository itself. */
export function describeDetail(
  parse: RepositoryParseResult,
  categories: CategorySet,
  map: MapGraph,
  selection: string | null,
): Detail {
  if (selection === null) return describeRepository(parse, categories);
  if (selection.startsWith("folder:")) {
    return describeFolder(parse, categories, map, selection) ?? describeRepository(parse, categories);
  }
  if (selection.startsWith("file:")) {
    const path = selection.slice("file:".length);
    return describeFile(parse, categories, path) ?? describeRepository(parse, categories);
  }
  return describeRepository(parse, categories);
}

export function describeRepository(parse: RepositoryParseResult, categories: CategorySet): RepositoryDetail {
  const importers = importerSets(parse);
  const importees = importeeSets(parse);
  const summaryOf = (file: ParsedFile): FileSummary => toSummary(file, importers, importees);

  const ranked = parse.files
    .map(summaryOf)
    .filter((summary) => summary.fanIn > 0)
    .sort(byFanInThenPath);

  // Only files no convention reaches. A test, a config file and a page are
  // imported by nothing and are not orphans — they are reached by a runner, a build
  // tool and a framework — and listing them here would contradict the insight panel
  // below, which draws the same line. The count of what was set aside is reported
  // so the two lists can be reconciled.
  const orphans = parse.files
    .filter((file) => (importers.get(file.path)?.size ?? 0) === 0)
    .filter((file) => entryPointRuleFor(file) === null)
    .map(summaryOf)
    .sort(byPath);

  let reachedByConvention = 0;
  for (const file of parse.files) {
    if ((importers.get(file.path)?.size ?? 0) === 0 && entryPointRuleFor(file) !== null) {
      reachedByConvention += 1;
    }
  }

  return {
    kind: "repository",
    name: repositoryNameOf(parse.repositoryPath),
    parse,
    frameworks: detectFrameworks(parse),
    fileCount: parse.summary.filesParsed,
    skippedCount: parse.summary.filesSkipped,
    importCount: parse.edges.length,
    externalImportCount: parse.coverage.outside,
    unresolvedImportCount: parse.coverage.unresolved,
    routesParsed: false,
    unplacedCount: countUnplaced(parse.files, categories.depth),
    mostImported: ranked.slice(0, TOP_IMPORTED),
    mostImportedTotal: ranked.length,
    orphans: orphans.slice(0, TOP_ORPHANS),
    orphanTotal: orphans.length,
    reachedByConvention,
  };
}

/**
 * What one selected file is.
 *
 * The two lists are distinct files, not distinct import statements. A file that
 * imports another twice is one row, because the question is what depends on what
 * rather than how often the code said so.
 */
export function describeFile(
  parse: RepositoryParseResult,
  categories: CategorySet,
  path: string,
): FileDetail | null {
  const file = parse.files.find((candidate) => candidate.path === path);
  if (!file) return null;

  const importers = importerSets(parse);
  const importees = importeeSets(parse);
  const byPath = new Map(parse.files.map((candidate) => [candidate.path, candidate]));
  const summaryOf = (candidate: string): FileSummary => {
    const found = byPath.get(candidate);
    return found ? toSummary(found, importers, importees) : { path: candidate, fanIn: 0, fanOut: 0, lines: 0 };
  };

  const categoryId = bucketOf(file.folder, categories.depth);
  return {
    kind: "file",
    path: file.path,
    folder: file.folder,
    language: file.language,
    lines: file.lines,
    parse,
    category: {
      id: categoryId,
      label: categoryLabel(categoryId),
      swatch: categories.categories.find((category) => category.id === categoryId)?.swatch ?? 0,
    },
    // Sorted by code unit rather than by fan-in: a list of what depends on this
    // file is read by scanning for a name, and a ranking puts the same ten
    // utilities at the top of every one of them.
    imports: [...(importees.get(path) ?? [])].sort(compare).map(summaryOf),
    importedBy: [...(importers.get(path) ?? [])].sort(compare).map(summaryOf),
  };
}

/**
 * What one selected folder holds.
 *
 * A folded folder is not a file, so there is no list of imports to show — the box
 * already carries its own fan-in and fan-out. What is useful here is how the
 * folder divides up: its immediate subfolders, and the files written straight into
 * it, each with its own file and line count.
 */
export function describeFolder(
  parse: RepositoryParseResult,
  categories: CategorySet,
  map: MapGraph,
  folderId: string,
): FolderDetail | null {
  const folder = map.folders.find((candidate) => candidate.id === folderId);
  if (!folder) return null;

  // A path-prefix scan, not a list carried on the node. `MapFolder` has no file list
  // — `rows` is only what the panel is currently showing, which is fewer files than
  // the folder holds once it is scrolled — so there is nothing to read from it.
  // Prefix matching also handles the root, which `ROOT_BUCKET` names rather than any
  // real directory.
  const files = parse.files.filter((file) => inFolder(file, folder.path));
  const byPart = new Map<string, FolderPart>();
  let lines = 0;

  for (const file of files) {
    lines += file.lines;
    const id = partOf(file.folder, folder.path);
    const existing = byPart.get(id);
    if (existing) {
      existing.fileCount += 1;
      existing.lines += file.lines;
      continue;
    }
    // A subfolder is its own name, because the reader has just clicked a folder and
    // a full path back down to it would be the thing they are already looking at.
    // Loose files say so, since "(loose files)" is not a directory that exists.
    byPart.set(id, {
      id,
      label: id === LOOSE_FILES ? LOOSE_FILES : id.slice(id.lastIndexOf("/") + 1),
      fileCount: 1,
      lines: file.lines,
      swatch: null,
    });
  }

  // Edges wholly inside the folder. A collapsed box cannot draw these, because
  // both ends are the same node — so their absence from the map is not evidence
  // they do not exist, and saying so is the difference between "no internal
  // imports" and "not visible while folded".
  const held = new Set(files.map((file) => file.path));
  const internalPairs = new Set<string>();
  for (const edge of parse.edges) {
    if (held.has(edge.from) && held.has(edge.to)) internalPairs.add(JSON.stringify([edge.from, edge.to]));
  }

  return {
    kind: "folder",
    path: folder.path,
    fileCount: files.length,
    lines,
    fanIn: folder.fanIn,
    fanOut: folder.fanOut,
    // Biggest first, then by path, so the same folder always reads the same way.
    parts: [...byPart.values()].sort(
      (left, right) => right.fileCount - left.fileCount || compare(left.id, right.id),
    ),
    internalEdgeCount: internalPairs.size,
  };
}

/** Where a file sits inside a folder: one of its subfolders, or directly in it. */
export const LOOSE_FILES = "directly in this folder";

function partOf(folder: string, parent: string): string {
  if (folder === parent) return LOOSE_FILES;
  const rest = folder.slice(parent === ROOT_BUCKET ? 0 : parent.length + 1);
  const cut = rest.indexOf("/");
  return cut < 0 ? rest : rest.slice(0, cut);
}

/**
 * Which files import each file.
 *
 * Sets, not counts, because the number of importers is not the number of import
 * statements and the pane lists importers rather than statements.
 */
function importerSets(parse: RepositoryParseResult): Map<string, Set<string>> {
  return edgeSets(parse, "to", "from");
}

/** Which files each file imports. */
function importeeSets(parse: RepositoryParseResult): Map<string, Set<string>> {
  return edgeSets(parse, "from", "to");
}

function edgeSets(
  parse: RepositoryParseResult,
  key: "from" | "to",
  value: "from" | "to",
): Map<string, Set<string>> {
  const sets = new Map<string, Set<string>>();
  for (const edge of parse.edges) {
    const existing = sets.get(edge[key]);
    if (existing) existing.add(edge[value]);
    else sets.set(edge[key], new Set([edge[value]]));
  }
  return sets;
}

function toSummary(
  file: ParsedFile,
  importers: ReadonlyMap<string, Set<string>>,
  importees: ReadonlyMap<string, Set<string>>,
): FileSummary {
  return {
    path: file.path,
    fanIn: importers.get(file.path)?.size ?? 0,
    fanOut: importees.get(file.path)?.size ?? 0,
    lines: file.lines,
  };
}

function inFolder(file: ParsedFile, folder: string): boolean {
  return folder === ROOT_BUCKET || file.folder === folder || file.folder.startsWith(`${folder}/`);
}

/** The repository's own name, from the path it was parsed from. */
function repositoryNameOf(repositoryPath: string): string {
  const last = repositoryPath.split(/[\\/]/).filter(Boolean).at(-1);
  if (!last) return "repository";
  // A local clone is often named `owner--repo`, which says nothing about what the
  // repository is called. Where the name carries that separator, the part after it
  // is the repository.
  const separator = last.indexOf("--");
  return separator >= 0 && separator + 2 < last.length ? last.slice(separator + 2) : last;
}

function byFanInThenPath(left: FileSummary, right: FileSummary): number {
  if (left.fanIn !== right.fanIn) return right.fanIn - left.fanIn;
  return compare(left.path, right.path);
}

function byPath(left: FileSummary, right: FileSummary): number {
  return compare(left.path, right.path);
}

/** Code-unit ordering rather than `localeCompare`, which varies by machine. */
function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
