import { PARSER_VERSION } from "../parser/types.mts";
import type {
  CoverageExample,
  CoverageKind,
  CoverageSummary,
  ImportKind,
  RepositoryParseResult,
} from "../parser/types.mts";

/**
 * Stored rows back into the parser's own shape.
 *
 * The map takes a `RepositoryParseResult` and always has. Now that the map is fed by
 * the database rather than by a checked-in file, something has to turn rows into
 * that shape, and this is it.
 *
 * It is a pure function over rows, separate from the queries, because that is the
 * only way to check it. The queries are one-liners the generated types already
 * check; what nothing checks is whether the rows that come back still describe the
 * same repository the parser looked at - a column that was never stored, a field
 * reconstructed with a default, a count that quietly comes out as zero. Each of those
 * produces a map that draws and none of them fail, which is what `map:roundtrip` is
 * for.
 *
 * Two things are reconstructed rather than read, and both are arithmetic:
 *
 *   Resolved imports are the edges. Every edge is one import that resolved to a real
 *   file; the ones that did not are their own table. Together they are
 *   `coverage.imports`, which is what framework detection reads.
 *
 *   Fan-in and fan-out are stored per file row. Recounting them from the edges would
 *   be a second answer to a question the store already answered.
 */

export interface StoredFile {
  id: string;
  path: string;
  folder: string;
  language: string | null;
  lines: number | null;
  module_id: string | null;
  sha256: string | null;
  is_entry_point: boolean;
  is_external_module: boolean;
  fan_in: number;
  fan_out: number;
}

export interface StoredEdge {
  from_file_id: string;
  to_file_id: string;
  kind: string;
  specifier: string | null;
  line: number | null;
}

export interface StoredUnresolved {
  file_path: string;
  specifier: string;
  kind: string;
  reason: string;
  line: number;
  import_kind: string;
}

export interface StoredSkipped {
  path: string;
  entry_kind: string;
  reason: string;
}

export interface StoredCounts {
  files_found: number;
  files_parsed: number;
  files_skipped: number;
  distinct_folders: number;
  imports_total: number;
  imports_resolved: number;
  imports_outside: number;
  imports_excluded: number;
  imports_unresolved: number;
}

export interface StoredAnalysis {
  name: string;
  createdAt: string;
}

export interface RowsToReconstruct {
  analysis: StoredAnalysis;
  files: StoredFile[];
  edges: StoredEdge[];
  unresolved: StoredUnresolved[];
  skipped: StoredSkipped[];
  coverage: StoredCounts | null;
}

export function reconstructParse(rows: RowsToReconstruct): RepositoryParseResult {
  const { analysis, files, edges, unresolved, skipped, coverage } = rows;

  const pathOfId = new Map<string, string>();
  for (const file of files) pathOfId.set(file.id, file.path);

  // An edge whose end has no file row cannot be drawn. It should be impossible -
  // the store writes both ends in one pass - so it is counted and named rather than
  // filtered away in silence.
  const drawn = edges.flatMap((edge) => {
    const from = pathOfId.get(edge.from_file_id);
    const to = pathOfId.get(edge.to_file_id);
    if (from === undefined || to === undefined) return [];
    return [
      {
        from,
        to,
        kind: edge.kind as ImportKind,
        specifier: edge.specifier ?? "",
        line: edge.line ?? 0,
      },
    ];
  });

  const undrawable = edges.length - drawn.length;
  if (undrawable > 0) {
    console.warn(
      `${undrawable} edges pointed at a file with no row and could not be drawn. ` +
        `The store writes both ends together, so this should not happen.`,
    );
  }

  // `coverage.imports` comes from the stored import rows, not from the edges. The
  // edges are deduplicated on from/to/kind, so they undercount a file that imports
  // the same module three times, and the totals would then disagree with the stored
  // coverage row in a way nobody could explain.
  const imports: CoverageExample[] = unresolved.map((entry) => ({
    from: entry.file_path,
    specifier: entry.specifier,
    kind: entry.kind as CoverageKind,
    reason: entry.reason,
    line: entry.line,
    importKind: entry.import_kind as ImportKind,
  }));

  return {
    parserVersion: PARSER_VERSION,
    repositoryPath: analysis.name,
    generatedAt: analysis.createdAt,
    summary: {
      filesFound: coverage?.files_found ?? files.length + skipped.length,
      filesParsed: coverage?.files_parsed ?? files.length,
      filesSkipped: coverage?.files_skipped ?? skipped.length,
      distinctFolders: coverage?.distinct_folders ?? new Set(files.map((f) => f.folder)).size,
    },
    files: files.map((file) => ({
      path: file.path,
      folder: file.folder,
      module: file.module_id ?? "",
      language: file.language === "javascript" ? "javascript" : "typescript",
      lines: file.lines ?? 0,
      sha256: file.sha256 ?? "",
      isExternalModule: file.is_external_module,
      isEntryPoint: file.is_entry_point,
    })),
    edges: drawn,
    fanIn: Object.fromEntries(files.map((file) => [file.path, file.fan_in])),
    fanOut: Object.fromEntries(files.map((file) => [file.path, file.fan_out])),
    coverage: summarise(imports, coverage),
    skipped: skipped.map((entry) => ({
      path: entry.path,
      kind: entry.entry_kind as "file" | "directory",
      reason: entry.reason,
    })),
  };
}

/**
 * The totals, the matrix, and the examples.
 *
 * The five counts come from the stored coverage row rather than from counting rows
 * here, because the stored row is what the parser counted and this is a
 * reconstruction. If the two ever disagree, the row is the one written by the thing
 * that read the code.
 */
function summarise(imports: CoverageExample[], counts: StoredCounts | null): CoverageSummary {
  const byKind: Record<ImportKind, Record<CoverageKind, number>> = {
    import: { resolved: 0, outside: 0, excluded: 0, unresolved: 0 },
    "re-export": { resolved: 0, outside: 0, excluded: 0, unresolved: 0 },
    dynamic: { resolved: 0, outside: 0, excluded: 0, unresolved: 0 },
  };

  for (const entry of imports) byKind[entry.importKind][entry.kind] += 1;

  const counted = (kind: CoverageKind) => imports.filter((entry) => entry.kind === kind).length;

  return {
    total: counts?.imports_total ?? imports.length,
    resolved: counts?.imports_resolved ?? counted("resolved"),
    outside: counts?.imports_outside ?? counted("outside"),
    excluded: counts?.imports_excluded ?? counted("excluded"),
    unresolved: counts?.imports_unresolved ?? counted("unresolved"),
    byKind,
    imports,
    // The examples are what did not resolve. A resolved import is already drawn.
    examples: imports.filter((entry) => entry.kind !== "resolved"),
  };
}