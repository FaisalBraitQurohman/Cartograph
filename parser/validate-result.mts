import {
  PARSER_VERSION,
  type CoverageExample,
  type RepositoryParseResult,
} from "./types.mts";

const COVERAGE_KINDS = ["resolved", "outside", "excluded", "unresolved"] as const;
const IMPORT_KINDS = ["import", "re-export", "dynamic"] as const;
const SOURCE_LANGUAGES = ["typescript", "javascript"] as const;

/** Validate the serialized contract after writing it to disk. */
export function validateRepositoryParseResult(value: unknown): value is RepositoryParseResult {
  if (!isRecord(value) || value.parserVersion !== PARSER_VERSION) return false;
  if (
    typeof value.repositoryPath !== "string" ||
    typeof value.generatedAt !== "string" ||
    !isRecord(value.summary) ||
    !Array.isArray(value.files) ||
    !Array.isArray(value.edges)
  ) {
    return false;
  }
  if (!Array.isArray(value.skipped) || !isRecord(value.fanIn) || !isRecord(value.fanOut)) return false;
  if (!isRecord(value.coverage)) return false;
  const summary = value.summary;
  if (
    typeof summary.filesFound !== "number" ||
    typeof summary.filesParsed !== "number" ||
    typeof summary.filesSkipped !== "number" ||
    typeof summary.distinctFolders !== "number" ||
    !isNonNegativeInteger(summary.filesFound) ||
    !isNonNegativeInteger(summary.filesParsed) ||
    !isNonNegativeInteger(summary.filesSkipped) ||
    !isNonNegativeInteger(summary.distinctFolders) ||
    summary.filesFound !== summary.filesParsed + summary.filesSkipped
  ) {
    return false;
  }

  const paths = new Set<string>();
  for (const file of value.files) {
    if (!isRecord(file)) return false;
    if (
      typeof file.path !== "string" ||
      typeof file.folder !== "string" ||
      typeof file.module !== "string" ||
      !isOneOf(SOURCE_LANGUAGES, file.language) ||
      !isNonNegativeInteger(file.lines) ||
      typeof file.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(file.sha256) ||
      typeof file.isExternalModule !== "boolean" ||
      typeof file.isEntryPoint !== "boolean"
    ) {
      return false;
    }
    const expectedFolder = file.path.includes("/")
      ? file.path.slice(0, file.path.lastIndexOf("/"))
      : ".";
    if (file.module !== file.path || file.folder !== expectedFolder) return false;
    paths.add(file.path);
  }

  const folders = new Set<string>();
  for (const file of value.files) {
    if (isRecord(file) && typeof file.folder === "string") folders.add(file.folder);
  }
  if (
    paths.size !== value.files.length ||
    paths.size !== summary.filesParsed ||
    folders.size !== summary.distinctFolders
  ) {
    return false;
  }

  const calculatedFanIn = Object.fromEntries([...paths].map((path) => [path, 0]));
  const calculatedFanOut = Object.fromEntries([...paths].map((path) => [path, 0]));
  for (const edge of value.edges) {
    if (!isRecord(edge)) return false;
    if (
      typeof edge.from !== "string" ||
      typeof edge.to !== "string" ||
      !isOneOf(["import", "re-export", "dynamic"] as const, edge.kind) ||
      typeof edge.specifier !== "string" ||
      !isNonNegativeInteger(edge.line) ||
      !paths.has(edge.from) ||
      !paths.has(edge.to)
    ) {
      return false;
    }
    calculatedFanOut[edge.from] += 1;
    calculatedFanIn[edge.to] += 1;
  }

  if (!sameCounts(value.fanIn, calculatedFanIn) || !sameCounts(value.fanOut, calculatedFanOut)) return false;

  let skippedFileCount = 0;
  for (const skipped of value.skipped) {
    if (
      !isRecord(skipped) ||
      typeof skipped.path !== "string" ||
      (skipped.kind !== "file" && skipped.kind !== "directory") ||
      typeof skipped.reason !== "string"
    ) {
      return false;
    }
    if (skipped.kind === "file") skippedFileCount += 1;
  }
  if (skippedFileCount !== summary.filesSkipped) return false;

  const coverage = value.coverage;
  if (
    isNonNegativeInteger(coverage.total) &&
    isNonNegativeInteger(coverage.resolved) &&
    isNonNegativeInteger(coverage.outside) &&
    isNonNegativeInteger(coverage.excluded) &&
    isNonNegativeInteger(coverage.unresolved) &&
    isRecord(coverage.byKind) &&
    Array.isArray(coverage.imports) &&
    Array.isArray(coverage.examples)
  ) {
    const totalCoverage = coverage.resolved + coverage.outside + coverage.excluded + coverage.unresolved;
    if (totalCoverage !== coverage.total || coverage.imports.length !== coverage.total) return false;

    for (const importKind of IMPORT_KINDS) {
      const kindCounts = coverage.byKind[importKind];
      if (!isRecord(kindCounts)) return false;
      for (const coverageKind of COVERAGE_KINDS) {
        if (!isNonNegativeInteger(kindCounts[coverageKind])) return false;
      }
      const countForKind = COVERAGE_KINDS.reduce(
        (count, coverageKind) => count + (kindCounts[coverageKind] as number),
        0,
      );
      if (countForKind !== coverage.imports.filter((entry) => isCoverageExample(entry) && entry.importKind === importKind).length) {
        return false;
      }
    }

    return coverage.imports.every(isCoverageExample) && coverage.examples.every(isCoverageExample);
  }

  return false;
}

function isCoverageExample(value: unknown): value is CoverageExample {
  return (
    isRecord(value) &&
    typeof value.from === "string" &&
    typeof value.specifier === "string" &&
    isOneOf(COVERAGE_KINDS, value.kind) &&
    typeof value.reason === "string" &&
    isNonNegativeInteger(value.line) &&
    isOneOf(IMPORT_KINDS, value.importKind)
  );
}

function isOneOf<const Values extends readonly string[]>(values: Values, value: unknown): value is Values[number] {
  return typeof value === "string" && values.some((candidate) => candidate === value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function sameCounts(actual: Record<string, unknown>, expected: Record<string, number>): boolean {
  const actualEntries = Object.entries(actual);
  return (
    actualEntries.length === Object.keys(expected).length &&
    Object.entries(expected).every(([key, count]) => actual[key] === count)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}