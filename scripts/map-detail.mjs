#!/usr/bin/env node
/**
 * What the detail pane says, checked without a browser.
 *
 * Everything the pane shows is arithmetic over the parse, so it can be verified
 * from a terminal rather than read off a screen. This imports the same functions
 * the pane renders, so it cannot pass while the component is wrong.
 *
 * The two numbers that matter most are the ones a reader would catch by eye: a
 * count that disagrees with the list printed under it, and a figure that is not
 * backed by the edge list.
 *
 * Usage: pnpm map:detail [result.json]
 */
import { readFileSync } from "node:fs";
import { validateRepositoryParseResult } from "../parser/validate-result.mts";
import { describeCategories } from "../lib/graph/categories.ts";
import { detectFrameworks } from "../lib/graph/framework.ts";
import { describeDetail, describeFile, describeFolder, describeRepository } from "../lib/graph/detail.ts";
import { foldFolders } from "../lib/graph/fold.ts";
import { deriveMap, fileItemId, PANEL_VISIBLE_ROWS } from "../lib/graph/graph.ts";

const resultPath = process.argv[2] ?? "data/preview/vuejs-devtools.json";
const parsed = JSON.parse(readFileSync(resultPath, "utf8"));

if (!validateRepositoryParseResult(parsed)) {
  console.error(`${resultPath} does not satisfy the parser's typed data contract.`);
  process.exitCode = 1;
} else {
  run(parsed);
}

