export const PARSER_VERSION = "phase-03" as const;

export type SourceLanguage = "typescript" | "javascript";

export type CoverageKind = "resolved" | "outside" | "excluded" | "unresolved";

export type ImportKind = "import" | "re-export" | "dynamic";

export interface ParsedFile {
  path: string;
  folder: string;
  module: string;
  language: SourceLanguage;
  lines: number;
  sha256: string;
  isExternalModule: boolean;
  isEntryPoint: boolean;
}

export interface ParsedEdge {
  from: string;
  to: string;
  kind: ImportKind;
  specifier: string;
  line: number;
}

export interface CoverageExample {
  from: string;
  specifier: string;
  kind: CoverageKind;
  reason: string;
  line: number;
  importKind: ImportKind;
}

export interface CoverageSummary {
  total: number;
  resolved: number;
  outside: number;
  excluded: number;
  unresolved: number;
  byKind: Record<ImportKind, Record<CoverageKind, number>>;
  imports: CoverageExample[];
  examples: CoverageExample[];
}

export interface ParseSummary {
  filesFound: number;
  filesParsed: number;
  filesSkipped: number;
  distinctFolders: number;
}

export interface RepositoryParseResult {
  parserVersion: typeof PARSER_VERSION;
  repositoryPath: string;
  generatedAt: string;
  summary: ParseSummary;
  files: ParsedFile[];
  edges: ParsedEdge[];
  fanIn: Record<string, number>;
  fanOut: Record<string, number>;
  coverage: CoverageSummary;
  skipped: SkippedFile[];
}

export interface SkippedFile {
  path: string;
  kind: "file" | "directory";
  reason: string;
}