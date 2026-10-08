#!/usr/bin/env node
/**
 * The numbers behind the canvas, printed from a terminal.
 *
 * Everything this reports is arithmetic over the checked-in parser output: how
 * many nodes the folding settled on, whether any of them ended up holding one
 * file, and whether every edge in the collapsed graph still lands on a node
 * that exists. Run it after changing anything in lib/graph.
 *
 * Usage: pnpm map:stats [result.json]
 */
import { readFileSync } from "node:fs";
import { validateRepositoryParseResult } from "../parser/validate-result.mts";
import { foldFolders } from "../lib/graph/fold.ts";
import { deriveMap, PANEL_VISIBLE_ROWS } from "../lib/graph/graph.ts";
import { boundsOf, seatFolders, seatIn } from "../lib/graph/layout.ts";
import { describeCategories } from "../lib/graph/categories.ts";

const resultPath = process.argv[2] ?? "data/preview/vuejs-devtools.json";
const parsed = JSON.parse(readFileSync(resultPath, "utf8"));

if (!validateRepositoryParseResult(parsed)) {
  console.error(`${resultPath} does not satisfy the parser's typed data contract.`);
  process.exitCode = 1;
} else {
  report(resultPath, parsed);
}

function report(path, parse) {
  const fold = foldFolders(parse.files);
  const map = deriveMap(parse, fold, new Set());

  console.log(`Data: ${path}`);
  console.log(
    `Files: ${parse.summary.filesParsed} parsed, ${fold.nodes.length} nodes, threshold ${fold.threshold}`,
  );

  console.log("\n1. Node count");
  console.log(`   nodes            ${fold.nodes.length}`);
  console.log(`   files per node   ${(parse.summary.filesParsed / fold.nodes.length).toFixed(1)}`);
  console.log(`   largest node     ${Math.max(...fold.nodes.map((node) => node.fileCount))} files`);
  console.log(`   smallest node    ${Math.min(...fold.nodes.map((node) => node.fileCount))} files`);

  const singletons = fold.nodes.filter((node) => node.fileCount < 2);
  console.log("\n2. Nodes holding fewer than two files");
  console.log(`   ${singletons.length} (${singletons.map((node) => node.id).join(", ") || "none"})`);

  const collapsed = new Map(map.edges.map((edge) => [edge.id, edge]));
  const missing = map.edges.filter((edge) => !map.itemIds.has(edge.source) || !map.itemIds.has(edge.target));
  const folderEdges = map.edges.filter(
    (edge) => edge.source.startsWith("folder:") && edge.target.startsWith("folder:"),
  );
  console.log("\n3. Edges in the collapsed graph");
  console.log(`   edges            ${map.edges.length}`);
  console.log(`   file edges in    ${parse.edges.length}`);
  console.log(
    `   inside a folder  ${parse.edges.length - folderEdges.reduce((sum, edge) => sum + edge.weight, 0)}`,
  );
  console.log(`   drawn            ${collapsed.size}`);
  console.log(`   dangling         ${missing.length}`);
  for (const edge of missing.slice(0, 10)) {
    console.log(`     ${edge.source} -> ${edge.target}`);
  }

  const openAll = new Set(fold.nodes.map((node) => node.id));
  const opened = deriveMap(parse, fold, openAll);
  const danglingOpen = opened.edges.filter(
    (edge) => !opened.itemIds.has(edge.source) || !opened.itemIds.has(edge.target),
  );
  const panelsWithOverflow = opened.folders.filter((folder) => folder.hiddenRowCount > 0);
  console.log("\n4. With every folder open");
  console.log(`   panels           ${opened.folders.length}`);
  console.log(`   rows drawn       ${opened.rows.length}`);
  console.log(`   edges            ${opened.edges.length}`);
  console.log(`   dangling         ${danglingOpen.length}`);
  console.log(`   visible rows/panel at most ${PANEL_VISIBLE_ROWS}`);
  console.log(`   panels truncated ${panelsWithOverflow.length}`);

  console.log("\n5. Layout");
  const seats = seatFolders(parse, fold);
  const placed = seatIn(seats, map.folders);
  const boxes = [...placed.values()];
  const extent = boundsOf(boxes);
  console.log(`   placed           ${placed.size}/${map.folders.length}`);
  console.log(`   spans            ${extent.width} x ${extent.height} px`);

  // Opening must not move anything. A node that grows is expected to shift its
  // own top-left corner — that is what growing around a fixed centre means — but
  // its centre holds still, and so does every node that did not change size.
  const allOpen = deriveMap(parse, fold, new Set(fold.nodes.map((node) => node.id)));
  const allOpenPlaced = seatIn(seats, allOpen.folders);
  let centreDrift = 0;
  let resized = 0;
  for (const [id, box] of placed) {
    const after = allOpenPlaced.get(id);
    if (!after) continue;
    if (after.width !== box.width || after.height !== box.height) resized += 1;
    centreDrift = Math.max(
      centreDrift,
      Math.abs(box.x + box.width / 2 - (after.x + after.width / 2)),
      Math.abs(box.y + box.height / 2 - (after.y + after.height / 2)),
    );
  }
  console.log(`   all open         ${allOpen.folders.length} panels, ${resized} resized`);
  // Half a pixel is the rounding on an odd-sized panel, not movement.
  console.log(`   centres held     ${centreDrift.toFixed(1)}px drift (expected 0)`);
  console.log(`   deterministic    ${layoutFingerprint(parse) === layoutFingerprint(parse) ? "yes" : "NO"}`);

  console.log("\n6. Categories in the left rail");
  const categories = describeCategories(parse.files);
  console.log(`   grouped at depth ${categories.depth}`);
  for (const category of categories.categories) {
    console.log(`   ${category.label.padEnd(28)} ${String(category.fileCount).padStart(4)} files`);
  }
  // A swatch has to mean the same category in the rail and in the detail pane, and
  // both order their lists differently, so the index travels with the category
  // rather than with its position. There are eight hues and a repository can have
  // more categories than that, so colours repeat — which is reported rather than
  // hidden, because a repeated colour is two categories that look alike.
  const swatches = categories.categories.map((category) => category.swatch);
  const distinct = new Set(swatches).size;
  console.log(
    `   swatches          ${distinct} distinct colour(s) across ${swatches.length} categories` +
      (distinct < swatches.length ? " — colours repeat, the swatch is not a unique key" : ""),
  );
}

/** Every box's position and size, as one comparable string. */
function layoutFingerprint(parse) {
  const derived = deriveMap(parse, foldFolders(parse.files), new Set());
  return JSON.stringify([...seatIn(seatFolders(parse, foldFolders(parse.files)), derived.folders)]);
}