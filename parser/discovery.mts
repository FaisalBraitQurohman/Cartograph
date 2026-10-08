import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, extname, relative, resolve, sep } from "node:path";
import type { ParsedFile, SkippedFile, SourceLanguage } from "./types.mts";

const SOURCE_EXTENSIONS = new Map<string, SourceLanguage>([
  [".ts", "typescript"],
  [".tsx", "typescript"],
  [".js", "javascript"],
  [".jsx", "javascript"],
  [".mts", "typescript"],
  [".cts", "typescript"],
  [".mjs", "javascript"],
  [".cjs", "javascript"],
]);

const EXCLUDED_DIRECTORIES = new Map<string, string>([
  [".agents", "agent tooling directory excluded by policy"],
  [".aider-desk", "agent tooling directory excluded by policy"],
  [".claude", "agent tooling directory excluded by policy"],
  [".git", "version-control internals excluded by policy"],
  [".next", "generated build directory excluded by policy"],
  [".turbo", "generated build directory excluded by policy"],
  [".tmp-mcp", "temporary tooling directory excluded by policy"],
  [".vercel", "deployment metadata directory excluded by policy"],
  ["coverage", "generated coverage directory excluded by policy"],
  ["dist", "generated build directory excluded by policy"],
  ["node_modules", "dependency directory excluded by policy"],
  ["out", "generated build directory excluded by policy"],
  ["build", "generated build directory excluded by policy"],
]);

export interface DiscoveryResult {
  rootPath: string;
  files: ParsedFile[];
  skipped: SkippedFile[];
}

export function discoverRepository(rootPath: string): DiscoveryResult {
  const absoluteRoot = resolve(rootPath);
  const found: string[] = [];
  const skipped: SkippedFile[] = [];
  walk(absoluteRoot, absoluteRoot, found, skipped);

  const files = found
    .sort((left, right) => left.localeCompare(right))
    .map((absolutePath) => toParsedFile(absoluteRoot, absolutePath));

  return { rootPath: absoluteRoot, files, skipped };
}

function walk(
  rootPath: string,
  directoryPath: string,
  found: string[],
  skipped: SkippedFile[],
): void {
  for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
    const entryPath = resolve(directoryPath, entry.name);

    if (entry.isDirectory()) {
      const exclusionReason = EXCLUDED_DIRECTORIES.get(entry.name);
      if (exclusionReason) {
        skipped.push({
          path: toRelativePath(rootPath, entryPath),
          kind: "directory",
          reason: exclusionReason,
        });
        continue;
      }
      walk(rootPath, entryPath, found, skipped);
      continue;
    }

    if (!entry.isFile()) {
      skipped.push({
        path: toRelativePath(rootPath, entryPath),
        kind: "file",
        reason: "not a regular file; symbolic links are not followed",
      });
      continue;
    }

    if (SOURCE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      found.push(entryPath);
    } else {
      skipped.push({
        path: toRelativePath(rootPath, entryPath),
        kind: "file",
        reason: "unsupported file type; only TypeScript and JavaScript source is parsed",
      });
    }
  }
}

function toParsedFile(rootPath: string, absolutePath: string): ParsedFile {
  const path = toRelativePath(rootPath, absolutePath);
  const source = readFileSync(absolutePath);
  const text = source.toString("utf8");
  const folderPath = dirname(path);
  const language = SOURCE_EXTENSIONS.get(extname(path).toLowerCase());

  if (!language) {
    throw new Error(`Unsupported source extension after discovery: ${path}`);
  }

  return {
    path,
    folder: folderPath === "." ? "." : folderPath,
    module: path,
    language,
    lines: countLines(text),
    sha256: createHash("sha256").update(source).digest("hex"),
    isExternalModule: false,
    isEntryPoint: false,
  };
}

function countLines(text: string): number {
  if (text.length === 0) return 0;
  const lineCount = text.split(/\r?\n/u).length;
  return /(?:\r\n|\n)$/u.test(text) ? lineCount - 1 : lineCount;
}

export function toRelativePath(rootPath: string, absolutePath: string): string {
  return relative(rootPath, absolutePath).split(sep).join("/");
}

export function isInsideRepository(rootPath: string, absolutePath: string): boolean {
  const relativePath = relative(rootPath, absolutePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !relativePath.includes(`..${sep}`));
}
