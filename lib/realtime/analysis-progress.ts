import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { channelNameFor } from "./channel.ts";
import type { Database } from "@/types/database";

/**
 * Subscribing to one analysis's progress.
 *
 * Takes a client rather than building one, and that is the whole point of the
 * signature. The channel is private, so opening it is subject to the policy on
 * `realtime.messages`, which compares the organization in the topic against the one
 * on the caller's token. A client built here from the publishable key carries no
 * token, so the policy would see no organization and the socket would sit there
 * quietly receiving nothing - which is exactly the failure this page exists to
 * report rather than hide. The client handed in is the authenticated one.
 */
export function subscribeToAnalysis(
  client: SupabaseClient<Database>,
  analysisId: string,
  organizationId: string,
  onProgress: (progress: AnalysisProgress) => void,
  onStatus: (status: SubscriptionStatus) => void,
): () => void {
  const channel: RealtimeChannel = client
    .channel(channelNameFor(analysisId, organizationId), { config: { private: true } })
    .on("broadcast", { event: "progress" }, ({ payload }) => {
      const progress = readProgress(payload);
      // A message we cannot read is not a progress update. Dropping it is the only
      // honest option: showing a stage nobody sent is worse than showing the last one
      // that was really sent.
      if (progress) onProgress(progress);
    });

  channel.subscribe((state) => {
    if (state === "SUBSCRIBED") onStatus("live");
    else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT") onStatus("unreachable");
    else if (state === "CLOSED") onStatus("closed");
  });

  return () => {
    // Removing the channel, not merely unsubscribing: the client would otherwise
    // hold the socket open, and a tab left open all day is a socket left open all day.
    void client.removeChannel(channel);
  };
}

export interface AnalysisProgress {
  analysisId: string;
  stage: string;
  message: string | null;
}

export type SubscriptionStatus = "connecting" | "live" | "unreachable" | "closed";

/**
 * Read a broadcast payload, or nothing.
 *
 * Every field is checked rather than assumed. The payload comes off a socket, which
 * is to say it is whatever arrived, and a page that renders an absent stage as a
 * real one is a page that will eventually be believed.
 */
function readProgress(payload: unknown): AnalysisProgress | null {
  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as Record<string, unknown>;

  if (typeof record.analysis_id !== "string") return null;
  if (typeof record.stage !== "string") return null;

  return {
    analysisId: record.analysis_id,
    stage: record.stage,
    message: typeof record.message === "string" ? record.message : null,
  };
}