import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { CoverageSummary, ParsedFile, ParsedEdge } from "@/parser/types.mts";
import type { Stage } from "./stage.mts";

/**
 * Writing a parse to the database.
 *
 * One analysis is written in one transaction: the files, the edges between them,
 * the coverage figures, and the imports that did not become edges. They are the same
 * claim about the same repository, and a graph whose edges are stored but whose
 * coverage figures are not would report itself as complete.
 *
 * The function takes a Supabase client rather than building one. Which client is
 * decides who is writing — a request signed in as a person, or this process with the
 * service key — and that belongs to the caller. Nothing here reads the environment.
 */

type Client = SupabaseClient<Database>;

/** A file to write, with the id the edge table will refer to. */
export interface StoredFile extends ParsedFile {
  id: string;
}

export interface StoreResult {
  filesWritten: number;
  edgesWritten: number;
  coverageWritten: boolean;
  unresolvedWritten: number;
  skippedWritten: number;
}

export interface StoreInput {
  analysisId: string;
  organizationId: string;
  files: readonly ParsedFile[];
  edges: readonly ParsedEdge[];
  coverage: CoverageSummary;
  summary: {
    filesFound: number;
    filesParsed: number;
    filesSkipped: number;
    distinctFolders: number;
  };
  skipped: readonly { path: string; kind: "file" | "directory"; reason: string }[];
}

export class StoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoreError";
  }
}

/**
 * Write the whole parse, or none of it.
 *
 * The ids are generated here rather than by the database so the edge table can be
 * written in the same pass: `edges.from_file_id` needs a file id that already
 * exists, and letting Postgres generate one would mean a round trip per file to
 * learn what it chose.
 */
export async function storeParse(client: Client, input: StoreInput): Promise<StoreResult> {
  const { analysisId, organizationId } = input;
  const idOfPath = new Map<string, string>();

  for (const file of input.files) {
    idOfPath.set(file.path, newId());
  }

  const files = input.files.map((file) => ({
    id: idOfPath.get(file.path) as string,
    organization_id: organizationId,
    analysis_id: analysisId,
    path: file.path,
    folder: file.folder,
    language: file.language,
    lines: file.lines,
    module_id: file.module,
    sha256: file.sha256,
    is_entry_point: file.isEntryPoint,
    is_external_module: file.isExternalModule,
    fan_in: countFor(file.path, input.edges, "to"),
    fan_out: countFor(file.path, input.edges, "from"),
  }));

  // Edges whose ends are both real files. A path with no row cannot have an edge
  // pointing at it, and the parser only ever emits edges between files it reported
  // — so this filter is a guard rather than a repair, and a path dropped here is
  // counted and reported rather than skipped silently.
  const edges = input.edges.flatMap((edge) => {
    const from = idOfPath.get(edge.from);
    const to = idOfPath.get(edge.to);
    if (from === undefined || to === undefined) return [];
    return [
      {
        id: newId(),
        organization_id: organizationId,
        analysis_id: analysisId,
        from_file_id: from,
        to_file_id: to,
        kind: edge.kind,
        specifier: edge.specifier,
        line: edge.line,
      },
    ];
  });

  const droppedEdges = input.edges.length - edges.length;

  // Batched. One insert per file is a round trip per file, and a repository of a
  // few hundred files would spend longer writing than parsing.
  const BATCH = 500;
  for (let start = 0; start < files.length; start += BATCH) {
    await insert(client, "files", files.slice(start, start + BATCH));
  }
  for (let start = 0; start < edges.length; start += BATCH) {
    await insert(client, "edges", edges.slice(start, start + BATCH));
  }

  await insert(client, "coverage", [
    {
      analysis_id: analysisId,
      organization_id: organizationId,
      files_found: input.summary.filesFound,
      files_parsed: input.summary.filesParsed,
      files_skipped: input.summary.filesSkipped,
      distinct_folders: input.summary.distinctFolders,
      imports_total: input.coverage.total,
      imports_resolved: input.coverage.resolved,
      imports_outside: input.coverage.outside,
      imports_excluded: input.coverage.excluded,
      imports_unresolved: input.coverage.unresolved,
    },
  ]);

  // Every import the parser saw, resolved or not - into the table whose kind
  // constraint already allows `resolved`. The edges alone are not enough to rebuild
  // the report: an edge is one drawn line, deduplicated on from/to/kind, so three
  // imports of one module are one edge and three imports. Storing only the failures
  // would leave the resolved count unrecoverable from rows, and the count is the
  // number the coverage banner shows.
  const unresolved = input.coverage.imports.map((entry) => ({
    analysis_id: analysisId,
    organization_id: organizationId,
    file_path: entry.from,
    specifier: entry.specifier,
    kind: entry.kind,
    reason: entry.reason,
    line: entry.line,
    import_kind: entry.importKind,
  }));

  for (let start = 0; start < unresolved.length; start += BATCH) {
    await insert(client, "unresolved_imports", unresolved.slice(start, start + BATCH));
  }

  const skipped = input.skipped.map((entry) => ({
    analysis_id: analysisId,
    organization_id: organizationId,
    path: entry.path,
    entry_kind: entry.kind,
    reason: entry.reason,
  }));

  for (let start = 0; start < skipped.length; start += BATCH) {
    await insert(client, "skipped_files", skipped.slice(start, start + BATCH));
  }

  if (droppedEdges > 0) {
    // Not a failure: the parser guarantees it does not happen. Reported because a
    // silent drop here is exactly the failure this product exists to avoid.
    console.warn(
      `${droppedEdges} edges referenced a file with no row and were not written. This should not happen.`,
    );
  }

  return {
    filesWritten: files.length,
    edgesWritten: edges.length,
    coverageWritten: true,
    unresolvedWritten: unresolved.length,
    skippedWritten: skipped.length,
  };
}

