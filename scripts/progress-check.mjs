#!/usr/bin/env node
/**
 * The progress channel and the progress page.
 *
 * Two things here are written twice, in two languages, and neither copy can see the
 * other at compile time:
 *
 *   The channel name. `channelNameFor` in TypeScript and the `publish_analysis_stage`
 *   trigger in SQL. If they disagree the trigger publishes to a channel nobody is
 *   listening to, the page never updates, and nothing throws.
 *
 *   The stage list. `stage.mts` and the check constraint in the migration, which
 *   pipeline-check.mjs already covers.
 *
 * Plus the stale rule, which is the only thing standing between a process that died
 * mid-parse and a row that says "parsing" until somebody reads the database by hand.
 *
 * Usage: pnpm map:progress
 */
import { readFileSync } from "node:fs";
import { STAGES, PIPELINE, STAGE_SUMMARY } from "../lib/pipeline/stage.mts";
import { channelNameFor } from "../lib/realtime/channel.ts";
import { runFreshness, STALE_AFTER_MINUTES } from "../lib/analysis-freshness.ts";

let failures = 0;
const check = (label, passed, detail) => {
  if (!passed) failures += 1;
  console.log(`${passed ? "pass" : "FAIL"}  ${label} - ${detail}`);
};

const migration = readFileSync(
  new URL("../supabase/migrations/20261009000005_progress_channel_policy_role.sql", import.meta.url),
  "utf8",
);

const publisher = readFileSync(
  new URL("../lib/realtime/publish-progress.mts", import.meta.url),
  "utf8",
);

// ---- One publisher -----------------------------------------------------------

// There was a trigger here and it published nothing, because `realtime.messages`
// has no partitions on this project and `realtime.send` swallows the error. The
// publisher moved into the process running the analysis. Two publishers would mean
// two sources for one fact, so there must be exactly one left.
//
// Comments are stripped first. The migration keeps the old trigger as a comment,
// because the version that was wrong is the instructive one, and a check that
// matched inside a comment would be reporting the documentation as a second
// publisher.
const executable = migration
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

check(
  "There is exactly one publisher",
  !/create trigger/i.test(executable) &&
    !/create or replace function public\.publish_analysis_stage/i.test(executable),
  "no trigger in the migration; the publisher is publish-progress.mts",
);

check(
  "The publisher sends the stage and its message, not the row",
  /payload:\s*\{\s*analysis_id:\s*this\.analysisId,\s*stage,\s*message\s*\}/.test(publisher),
  "two values with one meaning, so the page has nothing to filter",
);

// ---- The channel name --------------------------------------------------------

check(
  "The app builds one channel name and both sides use it",
  channelNameFor("{id}", "{org}") === "analysis:{org}:{id}" &&
    /channelNameFor\(this\.analysisId, this\.organizationId\)/.test(publisher),
  `channelNameFor gives ${channelNameFor("{id}", "{org}")}, and the publisher subscribes with it`,
);

// The policy is the only thing stopping one organization reading another's progress.
// It works by taking the organization back out of the topic, so the topic has to
// carry it and the policy has to be splitting on the same separator. Group 1 of each
// match is the separator and group 2 is the segment number being read.
const policy = executable.match(/create policy analysis_progress_subscribe[\s\S]*?;/)?.[0] ?? "";
const parts = [...policy.matchAll(/split_part\(realtime\.topic\(\), '(:)', (\d)\)/g)];
const segments = parts.map((match) => match[2]);
const separators = new Set(parts.map((match) => match[1]));

check(
  "The policy reads the organization back out of the topic",
  parts.length === 2 && segments[0] === "1" && segments[1] === "2" && separators.size === 1,
  parts.length === 2
    ? `segment 1 must be 'analysis', segment 2 compared to the token, split on ${[...separators][0]}`
    : "the policy does not split the topic into the three parts the channel name builds",
);

check(
  "The channel is private, so the policy applies to it",
  publisher.includes("private: true"),
  "a public channel is not subject to the policy on realtime.messages",
);

// `to authenticated` looks right and is wrong here. realtime.authorize() takes the
// session role from the token's own `role` claim, and a Clerk token has none, so a
// role-restricted policy is evaluated as anon, does not apply, and the socket is
// refused. The tenancy check in the predicate is the control; the role never was.
check(
  "The policy is not gated on a role the token does not carry",
  !/\bto\s+(authenticated|anon|authenticated\s*,\s*\w+)\b/i.test(executable),
  "no role restriction: realtime.authorize() sets the role from the token's own role " +
    "claim, which a Clerk token does not have",
);

check(
  "The policy still refuses a request with no organization",
  /using\s*\([\s\S]*current_organization_id\(\)[\s\S]*\)/.test(executable),
  "the organization in the topic is compared against the one on the token",
);

// ---- Stages a run actually passes through -------------------------------------

check(
  "PIPELINE holds only stages the run reaches",
  PIPELINE.every((stage) => STAGES.includes(stage)) && !PIPELINE.includes("selecting"),
  `${PIPELINE.join(" -> ")}, and failed is taken separately`,
);

check(
  "Every stage has a summary to show",
  STAGES.every((stage) => typeof STAGE_SUMMARY[stage] === "string" && STAGE_SUMMARY[stage] !== ""),
  `${STAGES.length} stages, all with a sentence`,
);

// ---- The stale rule -----------------------------------------------------------

const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();

check(
  "A run still moving is not stale",
  !runFreshness({ stage: "parsing", status: "parsing", stageAt: minutesAgo(0), finished: false }).stale,
  "stage moved just now",
);

check(
  `A run stalled for over ${STALE_AFTER_MINUTES} minutes is stale`,
  runFreshness({
    stage: "parsing",
    status: "parsing",
    stageAt: minutesAgo(STALE_AFTER_MINUTES + 1),
    finished: false,
  }).stale,
  "nothing times a run out, so a stage that stopped moving is the only evidence",
);

check(
  "A finished run is never stale, however old",
  !runFreshness({ stage: "done", status: "complete", stageAt: minutesAgo(600), finished: true }).stale,
  "it stopped on purpose",
);

check(
  "A failed run is never stale",
  !runFreshness({ stage: "failed", status: "failed", stageAt: minutesAgo(600), finished: true }).stale,
  "it stopped on purpose, in the other direction",
);

check(
  "An unfinished run with no stage_at is not called stale",
  !runFreshness({ stage: "parsing", status: "parsing", stageAt: null, finished: false }).stale,
  "there is no timestamp to compare, and guessing would be inventing something",
);

console.log(failures === 0 ? "\nAll progress checks passed." : `\n${failures} FAILED`);
if (failures > 0) process.exitCode = 1;