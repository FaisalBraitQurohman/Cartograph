import { createServerSupabaseClient } from "@/lib/supabase/server";
import { reconstructParse } from "@/lib/reconstruct-parse.mts";
import type { RepositoryParseResult } from "@/parser/types.mts";

/**
 * Read every row of a table for one analysis.
 *
 * PostgREST caps a response at a server-side row limit, and a capped read is the
 * worst kind of wrong here: the map draws fewer lines and reports nothing missing,
 * because the rows that never arrived are indistinguishable from rows that do not
 * exist. So this pages until a short page comes back. Ordered by a unique column so
 * a page boundary cannot repeat or skip a row.
 *
 * `id` is the stable key. It is unique on every table this reads.
 *
 * The parameter is the query builder before `.order()`, so the caller writes an
 * ordinary typed query and this only decides how many pages to ask for. Nothing here
 * casts: the row type comes from the builder the caller chose.
 */
async function readAll<Row>(
  query: PostgrestFilterBuilderLike<Row>,
  what: string,
): Promise<Row[]> {
  const PAGE = 1000;
  const rows: Row[] = [];

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Could not read ${what}: ${error.message}`);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

/** The last two steps of a PostgREST read, which is all `readAll` needs. */
interface PostgrestFilterBuilderLike<Row> {
  order: (
    column: string,
    options: { ascending: boolean },
  ) => {
    range: (
      from: number,
      to: number,
    ) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>;
  };
}

/**
 * A stored analysis, read back as the shape the map was built against.
 *
 * All queries, no arithmetic. The part that turns rows into a parse is
 * `reconstructParse`, which is a pure function over rows and is checked by
 * `map:roundtrip`; keeping it out of here is what makes it checkable at all.
 *
 * Every query is narrowed by `analysis_id` and none by organization. The policy
 * decides which analyses exist for this caller, and an analysis belonging to another
 * team is not returned rather than filtered afterwards.
 */
export async function loadAnalysisParse(analysisId: string): Promise<RepositoryParseResult> {
  const supabase = createServerSupabaseClient();

  const [analyses, coverage] = await Promise.all([
    supabase
      .from("analyses")
      .select("id, commit_sha, created_at, projects(name)")
      .eq("id", analysisId)
      .maybeSingle(),
    supabase.from("coverage").select("*").eq("analysis_id", analysisId).maybeSingle(),
  ]);

  // A failed query is never rendered as missing data. "No such analysis" and "the
  // query broke" are different problems and the second one must not look like the
  // first.
  if (analyses.error) {
    throw new Error(`Could not read the analysis: ${analyses.error.message}`);
  }
  // Coverage is a single row that a run which failed never wrote, so its absence is
  // a real answer rather than an error.
  if (coverage.error) throw new Error(`Could not read coverage: ${coverage.error.message}`);

  const analysis = analyses.data;
  if (!analysis) {
    // Nothing came back, which is either "no such analysis" or "not yours". Both are
    // the same answer here, on purpose.
    throw new Error("No analysis with that id is visible to this organization.");
  }

  const [files, edges, unresolved, skipped] = await Promise.all([
    readAll(
      supabase.from("files").select("*").eq("analysis_id", analysisId),
      "files",
    ),
    readAll(
      supabase
        .from("edges")
        .select("from_file_id, to_file_id, kind, specifier, line")
        .eq("analysis_id", analysisId),
      "edges",
    ),
    readAll(
      supabase
        .from("unresolved_imports")
        .select("file_path, specifier, kind, reason, line, import_kind")
        .eq("analysis_id", analysisId),
      "unresolved imports",
    ),
    readAll(
      supabase.from("skipped_files").select("path, entry_kind, reason").eq("analysis_id", analysisId),
      "skipped files",
    ),
  ]);

  return reconstructParse({
    analysis: { name: analysis.projects?.name ?? analysis.id, createdAt: analysis.created_at },
    files,
    edges,
    unresolved,
    skipped,
    coverage: coverage.data,
  });
}