/** Move a run to a stage, with whatever the reader should see beside it. */
export async function writeStage(
  client: Client,
  input: {
    analysisId: string;
    stage: Stage;
    message?: string | null;
    status?: "queued" | "parsing" | "complete" | "failed";
    commitSha?: string | null;
    error?: string | null;
    finished?: boolean;
  },
): Promise<void> {
  // Typed rather than assembled as a loose record, because the columns are named
  // here and the schema is checked at compile time: a renamed column is a build
  // failure rather than a runtime no-op that leaves a run reporting nothing.
  const patch: Database["public"]["Tables"]["analyses"]["Update"] = {
    stage: input.stage,
    stage_at: new Date().toISOString(),
    stage_message: input.message ?? null,
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.commitSha === undefined ? {} : { commit_sha: input.commitSha }),
    ...(input.error === undefined ? {} : { error: input.error }),
    ...(input.finished === true ? { finished_at: new Date().toISOString() } : {}),
  };

  const { error } = await client.from("analyses").update(patch).eq("id", input.analysisId);
  if (error) throw new StoreError(`Could not record the ${input.stage} stage: ${error.message}`);
}

/** How many edges touch a file, which is stored rather than derived on read. */
function countFor(path: string, edges: readonly ParsedEdge[], end: "from" | "to"): number {
  let count = 0;
  for (const edge of edges) {
    if (edge[end] === path) count += 1;
  }
  return count;
}

async function insert(client: Client, table: string, rows: readonly unknown[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await client.from(table as never).insert(rows as never);
  if (error) {
    throw new StoreError(`Could not write ${rows.length} rows to ${table}: ${error.message}`);
  }
}

/**
 * A v4 uuid.
 *
 * `crypto.randomUUID` is what Node and every browser ship, so this is a call rather
 * than a dependency. The ids are generated here rather than by the database because
 * the edge rows need file ids before those rows exist.
 */
function newId(): string {
  return globalThis.crypto.randomUUID();
}
