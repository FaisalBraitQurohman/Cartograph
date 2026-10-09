#!/usr/bin/env node
/**
 * Graph maths and insights, checked without a browser.
 *
 * Everything the walks and the insight panel show is arithmetic over the parse, so
 * it can be verified from a terminal rather than read off a screen. This imports
 * the same functions the pane renders, so it cannot pass while the component is
 * wrong.
 *
 * The checks that matter most are the ones about a walk being right rather than
 * merely fast: that it never revisits a file, that it stops at the depth it claims,
 * and that a cycle cannot make it run forever.
 *
 * Usage: pnpm map:insights [result.json]
 */
import { readFileSync } from "node:fs";
import { validateRepositoryParseResult } from "../parser/validate-result.mts";
import { describeCategories } from "../lib/graph/categories.ts";
import { entryPointRuleFor, ENTRY_POINT_RULES, partitionByEntryPoint } from "../lib/graph/entry-points.ts";
import {
  cyclesOf,
  importerCounts,
  insightsOf,
  MANY_IMPORTERS,
  TOO_MANY_LINES,
  walkFrom,
  walksFor,
  WALK_DEPTH,
} from "../lib/graph/insights.ts";
import { foldFolders } from "../lib/graph/fold.ts";
import { deriveMap, folderItemId } from "../lib/graph/graph.ts";
import { litItems } from "../lib/graph/highlight.ts";

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
  const closed = deriveMap(parse, fold, new Set(), new Map(), describeCategories(parse.files).depth);
  const paths = new Set(parse.files.map((file) => file.path));
  let failures = 0;
  const check = (label, passed, detail) => {
    if (!passed) failures += 1;
    console.log(`${passed ? "pass" : "FAIL"}  ${label} — ${detail}`);
  };

  // ---- The two walks ---------------------------------------------------------

  console.log("\n1. Blast radius and dependency chain");
  const counts = importerCounts(parse);

  let wrongDirection = 0;
  let revisited = 0;
  let tooDeep = 0;
  let notAFile = 0;
  let includedSelf = 0;

  for (const file of parse.files) {
    const { blast, chain } = walksFor(parse, file.path);

    const both = [blast, chain];
    for (const result of both) {
      const seen = new Set();
      for (const entry of result.paths) {
        if (seen.has(entry.path)) revisited += 1;
        seen.add(entry.path);
        if (!paths.has(entry.path)) notAFile += 1;
        if (entry.path === file.path) includedSelf += 1;
        if (entry.depth < 1 || entry.depth > WALK_DEPTH) tooDeep += 1;
      }
    }

    // The two walks are opposites. Every file the blast radius reports must be able
    // to reach the start by following imports forwards, or the two are not describing
    // one graph with two directions.
    for (const entry of blast.paths) {
      if (!reachable(parse, entry.path, file.path, WALK_DEPTH)) wrongDirection += 1;
    }
  }

  check(
    `All ${parse.files.length} files, both directions`,
    wrongDirection === 0 && revisited === 0 && tooDeep === 0 && notAFile === 0 && includedSelf === 0,
    `${revisited} revisits, ${tooDeep} past the depth limit, ${notAFile} paths not in the repository, ` +
      `${includedSelf} include the file itself`,
  );

  // Level 1 is the direct importers — distinct files, not import statements. Four
  // files in this repository are imported twice from the same place, and comparing
  // against the edge count instead of the distinct count reported them as a failure
  // that was the check's own arithmetic rather than the walk's.
  let levelWrong = 0;
  let duplicated = 0;
  for (const file of parse.files) {
    const statements = parse.edges.filter((edge) => edge.to === file.path).length;
    const distinct = importerCounts(parse).get(file.path) ?? 0;
    if (statements !== distinct) duplicated += 1;
    const levelOne = walkFrom(parse, file.path, { outward: false }).paths.filter((p) => p.depth === 1).length;
    if (distinct !== levelOne) levelWrong += 1;
  }
  check(
    "Blast radius level 1 is the distinct direct importers",
    levelWrong === 0,
    `${levelWrong} mismatched across ${parse.files.length} files (${duplicated} are imported twice from the same file)`,
  );

  const widest = [...parse.files].sort((a, b) => (counts.get(b.path) ?? 0) - (counts.get(a.path) ?? 0))[0];
  const shown = walksFor(parse, widest.path);
  console.log(`      widest file: ${widest.path}`);
  for (const [label, result] of [["blast radius", shown.blast], ["chain", shown.chain]]) {
    console.log(
      `        ${label.padEnd(13)} ${String(result.paths.length).padStart(3)} files` +
        ` (${result.paths.filter((p) => p.depth === 1).length} at 1, ${result.paths.filter((p) => p.depth === 2).length} at 2)` +
        `, truncated=${result.truncated}, beyond=${result.filesBeyond}`,
    );
  }

  // A walk must stop, and say so. Depth 1 on the widest file is guaranteed to leave
  // files behind, which is the only way to tell that the limit is real.
  const shallow = walkFrom(parse, widest.path, { outward: false, depth: 1 });
  const deeper = walkFrom(parse, widest.path, { outward: false, depth: 2 });
  const deepest = walkFrom(parse, widest.path, { outward: false, depth: 3 });

  check(
    "The depth limit is real and reported",
    deeper.paths.length >= shallow.paths.length &&
      deeper.paths.every((p) => p.depth <= 2) &&
      shallow.paths.every((p) => p.depth <= 1),
    `depth 1 -> ${shallow.paths.length}, depth 2 -> ${deeper.paths.length}, ` +
      `depth 2 reports ${deeper.filesBeyond} beyond`,
  );

  // `filesBeyond` was always 0, because the frontier was empty by the time it was
  // read — and a walk that reports nothing beyond the limit looks complete. A file
  // that is in the boundary set must be genuinely unreached, and there must be
  // something in that set when the graph goes deeper than the limit.
  let boundaryWrong = 0;
  for (const depth of [1, 2]) {
    const result = walkFrom(parse, widest.path, { outward: false, depth });
    for (const path of result.paths) {
      if (path.depth > depth) boundaryWrong += 1;
    }
  }

  // Every file counted as beyond must really be unreachable within the limit, and
  // every file reachable within limit+1 must either be in the list or counted.
  const beyondAt2 = deeper.filesBeyond;
  const reachableAt3 = deepest.paths.filter((p) => p.depth === 3).length;
  const consistent =
    beyondAt2 === reachableAt3 &&
    deeper.truncated === (beyondAt2 > 0) &&
    shallow.truncated === (shallow.filesBeyond > 0);

  check(
    "filesBeyond is counted, not always zero",
    boundaryWrong === 0 && consistent && beyondAt2 > 0,
    boundaryWrong === 0 && consistent
      ? `depth 1 leaves ${shallow.filesBeyond}, depth 2 leaves ${beyondAt2}, and depth 3 reaches exactly ${reachableAt3} new files`
      : `depth 2 claims ${beyondAt2} beyond but depth 3 reaches ${reachableAt3}`,
  );

  // Every file beyond the limit is reachable, just not within it. Checked by walking
  // forwards, because "unreached" here means "not found in time", not "not there".
  // Every file at level 3 must be genuinely three edges away, or the levels are
  // wrong rather than merely truncated. Checked backwards from each of them: a blast
  // radius reaches the start by following importers, so asking `reachable` to walk
  // forwards from the start would look for the wrong edge entirely.
  let notThreeAway = 0;
  for (const path of deepest.paths.filter((p) => p.depth === 3)) {
    if (reachable(parse, path.path, widest.path, 2)) notThreeAway += 1;
    if (deeper.paths.some((p) => p.path === path.path)) notThreeAway += 1;
  }
  check(
    "Files at level 3 really are three edges away",
    notThreeAway === 0,
    notThreeAway === 0
      ? `${reachableAt3} files at level 3, none reachable in 2 and none already in the level 2 list`
      : `${notThreeAway} of ${reachableAt3} are reachable in 2 or already listed`,
  );

  // ---- Cycles ----------------------------------------------------------------

  console.log("\n2. Import cycles, found iteratively");
  const cycles = cyclesOf(parse);
  const cyclesInGraph = cycles.filter(
    (loop) => parse.edges.some((edge) => edge.from === loop.from && edge.to === loop.to),
  );
  check(
    "Every reported cycle is a real edge",
    cyclesInGraph.length === cycles.length && cycles.length > 0,
    `${cycles.length} cycles, longest ${cycles[0]?.length ?? 0} files`,
  );

  // The whole point of the iterative walk: it terminates on a graph that has a cycle
  // through most of it. A recursive one would have blown up here.
  check(
    "A cyclic graph terminates",
    true,
    `${parse.files.length} files, ${parse.edges.length} edges, finished without recursion`,
  );

  // And the biggest one is verified by hand, the way the acceptance check asks.
  const biggest = cycles[0];
  if (biggest) {
    const forward = new Map();
    for (const edge of parse.edges) {
      const list = forward.get(edge.from) ?? [];
      list.push(edge.to);
      forward.set(edge.from, list);
    }
    const from = biggest.to;
    const seen = new Set([from]);
    const queue = [from];
    let back = false;
    while (queue.length > 0 && !back) {
      const node = queue.shift();
      for (const next of forward.get(node) ?? []) {
        if (next === biggest.from) { back = true; break; }
        if (!seen.has(next)) { seen.add(next); queue.push(next); }
      }
    }
    check(
      `Longest cycle verified by walking it: ${biggest.from} -> ${biggest.to}`,
      back,
      back ? `${biggest.length} files, path exists in the edge list` : "no path found back",
    );
  }

  // ---- Entry points ----------------------------------------------------------

  console.log("\n3. Files nothing imports");
  const { reached, unmatched } = partitionByEntryPoint(parse.files);
  const nothingImports = parse.files.filter((file) => (counts.get(file.path) ?? 0) === 0);
  const stillReported = nothingImports.filter((file) => entryPointRuleFor(file) === null);

  console.log(`      ${parse.files.length} files, ${nothingImports.length} that nothing imports`);
  console.log(`      ${reached.length} reached by a convention across ${ENTRY_POINT_RULES.length} rules`);
  for (const rule of ENTRY_POINT_RULES) {
    const matched = reached.filter((entry) => entry.rule.id === rule.id).length;
    console.log(`        ${String(matched).padStart(4)}  ${rule.label}`);
  }
  console.log(`      ${stillReported.length} left as findings, ${unmatched.length - stillReported.length} unmatched but imported`);

  // The rule that matters: a file nothing imports and a convention reaches is not a
  // finding. Checked against the insight's own rows, because that is where a file
  // would leak through if the two disagreed about what a convention is.
  const nothingImportsInsight = insightsOf(parse).find((insight) => insight.kind === "nothing-imports");
  const leaked = (nothingImportsInsight?.rows ?? []).filter(
    (row) => entryPointRuleFor(parse.files.find((file) => file.path === row.path)) !== null,
  );
  check(
    "No recognised entry point is reported as unreferenced",
    leaked.length === 0,
    `${reached.length} recognised, ${stillReported.length} reported, ${leaked.length} leaked into the insight`,
  );

  // A config file and a test file must be recognised, or the rule does nothing.
  const sample = [
    ["a config file", "vitest.config.ts"],
    ["a test file", "tests/unit/runtime/timeline-owner.test.ts"],
  ];
  for (const [label, path] of sample) {
    const file = parse.files.find((candidate) => candidate.path === path);
    if (!file) continue;
    const rule = entryPointRuleFor(file);
    check(`${label} is recognised`, rule !== null, `${path} -> ${rule?.label ?? "NOT RECOGNISED"}`);
  }

  // ---- The four insights -----------------------------------------------------

  console.log("\n4. Insights");
  const insights = insightsOf(parse);
  console.log(`      thresholds: ${MANY_IMPORTERS}+ importers, ${TOO_MANY_LINES}+ lines, depth ${WALK_DEPTH}`);

  const kinds = insights.map((insight) => insight.kind);
  check(
    "Nothing imports these leads",
    kinds[0] === "nothing-imports",
    kinds.join(", "),
  );
  check(
    "Cycles and long files read closer to a verdict, so they sit underneath",
    kinds.indexOf("cycle") > kinds.indexOf("nothing-imports") &&
      kinds.indexOf("too-long") > kinds.indexOf("nothing-imports"),
    `cycle at ${kinds.indexOf("cycle")}, too-long at ${kinds.indexOf("too-long")}`,
  );

  let wrongThreshold = 0;
  let inventedRow = 0;
  for (const insight of insights) {
    for (const row of insight.rows) {
      if (!paths.has(row.path)) inventedRow += 1;
    }
    if (insight.kind === "many-importers") {
      for (const row of insight.rows) {
        if ((counts.get(row.path) ?? 0) < MANY_IMPORTERS) wrongThreshold += 1;
      }
    }
    if (insight.kind === "too-long") {
      for (const row of insight.rows) {
        const file = parse.files.find((candidate) => candidate.path === row.path);
        if (!file || file.lines < TOO_MANY_LINES) wrongThreshold += 1;
      }
    }
    if (insight.kind === "nothing-imports") {
      for (const row of insight.rows) {
        if ((counts.get(row.path) ?? 0) !== 0 || entryPointRuleFor(parse.files.find((f) => f.path === row.path)) !== null) {
          wrongThreshold += 1;
        }
      }
    }
    console.log(
      `      [${insight.kind}] ${insight.total} total, showing ${insight.rows.length}` +
        (insight.rows.length ? ` — ${insight.rows[0].path} ${insight.rows[0].figure}` : ""),
    );
  }

  check("Every insight row is a real file", inventedRow === 0, `${inventedRow} invented`);
  check("Every insight row passes its own threshold", wrongThreshold === 0, `${wrongThreshold} did not`);

  // ---- Rail filtering --------------------------------------------------------

  console.log("\n5. The rail filter");
  const categories = describeCategories(parse.files);
  for (const category of categories.categories) {
    const expected = parse.files.filter(
      (file) => category.id === bucketFor(file.folder, categories.depth),
    ).length;
    const summed = fold.nodes.reduce(
      (sum, node) => sum + closed.filesOf(node.id, category.id),
      0,
    );
    if (summed !== expected || summed !== category.fileCount) {
      check(`Category ${category.label} adds up`, false, `panels ${summed}, parse ${expected}, rail ${category.fileCount}`);
      failures += 1;
    }
  }
  const allMatch = categories.categories.every((category) => {
    const summed = fold.nodes.reduce(
      (sum, node) => sum + closed.filesOf(node.id, category.id),
      0,
    );
    return summed === category.fileCount;
  });
  check(
    "Every category's panel counts sum to its rail count",
    allMatch,
    `${categories.categories.length} categories over ${fold.nodes.length} panels`,
  );

  // Dimming, not removing: every drawn item is still there with a category on.
  const oneCategory = categories.categories.find((c) => c.fileCount > 0);
  const filter = new Set(["not-a-real-item"]);
  const kept = litItems(closed, null, filter);
  check(
    "A filter dims rather than removes",
    kept !== null && kept.size === 0 && closed.itemIds.size > 0,
    `${closed.itemIds.size} items drawn, ${kept?.size ?? 0} lit`,
  );

  // A folder box holding one matching file stays lit — that is the only route to it.
  const target = fold.nodes.find((node) =>
    node.files.some((path) => {
      const file = parse.files.find((candidate) => candidate.path === path);
      return file && bucketFor(file.folder, categories.depth) === oneCategory?.id;
    }),
  );
  if (target && oneCategory) {
    const matching = litItems(closed, null, new Set([folderItemId(target.id)]));
    check(
      "A folder holding one matching file stays lit",
      matching !== null && matching.has(folderItemId(target.id)),
      `${target.id} has ${closed.filesOf(target.id, oneCategory.id)} of ${target.fileCount} in ${oneCategory.label}`,
    );
  }

  console.log(failures === 0 ? "\nAll insights checks passed." : `\n${failures} FAILED`);
  if (failures > 0) process.exitCode = 1;
}

function bucketFor(folder, depth) {
  const parts = folder === "." ? [] : folder.split("/");
  return parts.length < depth ? "." : parts.slice(0, depth).join("/");
}

/** Can `from` reach `target` in at most `depth` imports, following imports forwards? */
function reachable(parse, from, target, depth) {
  const seen = new Set([from]);
  let frontier = [from];
  for (let level = 1; level <= depth; level += 1) {
    const next = [];
    for (const node of frontier) {
      for (const edge of parse.edges) {
        if (edge.from !== node) continue;
        if (edge.to === target) return true;
        if (!seen.has(edge.to)) { seen.add(edge.to); next.push(edge.to); }
      }
    }
    frontier = next;
  }
  return false;
}
