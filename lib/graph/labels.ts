/**
 * Labels on the canvas are the shortest trailing part of a path that no other
 * thing on screen shares. `packages/kit/src` reads as `kit/src` when another
 * `src` is on the canvas and as `kit` when it isn't, and nothing has to be
 * truncated to a fixed width to make that true.
 */

/** Map each path to the shortest suffix of it that is unique among all of them. */
export function shortestUniqueLabels(paths: readonly string[]): Map<string, string> {
  const labels = new Map<string, string>();
  const segments = paths.map((path) => ({ path, parts: path.split("/") }));

  for (const entry of segments) {
    let label = entry.path;
    for (let take = 1; take <= entry.parts.length; take += 1) {
      const candidate = entry.parts.slice(entry.parts.length - take).join("/");
      const taken = segments.some(
        (other) => other.path !== entry.path && endsWithParts(other.parts, entry.parts, take),
      );
      if (!taken) {
        label = candidate;
        break;
      }
    }
    labels.set(entry.path, label);
  }

  return labels;
}

/** Whether `other`'s last `take` segments are the same as `entry`'s. */
function endsWithParts(other: readonly string[], entry: readonly string[], take: number): boolean {
  if (take > other.length) return false;
  const offset = other.length - take;
  for (let index = 0; index < take; index += 1) {
    if (other[offset + index] !== entry[entry.length - take + index]) return false;
  }
  return true;
}