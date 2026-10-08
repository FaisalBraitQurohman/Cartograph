#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { parseRepository } from "../parser/parse-repository.mts";
import { validateRepositoryParseResult } from "../parser/validate-result.mts";

const args = process.argv.slice(2);
const repositoryPath = args[0];
const outputFlagIndex = args.indexOf("--out");
const outputPath = outputFlagIndex >= 0 ? args[outputFlagIndex + 1] : undefined;

if (!repositoryPath || (outputFlagIndex >= 0 && !outputPath)) {
  console.error("Usage: pnpm parse:repo <directory> [--out <result.json>]");
  process.exitCode = 2;
} else {
  try {
    const result = parseRepository(repositoryPath);
    if (outputPath) {
      const serialized = `${JSON.stringify(result, null, 2)}\n`;
      writeFileSync(outputPath, serialized, "utf8");
      const roundTripped = JSON.parse(readFileSync(outputPath, "utf8"));
      if (!validateRepositoryParseResult(roundTripped)) {
        throw new Error("The written parser result does not satisfy its typed data contract.");
      }
    }

    console.log(`Repository: ${result.repositoryPath}`);
    console.log(
      `Files: ${result.summary.filesFound} found, ${result.summary.filesParsed} parsed, ${result.summary.filesSkipped} skipped`,
    );
    console.log(`Folders: ${result.summary.distinctFolders}`);
    console.log(`Edges: ${result.edges.length}`);
    console.log(
      `Coverage: ${result.coverage.total} imports (${result.coverage.resolved} resolved, ${result.coverage.outside} outside, ${result.coverage.excluded} excluded, ${result.coverage.unresolved} unresolved)`,
    );
    const reExports = result.coverage.byKind["re-export"];
    const reExportImports = result.coverage.imports.filter((entry) => entry.importKind === "re-export");
    console.log(`Re-exports: ${reExports.resolved} resolved / ${reExportImports.length} found`);
    for (const skipped of result.skipped) {
      console.log(`Skipped ${skipped.kind} ${skipped.path}: ${skipped.reason}`);
    }
    for (const example of result.coverage.examples.filter((entry) => entry.kind !== "resolved")) {
      console.log(
        `${example.kind}: ${example.from}:${example.line} -> ${example.specifier} (${example.reason})`,
      );
    }
    if (outputPath) console.log(`Wrote typed data: ${outputPath}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Parser failed: ${message}`);
    process.exitCode = 1;
  }
}