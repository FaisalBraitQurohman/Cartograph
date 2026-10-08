#!/usr/bin/env node
/**
 * Selection behaviour, checked without a browser.
 *
 * Selecting something is arithmetic over the edge list, so it can be verified
 * from a terminal rather than by looking at it. This imports the same
 * `litItems` and `isEdgeLit` the canvas uses, so it cannot pass while the
 * component is wrong.
 *
 * Usage: pnpm map:select [result.json]
 */
import { readFileSync } from "node:fs";
import { validateRepositoryParseResult } from "../parser/validate-result.mts";
import { foldFolders } from "../lib/graph/fold.ts";
import { deriveMap, folderItemId } from "../lib/graph/graph.ts";
import { edgeDirection, isEdgeLit, litItems } from "../lib/graph/highlight.ts";

const resultPath = process.argv[2] ?? "data/preview/vuejs-devtools.json";
const parsed = JSON.parse(readFileSync(resultPath, "utf8"));

if (!validateRepositoryParseResult(parsed)) {
  console.error(`${resultPath} does not satisfy the parser's typed data contract.`);
  process.exitCode = 1;
} else {
  run(parsed);
}

function run(parse) {
  const fold = foldFolders(parse.files);
  const closed = deriveMap(parse, fold, new Set());
  let failures = 0;

  // Nothing selected: nothing dims. A dimmed edge with no selection would mean
  // the resting view of the map is already washed out.
  const idle = litItems(closed, null);
  failures += check(
    "Nothing selected",
    idle === null && closed.edges.every((edge) => isEdgeLit(closed, edge, idle)),
    idle === null ? "nothing dims" : "some edges dim",
  );

  // A closed folder with edges on both sides, so both directions are covered.
  const target = closed.folders.find(
    (folder) =>
      closed.edges.some((edge) => edge.source === folder.id) &&
      closed.edges.some((edge) => edge.target === folder.id),
  );
  if (!target) throw new Error("No folder has edges in both directions to test with.");

  // 1. A selected folder keeps itself, its neighbours, and its own edges.
  const folderLit = litItems(closed, target.id);
  const neighbours = new Set([target.id]);
  for (const edge of closed.edges) {
    if (edge.source === target.id) neighbours.add(edge.target);
    if (edge.target === target.id) neighbours.add(edge.source);
  }
  failures += check(
    `Selected closed folder "${target.path}"`,
    sameSet(folderLit, neighbours) && closed.edges.filter((e) => isEdgeLit(closed, e, folderLit)).length > 0,
    `${neighbours.size} expected, ${folderLit.size} kept; ${count(closed, folderLit)}/${closed.edges.length} edges bright`,
  );

  // 2. A selected row keeps the panel it sits in bright, because a greyed-out
  //    box would hide the edges being drawn into it.
  // A panel worth testing against: the biggest one that is imported by something
  // and imports something itself, so both colours can appear. The root folder
  // has the most files but nothing imports it; the test folders are imported by
  // nothing and import nothing but the framework.
  const panel = [...closed.folders]
    .filter(
      (folder) =>
        closed.edges.some((edge) => edge.source === folder.id) &&
        closed.edges.some((edge) => edge.target === folder.id),
    )
    .sort((a, b) => b.fileCount - a.fileCount)[0];

  if (!panel) throw new Error("No folder has enough files to open a panel for testing.");

  const open = deriveMap(parse, fold, new Set([panel.path]));
  const panelId = folderItemId(panel.path);
  const row = open.rows.find((candidate) => candidate.panelId === panelId);
  if (row) {
    const rowLit = litItems(open, row.id);
    failures += check(
      `Selected row "${row.path}"`,
      rowLit.has(row.id) && rowLit.has(panelId),
      `row kept ${rowLit.has(row.id)}, panel kept ${rowLit.has(panelId)}`,
    );
  }

  // 3. A selected panel keeps its own rows bright, because they are still there
  //    and still the answer.
  const panelLit = litItems(open, panelId);
  const ownRows = open.rows.filter((candidate) => candidate.panelId === panelId);
  const dimmedOwn = ownRows.filter((candidate) => !panelLit.has(candidate.id));
  failures += check(
    `Selected open panel "${panel.path}"`,
    dimmedOwn.length === 0,
    `${ownRows.length} rows, ${dimmedOwn.length} of them dimmed`,
  );

  // 4. Opening a folder is enough. Direction is a property of an edge, not a
  //    reward for picking something, so the edges of an open panel are coloured
  //    with nothing selected at all.
  if (panel) {
    const openMap = deriveMap(parse, fold, new Set([panel.path]));
    const anchor = new Set(openMap.rows.flatMap((row) => [row.id, row.panelId]));
    const coloured = openMap.edges.filter((edge) => edgeDirection(edge, anchor) !== null);
    const incoming = coloured.filter((edge) => edgeDirection(edge, anchor) === "incoming");
    const outgoing = coloured.filter((edge) => edgeDirection(edge, anchor) === "outgoing");

    failures += check(
      `Opened "${panel.path}", nothing selected`,
      coloured.length > 0,
      `${coloured.length} coloured (${incoming.length} green in, ${outgoing.length} amber out)`,
    );

    // Closed, with nothing on screen, no edge has anything to be measured
    // against and none claims a direction.
    const closedAnchor = new Set(closed.rows.flatMap((row) => [row.id, row.panelId]));
    failures += check(
      "Nothing open, nothing selected",
      closed.edges.every((edge) => edgeDirection(edge, closedAnchor) === null),
      "no edge claims a direction",
    );
  }

  // 5. Two folders open at once must behave the same. A second folder opened
  //    while another was selected used to come up with no colour and at a fifth
  //    of the strength, so two equally open folders looked like different states.
  if (panel) {
    // The other folder has to be one with real edges too, or "it got colour" is
    // a statement about a single arrow.
    const other = closed.folders.find(
      (folder) =>
        folder.id !== panel.id &&
        folder.fileCount >= 4 &&
        closed.edges.some((edge) => edge.source === folder.id || edge.target === folder.id),
    );
    if (other) {
      const bothOpen = deriveMap(parse, fold, new Set([panel.path, other.path]));
      const anchor = new Set([...bothOpen.rows.flatMap((row) => [row.id, row.panelId]), panel.id]);

      // The rows of the folder that was NOT the selection still get direction.
      const otherRows = bothOpen.rows.filter((row) => row.panelId === folderItemId(other.path));
      const otherColoured = bothOpen.edges.filter(
        (edge) =>
          edgeDirection(edge, anchor) !== null &&
          (edge.source === folderItemId(other.path) ||
            edge.target === folderItemId(other.path) ||
            otherRows.some((row) => row.id === edge.source || row.id === edge.target)),
      );

      // And the panel nobody selected is still at full strength.
      const litBoth = litItems(bothOpen, panel.id);
      const otherRowsDimmed = otherRows.filter((row) => !litBoth.has(row.id)).length;

      failures += check(
        `Two folders open, "${other.path}" not selected`,
        otherColoured.length > 0 && otherRowsDimmed === 0,
        `${otherColoured.length} coloured, ${otherRowsDimmed} of its ${otherRows.length} rows dimmed`,
      );
    }
  }

  // 6. Opening a folder must not change what its edges mean.
  //
  //    This is the check behind a bug that only shows up in a browser: an open panel
  //    has no edges terminating on it — they all land on the rows inside — so
  //    selecting the panel found no neighbours at all and its fan-in dimmed. And an
  //    edge between two files of the same open folder was reported as "incoming",
  //    which drew a green arrow into the panel for a relationship wholly internal to
  //    it, in a place a closed box does not even show.
  //
  //    Both are answered the same way, by comparing the answer for a folder against
  //    itself before and after opening.
  for (const folder of closed.folders) {
    const neighboursOf = (map, selection) => {
      const lit = litItems(map, selection);
      const held = new Set([
        selection,
        ...map.rows.filter((row) => row.panelId === selection).map((row) => row.id),
      ]);
      const out = new Set();
      for (const edge of map.edges) {
        if (!held.has(edge.source) && !held.has(edge.target)) continue;
        const other = held.has(edge.source) ? edge.target : edge.source;
        if (!held.has(other) && isEdgeLit(map, edge, lit)) out.add(other.startsWith("folder:") ? other : other.slice(5));
      }
      return out;
    };

    const shut = neighboursOf(deriveMap(parse, fold, new Set()), folder.id);
    const open = neighboursOf(deriveMap(parse, fold, new Set([folder.path])), folder.id);
    if (shut.size === 0) continue;

    // Compared as file paths, because an open folder draws some neighbours as rows
    // and some as the boxes holding them. What must not change is the set of files.
    const lost = [...shut].filter((path) => !open.has(path));

    // A file that was hidden inside a box becomes a row, and a row the scroll
    // window does not reach is still represented by that box, so the neighbour is
    // named by the box holding it rather than by the file. Compared as "did any
    // lit neighbour go away", which is the direction that matters: a box that
    // opened and lost its fan-in.
    if (lost.length > 0) {
      failures += check(
        `Opening ${folder.path}`,
        false,
        `lost ${lost.length} lit neighbour(s): ${lost.slice(0, 3).join(", ")}`,
      );
    } else {
      failures += check(
        `Opening ${folder.path}`,
        true,
        `${shut.size} lit neighbours before and after`,
      );
    }
  }

  // 7. An edge wholly inside the open panel has no direction to report. Reporting
  //    one draws a coloured arrow into a folder for a relationship that never
  //    crosses its boundary.
  const opened = deriveMap(parse, fold, new Set(fold.nodes.map((node) => node.id)));
  const openAnchor = new Set(opened.rows.flatMap((row) => [row.id, row.panelId]));
  const internal = opened.edges.filter(
    (edge) => openAnchor.has(edge.source) && openAnchor.has(edge.target),
  );
  failures += check(
    `${internal.length} edges inside open panels`,
    internal.every((edge) => edgeDirection(edge, openAnchor) === null),
    `${internal.filter((edge) => edgeDirection(edge, openAnchor) !== null).length} claim a direction`,
  );

  const rowPanels = new Map(opened.rows.map((row) => [row.id, row.panelId]));
  const rowPanelEdges = opened.edges.filter(
    (edge) => rowPanels.get(edge.source) === edge.target || rowPanels.get(edge.target) === edge.source,
  );
  failures += check(
    "Rows connected to their own panel",
    rowPanelEdges.length > 0 && rowPanelEdges.every((edge) => edgeDirection(edge, openAnchor) === null),
    `${rowPanelEdges.length} edges, ${rowPanelEdges.filter((edge) => edgeDirection(edge, openAnchor) !== null).length} claim a direction`,
  );
  const panelAnchor = new Set(open.rows.flatMap((row) => [row.id, row.panelId]));
  const incoming = open.edges.filter((edge) => !panelAnchor.has(edge.source) && panelAnchor.has(edge.target));
  failures += check(
    "Edges from other folders remain incoming",
    incoming.length > 0 && incoming.every((edge) => edgeDirection(edge, panelAnchor) === "incoming"),
    `${incoming.length} incoming edges`,
  );

  // 8. No selection dims itself, and no selection leaves an edge bright whose
  //    ends are both dim. These are the two ways this reads as broken.
  let selfDims = 0;
  let orphanEdges = 0;
  for (const item of closed.itemIds) {
    const lit = litItems(closed, item);
    if (!lit.has(item)) selfDims += 1;
    for (const edge of closed.edges) {
      if (isEdgeLit(closed, edge, lit) && !(lit.has(edge.source) && lit.has(edge.target))) {
        orphanEdges += 1;
      }
    }
  }
  failures += check(
    `All ${closed.itemIds.size} items selectable`,
    selfDims === 0 && orphanEdges === 0,
    `${selfDims} dim themselves, ${orphanEdges} bright edges between dimmed items`,
  );

  console.log(failures === 0 ? "\nAll selection checks passed." : `\n${failures} FAILED`);
  if (failures > 0) process.exitCode = 1;
}

function count(map, lit) {
  return map.edges.filter((edge) => isEdgeLit(map, edge, lit)).length;
}

function sameSet(left, right) {
  return left.size === right.size && [...left].every((id) => right.has(id));
}

function check(label, passed, detail) {
  console.log(`${passed ? "pass" : "FAIL"}  ${label} — ${detail}`);
  return passed ? 0 : 1;
}