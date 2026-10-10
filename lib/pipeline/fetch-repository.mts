import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { archiveUrlFor, type RepositoryRef } from "./repository-url.mts";
import { readTarGzWithMetadata, stripTopDirectory } from "./untar.mts";

/**
 * Downloading a public repository and putting it on disk.
 *
 * No token, no scope, no OAuth. The archive is fetched over plain HTTPS from
 * `codeload.github.com`, which serves public repositories to anyone. That is the
 * whole reason this product can offer "paste a URL" without asking anybody to trust
 * it with a credential.
 *
 * Every failure here is a message a person can act on, because the alternative is a
 * run that stops and a dashboard row that says "fetching" forever. A 404 is "no such
 * repository"; a timeout is "the download timed out"; anything else carries the
 * status. None of them is "something went wrong".
 */

export class FetchError extends Error {
  // Written out rather than as a parameter property, because these modules are run
  // by Node's type stripping, which removes annotations and cannot remove a
  // constructor that assigns a field.
  readonly stage: "fetching";

  constructor(message: string) {
    super(message);
    this.name = "FetchError";
    this.stage = "fetching";
  }
}

export interface FetchedRepository {
  /** Where the files were written. Removed by `cleanUp`. */
  path: string;
  /** How many files were written. */
  fileCount: number;
  /** Bytes of archive downloaded, which is what a timeout is measured against. */
  bytes: number;
  /**
   * The commit the archive is a snapshot of.
   *
   * Out of the archive's own pax header, which is the only place it appears — a
   * tarball is not a checkout and carries no `.git`. Null when the archive did not
   * carry one, which is a real possibility and not an error.
   */
  commitSha: string | null;
}

/** How long the whole download may take. A repository archive is a few megabytes. */
const TOTAL_TIMEOUT_MS = 120_000;

/**
 * GitHub's own advice for archive endpoints is to retry: they are behind a CDN and
 * return 5xx under load. Two retries, and the failure reported is the last one.
 */
const ATTEMPTS = 3;

export async function fetchRepository(ref: RepositoryRef): Promise<FetchedRepository> {
  const url = archiveUrlFor(ref);
  let lastFailure: FetchError | null = null;

  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      return await downloadOnce(ref, url);
    } catch (error) {
      if (error instanceof FetchError) lastFailure = error;
      else lastFailure = new FetchError(error instanceof Error ? error.message : String(error));
      // A 404 will be a 404 on the next attempt too. Retrying it only delays the
      // message somebody is waiting to read.
      if (isNotFound(lastFailure)) throw lastFailure;
    }
  }

  throw lastFailure ?? new FetchError("The repository could not be downloaded.");
}

async function downloadOnce(ref: RepositoryRef, url: string): Promise<FetchedRepository> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TOTAL_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      // A redirect is the normal path here — `HEAD` resolves to the default
      // branch's sha — so it is followed rather than treated as a failure.
      redirect: "follow",
      signal: controller.signal,
      headers: {
        // GitHub requires a user agent on every request and returns 403 without one.
        "User-Agent": "cartograph",
        Accept: "application/x-gzip",
      },
    }).catch((error: unknown) => {
      if (error instanceof Error && error.name === "AbortError") {
        throw new FetchError(
          `The download timed out after ${Math.round(TOTAL_TIMEOUT_MS / 1000)} seconds.`,
        );
      }
      throw new FetchError(
        `Could not reach github.com: ${error instanceof Error ? error.message : String(error)}`,
      );
    });

    if (!response.ok) {
      throw new FetchError(messageForStatus(response.status, ref));
    }

    const archive = Buffer.from(await response.arrayBuffer());
    return extractTo(ref, archive, archive.length);
  } finally {
    clearTimeout(timer);
  }
}

function messageForStatus(status: number, ref: RepositoryRef): string {
  if (status === 404) {
    return `No public repository at ${ref.owner}/${ref.name}. Private repositories are not supported.`;
  }
  if (status === 403 || status === 429) {
    return `github.com refused the request (${status}). This is usually rate limiting; try again shortly.`;
  }
  return `github.com returned ${status} for ${ref.owner}/${ref.name}.`;
}

function isNotFound(error: FetchError): boolean {
  return error.message.startsWith("No public repository at");
}

/**
 * Unpack the archive into a temporary directory.
 *
 * The parser takes a path and returns data, which is the only interface it has. So
 * the repository has to exist on disk before it can be parsed, and it is written to
 * a temporary directory that the caller removes — nothing about a fetched repository
 * is kept between runs, and there is nowhere for it to accumulate.
 */
function extractTo(ref: RepositoryRef, archive: Buffer, bytes: number): FetchedRepository {
  let entries;
  let commitSha: string | null = null;
  try {
    const read = readTarGzWithMetadata(archive);
    entries = stripTopDirectory(read.entries);
    commitSha = read.commitSha;
  } catch (error) {
    throw new FetchError(
      `The archive from ${ref.owner}/${ref.name} could not be read: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (entries.length === 0) {
    throw new FetchError(`The archive for ${ref.owner}/${ref.name} contained no files.`);
  }

  const root = mkdtempSync(join(tmpdir(), "cartograph-"));
  let fileCount = 0;
  try {
    for (const entry of entries) {
      const target = join(root, entry.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, entry.data);
      fileCount += 1;
    }
  } catch (error) {
    // A half-written tree is worse than none: `fetchRepository` retries, and a retry
    // that finds the previous attempt's files cannot tell them from the repository's
    // own. The directory is removed here rather than left for `cleanUp`, because the
    // throw means the caller never receives a `FetchedRepository` to hand back.
    rmSync(root, { recursive: true, force: true });
    throw new FetchError(
      `The archive from ${ref.owner}/${ref.name} could not be written to disk: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return { path: root, fileCount, bytes, commitSha };
}

/** Remove a fetched repository. Called whatever happened, so nothing is left behind. */
export function cleanUp(fetched: FetchedRepository | null): void {
  if (!fetched) return;
  rmSync(fetched.path, { recursive: true, force: true });
}
