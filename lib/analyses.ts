import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type AnalysisRow = Database["public"]["Tables"]["analyses"]["Row"];

/**
 * The project an analysis ran against, as embedded by the select below. One
 * project, because `analyses.project_id` is a single foreign key.
 */
type AnalysisWithProject = Pick<
  AnalysisRow,
  "id" | "status" | "commit_sha" | "created_at" | "finished_at" | "error"
> & {
  projects: Pick<
    Database["public"]["Tables"]["projects"]["Row"],
    "name" | "repo_url"
  > | null;
};

/**
 * Every analysis in the current organization.
 *
 * There is no organization argument, and that is deliberate. The query asks for
 * all analyses; the row-level-security policy narrows "all" to the organization
 * on the caller's token. Passing an id in here would move the decision into
 * application code, which is the thing the policy exists to make unnecessary —
 * and the thing that quietly stops being true the first time someone forgets.
 *
 * Columns are named rather than `*`: the table shows six of them, and the graph
 * payloads that will hang off an analysis are not wanted here.
 */
export async function listAnalyses(): Promise<AnalysisWithProject[]> {
  const supabase = createServerSupabaseClient();

  const { data, error } = await supabase
    .from("analyses")
    // One string literal, not concatenated: the types are inferred by parsing
    // this exact text, and a runtime-built string infers as an error.
    .select(
      "id, status, commit_sha, created_at, finished_at, error, projects(name, repo_url)",
    )
    .order("created_at", { ascending: false });

  // No rows is not an error — that is a team with no analyses. A thrown query
  // is a different thing, and must not be shown as an empty list, because that
  // would hide a broken policy behind a friendly empty state.
  if (error) {
    throw new Error(`Could not read analyses: ${error.message}`);
  }

  return data;
}

