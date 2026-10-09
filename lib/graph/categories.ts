import type { ParsedFile } from "@/parser/types.mts";

/**
 * The categories the left rail lists, and the buckets the detail pane groups by.
 *
 * A category is a place in the repository, not a guess about what a file does:
 * the shallowest folder depth at which the repository splits into between two
 * and twelve parts. Depth one is tried first, and the depth only moves deeper
 * when a shallower one would put everything in the same bucket, so a monorepo
 * whose code all sits under `packages/` gets its packages rather than one row
 * that says "packages".
 *
 * Nothing is invented to fill a gap: a file that sits above the chosen depth is
 * counted on its own row as the repository root, rather than being attributed to
 * a folder it is not in. Those files are also what `countUnplaced` reports,
 * because "the grouping had nowhere to put this" is the honest version of "no
 * convention could identify it".
 */

/** More rows than this stop being a list somebody scans down a narrow rail. */
const MAX_CATEGORIES = 20;

/** The bucket a file above the chosen depth is counted in. */
export const ROOT_BUCKET = ".";

export interface Category {
  id: string;
  label: string;
  fileCount: number;
  /**
   * Which palette slot this category takes.
   *
   * Fixed to the category rather than to its position in a list, because the rail
   * sorts by path and a folder's breakdown in the detail pane sorts by count —
   * and a swatch picked from the list position would paint the same category two
   * different colours in two places on the same screen.
   */
  swatch: number;
}

export interface CategorySet {
  /** Folder depth the buckets were cut at. */
  depth: number;
  categories: Category[];
}

export function describeCategories(files: readonly ParsedFile[]): CategorySet {
  if (files.length === 0) return { depth: 0, categories: [] };

  const depth = categoryDepth(files);
  const counts = new Map<string, number>();
  for (const file of files) {
    const bucket = bucketOf(file.folder, depth);
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }

  return {
    depth,
    categories: [...counts]
      .sort((left, right) => compareBuckets(left[0], right[0]))
      .map(([id, fileCount], swatch) => ({ id, label: categoryLabel(id), fileCount, swatch })),
  };
}

/**
 * The deepest split that still fits in the rail.
 *
 * Depth one is the safest and the least useful — in a monorepo it is one row
 * saying "packages" — so the walk goes deeper for as long as the list stays
 * readable, and stops at the first depth that would not.
 */
function categoryDepth(files: readonly ParsedFile[]): number {
  const folders = files.map((file) => segmentsOf(file.folder));
  const deepest = folders.reduce((longest, parts) => Math.max(longest, parts.length), 1);

  let depth = 0;
  for (let candidate = 1; candidate <= deepest; candidate += 1) {
    const buckets = new Set(folders.map((parts) => bucketOfParts(parts, candidate)));
    if (buckets.size < 2) continue;
    if (buckets.size > MAX_CATEGORIES) break;
    depth = candidate;
  }
  return depth === 0 ? 1 : depth;
}

/** The bucket a file belongs to at a given depth, or the root when it sits higher. */
export function bucketOf(folder: string, depth: number): string {
  return bucketOfParts(segmentsOf(folder), depth);
}

/**
 * Files the grouping has nowhere to put: those sitting in a folder shallower than
 * the depth everything else was cut at. Reported rather than folded away, because
 * a count of files that went unclassified is the number that says whether the
 * classification can be trusted.
 */
export function countUnplaced(files: readonly ParsedFile[], depth: number): number {
  let unplaced = 0;
  for (const file of files) {
    if (segmentsOf(file.folder).length < depth) unplaced += 1;
  }
  return unplaced;
}

/** The category in a set with this id, for colouring a file by where it sits. */
export function categoryOf(set: CategorySet, bucket: string): Category {
  const found = set.categories.find((category) => category.id === bucket);
  // An unknown bucket cannot happen from `bucketOf`, but a category the caller
  // asks about is answered rather than assumed: an unlabelled file is shown as
  // unlabelled instead of being given a category it was never placed in.
  return found ?? { id: bucket, label: categoryLabel(bucket), fileCount: 0, swatch: 0 };
}

export function categoryLabel(bucket: string): string {
  return bucket === ROOT_BUCKET ? "repository root" : bucket;
}

function bucketOfParts(parts: readonly string[], depth: number): string {
  if (parts.length < depth) return ROOT_BUCKET;
  return parts.slice(0, depth).join("/");
}

function segmentsOf(folder: string): string[] {
  return folder === ROOT_BUCKET || folder === "" ? [] : folder.split("/");
}

/** The root first, then code-unit order, so the list is the same every time. */
function compareBuckets(left: string, right: string): number {
  if (left === right) return 0;
  if (left === ROOT_BUCKET) return -1;
  if (right === ROOT_BUCKET) return 1;
  return left < right ? -1 : 1;
}
