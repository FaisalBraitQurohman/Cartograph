"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSupabaseClient } from "@/lib/supabase/client";
import {
  subscribeToAnalysis,
  type AnalysisProgress,
  type SubscriptionStatus,
} from "@/lib/realtime/analysis-progress";
import { PIPELINE, STAGE_SUMMARY, type Stage } from "@/lib/pipeline/stage.mts";
import { runFreshness, STALE_AFTER_MINUTES } from "@/lib/analysis-freshness";

/**
 * The live half of the progress page.
 *
 * The server rendered the state this starts from, so the page is correct before any
 * socket exists. The socket only makes it current. That ordering is the point: a page
 * that renders nothing until a message arrives is a blank page on a slow connection
 * and a permanently blank page on a broken one.
 *
 * Stages come from `PIPELINE`, which is the four a run actually passes through, and a
 * step is only ever marked done because a message said so.
 */
export function AnalysisProgressView({
  analysisId,
  organizationId,
  initialStage,
  initialMessage,
  initialStatus,
  startedAt,
  stageAt,
  finishedAt,
}: {
  analysisId: string;
  organizationId: string;
  initialStage: Stage | null;
  initialMessage: string | null;
  initialStatus: string;
  startedAt: string;
  stageAt: string | null;
  finishedAt: string | null;
}) {
  const router = useRouter();

  // The authenticated client, which carries the Clerk session token. The channel is
  // private: opening it is checked against the organization on that token, and a
  // client without it would sit there receiving nothing while looking perfectly
  // healthy.
  const supabase = useSupabaseClient();

  const [stage, setStage] = useState<Stage | null>(initialStage);
  const [message, setMessage] = useState<string | null>(initialMessage);
  const [reached, setReached] = useState<Stage[]>(
    initialStage ? PIPELINE.slice(0, PIPELINE.indexOf(initialStage) + 1) : [],
  );
  const [subscription, setSubscription] = useState<SubscriptionStatus>("connecting");
  // Ticks once a second so the elapsed time is honest rather than frozen at whatever
  // it said when the page loaded.
  const [, setTick] = useState(0);

  // The gap between the server render and the socket opening is real time in which a
  // stage can move, and a broadcast sent in that gap is gone — the channel was not
  // listening. One refresh on connect closes it, and only one: the server re-renders
  // with the current row and this flag stays set for the life of the page. A refresh
  // that repeated on every status change would be a polling loop with extra steps.
  const refreshedOnConnect = useRef(false);

  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const stop = subscribeToAnalysis(
      supabase,
      analysisId,
      organizationId,
      (progress: AnalysisProgress) => {
        const next = progress.stage as Stage;

        // `failed` is not in PIPELINE - a run does not move through it, it stops
        // there - so it is taken separately. Dropping it would leave the page showing
        // the last stage that worked, on a run that has stopped.
        if (next === "failed") {
          setStage("failed");
          setMessage(progress.message);
          return;
        }

        if (!PIPELINE.includes(next)) return;
        setStage(next);
        setMessage(progress.message);
        setReached(PIPELINE.slice(0, PIPELINE.indexOf(next) + 1));
      },
      (status) => {
        setSubscription(status);
        if (status === "live" && !refreshedOnConnect.current) {
          refreshedOnConnect.current = true;
          router.refresh();
        }
      },
    );

    return stop;
  }, [supabase, analysisId, organizationId, router]);

  // On completion, go to the map. Server-rendered runs land here already finished -
  // a reload of a finished run, or a page opened after the fact - so the redirect
  // has to be here too and not only on the message that says it finished.
  const done = stage === "done";
  useEffect(() => {
    if (done) router.replace(`/workspace/analyses/${analysisId}/map`);
  }, [done, analysisId, router]);

  const failed = stage === "failed" || initialStatus === "failed";
  const finished = done || failed;
  const fresh = runFreshness({
    stage,
    status: initialStatus,
    stageAt,
    finished: finishedAt !== null || finished,
  });

  return (
    <div className="mt-8">
      <ol className="rounded-lg border border-border bg-surface-raised/35">
        {PIPELINE.map((step) => {
          const isDone = reached.includes(step);
          const current = stage === step && !finished;
          const label = current
            ? (message ?? STAGE_SUMMARY[step])
            : step === stage
              ? (message ?? STAGE_SUMMARY[step])
              : STAGE_SUMMARY[step];

          return (
            <li
              key={step}
              className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0 sm:px-5"
            >
              <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  current ? "bg-accent" : isDone ? "bg-incoming" : "bg-border"
                }`}
              />
              <span
                className={`w-24 shrink-0 font-mono text-[11px] ${
                  isDone || current ? "text-text" : "text-text-muted"
                }`}
              >
                {step}
              </span>
              <span className="truncate text-xs text-text-muted">{label}</span>
              {current ? (
                <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-accent">
                  running
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>

      {/* What the reader cannot work out from the stage list alone: how long this has
          been going, when the stage last actually changed, and whether that was
          recently enough to still be believable. */}
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 font-mono text-[11px] sm:grid-cols-4">
        <Figure label="Started" value={`${since(startedAt)} ago`} />
        <Figure
          label="Stage changed"
          value={fresh.finished ? "—" : stageAt ? `${since(stageAt)} ago` : "—"}
        />
        <Figure label="Elapsed" value={elapsed(startedAt, finishedAt)} />
        <Figure
          label="Live"
          value={
            finished
              ? "finished"
              : subscription === "live"
                ? "yes"
                : subscription === "connecting"
                  ? "connecting"
                  : "no"
          }
          tone={
            finished || subscription === "live" ? "normal" : "warn"
          }
        />
      </dl>

      {!finished && fresh.stale ? (
        <p className="mt-3 rounded-md border border-border bg-surface-raised px-4 py-3 text-xs leading-5 text-text">
          <span className="font-medium">This run looks abandoned.</span>{" "}
          <span className="text-text-muted">
            Its stage has not moved for over {STALE_AFTER_MINUTES} minutes. Nothing in
            this app times a run out, so it may still be going — reload to check.
          </span>
        </p>
      ) : null}

      {!finished ? (
        <p className="mt-3 text-[11px] text-text-muted">
          {subscription === "live"
            ? "Updating as the run publishes."
            : subscription === "connecting"
              ? "Connecting to the progress channel…"
              : "Not receiving updates. This page will not change on its own — reload to check."}
        </p>
      ) : null}
    </div>
  );
}

function Figure({
  label,
  value,
  tone = "normal",
}: {
  label: string;
  value: string;
  tone?: "normal" | "warn";
}) {
  return (
    <div>
      <dt className="text-text-muted">{label}</dt>
      <dd className={`mt-1 ${tone === "warn" ? "text-danger" : "text-text"}`}>{value}</dd>
    </div>
  );
}

/** Coarse and relative, like the dashboard's. A timestamp to the second is noise. */
function since(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.round(minutes / 60)}h`;
}

/** How long the run took, or has been taking. */
function elapsed(startedAt: string, finishedAt: string | null): string {
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  return duration(end - new Date(startedAt).getTime());
}

function duration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return `${minutes}m ${rest}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}