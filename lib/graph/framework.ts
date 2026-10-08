import type { RepositoryParseResult } from "@/parser/types.mts";

/**
 * Which framework a repository is on, read off the packages its files really
 * imported.
 *
 * The parser has no opinion about frameworks — framework knowledge is an adapter
 * and the only adapter so far assumes none — so this works on the outside imports
 * it did record. Every import the parser could not resolve to a file inside the
 * repository is in `coverage.imports` with the specifier it was written as, so
 * the set of packages a repository depends on is already in the data and needs
 * nothing but counting.
 *
 * It is a lookup against a table of package names, not a guess from a file's
 * contents. A package not in the table contributes nothing, and a repository
 * whose packages are not in the table gets no framework named rather than the
 * nearest plausible one.
 */

interface FrameworkDefinition {
  id: string;
  label: string;
  /**
   * Packages that mean this framework and nothing else.
   *
   * Deliberately the framework's own runtime and nothing built around it:
   * `@vitejs/plugin-vue` proves the build tool is set up for Vue, not that the
   * application is Vue, and `vitepress` is a documentation site rather than the
   * framework the application is written in.
   */
  packages: readonly string[];
}

const FRAMEWORKS: readonly FrameworkDefinition[] = [
  { id: "next", label: "Next.js", packages: ["next"] },
  { id: "nuxt", label: "Nuxt", packages: ["nuxt"] },
  { id: "astro", label: "Astro", packages: ["astro"] },
  { id: "react", label: "React", packages: ["react", "react-dom"] },
  { id: "vue", label: "Vue", packages: ["vue"] },
  { id: "svelte", label: "Svelte", packages: ["svelte"] },
  { id: "solid", label: "Solid", packages: ["solid-js"] },
  { id: "angular", label: "Angular", packages: ["@angular/core"] },
];

export interface DetectedFramework {
  id: string;
  label: string;
  /** Files that imported this framework directly. */
  fileCount: number;
  /** The specifiers that named it, deduplicated. */
  specifiers: string[];
}

export function detectFrameworks(parse: RepositoryParseResult): DetectedFramework[] {
  const labelOf = new Map<string, FrameworkDefinition>();
  for (const framework of FRAMEWORKS) {
    for (const name of framework.packages) labelOf.set(name, framework);
  }

  const specifiersOf = new Map<string, Set<string>>();
  const filesOf = new Map<string, Set<string>>();

  for (const example of parse.coverage.imports) {
    if (example.kind !== "outside") continue;
    const framework = labelOf.get(packageNameOf(example.specifier));
    if (!framework) continue;

    const specifiers = specifiersOf.get(framework.id) ?? new Set<string>();
    specifiers.add(example.specifier);
    specifiersOf.set(framework.id, specifiers);

    const files = filesOf.get(framework.id) ?? new Set<string>();
    files.add(example.from);
    filesOf.set(framework.id, files);
  }

  return FRAMEWORKS.filter((framework) => filesOf.has(framework.id))
    .map((framework) => ({
      id: framework.id,
      label: framework.label,
      fileCount: filesOf.get(framework.id)?.size ?? 0,
      specifiers: [...(specifiersOf.get(framework.id) ?? [])].sort(compare),
    }))
    .sort((left, right) => right.fileCount - left.fileCount || compare(left.id, right.id));
}

/**
 * The package a specifier names: `vue-router` and `vue` are the same package,
 * `@vitejs/plugin-vue` is scoped and takes two segments, and everything after the
 * package name is a path inside it.
 */
export function packageNameOf(specifier: string): string {
  const segments = specifier.split("/");
  if (specifier.startsWith("@")) return segments.slice(0, 2).join("/");
  return segments[0] ?? specifier;
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
