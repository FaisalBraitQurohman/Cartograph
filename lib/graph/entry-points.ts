import type { ParsedFile, RepositoryParseResult } from "@/parser/types.mts";

/**
 * Which files nothing imports because something other than an import reaches them.
 *
 * The parser resolves imports and nothing else. A page, a route, a layout,
 * middleware and a config file are reached by a framework reading the filesystem
 * or a manifest, and no import statement in the repository will ever point at
 * them. So "nothing imports this" is a fact about the import graph, not about
 * whether the file is used, and reporting those files as unused would be the
 * parser describing the limits of its own view as a finding about the code.
 *
 * This is a stated convention, not framework knowledge. It does not ask what
 * framework a repository uses and it does not import anything, so nothing here
 * leaks into the parser. What it cannot recognise it reports, which is why the
 * count of files it set aside is shown rather than the files themselves: a
 * convention that quietly matched everything would be indistinguishable from one
 * that matched nothing.
 */

export interface EntryPointRule {
  id: string;
  label: string;
  /** What the rule matches, in plain words, for the panel and for review. */
  reason: string;
  matches: (file: ParsedFile) => boolean;
}

/** `vite.config.ts`, `vitest.config.ts`, `uno.config.ts`. */
const CONFIG_FILE = /\.(config|conf)\.[cm]?[jt]sx?$/u;

/** A test or a fixture. Reached by a test runner, which resolves no imports. */
const TEST_FILE = /\.(test|spec|fixture)\.[cm]?[jt]sx?$/u;

/** A declaration file. Read by the compiler, not imported. */
const DECLARATION_FILE = /\.d\.[cm]?ts$/u;

/**
 * A filename that a bundler, a browser or a manifest looks for by name.
 *
 * `main`, `index`, `setup` and `client` are the names the ecosystem actually
 * resolves: an HTML `<script src>`, a `package.json` `main`, a test runner's
 * setup file, a browser extension's background script. A file with any other name
 * is not matched, because guessing more shapes would start matching files that
 * really are reached only through an import.
 */
const ENTRY_NAMES: ReadonlySet<string> = new Set([
  "main",
  "index",
  "setup",
  "client",
  "server",
  "entry",
  "app",
]);

/** Path segments a framework looks for by position rather than by name. */
const ENTRY_FOLDERS: ReadonlySet<string> = new Set([
  "pages",
  "routes",
  "layouts",
  "middleware",
  "api",
]);

/**
 * Filename shapes a framework treats as a route, a page or a boundary.
 *
 * `page.tsx`, `route.ts`, `layout.tsx` and `middleware.ts` are the Next.js and
 * Remix conventions by name; `*.page.ts` and `*.route.ts` are the same idea with
 * a prefix. Matching them by name is what makes this work on a repository whose
 * framework was never identified.
 */
const ENTRY_SUFFIXES: readonly string[] = [
  "page",
  "layout",
  "route",
  "middleware",
  "loader",
  "action",
];

