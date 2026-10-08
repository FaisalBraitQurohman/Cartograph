import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  Node,
  Project,
  SourceFile,
  SyntaxKind,
  ts,
} from "ts-morph";
import { discoverRepository, toRelativePath } from "./discovery.mts";
import { fallbackAdapter, type ParserAdapter } from "./adapters.mts";
import { resolveImport } from "./resolve.mts";
import {
  PARSER_VERSION,
  type CoverageExample,
  type CoverageKind,
  type CoverageSummary,
  type ImportKind,
  type ParsedEdge,
  type RepositoryParseResult,
} from "./types.mts";

export interface ParseOptions {
  adapter?: ParserAdapter;
}

export function parseRepository(
  repositoryPath: string,
  options: ParseOptions = {},
): RepositoryParseResult {
  const discovery = discoverRepository(repositoryPath);
  const adapter = options.adapter ?? fallbackAdapter;
  const tsConfigPath = join(discovery.rootPath, "tsconfig.json");
  const project = new Project({
    ...(existsSync(tsConfigPath)
      ? { tsConfigFilePath: tsConfigPath, skipAddingFilesFromTsConfig: true }
      : {}),
    compilerOptions: {
      allowJs: true,
      allowNonTsExtensions: true,
      noEmit: true,
    },
  });

  const sourceFiles = discovery.files.map((file) =>
    project.addSourceFileAtPath(resolve(discovery.rootPath, file.path)),
  );
  const syntacticErrors = new Map<string, string>();
  for (const sourceFile of sourceFiles) {
    const diagnostics = project
      .getLanguageService()
      .compilerObject.getSyntacticDiagnostics(sourceFile.getFilePath());
    if (diagnostics.length > 0) {
      syntacticErrors.set(
        toRelativePath(discovery.rootPath, sourceFile.getFilePath()),
        ts.flattenDiagnosticMessageText(diagnostics[0].messageText, " "),
      );
    }
  }

  const parsedFiles = discovery.files
    .filter((file) => !syntacticErrors.has(file.path))
    .map((file) => ({ ...file }));
  const parsedFileByPath = new Map(parsedFiles.map((file) => [file.path, file]));
  const knownFiles = new Set(parsedFiles.map((file) => file.path));
  const skipped = [
    ...discovery.skipped,
    ...[...syntacticErrors.entries()].map(([path, reason]) => ({
      path,
      kind: "file" as const,
      reason: `TypeScript syntax could not be parsed: ${reason}`,
    })),
  ].sort((left, right) => left.path.localeCompare(right.path));
  const skippedFileCount = skipped.filter((entry) => entry.kind === "file").length;
  const edges = new Map<string, ParsedEdge>();
  const coverage = createCoverage();

  for (const sourceFile of sourceFiles) {
    const relativePath = toRelativePath(discovery.rootPath, sourceFile.getFilePath());
    const parsedFile = parsedFileByPath.get(relativePath);

    if (!parsedFile) {
      continue;
    }

    parsedFile.isExternalModule = ts.isExternalModule(sourceFile.compilerNode);
    parsedFile.isEntryPoint = adapter.isEntryPoint(sourceFile);

    parseStaticImports(sourceFile, relativePath, discovery.rootPath, knownFiles, project, edges, coverage);
    parseDynamicImports(sourceFile, relativePath, discovery.rootPath, knownFiles, project, edges, coverage);
  }

  const edgeList = [...edges.values()].sort(compareEdges);
  const fanIn = countEdges(parsedFiles.map((file) => file.path), edgeList, "to");
  const fanOut = countEdges(parsedFiles.map((file) => file.path), edgeList, "from");

  return {
    parserVersion: PARSER_VERSION,
    repositoryPath: discovery.rootPath,
    generatedAt: new Date().toISOString(),
    summary: {
      filesFound: parsedFiles.length + skippedFileCount,
      filesParsed: parsedFiles.length,
      filesSkipped: skippedFileCount,
      distinctFolders: new Set(parsedFiles.map((file) => file.folder)).size,
    },
    files: parsedFiles,
    edges: edgeList,
    fanIn,
    fanOut,
    coverage: finalizeCoverage(coverage),
    skipped,
  };
}

function parseStaticImports(
  sourceFile: SourceFile,
  from: string,
  rootPath: string,
  knownFiles: Set<string>,
  project: Project,
  edges: Map<string, ParsedEdge>,
  coverage: MutableCoverage,
): void {
  for (const declaration of sourceFile.getImportDeclarations()) {
    addStaticEdge(declaration, "import", from, rootPath, knownFiles, project, edges, coverage);
  }

  for (const declaration of sourceFile.getExportDeclarations()) {
    if (declaration.hasModuleSpecifier()) {
      addStaticEdge(declaration, "re-export", from, rootPath, knownFiles, project, edges, coverage);
    }
  }
}

