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
    const anchor = new Set(openMap.rows.map((row) => row.id));
    const rowPanels = new Map(openMap.rows.map((row) => [row.id, row.panelId]));
    const coloured = openMap.edges.filter((edge) => edgeDirection(edge, anchor, rowPanels) !== null);
    const incoming = coloured.filter((edge) => edgeDirection(edge, anchor, rowPanels) === "incoming");
    const outgoing = coloured.filter((edge) => edgeDirection(edge, anchor, rowPanels) === "outgoing");

    failures += check(
      `Opened "${panel.path}", nothing selected`,
      coloured.length > 0,
      `${coloured.length} coloured (${incoming.length} green in, ${outgoing.length} amber out)`,
    );

    // Closed, with nothing on screen, no edge has anything to be measured
    // against and none claims a direction.
    const closedAnchor = new Set(closed.rows.map((row) => row.id));
    failures += check(
      "Nothing open, nothing selected",
      closed.edges.every((edge) => edgeDirection(edge, closedAnchor, new Map()) === null),
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
      const anchor = new Set([...bothOpen.rows.map((row) => row.id), panel.id]);
      const bothPanels = new Map(bothOpen.rows.map((row) => [row.id, row.panelId]));

      // The rows of the folder that was NOT the selection still get direction.
      const otherRows = bothOpen.rows.filter((row) => row.panelId === folderItemId(other.path));
      const otherColoured = bothOpen.edges.filter(
        (edge) =>
          edgeDirection(edge, anchor, bothPanels) !== null &&
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
  //    The anchor is every row of every open folder, so "both ends are in it" means
  //    "both ends are in some open folder" and cannot tell an internal edge from one
  //    running between two. That is what the panel map is for, and it is passed to
  //    `edgeDirection` here exactly as the canvas passes it.
  const opened = deriveMap(parse, fold, new Set(fold.nodes.map((node) => node.id)));
  const openAnchor = new Set(opened.rows.map((row) => row.id));
  const rowPanels = new Map(opened.rows.map((row) => [row.id, row.panelId]));

  const isInsideOneFolder = (edge) => {
    const source = rowPanels.get(edge.source);
    const target = rowPanels.get(edge.target);
    if (source !== undefined && target !== undefined) return source === target;
    if (source !== undefined) return source === edge.target;
    if (target !== undefined) return target === edge.source;
    return false;
  };

  const internal = opened.edges.filter((edge) => isInsideOneFolder(edge));
  failures += check(
    `${internal.length} edges inside one open folder`,
    internal.every((edge) => edgeDirection(edge, openAnchor, rowPanels) === null),
    `${internal.filter((edge) => edgeDirection(edge, openAnchor, rowPanels) !== null).length} claim a direction`,
  );

  // The row-to-its-own-panel case on its own, because it is the one that is easy to
  // miss. The panel stands in for a file the scroll window is not showing, so the
  // two are still one folder.
  const rowPanelEdges = opened.edges.filter(
    (edge) => rowPanels.get(edge.source) === edge.target || rowPanels.get(edge.target) === edge.source,
  );
  failures += check(
    "Rows connected to their own panel",
    rowPanelEdges.length > 0 &&
      rowPanelEdges.every((edge) => edgeDirection(edge, openAnchor, rowPanels) === null),
    `${rowPanelEdges.length} edges, ${
      rowPanelEdges.filter((edge) => edgeDirection(edge, openAnchor, rowPanels) !== null).length
    } claim a direction`,
  );

  // And the opposite direction, which is what putting the panels in the anchor broke.
  // Two different folders open at once must still be coloured against each other, or
  // opening a second folder silences everything between the two.
  const betweenPanels = opened.edges.filter((edge) => {
    const source = rowPanels.get(edge.source);
    const target = rowPanels.get(edge.target);
    return source !== undefined && target !== undefined && source !== target;
  });
  const colouredBetween = betweenPanels.filter(
    (edge) => edgeDirection(edge, openAnchor, rowPanels) !== null,
  ).length;
  failures += check(
    `${betweenPanels.length} edges between different open folders`,
    colouredBetween === betweenPanels.length,
    `${colouredBetween} still claim a direction`,
  );

  // An edge arriving from outside an open panel is incoming.
  //
  // "Outside" excludes the panel's own id as well as its own rows. The panel is a
  // box holding the folder, and an edge from that box to a row inside it is the
  // folder reaching into itself — internal, like the row-to-own-panel case above.
  // Filtering only on rows counted five of those as arrivals from elsewhere, which
  // is why this failed against correct behaviour.
  const singleOpen = deriveMap(parse, fold, new Set([panel.path]));
  const singleRows = new Set(singleOpen.rows.map((row) => row.id));
  const singlePanels = new Map(singleOpen.rows.map((row) => [row.id, row.panelId]));
  const singlePanelId = folderItemId(panel.path);
  const arriving = singleOpen.edges.filter(
    (edge) =>
      singleRows.has(edge.target) && !singleRows.has(edge.source) && edge.source !== singlePanelId,
  );
  failures += check(
    "Edges from other folders remain incoming",
    arriving.length > 0 &&
      arriving.every((edge) => edgeDirection(edge, singleRows, singlePanels) === "incoming"),
    `${arriving.length} arriving edges, all still green`,
  );

  // One folder open is the case that reads worst, because the map looks connected
  // and simply has no colour on it. Stated as a number rather than left to be noticed.
  const oneOpen = deriveMap(parse, fold, new Set([panel.path]));
  const oneAnchor = new Set(oneOpen.rows.map((row) => row.id));
  const onePanels = new Map(oneOpen.rows.map((row) => [row.id, row.panelId]));
  const oneColoured = oneOpen.edges.filter((edge) => edgeDirection(edge, oneAnchor, onePanels) !== null).length;
  failures += check(
    `One folder open (${panel.path})`,
    oneColoured > 0,
    `${oneColoured} of ${oneOpen.edges.length} edges coloured`,
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