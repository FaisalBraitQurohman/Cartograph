import type { MapGraph } from "./graph.ts";

/**
 * What stays at full strength while something is selected.
 *
 * The selection, the things it is connected to, and the panel either of them
 * sits in. Everything else dims, which is how "what depends on this" becomes
 * visible without a second panel for it.
 *
 * It is a pure function over the map rather than state in a component, so the
 * rule can be checked from a terminal instead of by looking at it.
 */
export function litItems(map: MapGraph, selection: string | null): Set<string> | null {
  if (!selection) return null;

  const kept = new Set<string>([selection]);

  // The selection is whatever the reader pointed at, which is not always one drawn
  // object. An open panel is its rows: no edge ever terminates on a panel, they all
  // land on the rows inside it, so asking only for edges touching the panel's own id
  // finds none at all. That is how selecting an open folder found zero neighbours
  // and dimmed its whole fan-in — the box's incoming edges went grey the moment it
  // was opened, which is exactly when they are being read.
  //
  // So the neighbourhood is taken over the panel *and* its rows together. One set,
  // one scan: whatever the reader clicked, the answer is the same set of
  // neighbours whichever way the same relationship is drawn.
  const subject = new Set<string>([selection]);
  for (const row of map.rows) {
    if (row.panelId === selection) subject.add(row.id);
  }

  for (const edge of map.edges) {
    if (subject.has(edge.source)) kept.add(edge.target);
    if (subject.has(edge.target)) kept.add(edge.source);
  }

  // A panel and the rows inside it are one thing, so whichever of them is
  // selected, all of them stay bright. A selected row keeps its panel lit,
  // because a greyed-out box would hide the very edges being drawn into it. A
  // selected panel keeps its rows lit, because they are what it is showing, and
  // dimming them would leave an open panel looking broken.
  //
  // Both directions have to be driven explicitly. Reading only "which panel does
  // this item sit in" finds nothing when the item is the panel itself, which is
  // how a selected panel ended up dimming every row it had just been opened to
  // show.
  const rowsOfPanel = new Map<string, string[]>();
  for (const row of map.rows) {
    const siblings = rowsOfPanel.get(row.panelId);
    if (siblings) siblings.push(row.id);
    else rowsOfPanel.set(row.panelId, [row.id]);
  }

  for (const panel of rowsOfPanel.keys()) {
    if (!kept.has(panel)) continue;
    for (const row of rowsOfPanel.get(panel) ?? []) kept.add(row);
  }

  for (const row of map.rows) {
    if (kept.has(row.id)) kept.add(row.panelId);
  }

  // Every open panel stays bright, not only the one holding the selection.
  //
  // A folder someone has opened is being read; dimming it because the selection
  // happens to be in a different folder made two equally open folders look like
  // different states, and the one that dimmed was the one with colour to lose.
  // Its edges were still drawn, just at a fifth of the strength, so it read as
  // unconnected rather than as unselected.
  for (const panel of rowsOfPanel.keys()) {
    kept.add(panel);
    for (const row of rowsOfPanel.get(panel) ?? []) kept.add(row);
  }

  return kept;
}

/**
 * Whether an edge stays bright. It does only when both of the things it
 * connects are still bright, so a dimmed end takes its edges with it rather
 * than leaving a line running to something nobody can see.
 */
export function isEdgeLit(
  map: MapGraph,
  edge: { source: string; target: string },
  lit: ReadonlySet<string> | null,
): boolean {
  if (lit === null) return true;
  return lit.has(edge.source) && lit.has(edge.target);
}

/**
 * Which way an edge runs, relative to whatever is being looked at.
 *
 * `anchor` is the thing the reader is asking about, which is the selection when
 * there is one and otherwise every row an open panel is showing. An edge into
 * the anchor is incoming and an edge out of it is outgoing; an edge that does
 * not touch the anchor is about something else and has no direction to report.
 *
 * Anchoring to open rows rather than to the panel node is what makes a folder
 * coloured the moment it opens. No edge ever terminates on a panel — they all
 * land on the rows inside it — so anchoring to the panel would leave every one
 * of them without a direction and the whole folder would read as unconnected.
 */
export function edgeDirection(
  edge: { source: string; target: string },
  anchor: ReadonlySet<string> | null,
): "incoming" | "outgoing" | null {
  if (anchor === null) return null;
  // Both ends inside the thing being looked at means nothing about how anything
  // gets into it or out of it. Reporting "incoming" for an edge between two files of
  // the same open folder drew a green arrow into the panel for a relationship wholly
  // internal to it — and because a closed box hides exactly those edges, opening
  // the folder appeared to reverse the direction of an arrow that had meant
  // something else entirely.
  if (anchor.has(edge.target) && anchor.has(edge.source)) return null;
  if (anchor.has(edge.target)) return "incoming";
  if (anchor.has(edge.source)) return "outgoing";
  return null;
}