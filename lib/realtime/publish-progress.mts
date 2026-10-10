import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { channelNameFor } from "./channel.ts";
import type { Database } from "@/types/database";
import type { Stage } from "@/lib/pipeline/stage.mts";

/**
 * Publishing a run's progress from the process doing the work.
 *
 * The spec asks for this to come from a trigger on our own table, and the trigger
 * is written and applied - it is in `20261009000004`. It publishes nothing on this
 * project, for a reason that is not ours:
 *
 *   `realtime.messages` is partitioned by `inserted_at` and on this project has no
 *   partitions at all, so every `realtime.send()` fails with "no partition of
 *   relation messages found for row". `send` catches `WHEN OTHERS` and raises only a
 *   warning, so a publish that cannot happen is indistinguishable from one that did.
 *   There is also no logical replication slot, so nothing is reading the WAL.
 *
 * Client-to-client broadcast over the same service does work, verified with two
 * independent sockets. So the publisher moved here, where it works, and the
 * database stays what it was asked to be: the record of the run. The page still
 * never polls.
 *
 * One publisher, deliberately. Leaving the trigger in place as well would mean two
 * sources for one fact, and they would disagree the moment someone added the
 * missing partition.
 */

/**
 * A publisher that keeps one socket open for the length of a run.
 *
 * Not a per-stage connection. Opening a socket four times for one run is four
 * chances to be slow, and the stage that reports first would be the one that
 * happened to connect first.
 */
export class ProgressPublisher {
  private channel: RealtimeChannel | null = null;
  private client: SupabaseClient<Database> | null = null;

  constructor(
    private readonly analysisId: string,
    private readonly organizationId: string,
  ) {}

  /** Connect, and resolve once the channel is usable. A failure is not fatal. */
  async open(): Promise<void> {
    const client = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL as string,
      process.env.SUPABASE_SECRET_KEY as string,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const channel = client.channel(channelNameFor(this.analysisId, this.organizationId), {
      config: { private: true },
    });

    await new Promise<void>((resolve) => {
      // Resolve on any terminal state. A publisher that never resolves would hang
      // the run behind a socket, and a run must not depend on a page being open.
      const timer = setTimeout(resolve, 3000);
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          clearTimeout(timer);
          resolve();
        }
      });
    });

    this.client = client;
    this.channel = channel;
  }

  async publish(stage: Stage, message: string): Promise<void> {
    if (!this.channel) return;
    // A failed publish is not worth throwing over: the run is still running and the
    // row in the database is still the truth. The page falls back to what it read.
    try {
      await this.channel.send({
        type: "broadcast",
        event: "progress",
        payload: { analysis_id: this.analysisId, stage, message },
      });
    } catch {
      // Nothing. See above.
    }
  }

  async close(): Promise<void> {
    if (this.client && this.channel) await this.client.removeChannel(this.channel);
    this.channel = null;
    this.client = null;
  }
}