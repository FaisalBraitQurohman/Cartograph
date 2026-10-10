/**
 * Turning what somebody pasted into a repository to fetch.
 *
 * The input is free text — people paste a browser URL, an `owner/repo` pair, a
 * clone URL with a trailing `.git`, a branch URL — and the pipeline needs one
 * canonical form. Everything downstream depends on that form being right, because
 * it is what the one-repository-per-organization constraint is keyed on: a
 * canonicalisation that produces two different strings for one repository produces
 * two projects and two disagreeing maps.
 *
 * Only the host is accepted that can be asked for a public archive. A URL is not
 * fetched, so this is not an SSRF surface; it decides which GitHub-compatible host
 * to ask, and refusing anything else is refusing to guess.
 */

export interface RepositoryRef {
  /** `owner/repo`, the canonical identity. */
  slug: string;
  owner: string;
  name: string;
  /**
   * The branch, tag or commit to fetch, or null for the default branch.
   *
   * Kept out of the slug deliberately. The same repository fetched at two commits is
   * one repository with two analyses, not two repositories.
   */
  ref: string | null;
}

export class InvalidRepositoryUrl extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRepositoryUrl";
  }
}

const HOSTS = new Set(["github.com", "www.github.com"]);

/**
 * `owner/repo`, a full URL, or a URL with a branch and `.git`.
 *
 * Rejects rather than repairing. A string that needs three fixes applied before it
 * means this function is guessing, and a guessed repository is a map of somebody
 * else's code presented as yours.
 */
export function parseRepositoryUrl(input: string): RepositoryRef {
  const trimmed = input.trim();
  if (trimmed === "") throw new InvalidRepositoryUrl("Enter a repository URL.");

  // `owner/repo` with no host at all. Positional groups rather than named ones,
  // because this file's TypeScript target predates them.
  const bare = /^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(trimmed);
  if (bare) {
    const [, owner, name] = bare;
    if (owner !== undefined && name !== undefined) {
      return { slug: `${owner}/${name}`, owner, name, ref: null };
    }
  }

  // `github.com/owner/repo` with no scheme, which people paste and the browser
  // accepts. Prefixed with a scheme and handed to the same path as a full URL, so
  // there is one implementation of what a github path means rather than two.
  const hostFirst = /^([\w.-]+)\/([\w.-]+)(?:\/.*)?$/.exec(trimmed);
  if (hostFirst && HOSTS.has((hostFirst[1] ?? "").toLowerCase())) {
    return parseRepositoryUrl(`https://${trimmed}`);
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new InvalidRepositoryUrl(
      `Could not read "${trimmed}" as a repository. Paste a github.com URL or an owner/repo pair.`,
    );
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new InvalidRepositoryUrl("Only http and https repository URLs are supported.");
  }
  if (!HOSTS.has(url.hostname.toLowerCase())) {
    throw new InvalidRepositoryUrl(
      `Only github.com repositories can be fetched. Got ${url.hostname}.`,
    );
  }

  const segments = url.pathname.split("/").filter(Boolean);
  const owner = segments[0];
  const rawName = segments[1];
  if (!owner || !rawName) {
    throw new InvalidRepositoryUrl(
      `A github.com URL needs an owner and a repository: github.com/${owner ?? "OWNER"}/REPO`,
    );
  }
  // `.git` is a clone suffix, not part of the repository's name.
  const name = rawName.endsWith(".git") ? rawName.slice(0, -".git".length) : rawName;

  // `/tree/<ref>/...` is a branch or commit; `/issues/4` is not a ref and is
  // ignored rather than read as one, because fetching `issues` as a branch would
  // fail with a message that names the wrong thing.
  const third = segments[2];
  const ref =
    third === "tree" && segments[3] ? decodeURIComponent(segments.slice(3).join("/")) : null;

  return { slug: `${owner}/${name}`, owner, name, ref };
}

/**
 * The archive URL for a repository.
 *
 * `codeload.github.com` serves the tarball for a public repository with no
 * authentication and no scope — which is the point. A token here would be a token
 * in an environment variable and a token in a request header, and the only thing it
 * would buy is access this product deliberately does not have.
 */
export function archiveUrlFor(ref: RepositoryRef): string {
  const branch = ref.ref ? encodeURIComponent(ref.ref) : "HEAD";
  return `https://codeload.github.com/${ref.owner}/${ref.name}/tar.gz/${branch}`;
}

/**
 * The canonical URL, which is what the database stores.
 *
 * Built from the parsed pieces rather than from the input, so two URLs that name the
 * same repository produce the same string and the unique index on
 * (organization_id, repo_url) means what it says.
 */
export function canonicalUrlFor(ref: RepositoryRef): string {
  return `https://github.com/${ref.owner}/${ref.name}`;
}
