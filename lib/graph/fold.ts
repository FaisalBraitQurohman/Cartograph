import type { ParsedFile } from "@/parser/types.mts";

/**
 * Folding directories into nodes.
 *
 * Every directory in the repository is a node to begin with. Then, working from
 * the deepest directory upward, any directory holding fewer than the current
 * threshold's worth of files gives up its identity and is absorbed by its
 * parent. When that still leaves more nodes than anyone can read, the
 * threshold rises and the whole thing is computed again from scratch, and the
 * lowest threshold that lands under NODE_LIMIT wins.
 *
 * Nothing here is told what the repository looks like. The same input always
 * produces the same nodes, because every ordering is a plain comparison rather
 * than a locale-aware one.
 */

/** The repository root. A container rather than a node in its own right. */
export const ROOT = ".";

/**
 * "Under roughly two dozen." The threshold stops rising as soon as the map fits
 * inside this, so how deep the folding goes is the repository's decision and not
 * a constant somebody picked.
 */
export const NODE_LIMIT = 24;

/** "Fewer than a couple of files" — where the first pass starts. */
const FIRST_THRESHOLD = 2;

/** A ceiling, so a repository of nothing but wide directories still terminates. */
const LAST_THRESHOLD = 512;

export interface FolderNode {
  /** The directory path this node stands for, e.g. `packages/kit/src/features`. */
  id: string;
  /** The last path segment, used as the fallback label. */
  name: string;
  /** Directory depth below the root. */
  depth: number;
  /** Files in this directory's subtree, including everything folded into it. */
  fileCount: number;
  /** Those files, sorted, so a panel lists them in the same order every time. */
  files: string[];
}

export interface FoldResult {
  nodes: FolderNode[];
  /** The file-count threshold that produced these nodes. */
  threshold: number;
  /** Every directory in the repository, root included, mapped to the node holding it. */
  ownerOf: Map<string, string>;
  /** Every file, mapped to the node holding it. */
  nodeOfFile: Map<string, string>;
}

interface Folder {
  path: string;
  depth: number;
  /** Files written directly into this directory before any folding. */
  directFiles: string[];
}

interface Pass {
  folders: Map<string, Folder>;
  survivors: Map<string, string[]>;
}

export function foldFolders(files: readonly ParsedFile[]): FoldResult {
  const folders = collectFolders(files);

  let threshold = FIRST_THRESHOLD;
  let pass = runPass(folders, threshold);
  while (pass.survivors.size > NODE_LIMIT && threshold < LAST_THRESHOLD) {
    threshold += 1;
    pass = runPass(folders, threshold);
  }

  // A directory that gave up its identity is still somewhere: the nearest
  // ancestor that kept one. Only the directories that survived are nodes.
  const nodeIds = new Set(pass.survivors.keys());
  const ownerOf = new Map<string, string>();
  for (const folder of folders.values()) {
    const owner = nearestNode(folder.path, nodeIds);
    if (owner) ownerOf.set(folder.path, owner);
  }

  // Anything that reached the root is left holding the repository's own loose
  // files, which is what the root directory is. It becomes one node so that
  // every edge still terminates on something that exists.
  const loose = files
    .filter((file) => !ownerOf.has(normalizeFolder(file.folder)))
    .map((file) => file.path)
    .sort(comparePaths);
  if (loose.length > 0) {
    nodeIds.add(ROOT);
    pass = { folders: pass.folders, survivors: new Map([...pass.survivors, [ROOT, loose]]) };
  }

  const nodes = [...pass.survivors]
    .map(([path, held]) => ({
      id: path,
      name: path === ROOT ? "root" : path.slice(path.lastIndexOf("/") + 1),
      depth: path === ROOT ? 0 : depthOf(path),
      fileCount: held.length,
      files: held,
    }))
    .sort((left, right) => comparePaths(left.id, right.id));

  const nodeOfFile = new Map<string, string>();
  for (const file of files) {
    const node = ownerOf.get(normalizeFolder(file.folder));
    if (node) nodeOfFile.set(file.path, node);
  }
  for (const file of loose) nodeOfFile.set(file, ROOT);

  return { nodes, threshold, ownerOf, nodeOfFile };
}

function collectFolders(files: readonly ParsedFile[]): Map<string, Folder> {
  const folders = new Map<string, Folder>();
  const ensure = (path: string): void => {
    if (folders.has(path)) return;
    folders.set(path, { path, depth: depthOf(path), directFiles: [] });
  };

  ensure(ROOT);
  for (const file of files) {
    const folder = normalizeFolder(file.folder);
    ensure(folder);
    folders.get(folder)?.directFiles.push(file.path);
    let child = folder;
    while (child !== ROOT) {
      child = parentOf(child);
      ensure(child);
    }
  }

  return folders;
}

/**
 * One full folding pass at a fixed threshold.
 *
 * `held` is the file set a directory currently owns, and it is always the whole
 * subtree: a directory that absorbs a child absorbs everything that child had
 * already absorbed. Merges are applied one depth at a time, and because a merge
 * only ever writes into its own parent — one level up, and therefore not looked
 * at again during this depth — two directories at the same depth cannot see each
 * other's merge. What one merge changes, the next depth reads fresh.
 */
function runPass(folders: Map<string, Folder>, threshold: number): Pass {
  const held = new Map<string, string[]>();
  const byDepth = new Map<number, string[]>();
  for (const folder of folders.values()) {
    held.set(folder.path, [...folder.directFiles]);
    if (folder.path === ROOT) continue;
    const bucket = byDepth.get(folder.depth);
    if (bucket) bucket.push(folder.path);
    else byDepth.set(folder.depth, [folder.path]);
  }
  for (const bucket of byDepth.values()) bucket.sort(comparePaths);

  const merged = new Set<string>();
  for (const depth of [...byDepth.keys()].sort((left, right) => right - left)) {
    for (const path of byDepth.get(depth) ?? []) {
      if (merged.has(path)) continue;
      const files = held.get(path) ?? [];
      if (files.length >= threshold) continue;
      const parent = parentOf(path);
      held.set(parent, [...(held.get(parent) ?? []), ...files]);
      held.delete(path);
      merged.add(path);
    }
  }

  const survivors = new Map<string, string[]>();
  for (const path of [...held.keys()].sort(comparePaths)) {
    if (path === ROOT || merged.has(path)) continue;
    survivors.set(path, held.get(path) ?? []);
  }

  return { folders, survivors };
}

function nearestNode(path: string, nodeIds: ReadonlySet<string>): string | undefined {
  let current = path;
  while (current !== ROOT && !nodeIds.has(current)) current = parentOf(current);
  return nodeIds.has(current) ? current : undefined;
}

function normalizeFolder(folder: string): string {
  return folder === "" ? ROOT : folder;
}

function depthOf(path: string): number {
  return path === ROOT ? 0 : path.split("/").length;
}

function parentOf(path: string): string {
  if (path === ROOT) return ROOT;
  const cut = path.lastIndexOf("/");
  return cut < 0 ? ROOT : path.slice(0, cut);
}

/**
 * Code-unit ordering rather than `localeCompare`, which varies by machine. The
 * layout has to come out identical every time it is computed.
 */
function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}