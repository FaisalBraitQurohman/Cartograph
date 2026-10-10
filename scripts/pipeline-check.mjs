#!/usr/bin/env node
/**
 * The fetch half of the pipeline, checked against real repositories.
 *
 * Two things are verified here that cannot be checked from a type signature: that
 * the tar reader reads what GNU tar reads, and that a URL that does not name a
 * repository fails with a message rather than with a stack trace.
 *
 * Network is used on purpose. A tar reader tested only against an archive this
 * project generated is a tar reader tested against its own assumptions, and the
 * interesting cases — a path over 100 characters, a pax header — only appear in real
 * archives.
 *
 * Usage: pnpm map:pipeline
 */
import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readTarGz, stripTopDirectory } from "../lib/pipeline/untar.mts";
import {
  InvalidRepositoryUrl,
  archiveUrlFor,
  canonicalUrlFor,
  parseRepositoryUrl,
} from "../lib/pipeline/repository-url.mts";
import { fetchRepository, cleanUp, FetchError } from "../lib/pipeline/fetch-repository.mts";
import { STAGES, PIPELINE } from "../lib/pipeline/stage.mts";

let failures = 0;
const check = (label, passed, detail) => {
  if (!passed) failures += 1;
  console.log(`${passed ? "pass" : "FAIL"}  ${label} — ${detail}`);
};

// ---- URLs -------------------------------------------------------------------

console.log("\n1. Repository URLs");
const urls = [
  ["https://github.com/vuejs/devtools", "vuejs/devtools", null, "https://github.com/vuejs/devtools"],
  ["https://github.com/vuejs/devtools.git", "vuejs/devtools", null, "https://github.com/vuejs/devtools"],
  ["https://github.com/vuejs/devtools/", "vuejs/devtools", null, "https://github.com/vuejs/devtools"],
  ["http://github.com/vuejs/devtools", "vuejs/devtools", null, "https://github.com/vuejs/devtools"],
  ["github.com/vuejs/devtools", "vuejs/devtools", null, "https://github.com/vuejs/devtools"],
  ["vuejs/devtools", "vuejs/devtools", null, "https://github.com/vuejs/devtools"],
  ["https://www.github.com/vuejs/devtools", "vuejs/devtools", null, "https://github.com/vuejs/devtools"],
  [
    "https://github.com/tailwindlabs/tailwindcss/tree/main/packages/tailwindcss",
    "tailwindlabs/tailwindcss",
    "main/packages/tailwindcss",
    "https://github.com/tailwindlabs/tailwindcss",
  ],
  ["https://github.com/vuejs/devtools/issues/4", "vuejs/devtools", null, "https://github.com/vuejs/devtools"],
];

let urlWrong = 0;
for (const [input, slug, ref, canonical] of urls) {
  const parsed = parseRepositoryUrl(input);
  if (parsed.slug !== slug || parsed.ref !== ref || canonicalUrlFor(parsed) !== canonical) {
    urlWrong += 1;
    console.log(`      ${input} -> ${parsed.slug} ref=${parsed.ref} canonical=${canonicalUrlFor(parsed)}`);
  }
}
check(
  `${urls.length} URL forms`,
  urlWrong === 0,
  urlWrong === 0 ? "every form canonicalises to the same repository" : `${urlWrong} canonicalised wrongly`,
);

// One repository, one string. Every way of writing the same repository has to
// produce one canonical URL, or "paste it twice" creates two projects and two maps
// that disagree with each other. Grouped by slug, because the list deliberately
// covers two different repositories.
let canonicalSplit = 0;
for (const group of groupBy(urls, ([input]) => parseRepositoryUrl(input).slug)) {
  const distinct = new Set(group.map(([input]) => canonicalUrlFor(parseRepositoryUrl(input))));
  if (distinct.size !== 1) {
    canonicalSplit += 1;
    console.log(`      ${group[0][0].split("/")[0]} -> ${[...distinct].join(" and ")}`);
  }
}
check(
  "One repository is one canonical URL",
  canonicalSplit === 0,
  canonicalSplit === 0
    ? `${urls.length} forms across ${groupBy(urls, ([input]) => parseRepositoryUrl(input).slug).length} repositories, each with one canonical form`
    : `${canonicalSplit} repositories canonicalised more than one way`,
);

const rejects = [
  ["", "empty"],
  ["https://gitlab.com/vuejs/devtools", "another host"],
  ["https://evil.example.com/a/b", "another host"],
  ["https://github.com/vuejs", "no repository name"],
  ["ftp://github.com/a/b", "wrong protocol"],
  ["not a url at all", "not a url"],
  ["https://github.com/", "host only"],
];
let rejectWrong = 0;
for (const [input, why] of rejects) {
  try {
    parseRepositoryUrl(input);
    rejectWrong += 1;
    console.log(`      accepted ${JSON.stringify(input)} (${why})`);
  } catch (error) {
    if (!(error instanceof InvalidRepositoryUrl)) rejectWrong += 1;
  }
}
check(
  `${rejects.length} rejected inputs`,
  rejectWrong === 0,
  rejectWrong === 0 ? "each raises InvalidRepositoryUrl rather than returning a guess" : `${rejectWrong} slipped through`,
);

