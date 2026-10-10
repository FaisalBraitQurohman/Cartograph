import type { RepositoryParseResult } from "@/parser/types.mts";
import { bucketOf } from "./categories.ts";
import type { FoldResult, FolderNode } from "./fold.ts";
import { shortestUniqueLabels } from "./labels.ts";

/**
 * From the parser's output to the things the canvas draws.
 *
 * The parser's shape is left alone: files keep their paths, edges keep the two
 * files they were resolved between, and nothing here decides that two files are
 * connected. This file only decides which files share a box and where an edge
 * lands once a box has been opened.
 */

/**
 * How many rows a panel shows at once.
 *
 * A panel that grew to fit every file would be taller than the canvas and push
 * the rest of the map off screen, so it shows a window and scrolls through the
 * rest. The window is fixed rather than sized to the folder, so opening a folder
 * with three files and one with sixty move the same amount.
 */
export const PANEL_VISIBLE_ROWS = 10;

export const PANEL_HEADER_HEIGHT = 38;
export const PANEL_ROW_HEIGHT = 22;
export const PANEL_FOOTER_HEIGHT = 20;

export function folderItemId(path: string): string {
  return `folder:${path}`;
};

export function fileItemId(path: string): string {
  return `file:${path}`;
}

/** The folder path behind a folder item id. */
export function folderPathOf(itemId: string): string {
  return itemId.slice("folder:".length);
};

export type PanelRow = {
  /** The item id, and the canvas node id, of this row. */
  id: string;
  path: string;
  label: string;
  fanIn: number;
  fanOut: number;
  index: number;
};

export type MapFolder = {
  id: string;
  kind: "folder";
  /** Shortest unique name. */
  label: string;
  path: string;
  fileCount: number;
  /** Distinct folders that import something in here. */
  fanIn: number;
  /** Distinct folders this one imports something in. */
  fanOut: number;
  open: boolean;
  rows: PanelRow[];
  /** Files the panel is not showing, because it is scrolled away or has no room. */
  hiddenRowCount: number;
  /** Index of the first row on screen. */
  scroll: number;
  /** How many rows the panel can scroll past. Zero when everything fits. */
  scrollableBy: number;
  width: number;
  height: number;
};

export type MapRow = {
  id: string;
  kind: "file";
  label: string;
  path: string;
  panelId: string;
  /** Position within the panel, which is where the row is drawn. */
  index: number;
  fanIn: number;
  fanOut: number;
  width: number;
  height: number;
};

export type MapEdge = {
  id: string;
  source: string;
  target: string;
  /** How many real file-to-file edges this one stands in for. */
  weight: number;
};

export interface MapGraph {
  folders: MapFolder[];
  rows: MapRow[];
  edges: MapEdge[];
  /** Every canvas item id, for the checks that edges must terminate on one. */
  itemIds: Set<string>;
  /**
   * How many of a folder's files sit in a category, keyed by folder path.
   *
   * Read off the fold rather than recomputed by a caller, so a panel's match count
   * is the same number as the rail's row and not a second answer to the same
   * question. Counted over the whole folder and not over the scroll window: a
   * category lives in a folder, and a panel scrolled to its second page still
   * belongs to it.
   */
  filesOf: (folderPath: string, categoryId: string) => number;
};

/**
 * `expanded` is the set of folder ids currently open. Passing it in rather than
 * reading it from anywhere else is what makes the ordering safe: the refit that
 * follows a change reads the same set the new layout was built from, not the
 * one that was there a render ago.
 */
