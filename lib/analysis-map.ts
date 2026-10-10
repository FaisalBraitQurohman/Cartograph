import { createServerSupabaseClient } from "@/lib/supabase/server";
import { reconstructParse } from "@/lib/reconstruct-parse.mts";
import type { RepositoryParseResult } from "@/parser/types.mts";

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

  const [analyses, files, edges, unresolved, skipped, coverage] = await Promise.all([
    supabase
      .from("analyses")
      .select("id, commit_sha, created_at, projects(name)")
      .eq("id", analysisId)
      .maybeSingle(),
    supabase.from("files").select("*").eq("analysis_id", analysisId),
    supabase
      .from("edges")
      .select("from_file_id, to_file_id, kind, specifier, line")
      .eq("analysis_id", analysisId),
    supabase
      .from("unresolved_imports")
      .select("file_path, specifier, kind, reason, line, import_kind")
      .eq("analysis_id", analysisId),
    supabase.from("skipped_files").select("path, entry_kind, reason").eq("analysis_id", analysisId),
    supabase.from("coverage").select("*").eq("analysis_id", analysisId).maybeSingle(),
  ]);

  // A failed query is never rendered as missing data. "No such analysis" and "the
  // query broke" are different problems and the second one must not look like the
  // first.
  if (analyses.error) {
    throw new Error(`Could not read the analysis: ${analyses.error.message}`);
  }
  if (files.error) throw new Error(`Could not read files: ${files.error.message}`);
  if (edges.error) throw new Error(`Could not read edges: ${edges.error.message}`);
  if (unresolved.error) {
    throw new Error(`Could not read unresolved imports: ${unresolved.error.message}`);
  }
  if (skipped.error) throw new Error(`Could not read skipped files: ${skipped.error.message}`);
  // Coverage is a single row that a run which failed never wrote, so its absence is
  // a real answer rather than an error.
  if (coverage.error) throw new Error(`Could not read coverage: ${coverage.error.message}`);

  const analysis = analyses.data;
  if (!analysis) {
    // Nothing came back, which is either "no such analysis" or "not yours". Both are
    // the same answer here, on purpose.
    throw new Error("No analysis with that id is visible to this organization.");
  }

  return reconstructParse({
    analysis: { name: analysis.projects?.name ?? analysis.id, createdAt: analysis.created_at },
    files: files.data ?? [],
    edges: edges.data ?? [],
    unresolved: unresolved.data ?? [],
    skipped: skipped.data ?? [],
    coverage: coverage.data,
  });
}