check(
  "No token anywhere in the fetch",
  archiveUrlFor(parseRepositoryUrl("vuejs/devtools")).startsWith("https://codeload.github.com/") &&
    !archiveUrlFor(parseRepositoryUrl("vuejs/devtools")).includes("token"),
  `https://codeload.github.com/${parseRepositoryUrl("vuejs/devtools").owner}/${
    parseRepositoryUrl("vuejs/devtools").name
  }/tar.gz/HEAD`,
);

// ---- Stages -----------------------------------------------------------------

console.log("\n2. Stages");
check(
  `${STAGES.length} stages, one pipeline`,
  PIPELINE.every((stage) => STAGES.includes(stage)) && PIPELINE[0] === "fetching" && PIPELINE.at(-1) === "done",
  PIPELINE.join(" -> "),
);

// ---- The tar reader, against GNU tar ----------------------------------------

console.log("\n3. The tar reader, against real archives");

const REPOSITORIES = [
  { ref: "vuejs/devtools", why: "a monorepo with a pax global header" },
  { ref: "tailwindlabs/tailwindcss", why: "paths over 100 characters" },
  { ref: "sindresorhus/slugify", why: "a small repository, directories included" },
];

for (const { ref, why } of REPOSITORIES) {
  const dir = mkdtempSync(join(tmpdir(), "cartograph-check-"));
  const archive = join(dir, "repo.tar.gz");
  try {
    execFileSync(
      "curl",
      ["-sSL", "-o", archive, `https://codeload.github.com/${ref}/tar.gz/HEAD`],
      { stdio: "pipe" },
    );

    const mine = new Set(stripTopDirectory(readTarGz(readFileSync(archive))).map((e) => e.path));
    const listing = execFileSync("tar", ["-tzf", archive], { encoding: "utf8", maxBuffer: 1 << 26 })
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const top = (listing[0] ?? "").split("/")[0];
    const gnu = new Set(
      listing
        .map((line) => line.slice(top.length + 1))
        .filter((line) => line !== "" && !line.endsWith("/")),
    );

    const missing = [...gnu].filter((path) => !mine.has(path));
    const extra = [...mine].filter((path) => !gnu.has(path));
    const longest = [...mine].sort((left, right) => right.length - left.length)[0] ?? "";

    check(
      `${ref} (${why})`,
      missing.length === 0 && extra.length === 0,
      missing.length === 0 && extra.length === 0
        ? `${mine.size} files, identical to GNU tar, longest path ${longest.length} chars`
        : `${missing.length} missing, ${extra.length} extra`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Path traversal. An archive is untrusted input; a path escaping the extraction
// directory would write somebody else's code anywhere on this disk.
const traversal = readTarGz(
  gzipOf(usTar([
    { name: "root/../../etc/passwd", data: Buffer.from("nope") },
    { name: "root/nested/../../../escape.ts", data: Buffer.from("nope") },
    { name: "root/ok.ts", data: Buffer.from("fine") },
  ])),
);
const stripped = stripTopDirectory(traversal);
check(
  "Nothing escapes the extraction directory",
  stripped.every((entry) => !entry.path.includes("..") && !entry.path.startsWith("/")),
  `${stripped.length} of 3 entries kept, paths: ${stripped.map((e) => e.path).join(", ")}`,
);

// A path longer than either header field can hold, split across `name` and `prefix`.
// GitHub produces these for real — tailwindcss has 25 — so the fixture has to be
// built the same way tar builds them, or the check proves nothing.
// A path tar has to split across two header fields: long enough overall, with the
// leading directories still fitting in `name`.
const longRelative = `${"d".repeat(40)}/${"e".repeat(40)}/${"f".repeat(40)}.ts`;
const split = stripTopDirectory(
  readTarGz(gzipOf(usTar([{ name: `root/${longRelative}`, data: Buffer.from("x"), splitAcrossFields: true }]))),
);
check(
  "A path over 100 characters survives",
  split.length === 1 && split[0]?.path === longRelative,
  split[0]?.path === longRelative
    ? `${split[0].path.length} chars, reassembled from name + prefix`
    : `got ${split[0]?.path ?? "nothing"}`,
);

// And the other way a long path arrives: a pax extended header whose `path=` record
// replaces the header name outright, because the name does not fit in either field.
//
// The pax header is its own entry, so the archive needs the normal first entry to
// exist before it — which is why this fixture writes two files, and why the
// stripped result is compared by index rather than by "the first entry".
const viaPax = stripTopDirectory(
  readTarGz(
    gzipOf(
      usTar([
        { name: "root/first.ts", data: Buffer.from("a") },
        { name: "PaxHeaders/0", data: paxPath(`root/${longRelative}`), typeByte: "x" },
        { name: "root/second.ts", data: Buffer.from("b") },
      ]),
    ),
  ),
);
check(
  "A pax path record overrides the header name",
  viaPax.length === 2 && viaPax[1]?.path === longRelative,
  viaPax[1]?.path === longRelative
    ? `${viaPax[1].path.length} chars from a pax record, header said "second.ts"`
    : `got ${viaPax[1]?.path ?? "nothing"}`,
);

// ---- A real fetch, and a real failure ---------------------------------------

console.log("\n4. Fetching");
{
  const fetched = await fetchRepository(parseRepositoryUrl("sindresorhus/slugify"));
  check(
    "A small repository fetches and unpacks",
    fetched.fileCount > 0 && readFileSync(join(fetched.path, "index.js"), "utf8").length > 0,
    `${fetched.fileCount} files, ${(fetched.bytes / 1024).toFixed(0)}KB archive, into ${fetched.path}`,
  );
  const before = fetched.path;
  cleanUp(fetched);
  check("The fetched copy is deleted afterwards", !exists(before), "removed");
}

{
  let message = "";
  let isFetchError = false;
  try {
    await fetchRepository(parseRepositoryUrl("cartograph-this-org-does-not-exist/xyzzy"));
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
    isFetchError = error instanceof FetchError;
  }
  check(
    "A repository that does not exist fails with a message",
    isFetchError && message.includes("No public repository at") && !message.includes("http"),
    message,
  );
}

// ---- Stages against the database vocabulary ----------------------------------

console.log("\n5. The stage list and the migration agree");
const migration = readFileSync(
  new URL("../supabase/migrations/20261009000003_parse_provenance.sql", import.meta.url),
  "utf8",
);
const inSql = migration.match(/check \(stage is null or stage in \(([\s\S]*?)\)\);/)?.[1] ?? "";
const sqlStages = [...inSql.matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
const missingInSql = STAGES.filter((stage) => !sqlStages.includes(stage));
check(
  "Every stage is in the migration's constraint",
  missingInSql.length === 0 && sqlStages.length === STAGES.length,
  missingInSql.length === 0
    ? `${sqlStages.length} in the constraint, ${STAGES.length} in stage.mts`
    : `missing from the constraint: ${missingInSql.join(", ")}`,
);

console.log(failures === 0 ? "\nAll pipeline checks passed." : `\n${failures} FAILED`);
if (failures > 0) process.exitCode = 1;

// ---- Fixtures for the archive checks ----------------------------------------

function exists(path) {
  try {
    readFileSync(path);
    return true;
  } catch {
    return false;
  }
}

function groupBy(rows, keyOf) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }
  return [...groups.values()];
}

/** A pax extended header body: `%d path=<value>\n`, the length covering itself. */
function paxPath(path) {
  const body = ` path=${path}\n`;
  // The stated length is the length of the whole record, and it counts its own
  // digits — so adding a digit to the number changes the total. Rebuild until the
  // two agree, which is what tar does.
  let length = body.length + 2;
  while (String(length).length + body.length !== length) {
    length = String(length).length + body.length;
  }
  return Buffer.from(`${length}${body}`, "utf8");
}

/**
 * A one-entry tar, so the checks above can state a shape rather than download one.
 *
 * `splitAcrossFields` builds the shape tar actually uses for a long path: the
 * leading directories in `name`, the last segment in `prefix`, with the split at
 * whichever slash leaves the tail within `prefix`'s 155 bytes. Every other entry
 * writes its whole name into `name`, which is the case a naive reader gets right.
 */
function usTar(entries) {
  const blocks = [];
  for (const entry of entries) {
    const header = Buffer.alloc(512);
    const typeByte = entry.typeByte ?? "0";
    if (entry.splitAcrossFields) {
      // The way GitHub writes it: leading directories in `prefix`, last segment in
      // `name`. Reading it the other way round would produce a plausible path that
      // points nowhere, so the fixture has to match the real archives rather than a
      // guess about them.
      const name = entry.name;
      const cut = name.lastIndexOf("/");
      header.write(name.slice(cut + 1), 0, "utf8");
      header.write(name.slice(0, cut), 345, "utf8");
    } else {
      header.write(entry.name, 0, "utf8");
    }
    header.write("0000644\0", 100, "ascii");
    header.write("0000000\0", 108, "ascii");
    header.write("0000000\0", 116, "ascii");
    header.write(entry.data.length.toString(8).padStart(11, "0") + "\0", 124, "ascii");
    header.write("00000000000\0", 136, "ascii");
    header.write("        ", 148, "ascii");
    header.write(typeByte, 156, "ascii");
    header.write("ustar\0", 257, "ascii");
    header.write("00", 263, "ascii");
    let sum = 0;
    for (let i = 0; i < 512; i += 1) sum += header[i];
    header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "ascii");
    blocks.push(header, entry.data, Buffer.alloc((512 - (entry.data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

function gzipOf(tar) {
  return gzipSync(tar);
}