export function deriveMap(
  parse: RepositoryParseResult,
  fold: FoldResult,
  expanded: ReadonlySet<string>,
  scrolled: ReadonlyMap<string, number> = new Map(),
  depth = 2,
): MapGraph {
  const nodeIds = new Set(fold.nodes.map((node) => node.id));
  const open = new Set([...expanded].filter((id) => nodeIds.has(id)));
  const nodeOfFile = fold.nodeOfFile;

  // Which files are on screen right now: the ones inside their panel's scroll
  // window. A file outside the window is represented by the box holding it, so
  // its edge still lands on something real rather than on nothing.
  const windowOf = new Map<string, { start: number; end: number }>();
  const shownFile = new Set<string>();
  for (const node of fold.nodes) {
    if (!open.has(node.id)) continue;
    const start = clampStart(scrolled.get(node.id) ?? 0, node.fileCount);
    const end = Math.min(node.fileCount, start + PANEL_VISIBLE_ROWS);
    windowOf.set(node.id, { start, end });
    for (const path of node.files.slice(start, end)) shownFile.add(path);
  }

  // This is the only place a decision is made about an edge: which drawn thing
  // each end attaches to. It is a lookup against the expansion state, not a
  // judgement about whether two files are connected.
  const itemOfFile = new Map<string, string>();
  for (const file of parse.files) {
    const folder = nodeOfFile.get(file.path);
    if (folder === undefined) continue;
    const asRow = open.has(folder) && shownFile.has(file.path);
    itemOfFile.set(file.path, asRow ? fileItemId(file.path) : folderItemId(folder));
  }

  const folderDegrees = folderFan(parse, nodeOfFile);
  const folderLabels = shortestUniqueLabels(fold.nodes.map((node) => node.id));

  const folders: MapFolder[] = [];
  const rows: MapRow[] = [];

  for (const node of fold.nodes) {
    const isOpen = open.has(node.id);
    const window = windowOf.get(node.id);
    const scroll = window ? window.start : 0;
    const panelRows = isOpen ? buildRows(node, parse, itemOfFile, window) : [];
    const hiddenRowCount = isOpen ? node.fileCount - panelRows.length : 0;
    const label = folderLabels.get(node.id) ?? node.id;
    const degree = folderDegrees.get(node.id) ?? { in: 0, out: 0 };
    const size = isOpen
      ? panelSize(label, panelRows, hiddenRowCount)
      : boxSize(label, node.fileCount, degree.in, degree.out);

    folders.push({
      id: folderItemId(node.id),
      kind: "folder",
      label,
      path: node.id,
      fileCount: node.fileCount,
      fanIn: degree.in,
      fanOut: degree.out,
      open: isOpen,
      rows: panelRows,
      hiddenRowCount,
      // Where the panel is scrolled to, and how far it can go. The panel draws
      // its own scrollbar from these.
      scroll,
      scrollableBy: isOpen ? Math.max(0, node.fileCount - PANEL_VISIBLE_ROWS) : 0,
      ...size,
    });

    for (const row of panelRows) {
      rows.push({
        id: row.id,
        kind: "file",
        label: row.label,
        path: row.path,
        panelId: folderItemId(node.id),
        index: row.index,
        fanIn: row.fanIn,
        fanOut: row.fanOut,
        width: size.width - 8,
        height: PANEL_ROW_HEIGHT,
      });
    }
  }

  const pairs = new Map<string, MapEdge>();
  for (const edge of parse.edges) {
    const source = itemOfFile.get(edge.from);
    const target = itemOfFile.get(edge.to);
    // An edge between two files inside the same box has nowhere to go until
    // that box is open, and by then the two ends are different rows.
    if (source === undefined || target === undefined || source === target) continue;

    const id = `${source}->${target}`;
    const existing = pairs.get(id);
    if (existing) existing.weight += 1;
    else pairs.set(id, { id, source, target, weight: 1 });
  }

  const edges = [...pairs.values()].sort(
    (left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
  );
  const itemIds = new Set<string>([
    ...folders.map((folder) => folder.id),
    ...rows.map((row) => row.id),
  ]);

  // Counted once over the files and once over the folders, rather than per category
  // per folder. Sixteen categories across twenty-four folders is 384 buckets that
  // way, and every one of them is thrown away when the reader clicks a different
  // rail row.
  const bucketOfFile = new Map(parse.files.map((file) => [file.path, bucketOf(file.folder, depth)]));
  const filesPerBucket = new Map<string, Map<string, number>>();
  for (const node of fold.nodes) {
    const perBucket = new Map<string, number>();
    for (const path of node.files) {
      const bucket = bucketOfFile.get(path);
      if (bucket === undefined) continue;
      perBucket.set(bucket, (perBucket.get(bucket) ?? 0) + 1);
    }
    filesPerBucket.set(node.id, perBucket);
  }

  return {
    folders,
    rows,
    edges,
    itemIds,
    /**
     * How many of a folder's files sit in a category.
     *
     * Takes the folder path rather than the item id, because the counts are keyed by
     * folder path. Accepting the id — the thing a caller has in hand when it is
     * holding a node — and stripping the prefix here is the alternative, and it puts
     * an `itemIds` prefix in a function that otherwise knows nothing about the
     * canvas.
     */
    filesOf: (folderPath: string, categoryId: string): number =>
      filesPerBucket.get(folderPath)?.get(categoryId) ?? 0,
  };
};

function buildRows(
  node: FolderNode,
  parse: RepositoryParseResult,
  itemOfFile: ReadonlyMap<string, string>,
  window: { start: number; end: number } | undefined,
): PanelRow[] {
  const shown = node.files.slice(window?.start ?? 0, window?.end ?? node.fileCount);
  // Labels are computed over what is on screen, not over the whole folder, so a
  // row that happens to share a basename with one three pages up still gets the
  // short name.
  const labels = shortestUniqueLabels(shown);
  const incoming = fileFanIn(parse, itemOfFile);
  const outgoing = fileFanOut(parse, itemOfFile);
  const first = window?.start ?? 0;

  return shown.map((path, index) => ({
    id: fileItemId(path),
    path,
    label: labels.get(path) ?? path,
    fanIn: incoming.get(path) ?? 0,
    fanOut: outgoing.get(path) ?? 0,
    index: first + index,
  }));
}

/**
 * A closed box is as tall as its fan-in, because that is the number worth
 * seeing at a glance, and as wide as its label needs — a long name must not
 * read as an important folder.
 */
/**
 * Width comes from the label and from the three numbers under it, never from the
 * fan-in — otherwise a long name would read as an important folder. Height does
 * come from the fan-in, because that is the number worth seeing at a glance.
 */
function boxSize(label: string, fileCount: number, fanIn: number, fanOut: number): { width: number; height: number } {
  const labelWidth = label.length * 6.4;
  const figuresWidth = `${fileCount} files`.length * 5.4 + `${fanIn}`.length * 5.4 + `${fanOut}`.length * 5.4 + 34;
  return {
    width: clamp(Math.max(120 + labelWidth, 16 + figuresWidth), 132, 244),
    height: clamp(38 + fanIn * 2.6, 38, 132),
  };
};

function panelSize(
  label: string,
  rows: readonly PanelRow[],
  hiddenRowCount: number,
): { width: number; height: number } {
  const widestRow = rows.reduce((widest, row) => Math.max(widest, row.label.length), 0);
  const widest = Math.max(label.length + 16, widestRow + 12);
  return {
    width: clamp(176 + widest * 6.2, 208, 340),
    height:
      PANEL_HEADER_HEIGHT +
      rows.length * PANEL_ROW_HEIGHT +
      (hiddenRowCount > 0 ? PANEL_FOOTER_HEIGHT : 0),
  };
};

/**
 * Folder fan-in and fan-out, counted between folders.
 *
 * Edges wholly inside a folder are left out, so opening that folder does not
 * change what its own header says. What remains is "which other parts of the
 * repository depend on this one", which is the same answer whether the folder
 * is a box or a panel.
 */
function folderFan(
  parse: RepositoryParseResult,
  nodeOfFile: ReadonlyMap<string, string>,
): Map<string, { in: number; out: number }> {
  const incoming = new Map<string, Set<string>>();
  const outgoing = new Map<string, Set<string>>();

  for (const edge of parse.edges) {
    const from = nodeOfFile.get(edge.from);
    const to = nodeOfFile.get(edge.to);
    if (from === undefined || to === undefined || from === to) continue;
    const sources = incoming.get(to) ?? new Set<string>();
    sources.add(from);
    incoming.set(to, sources);
    const targets = outgoing.get(from) ?? new Set<string>();
    targets.add(to);
    outgoing.set(from, targets);
  }

  const paths = new Set([...incoming.keys(), ...outgoing.keys()]);
  return new Map(
    [...paths].map((path) => [
      path,
      { in: incoming.get(path)?.size ?? 0, out: outgoing.get(path)?.size ?? 0 },
    ]),
  );
};

/** How many distinct items import this file. */
function fileFanIn(
  parse: RepositoryParseResult,
  itemOfFile: ReadonlyMap<string, string>,
): Map<string, number> {
  const counts = new Map<string, Set<string>>();
  for (const edge of parse.edges) {
    const target = itemOfFile.get(edge.to);
    if (target === undefined) continue;
    const source = itemOfFile.get(edge.from);
    if (source === undefined || source === target) continue;
    const sources = counts.get(edge.to) ?? new Set<string>();
    sources.add(source);
    counts.set(edge.to, sources);
  }
  return new Map([...counts].map(([path, sources]) => [path, sources.size]));
};

/** How many distinct items this file imports. */
function fileFanOut(
  parse: RepositoryParseResult,
  itemOfFile: ReadonlyMap<string, string>,
): Map<string, number> {
  const counts = new Map<string, Set<string>>();
  for (const edge of parse.edges) {
    const source = itemOfFile.get(edge.from);
    if (source === undefined) continue;
    const target = itemOfFile.get(edge.to);
    if (target === undefined || target === source) continue;
    const targets = counts.get(edge.from) ?? new Set<string>();
    targets.add(target);
    counts.set(edge.from, targets);
  }
  return new Map([...counts].map(([path, targets]) => [path, targets.size]));
};

function clamp(value: number, low: number, high: number): number {
  return Math.round(Math.min(high, Math.max(low, value)));
}

/**
 * A scroll position inside its range.
 *
 * Scrolling past the end would show an empty panel, because the last window of
 * rows would start beyond the last file. Clamping keeps the panel full: the last
 * position shows the final rows rather than nothing.
 */
function clampStart(scroll: number, fileCount: number): number {
  return clamp(scroll, 0, Math.max(0, fileCount - PANEL_VISIBLE_ROWS));
}