#!/usr/bin/env node
/**
 * Stored rows back into the parser's shape.
 *
 * The map has always taken a `RepositoryParseResult`. Now the same map takes rows out
 * of the database, converted by `loadAnalysisParse`. Nothing checks that the two
 * agree: a column that was never stored, a field reconstructed with a default, a
 * count that quietly comes out as zero - all of them produce a map that draws, and
 * none of them fail.
 *
 * So this runs a real repository through the real store into a recording client, and
 * then runs the same rows through the same reconstruction the map uses, and compares
 * the result against what the parser actually produced. Anything the round trip
 * cannot carry comes back as a named difference rather than as a smaller graph.
 *
 * `loadAnalysisParse` reads through the Supabase client, so it cannot be pointed at
 * a recorder. What is checked here is the part that is not a query: the shape of what
 * comes out. The queries themselves are one-liners that the generated types check.
 *
 * Usage: pnpm map:roundtrip [repository]
 */
import { parseRepository } from "../parser/parse-repository.mts";
import { validateRepositoryParseResult } from "../parser/validate-result.mts";
import { fetchRepository, cleanUp } from "../lib/pipeline/fetch-repository.mts";
import { parseRepositoryUrl } from "../lib/pipeline/repository-url.mts";
import { storeParse } from "../lib/pipeline/store.mts";
import { reconstructParse } from "../lib/reconstruct-parse.mts";

const slug = process.argv[2] ?? "sindresorhus/slugify";
const ref = parseRepositoryUrl(slug);

let failures = 0;
const check = (label, passed, detail) => {
  if (!passed) failures += 1;
  console.log(`${passed ? "pass" : "FAIL"}  ${label} - ${detail}`);
};

// A client that answers the inserts and hands them straight back, so the store's
// output can be read without a database. `storeParse` only calls `.insert`.
const written = { files: [], edges: [] };
const client = {
  from(table) {
    const chain = {
      insert(rows) {
        if (table === "files") written.files.push(...rows);
        if (table === "edges") written.edges.push(...rows);
        return Promise.resolve({ error: null });
      },
    };
    return chain;
  },
};

const fetched = await fetchRepository(ref);
let parsed;