export const ENTRY_POINT_RULES: readonly EntryPointRule[] = [
  {
    id: "config",
    label: "config",
    reason: "Read by a build tool by filename. Nothing imports a config file.",
    matches: (file) => CONFIG_FILE.test(basenameOf(file.path)),
  },
  {
    id: "dot-directory",
    label: "dot-directory config",
    reason:
      "Inside a directory whose name begins with a dot, which by convention holds a tool's own configuration rather than the project's code.",
    // A separate rule from `config`, not a wider regex, because the two are
    // different claims. `vite.config.ts` is a config file the parser recognises by
    // filename. `docs/.vitepress/config.ts` is only recognisable because of where it
    // sits, and merging the two would have made a filename match look like it
    // covered a case it does not.
    matches: (file) =>
      /(^|\/)\.[^/]+\//u.test(file.path) && /(^|\/)(config|index)\.[cm]?[jt]sx?$/u.test(file.path),
  },
  {
    id: "test",
    label: "test",
    reason: "Discovered and run by a test runner, which resolves no imports.",
    matches: (file) => TEST_FILE.test(basenameOf(file.path)),
  },
  {
    id: "declaration",
    label: "declaration",
    reason: "Read by the compiler for types. Never imported at runtime.",
    matches: (file) => DECLARATION_FILE.test(basenameOf(file.path)),
  },
  {
    id: "entry-name",
    label: "entry by name",
    reason:
      "Resolved by name: a package's `main`, an HTML script tag, a browser extension manifest, a test runner's setup file.",
    // No depth limit, which looked like it needed one. A barrel file called
    // `index.ts` deep in a package is an ordinary module that plenty of files
    // import, and it reads as an entry point here — but it never reaches the
    // findings, because the only question asked about an entry point is whether
    // anything imports it, and something does. Restricting the match by depth
    // therefore bought nothing and lost a real one: `packages/chrome/app/panel/main.ts`
    // is an extension panel referenced by an HTML file, and it sits four folders
    // down.
    matches: (file) => ENTRY_NAMES.has(basenameOf(file.path).replace(/\.[^.]+$/u, "")),
  },
  {
    id: "entry-folder",
    label: "entry by folder",
    reason: "A folder a framework scans by position rather than by import.",
    matches: (file) =>
      file.folder
        .split("/")
        .some((segment) => ENTRY_FOLDERS.has(segment)),
  },
  {
    id: "entry-suffix",
    label: "entry by name shape",
    reason: "A page, route, layout or middleware by filename convention.",
    matches: (file) => {
      const base = basenameOf(file.path).replace(/\.[^.]+$/u, "");
      const stripped = base.replace(/\./gu, ".");
      return ENTRY_SUFFIXES.some((suffix) => stripped === suffix || stripped.endsWith(`.${suffix}`));
    },
  },
];

export interface EntryPointVerdict {
  /** The file is reached by something other than an import, and by which rule. */
  rule: EntryPointRule;
}

/**
 * The rule that reaches this file, or null if the conventions do not recognise it.
 *
 * Null is the honest answer for most files, and it is the common case by far: on
 * the checked-in repository 86 of 215 files match and 129 do not. A file that is
 * not recognised here is still reported when nothing imports it — the conventions
 * narrow the field, they do not decide it.
 */
export function entryPointRuleFor(file: ParsedFile): EntryPointRule | null {
  for (const rule of ENTRY_POINT_RULES) {
    if (rule.matches(file)) return rule;
  }
  return null;
}

/** Files nothing imports, split by whether a convention reaches them. */
export function partitionByEntryPoint(
  files: readonly ParsedFile[],
): { reached: { file: ParsedFile; rule: EntryPointRule }[]; unmatched: ParsedFile[] } {
  const reached: { file: ParsedFile; rule: EntryPointRule }[] = [];
  const unmatched: ParsedFile[] = [];

  for (const file of files) {
    const rule = entryPointRuleFor(file);
    if (rule) reached.push({ file, rule });
    else unmatched.push(file);
  }

  return { reached, unmatched };
}

/**
 * How many files each rule set aside, for the panel. Never the files themselves.
 *
 * Only files nothing imports. An entry point is a thing reached by something other
 * than an import, and a file that a rule matches but that something *does* import is
 * an ordinary module — the rules narrow the field, they do not decide it. Counting
 * it here would report `index.ts` barrels as entry points, which is the case the
 * rule comment above already says must not happen.
 */
export function entryPointCounts(parse: RepositoryParseResult): Map<string, number> {
  const imported = new Set(parse.edges.map((edge) => edge.to));
  const counts = new Map<string, number>();
  for (const file of parse.files) {
    if (imported.has(file.path)) continue;
    const rule = entryPointRuleFor(file);
    if (!rule) continue;
    counts.set(rule.id, (counts.get(rule.id) ?? 0) + 1);
  }
  return counts;
}

function basenameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}
