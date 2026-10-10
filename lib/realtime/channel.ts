/**
 * The name of the channel one analysis publishes on.
 *
 * Its own module with no imports, because it is the one string that has to agree
 * with the `publish_analysis_stage` trigger in SQL and nothing in between can check
 * that. `map:progress` reads both and compares them.
 *
 * The organization is in the name and not in the payload. That is deliberate: the
 * policy on `realtime.messages` reads the organization back out of the topic and
 * compares it to the one on the token, so a topic that did not carry it could not be
 * checked against anything and another organization's progress would be readable.
 */
export function channelNameFor(analysisId: string, organizationId: string): string {
  return `analysis:${organizationId}:${analysisId}`;
}