function run(parse) {
  const categories = describeCategories(parse.files);
  const fold = foldFolders(parse.files);
  const closed = deriveMap(parse, fold, new Set());
  let failures = 0;
  const fail = (label, detail) => {
    failures += 1;
    console.log(`FAIL  ${label} — ${detail}`);
  };
  const pass = (label, detail) => console.log(`pass  ${label} — ${detail}`);

  // ---- The resting state -----------------------------------------------------

  console.log("\n1. Repository summary, nothing selected");
  const repo = describeRepository(parse, categories);
  pass("name", `${repo.name} from ${parse.repositoryPath}`);
  pass("frameworks", repo.frameworks.map((f) => `${f.label} (${f.fileCount} files)`).join(", ") || "none named");
  pass(
    "counts",
    `${repo.fileCount} files, ${repo.importCount} imports, routes ${String(repo.routesParsed)}, ` +
      `${repo.unplacedCount} unplaced of ${parse.files.length}`,
  );

  // Routes must never be a number. The parser does not extract them, and a count
  // would claim this repository has none when it only says nobody looked.
  if (repo.routesParsed !== false) fail("Routes", `expected false, got ${JSON.stringify(repo.routesParsed)}`);
  else pass("Routes", "reported as not parsed, not as 0");

  // Every framework named must be backed by an import the parser actually saw.
  const frameworks = detectFrameworks(parse);
  let unsupported = 0;
  for (const framework of frameworks) {
    const files = new Set();
    for (const entry of parse.coverage.imports) {
      if (entry.kind === "outside" && framework.specifiers.includes(entry.specifier)) files.add(entry.from);
    }
    if (files.size !== framework.fileCount) unsupported += 1;
  }
  if (unsupported > 0) fail("Framework counts", `${unsupported} disagree with the imports behind them`);
  else pass("Framework counts", `${frameworks.length} frameworks, each backed by its own import records`);

  // The ranked list really is ranked, and nothing is silently dropped from the
  // end without the total saying so.
  const descending = repo.mostImported.every(
    (file, index) => index === 0 || repo.mostImported[index - 1].fanIn >= file.fanIn,
  );
  if (!descending) fail("Most depended on", "not ordered by fan-in");
  else if (repo.mostImportedTotal > repo.mostImported.length) {
    pass("Most depended on", `top ${repo.mostImported.length} of ${repo.mostImportedTotal}, ordered by fan-in`);
  } else {
    pass("Most depended on", `${repo.mostImportedTotal} files, all listed, ordered by fan-in`);
  }

  // ---- Orphan list -----------------------------------------------------------

  const importedBySomething = new Set(parse.edges.map((edge) => edge.to));
  const wrongOrphans = repo.orphans.filter((file) => importedBySomething.has(file.path));
  if (wrongOrphans.length > 0) {
    fail("Orphans", `${wrongOrphans.length} of them are in fact imported by something`);
  } else {
    pass("Orphans", `${repo.orphanTotal} files nothing imports, ${repo.orphans.length} shown, none of them imported`);
  }

  // ---- Per-file counts against per-file lists --------------------------------

  console.log("\n2. A selected file, every one of them");
  let mismatched = 0;
  let mostDependedOn = null;
  for (const file of parse.files) {
    const detail = describeFile(parse, categories, file.path);
    if (!detail) {
      fail(`File ${file.path}`, "described as nothing");
      mismatched += 1;
      continue;
    }

    // Expected neighbours come from the parse, independently of the detail lists.
    const distinctImports = new Set(parse.edges.filter((edge) => edge.from === file.path).map((edge) => edge.to)).size;
    const distinctImporters = new Set(parse.edges.filter((edge) => edge.to === file.path).map((edge) => edge.from)).size;
    if (distinctImports !== detail.imports.length) mismatched += 1;
    if (distinctImporters !== detail.importedBy.length) mismatched += 1;
    if (detail.path !== file.path) mismatched += 1;
    if (detail.lines !== file.lines) mismatched += 1;

    if (!mostDependedOn || detail.importedBy.length > mostDependedOn.importedBy.length) mostDependedOn = detail;
  }

  if (mismatched > 0) {
    fail("File counts", `${mismatched} file checks disagree with the parse`);
  } else {
    pass(
      "File counts",
      `all ${parse.files.length} files: list lengths match distinct neighbours in the parse`,
    );
  }

  if (mostDependedOn) {
    const detail = mostDependedOn;
    console.log(`      deepest: ${detail.importedBy.length} importers, ${detail.imports.length} imports`);
    console.log(`        ${detail.path}`);
    for (const row of detail.importedBy.slice(0, 3)) console.log(`        <- ${row.path}`);
    for (const row of detail.imports.slice(0, 3)) console.log(`        -> ${row.path}`);
    pass("Widest file", `${detail.importedBy.length} rows listed under "Depended on by"`);
  }

  // The parser's own fan-in is a record, not a set, so it counts statements. The
  // pane counts files. Where they differ, the pane's number is the one matching
  // the rows beside it — and this is where that difference is measured.
  let differs = 0;
  for (const file of parse.files) {
    const detail = describeFile(parse, categories, file.path);
    if (detail && (parse.fanIn[file.path] ?? 0) !== detail.importedBy.length) differs += 1;
  }
  pass(
    "Distinct importers",
    `${differs} of ${parse.files.length} files differ from the parser's statement count, ` +
      `which counts statements rather than files`,
  );

  // ---- A selected folder -----------------------------------------------------

  console.log("\n3. A selected folder");
  // Deliberately not the root, which is the one node whose "inside this folder"
  // means every file and would hide a grouping bug. And deliberately not just the
  // largest and smallest: a folder with subfolders is the case where the parts
  // list has something to say, and picking only by size found two folders whose
  // files all sit directly in them and reported "1 part" for both.
  const real = closed.folders.filter((folder) => folder.path !== ".");
  const withParts = real
    .map((folder) => ({ folder, detail: describeFolder(parse, categories, closed, folder.id) }))
    .filter((entry) => entry.detail !== null && entry.detail.parts.length > 1)
    .sort((left, right) => (right.detail?.fileCount ?? 0) - (left.detail?.fileCount ?? 0));

  const candidates = [
    withParts[0]?.folder,
    // The biggest folder with no subfolders at all, which is the "1 part" case.
    real.filter((folder) => describeFolder(parse, categories, closed, folder.id)?.parts.length === 1).sort(
      (left, right) => right.fileCount - left.fileCount,
    )[0],
    [...real].sort((left, right) => left.fileCount - right.fileCount)[0],
  ].filter((folder) => folder !== undefined);

  if (candidates.length === 0) fail("Folder", "no folders to test with");

  for (const folder of candidates) {
    const detail = describeFolder(parse, categories, closed, folder.id);
    if (!detail) {
      fail(`Folder ${folder.path}`, "described as nothing");
      continue;
    }
    const parts = detail.parts.length === 1 ? "part" : "parts";

    // The parts have to add up to the folder. This is the check the earlier
    // category-based version was passing while showing one row for 21 of 23
    // folders, which is why the parts are counted against the files rather than
    // against the folder's own total.
    const partTotal = detail.parts.reduce((sum, part) => sum + part.fileCount, 0);
    if (partTotal !== detail.fileCount) {
      fail(`Folder ${folder.path}`, `parts total ${partTotal}, file count ${detail.fileCount}`);
      continue;
    }
    const partLines = detail.parts.reduce((sum, part) => sum + part.lines, 0);
    if (partLines !== detail.lines) {
      fail(`Folder ${folder.path}`, `part lines total ${partLines}, line count ${detail.lines}`);
      continue;
    }

    // Counted straight off the parse, so the pane's number is checked against the
    // data rather than against itself.
    const expected = parse.files.filter(
      (file) => file.folder === folder.path || file.folder.startsWith(`${folder.path}/`),
    );
    if (expected.length !== detail.fileCount) {
      fail(`Folder ${folder.path}`, `pane says ${detail.fileCount} files, parse has ${expected.length} there`);
      continue;
    }

    const held = new Set(expected.map((file) => file.path));
    const internalPairs = new Set(
      parse.edges.filter((edge) => held.has(edge.from) && held.has(edge.to)).map((edge) => JSON.stringify([edge.from, edge.to])),
    );
    if (detail.internalEdgeCount !== internalPairs.size) {
      fail(`Folder ${folder.path}`, `pane says ${detail.internalEdgeCount} internal imports, parse has ${internalPairs.size} distinct pairs`);
      continue;
    }

    // Every file really is in a part, and in the right one. Getting this wrong is
    // how a folder ends up reporting a subfolder that holds nothing.
    let misplaced = 0;
    for (const part of detail.parts) {
      const inPart = expected.filter((file) => {
        if (part.id === "directly in this folder") return file.folder === folder.path;
        return file.folder === `${folder.path}/${part.id}` || file.folder.startsWith(`${folder.path}/${part.id}/`);
      });
      if (inPart.length !== part.fileCount) misplaced += 1;
    }

    if (misplaced > 0) fail(`Folder ${folder.path}`, `${misplaced} parts do not hold what they say they do`);
    else
      pass(
        `Folder ${folder.path}`,
        `${detail.fileCount} files, ${detail.parts.length} ${parts} summing to ${partTotal}, ` +
          `${detail.internalEdgeCount} internal imports, matches the parse`,
      );
    for (const part of detail.parts.slice(0, 5)) {
      console.log(`      ${String(part.fileCount).padStart(3)}  ${part.label}`);
    }
  }

  // ---- Selection routing -----------------------------------------------------

  console.log("\n4. What a selection resolves to");
  const byNothing = describeDetail(parse, categories, closed, null);
  if (byNothing.kind !== "repository") fail("No selection", `resolved to ${byNothing.kind}`);
  else pass("No selection", "resolves to the repository summary, not an empty state");

  const allOpen = deriveMap(parse, fold, new Set(fold.nodes.map((node) => node.id)));
  const selections = [
    ...closed.folders.map((folder) => folder.id),
    ...allOpen.rows.map((row) => row.id),
    fileItemId(parse.files[0].path),
  ];

  let unresolvable = 0;
  let fellBack = 0;
  for (const selection of new Set(selections)) {
    const detail = describeDetail(parse, categories, allOpen, selection);
    if (detail.kind === "repository") fellBack += 1;
    else {
      const wantsFolder = selection.startsWith("folder:");
      if ((detail.kind === "folder") !== wantsFolder) unresolvable += 1;
    }
  }
  if (unresolvable > 0) fail("Selection routing", `${unresolvable} resolved to the wrong kind`);
  else if (fellBack > 0) fail("Selection routing", `${fellBack} fell back to the repository summary`);
  else pass("Selection routing", `${new Set(selections).size} selections all resolved to their own subject`);

  // A path that is not in the repository resolves to the repository rather than
  // throwing. Nothing in the interface can produce one, so this is about a bad
  // selection left over from a previous analysis being survivable.
  const missing = describeDetail(parse, categories, allOpen, fileItemId("nope/nope.ts"));
  if (missing.kind !== "repository") fail("Unknown path", `resolved to ${missing.kind}`);
  else pass("Unknown path", "falls back to the repository summary rather than throwing");

  // ---- A file the panel has scrolled past -------------------------------------

  console.log("\n5. Selecting a file the panel is not showing");
  // A panel shows a window of rows and scrolls. Selecting a file past the window
  // selects an item id with no row behind it, so the map dims and highlights
  // nothing. The scroll that brings it back is checked here by reading the state
  // the workspace would write, because that is where the decision is made.
  // The root is excluded: it holds every file, so it always scrolls, and its last
  // file is a fixture .vue nothing imports — which would test the arithmetic
  // without saying anything about a real folder.
  const tall = [...fold.nodes].filter(
    (node) => node.id !== "." && node.fileCount > PANEL_VISIBLE_ROWS,
  );
  if (tall.length === 0) {
    pass("Scrolled rows", `every panel fits in ${PANEL_VISIBLE_ROWS} rows, nothing can scroll past`);
  } else {
    const node = tall.sort((left, right) => right.fileCount - left.fileCount)[0];
    const lastIndex = node.fileCount - 1;
    const lastStart = node.fileCount - PANEL_VISIBLE_ROWS;
    const start = Math.min(Math.max(0, lastIndex - PANEL_VISIBLE_ROWS + 1), lastStart);
    const opened = deriveMap(parse, fold, new Set([node.id]), new Map([[node.id, start]]));
    const row = opened.rows.find((candidate) => candidate.path === node.files[lastIndex]);

    if (!row) fail("Scrolled rows", `scrolling to ${start} did not bring ${node.files[lastIndex]} on screen`);
    else pass("Scrolled rows", `${tall.length} panels scroll; ${node.id} reaches its last file at scroll ${start}`);

    // And the selection survives that scroll: the same file is still lit.
    if (row && !opened.itemIds.has(row.id)) fail("Scrolled selection", "the row is not a selectable item");
  }

  console.log(failures === 0 ? "\nAll detail checks passed." : `\n${failures} FAILED`);
  if (failures > 0) process.exitCode = 1;
}
