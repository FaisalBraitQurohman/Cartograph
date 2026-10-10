#!/usr/bin/env node
/**
 * Run the pipeline against the real database, and read back what it wrote.
 *
 * Everything else about the pipeline is checked without a database: the tar reader
 * against GNU tar, the store against a client that records inserts. This is the one
 * run that touches Postgres, and it exists because the join between the parser and
 * the schema is only really tested when the two are the same transaction.
 *
 * The read-back at the end is the point. `runAnalysis` reports how many rows it
 * wrote, and a store that silently wrote half of them would report the number it
 * intended. Counting the rows back is the only check that would notice.
 *
 * `--org` is required rather than defaulted. This client bypasses row-level
 * security, so the organization is trusted input, and a script that guessed one
 * would quietly write into a team nobody named. Nothing here takes a token, because
 * a terminal has no user to have one.
 *
 * Usage: pnpm map:run <owner/repo> --org <org_...>
 */
import { createServiceSupabaseClient } from "../lib/supabase/service.mts";
import { runAnalysis } from "../lib/pipeline/pipeline.mts";

const [slug, ...rest] = process.argv.slice(2);
const orgFlag = rest.indexOf("--org");
const organizationId = orgFlag >= 0 ? rest[orgFlag + 1] : undefined;

if (!slug || !organizationId) {
  console.error("Usage: pnpm map:run <owner/repo> --org <org_...>");
  console.error("  --org is required: this client bypasses row-level security.");
  process.exit(2);
}

const client = createServiceSupabaseClient();

const result = await runAnalysis(
  client,
  { organizationId, url: slug },
  {
    onStage: (stage, message) => console.log(`  ${stage.padEnd(9)} ${message}`),
  },
);

console.log("");
console.log(`Analysis  ${result.analysisId}`);
console.log(`Status    ${result.status}${result.existing ? "  (already existed, nothing re-run)" : ""}`);
console.log(`Failed in ${result.stage}`);
if (result.error) console.log(`Error     ${result.error}`);

// Read every table back rather than trust the counts the run reported.
const analysisId = result.analysisId;
const count = async (table, column = "analysis_id") => {
  const { count, error } = await client.from(table).select("*", { count: "exact", head: true }).eq(column, analysisId);
  if (error) throw new Error(`Could not count ${table}: ${error.message}`);
  return count;
};

const { data: analysis } = await client
  .from("analyses")
  .select("status, stage, stage_message, commit_sha, error")
  .eq("id", analysisId)
  .single();

console.log("");
console.log("Read back from the database:");
console.log(`  status         ${analysis.status} / ${analysis.stage} - ${analysis.stage_message}`);
console.log(`  parser version ${analysis.commit_sha ?? "-"}`);
console.log(`  files          ${await count("files")}`);
console.log(`  edges          ${await count("edges")}`);
console.log(`  unresolved     ${await count("unresolved_imports")}`);
console.log(`  skipped        ${await count("skipped_files")}`);

const { data: coverage, error: coverageError } = await client
  .from("coverage")
  .select("*")
  .eq("analysis_id", analysisId)
  .maybeSingle();
if (coverageError) throw new Error(`Could not read coverage: ${coverageError.message}`);
if (coverage) {
  console.log(
    `  coverage       ${coverage.files_parsed}/${coverage.files_found} files, ` +
      `${coverage.imports_resolved}/${coverage.imports_total} imports resolved ` +
      `(${(coverage.resolved_fraction * 100).toFixed(1)}%)`,
  );
} else if (result.status === "complete") {
  // Only a problem when the run said it wrote one. A run that failed before storing
  // is supposed to leave no coverage row, and saying so would be alarming about
  // nothing.
  console.log("  coverage       MISSING - the run reported writing one");
}

if (result.status !== "complete") process.exitCode = 1;