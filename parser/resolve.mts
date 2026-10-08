import { existsSync, statSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { ts, type SourceFile } from "ts-morph";
import type { CoverageKind } from "./types.mts";
import { isInsideRepository, toRelativePath } from "./discovery.mts";

const RESOLVABLE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs",
];

export interface Resolution {
  kind: CoverageKind;
  path?: string;
  reason: string;
}

export function resolveImport(
  rootPath: string,
  sourceFile: SourceFile,
  specifier: string,
  knownFiles: Set<string>,
  compilerOptions: Parameters<typeof ts.resolveModuleName>[2],
): Resolution {
  const sourcePath = sourceFile.getFilePath();
  const resolution = ts.resolveModuleName(
    specifier,
    sourcePath,
    compilerOptions,
    ts.sys,
  ).resolvedModule;

  if (resolution) {
    const resolvedPath = resolve(resolution.resolvedFileName);
    if (!isInsideRepository(rootPath, resolvedPath)) {
      return {
        kind: "outside",
        reason: `resolved outside the repository to ${resolution.resolvedFileName}`,
      };
    }

    const relativePath = toRelativePath(rootPath, resolvedPath);
    if (knownFiles.has(relativePath)) {
      return {
        kind: "resolved",
        path: relativePath,
        reason: `resolved to ${relativePath}`,
      };
    }

    return {
      kind: "excluded",
      reason: `resolved to ${relativePath}, which is not a selected source file`,
    };
  }

  if (!isRelativeSpecifier(specifier) && !matchesConfiguredPathAlias(specifier, compilerOptions)) {
    return {
      kind: "outside",
      reason: "bare module specifier is outside the repository source graph",
    };
  }

  const isRelative = isRelativeSpecifier(specifier);
  const candidateBase = isRelative ? resolve(dirname(sourcePath), specifier) : undefined;
  if (
    candidateBase &&
    extname(candidateBase) &&
    existsSync(candidateBase) &&
    isInsideRepository(rootPath, candidateBase)
  ) {
    return {
      kind: "excluded",
      reason: `resolved to ${toRelativePath(rootPath, candidateBase)}, whose file type is deliberately excluded`,
    };
  }

  const candidates = candidateBase ? extensionCandidates(candidateBase) : [];
  const unsupportedCandidate = candidateBase
    ? candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile())
    : undefined;
  if (unsupportedCandidate && isInsideRepository(rootPath, unsupportedCandidate)) {
    return {
      kind: "excluded",
      reason: `resolved to ${toRelativePath(rootPath, unsupportedCandidate)}, whose file type is deliberately excluded`,
    };
  }

  return {
    kind: "unresolved",
    reason: candidateBase
      ? `TypeScript module resolution found no source file for ${specifier}; tried ${candidates.map((candidate) => toRelativePath(rootPath, candidate)).join(", ")}`
      : `TypeScript module resolution found no source file for bare specifier ${specifier}; it was not assumed to be external`,
  };
}

function matchesConfiguredPathAlias(
  specifier: string,
  compilerOptions: Parameters<typeof ts.resolveModuleName>[2],
): boolean {
  const paths = compilerOptions.paths;
  if (!paths) return false;

  return Object.keys(paths).some((pattern) => {
    const wildcardPosition = pattern.indexOf("*");
    if (wildcardPosition === -1) return pattern === specifier;

    const prefix = pattern.slice(0, wildcardPosition);
    const suffix = pattern.slice(wildcardPosition + 1);
    return specifier.startsWith(prefix) && specifier.endsWith(suffix);
  });
}

function extensionCandidates(basePath: string): string[] {
  const extension = extname(basePath);
  const fileCandidates = extension
    ? [basePath]
    : RESOLVABLE_EXTENSIONS.map((candidateExtension) => `${basePath}${candidateExtension}`);
  const indexCandidates = RESOLVABLE_EXTENSIONS.map((candidateExtension) =>
    resolve(basePath, `index${candidateExtension}`),
  );

  return [...fileCandidates, ...indexCandidates];
}

function isRelativeSpecifier(specifier: string): boolean {
  return specifier === "." || specifier === ".." || specifier.startsWith("./") || specifier.startsWith("../");
}