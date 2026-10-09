import dagre from "dagre";
import type { MapFolder } from "./graph.ts";
import type { FoldResult } from "./fold.ts";
import type { RepositoryParseResult } from "@/parser/types.mts";

/**
 * Position, left to right: a module's importers sit to its left and whatever it
 * imports sits to its right, which is the direction the reader is already
 * following when they follow an edge.
 *
 * Rows are not laid out here. A row belongs to the panel it is drawn inside, so
 * its position is an offset from that panel's top-left corner, not a rank.
 *
 * Dagre is given the folders in path order and the edges in identifier order, so
 * the same graph lays out the same way every time it is computed.
 */

export interface PlacedBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

const RANK_SEPARATION = 96;
const NODE_SEPARATION = 26;
const MARGIN = 48;

/**
 * The seats, decided once.
 *
 * Every folder as a closed box, laid out from the fold and its edges. This is
 * the only place dagre runs, and it does not depend on what is open — so a
 * folder's position is a fact about the repository rather than about how far
 * through someone's clicking they happen to be.
 */
export function seatFolders(
  parse: RepositoryParseResult,
  fold: FoldResult,
): Map<string, PlacedBox> {
  const ids = fold.nodes.map((node) => `folder:${node.id}`);

  const graph = new dagre.graphlib.Graph();
  graph.setGraph({
    rankdir: "LR",
    ranksep: RANK_SEPARATION,
    nodesep: NODE_SEPARATION,
    marginx: MARGIN,
    marginy: MARGIN,
  });
  graph.setDefaultEdgeLabel(() => ({}));

  for (const id of ids) {
    graph.setNode(id, { width: CLOSED_WIDTH, height: CLOSED_HEIGHT });
  }
  // The fold speaks in folder paths and the graph speaks in item ids, so the
  // prefix is applied here. Missing it matches no node, dagre lays out twenty-
  // four disconnected boxes, and every one of them ends up in the same column.
  for (const [from, targets] of folderNeighbours(parse, fold.nodeOfFile)) {
    for (const to of targets) graph.setEdge(`folder:${from}`, `folder:${to}`);
  }

  dagre.layout(graph);

  const seats = new Map<string, PlacedBox>();
  for (const id of ids) {
    const box = graph.node(id) as { x: number; y: number; width: number; height: number };
    seats.set(id, {
      // Dagre reports centres; React Flow wants top-left corners.
      x: Math.round(box.x - box.width / 2),
      y: Math.round(box.y - box.height / 2),
      width: box.width,
      height: box.height,
    });
  }
  return seats;
}

/**
 * A folder on its seat, or where the reader put it.
 *
 * Opening turns a closed box into a panel several times its height. Dagre
 * recomputes every rank when a node's size changes, so laying the map out as it
 * currently stands shifted all twenty-odd nodes — a 64px box becoming a 148px
 * panel moved one node 979px and threw the reader across the graph.
 *
 * So the seat is kept and the box is centred on it. The panel grows outwards
 * from where its box was and nothing else moves, no matter how many folders are
 * open. A panel near the edge of the layout will cover more canvas than its seat
 * allows, which is the honest result — the seats were computed for closed boxes.
 *
 * `moved` holds where the reader has dragged a folder to, which outranks the
 * seat. Without it a drag lasted until the next state change and then sprang
 * back, because every position here is computed rather than stored. A dragged
 * folder keeps its top-left corner instead of centring on it, so opening it
 * extends it downwards rather than moving the corner the reader chose.
 */
export function seatIn(
  seats: ReadonlyMap<string, PlacedBox>,
  folders: readonly MapFolder[],
  moved?: ReadonlyMap<string, PlacedBox>,
): Map<string, PlacedBox> {
  const placed = new Map<string, PlacedBox>();

  for (const folder of folders) {
    const dropped = moved?.get(folder.id);
    if (dropped) {
      placed.set(folder.id, { x: dropped.x, y: dropped.y, width: folder.width, height: folder.height });
      continue;
    }

    const seat = seats.get(folder.id);
    if (!seat) continue;
    // Rounded on the centre rather than the corner. Round-tripping the corner
    // instead left every panel half a pixel off its seat, which is invisible on
    // screen and enough to make "nothing moves when you open something" untrue.
    const centreX = seat.x + seat.width / 2;
    const centreY = seat.y + seat.height / 2;
    placed.set(folder.id, {
      x: Math.round(centreX - folder.width / 2),
      y: Math.round(centreY - folder.height / 2),
      width: folder.width,
      height: folder.height,
    });
  }

  return placed;
}

/**
 * Folder-to-folder edges.
 *
 * Read off the real file edges, not off the directory tree: a directory nesting
 * inside another is not a dependency, and treating it as one put every folder in
 * the repository into a single rank.
 */
function folderNeighbours(
  parse: RepositoryParseResult,
  nodeOfFile: ReadonlyMap<string, string>,
): Map<string, string[]> {
  const neighbours = new Map<string, Set<string>>();

  for (const edge of parse.edges) {
    const from = nodeOfFile.get(edge.from);
    const to = nodeOfFile.get(edge.to);
    if (from === undefined || to === undefined || from === to) continue;
    const targets = neighbours.get(from);
    if (targets) targets.add(to);
    else neighbours.set(from, new Set([to]));
  }

  return new Map([...neighbours].map(([id, set]) => [id, [...set].sort()]));
}

/** The box every folder occupies, for fitting the view. */
export function boundsOf(placed: Iterable<PlacedBox>): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const box of placed) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 1, height: 1 };
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

/** Nominal closed-box size. Only used for spacing the ranks out. */
const CLOSED_WIDTH = 170;
const CLOSED_HEIGHT = 52;