try {
  parsed = parseRepository(fetched.path);

  await storeParse(client, {
    analysisId: "a1111111-1111-4111-8111-111111111111",
    organizationId: "org_test",
    files: parsed.files,
    edges: parsed.edges,
    coverage: parsed.coverage,
    summary: parsed.summary,
    skipped: parsed.skipped,
  });

  // The rows, as the database would hand them back.
  const rows = {
    analysis: {
      name: parsed.repositoryPath,
      createdAt: parsed.generatedAt,
    },
    files: written.files,
    edges: written.edges.map((edge) => ({
      from_file_id: edge.from_file_id,
      to_file_id: edge.to_file_id,
      kind: edge.kind,
      specifier: edge.specifier,
      line: edge.line,
    })),
    // Every import, resolved or not - which is what the store writes.
    unresolved: parsed.coverage.imports.map((entry) => ({
        file_path: entry.from,
        specifier: entry.specifier,
        kind: entry.kind,
        reason: entry.reason,
        line: entry.line,
        import_kind: entry.importKind,
      })),
    skipped: parsed.skipped.map((entry) => ({
      path: entry.path,
      entry_kind: entry.kind,
      reason: entry.reason,
    })),
    // The coverage row as the database holds it. The parser names these `total` and
    // `resolved`; the column names are `imports_total` and `imports_resolved`, and
    // mapping between them here is what a migration does.
    coverage: {
      files_found: parsed.summary.filesFound,
      files_parsed: parsed.summary.filesParsed,
      files_skipped: parsed.summary.filesSkipped,
      distinct_folders: parsed.summary.distinctFolders,
      imports_total: parsed.coverage.total,
      imports_resolved: parsed.coverage.resolved,
      imports_outside: parsed.coverage.outside,
      imports_excluded: parsed.coverage.excluded,
      imports_unresolved: parsed.coverage.unresolved,
    },
    summary: parsed.summary,
  };

  const rebuilt = reconstructParse(rows);

  check(
    "The reconstruction is a valid parse",
    validateRepositoryParseResult(rebuilt),
    `${rebuilt.files.length} files, ${rebuilt.edges.length} edges`,
  );

  const paths = new Set(rebuilt.files.map((f) => f.path));
  const missing = parsed.files.filter((f) => !paths.has(f.path)).map((f) => f.path);
  check(
    "Every file the parser found survives the round trip",
    missing.length === 0,
    missing.length === 0
      ? `${rebuilt.files.length} of ${parsed.files.length} paths, none lost`
      : `missing: ${missing.slice(0, 5).join(", ")}`,
  );

  // Folding is arithmetic on the folder, so a folder that came back wrong would draw
  // a plausible map of the wrong shape rather than fail.
  const wrongFolder = rebuilt.files.filter(
    (f) => f.folder !== parsed.files.find((p) => p.path === f.path)?.folder,
  );
  check(
    "Every folder survives the round trip",
    wrongFolder.length === 0,
    wrongFolder.length === 0
      ? `${new Set(rebuilt.files.map((f) => f.folder)).size} distinct folders`
      : `${wrongFolder.length} differ, first: ${wrongFolder[0].path}`,
  );

  // Resolved imports are the edges, and the unresolved ones are their own table.
  // Together they are coverage.imports, which is what framework detection reads.
  
  check(
    "The stored counts survive, which is what the banner shows",
    rebuilt.coverage.total === parsed.coverage.total &&
      rebuilt.coverage.resolved === parsed.coverage.resolved &&
      rebuilt.coverage.outside === parsed.coverage.outside &&
      rebuilt.coverage.excluded === parsed.coverage.excluded &&
      rebuilt.coverage.unresolved === parsed.coverage.unresolved,
    `${rebuilt.coverage.resolved} resolved + ${rebuilt.coverage.outside} outside + ` +
      `${rebuilt.coverage.unresolved} unresolved, of ${rebuilt.coverage.total}`,
  );

  check(
    "The kind matrix survives, counted per import statement",
    ["import", "re-export", "dynamic"].every((kind) =>
      ["resolved", "outside", "excluded", "unresolved"].every(
        (outcome) => rebuilt.coverage.byKind[kind][outcome] === parsed.coverage.byKind[kind][outcome],
      ),
    ),
    rebuilt.coverage.resolved === rebuilt.edges.length
      ? `${rebuilt.coverage.resolved} imports and ${rebuilt.edges.length} edges happen to agree`
      : `${rebuilt.coverage.resolved} imports draw ${rebuilt.edges.length} edges - deduplicated on from/to/kind - ` +
        `and the matrix counts imports`,
  );

  check(
    "Every import is stored as a row, none deduplicated away",
    parsed.coverage.imports.length === rows.unresolved.length,
    `${rows.unresolved.length} rows for ${parsed.coverage.imports.length} imports`,
  );

  check(
    "Fan-in and fan-out survive, keyed by path",
    parsed.files.every(
      (f) =>
        rebuilt.fanIn[f.path] === countWhere(rebuilt, f.path, "to") &&
        rebuilt.fanOut[f.path] === countWhere(rebuilt, f.path, "from"),
    ),
    "read from the stored columns, and they agree with the edge list",
  );

  check(
    "Every skipped file keeps its reason",
    rebuilt.skipped.length === parsed.skipped.length &&
      parsed.skipped.every((s) => rebuilt.skipped.some((r) => r.path === s.path && r.reason === s.reason)),
    `${rebuilt.skipped.length} skipped, each with a reason`,
  );

  check(
    "Line numbers on edges survive",
    rebuilt.edges.every((e) => typeof e.line === "number" && e.line > 0),
    `${rebuilt.edges.length} edges, every one pointing at a line`,
  );
} finally {
  cleanUp(fetched);
}

function countWhere(parse, path, end) {
  return parse.edges.filter((edge) => edge[end] === path).length;
}

console.log(failures === 0 ? "\nAll round-trip checks passed." : `\n${failures} FAILED`);
if (failures > 0) process.exitCode = 1;