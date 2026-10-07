/**
 * Where fleet telemetry goes: the one place the PostHog project is named.
 *
 * A project API key is a public write key by design: it can only send
 * events, never read them, so it is safe to embed in a published package.
 * An empty key means this build has no telemetry configured: `telemetry on`
 * says so and nothing is ever sent.
 */

/** PostHog's ingestion host; the batch endpoint is `${TELEMETRY_HOST}/batch/`. */
export const TELEMETRY_HOST = "https://internal-j.posthog.com";

/** The PostHog project's public write key. */
export const TELEMETRY_KEY = "sTMFPsFhdP1Ssg";

/** The `team` property every event carries, so the project's owners can filter Coherence's events. */
export const TELEMETRY_TEAM_TAG = "coherence";

/** The most a flush waits for PostHog before it drops the batch. */
export const TELEMETRY_TIMEOUT_MS = 5_000;

export interface TelemetryTarget {
  host: string;
  key: string;
  team: string;
}

export const TELEMETRY_TARGET: TelemetryTarget = { host: TELEMETRY_HOST, key: TELEMETRY_KEY, team: TELEMETRY_TEAM_TAG };