function addStaticEdge(
  declaration: ReturnType<SourceFile["getImportDeclarations"]>[number] | ReturnType<SourceFile["getExportDeclarations"]>[number],
  kind: "import" | "re-export",
  from: string,
  rootPath: string,
  knownFiles: Set<string>,
  project: Project,
  edges: Map<string, ParsedEdge>,
  coverage: MutableCoverage,
): void {
  const specifier = declaration.getModuleSpecifierValue();
  if (!specifier) {
    return;
  }

  recordResolution(declaration, kind, from, specifier, rootPath, knownFiles, project, edges, coverage);
}

function parseDynamicImports(
  sourceFile: SourceFile,
  from: string,
  rootPath: string,
  knownFiles: Set<string>,
  project: Project,
  edges: Map<string, ParsedEdge>,
  coverage: MutableCoverage,
): void {
  sourceFile.forEachDescendant((node) => {
    if (!Node.isCallExpression(node) || node.getExpression().getKind() !== SyntaxKind.ImportKeyword) {
      return;
    }

    const argument = node.getArguments()[0];
    const specifier = argument && getLiteralSpecifier(argument);
    if (!specifier) {
      recordCoverage(coverage, {
        from,
        specifier: argument?.getText() ?? "<missing>",
        kind: "unresolved",
        reason: "dynamic import is not a literal string",
        line: node.getStartLineNumber(),
        importKind: "dynamic",
      });
      return;
    }

    recordResolution(node, "dynamic", from, specifier, rootPath, knownFiles, project, edges, coverage);
  });
}

function getLiteralSpecifier(node: Node): string | undefined {
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return node.getLiteralValue();
  }
  return undefined;
}

function recordResolution(
  node: Node,
  importKind: ImportKind,
  from: string,
  specifier: string,
  rootPath: string,
  knownFiles: Set<string>,
  project: Project,
  edges: Map<string, ParsedEdge>,
  coverage: MutableCoverage,
): void {
  const resolution = resolveImport(
    rootPath,
    node.getSourceFile(),
    specifier,
    knownFiles,
    project.getCompilerOptions(),
  );
  const line = node.getStartLineNumber();
  recordCoverage(coverage, {
    from,
    specifier,
    kind: resolution.kind,
    reason: resolution.reason,
    line,
    importKind,
  });

  if (resolution.kind !== "resolved" || !resolution.path) {
    return;
  }

  const edge: ParsedEdge = {
    from,
    to: resolution.path,
    kind: importKind,
    specifier,
    line,
  };
  edges.set(`${from}\0${resolution.path}\0${importKind}`, edge);
}

interface MutableCoverage {
  total: number;
  counts: Record<CoverageKind, number>;
  byKind: Record<ImportKind, Record<CoverageKind, number>>;
  imports: CoverageExample[];
  examples: CoverageExample[];
}

function createCoverage(): MutableCoverage {
  return {
    total: 0,
    counts: { resolved: 0, outside: 0, excluded: 0, unresolved: 0 },
    byKind: {
      import: { resolved: 0, outside: 0, excluded: 0, unresolved: 0 },
      "re-export": { resolved: 0, outside: 0, excluded: 0, unresolved: 0 },
      dynamic: { resolved: 0, outside: 0, excluded: 0, unresolved: 0 },
    },
    imports: [],
    examples: [],
  };
}

function recordCoverage(coverage: MutableCoverage, example: CoverageExample): void {
  coverage.total += 1;
  coverage.counts[example.kind] += 1;
  coverage.byKind[example.importKind][example.kind] += 1;
  coverage.imports.push(example);
  if (example.kind !== "resolved") {
    coverage.examples.push(example);
  }
}

function finalizeCoverage(coverage: MutableCoverage): CoverageSummary {
  return {
    total: coverage.total,
    resolved: coverage.counts.resolved,
    outside: coverage.counts.outside,
    excluded: coverage.counts.excluded,
    unresolved: coverage.counts.unresolved,
    byKind: coverage.byKind,
    imports: coverage.imports.sort(compareCoverageExamples),
    examples: coverage.examples.sort(compareCoverageExamples),
  };
}

function countEdges(
  paths: string[],
  edges: ParsedEdge[],
  field: "from" | "to",
): Record<string, number> {
  const counts: Record<string, number> = Object.fromEntries(paths.map((path) => [path, 0]));
  for (const edge of edges) {
    counts[edge[field]] = (counts[edge[field]] ?? 0) + 1;
  }
  return counts;
}

function compareEdges(left: ParsedEdge, right: ParsedEdge): number {
  return `${left.from}\0${left.to}\0${left.kind}\0${left.specifier}`.localeCompare(
    `${right.from}\0${right.to}\0${right.kind}\0${right.specifier}`,
  );
}

function compareCoverageExamples(left: CoverageExample, right: CoverageExample): number {
  return `${left.from}\0${left.line}\0${left.specifier}`.localeCompare(
    `${right.from}\0${right.line}\0${right.specifier}`,
  );
}
