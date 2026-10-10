import { gunzipSync } from "node:zlib";

/**
 * Reading a tar archive, which is what GitHub serves a repository as.
 *
 * Node has no tar reader, and this is the part of the format that matters: a header
 * is 512 bytes of fixed-offset fields, a file's contents follow it padded to a
 * multiple of 512, and two zero blocks mean the end.
 *
 * Two details decide whether this is correct or merely usually right, and both were
 * checked against real archives rather than assumed:
 *
 * **The `prefix` field.** A name longer than 100 bytes is split between the header's
 * `name` and `prefix` fields, and reading only `name` truncates it. The tailwindcss
 * archive has 25 such paths, the longest 129 characters.
 *
 * The split is not "the first part goes in `name`". GitHub puts the *leading*
 * directories in `prefix` and the last segment in `name`:
 *
 *     prefix  tailwindcss-HEAD/packages/@tailwindcss-postcss/…/fixtures
 *     name    example-project/
 *
 * so the path is `prefix + "/" + name`. Assembling it the other way round produces a
 * path that looks plausible and points at a directory that does not exist, which is
 * the worst failure this reader can have — it silently misfiles code rather than
 * failing to read it.
 *
 * **pax headers.** GitHub writes a `g` global header and can write an `x` extended
 * header whose `path=` record overrides the name entirely — used for names too long
 * for either field to hold. Both are read, and the record wins because that is what
 * it is for.
 *
 * Written rather than installed because a dependency on a format this specific is a
 * larger cost than 120 lines that are checked against the archives we actually read.
 */

const BLOCK = 512;

/** A file the archive said exists, with the bytes it said they contain. */
export interface TarEntry {
  /** Path relative to the archive root, with the archive's own top directory removed. */
  path: string;
  data: Buffer;
  /** Tar's own type byte. `'0'` is a regular file and `'5'` a directory. */
  type: string;
  mode: number;
}

export function readTarGz(compressed: Buffer): TarEntry[] {
  return readTar(gunzipSync(compressed));
}

export function readTar(archive: Buffer): TarEntry[] {
  const entries: TarEntry[] = [];
  // The pax record applies to the next entry and is cleared afterwards. Leaving it
  // set would apply one file's long name to every file after it.
  let paxPath: string | null = null;
  let paxLinkPath: string | null = null;

  for (let offset = 0; offset + BLOCK <= archive.length; ) {
    const header = archive.subarray(offset, offset + BLOCK);
    // Two zero blocks end the archive. GitHub's is not always padded to one, so
    // this is checked rather than assumed.
    if (header.every((byte) => byte === 0)) break;

    const size = readOctal(header, 124, 12);
    const type = String.fromCharCode(header[156] ?? 0x30);
    const body = archive.subarray(offset + BLOCK, offset + BLOCK + size);
    offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK;

    if (type === "g") {
      const globals = readPaxRecords(body);
      paxPath = globals.path ?? null;
      paxLinkPath = globals.linkpath ?? null;
      continue;
    }

    if (type === "x" || type === "X") {
      const extended = readPaxRecords(body);
      paxPath = extended.path ?? null;
      paxLinkPath = extended.linkpath ?? null;
      continue;
    }

    // Type `L` is GNU's long-name record, carrying a name that fits in neither
    // field. Not something GitHub's archives use, but cheap to honour and it is a
    // real format rather than a hypothetical one.
    if (type === "L") {
      paxPath = readCString(body);
      continue;
    }
    if (type === "K") {
      paxLinkPath = readCString(body);
      continue;
    }

    const prefix = readCString(header.subarray(345, 500));
    const name = readCString(header.subarray(0, 100));
    // Leading directories first. See the note on `prefix` above — GitHub writes the
    // split this way round and the other way round misfiles rather than failing.
    const path = paxPath ?? (prefix ? `${prefix}/${name}` : name);
    paxPath = null;
    paxLinkPath = null;

    // Only regular files are extracted. A directory entry has no contents and a
    // symlink's "contents" are a path, not bytes — writing one as a file would put
    // a repository's link target on disk as if it were code.
    if (type !== "0" && type !== "\0") continue;

    void paxLinkPath;
    entries.push({ path, data: Buffer.from(body), type, mode: readOctal(header, 100, 8) });
  }

  return entries;
}

/**
 * The `path=` and `linkpath=` records out of a pax extended header.
 *
 * The format is `%d key=value\n` per record, where the leading number is the length
 * of the whole record including itself — which is why the value cannot be found by
 * searching for `=`: a key longer than two characters, or a path containing `=`,
 * both break that. The lengths are respected instead.
 */
function readPaxRecords(body: Buffer): Record<string, string> {
  const records: Record<string, string> = {};
  let offset = 0;

  while (offset < body.length) {
    const space = body.indexOf(0x20, offset);
    if (space < 0) break;

    const length = Number.parseInt(body.subarray(offset, space).toString("ascii"), 10);
    if (!Number.isFinite(length) || length <= 0) break;

    const record = body.subarray(space + 1, offset + length).toString("utf8");
    const newline = record.lastIndexOf("\n");
    const payload = newline >= 0 ? record.slice(0, newline) : record;
    const equals = payload.indexOf("=");
    if (equals > 0) records[payload.slice(0, equals)] = payload.slice(equals + 1);

    offset += length;
  }

  return records;
}

/** An octal field, which is NUL- or space-padded and may be empty for a zero. */
function readOctal(header: Buffer, start: number, length: number): number {
  const text = header.subarray(start, start + length).toString("ascii").replace(/[^0-7]/g, "");
  if (text.length === 0) return 0;
  const value = Number.parseInt(text, 8);
  return Number.isFinite(value) ? value : 0;
}

function readCString(field: Buffer): string {
  const end = field.indexOf(0);
  return field.subarray(0, end < 0 ? field.length : end).toString("utf8");
}

/**
 * Remove the archive's own top directory.
 *
 * GitHub wraps everything in `owner-repo-sha/`, so every entry has one leading
 * segment that is not part of the repository. Paths are keyed off the first entry
 * rather than guessed from the URL, because the directory name contains a commit
 * sha the caller does not know before it downloads.
 */
export function stripTopDirectory(entries: readonly TarEntry[]): TarEntry[] {
  const top = entries.length > 0 ? (entries[0]?.path.split("/")[0] ?? "") : "";
  if (top === "") return [...entries];

  return entries
    .map((entry) => {
      const cut = entry.path.indexOf("/");
      // An entry with no slash is the top directory itself, which is a directory
      // and therefore already filtered out above.
      if (cut < 0) return entry;
      return { ...entry, path: entry.path.slice(cut + 1) };
    })
    // And nothing above the root: an entry called `../x` is not a repository file.
    .filter((entry) => entry.path !== "" && !entry.path.startsWith("../") && !entry.path.includes("/../"));
}
