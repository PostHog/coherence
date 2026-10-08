/**
 * `coherence telemetry on | off | status | show | reset-id`, and the internal
 * `flush` the hooks start detached. See telemetry.ts.
 */

import type { Io } from "../journal/cli.ts";
import {
  DEFECT_EVENT,
  HOSTS,
  SESSION_EVENT,
  batchBody,
  collectSessions,
  flushQueue,
  optIn,
  optOut,
  pendingSessions,
  readQueue,
  resetId,
  settingsPath,
  queuePath,
  telemetryState,
  type Env,
  type Sender,
} from "./telemetry.ts";
import { TELEMETRY_TARGET } from "./telemetry-config.ts";

export const TELEMETRY_USAGE = `  coherence telemetry on | off | status | show | reset-id   opt-in fleet telemetry through PostHog: off until turned on; show prints the queue exactly as it would be sent`;

const WHAT = [
  `Coherence sends two events, and only these fields (see the README's Telemetry section):`,
  `  ${SESSION_EVENT}: per hook event, the count and p50, p95 and max milliseconds; Coherence's version, the host, the OS, Node's major version, the project's languages, its size in files and components as buckets, and whether a registry is in use`,
  `  ${DEFECT_EVENT}: the defect's class, whether a fix introduced it, how it was caught, the version, the host and the project's size bucket; never its text`,
  `Never a name, an email, a host name, a path, a repository or project name, a prompt, a command, code or a defect's text. The id is random and yours to reset.`,
];

function flagValue(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
}

export async function telemetryCommand(argv: string[], io: Io, env: Env = process.env, send?: Sender): Promise<number> {
  const [sub, ...rest] = argv;
  const root = io.cwd;
  switch (sub) {
    case "on": {
      if (TELEMETRY_TARGET.key === "") {
        io.out("telemetry is not configured for this build (no PostHog project key); nothing will be sent");
        return 1;
      }
      const settings = optIn(env);
      io.out(`telemetry on: installation id ${settings.id}, kept in ${settingsPath(env)}`);
      for (const line of WHAT) io.out(line);
      const state = telemetryState(root, env);
      if (!state.on) io.out(`but nothing is sent from here: ${state.reason}`);
      return 0;
    }
    case "off":
      optOut(env);
      io.out(`telemetry off: the installation id is forgotten and the queue dropped (${settingsPath(env)})`);
      return 0;
    case "reset-id": {
      const settings = resetId(env);
      io.out(settings.enabled ? `new installation id ${settings.id}; what was queued under the old one is dropped` : `new installation id ${settings.id}; telemetry is off, so nothing is sent until coherence telemetry on`);
      return 0;
    }
    case "status": {
      const state = telemetryState(root, env);
      io.out(`telemetry: ${state.reason}`);
      io.out(`  your choice: ${state.settings.enabled ? "on" : "off"} (${settingsPath(env)})`);
      if (state.settings.id !== undefined && state.settings.enabled) io.out(`  installation id: ${state.settings.id}`);
      io.out(`  queued: ${readQueue(env).length} event(s) (${queuePath(env)}); coherence telemetry show prints them`);
      io.out(`  sent to: ${TELEMETRY_TARGET.host}/batch/`);
      io.out(`  refused always by DO_NOT_TRACK=1, COHERENCE_TELEMETRY=0, or a project's "telemetry": false`);
      return 0;
    }
    case "show": {
      const events = readQueue(env);
      io.out(JSON.stringify(batchBody(events), null, 2));
      const waiting = pendingSessions(root, undefined, env).length;
      if (waiting > 0) io.err(`and ${waiting} session(s) of this project that are over wait to be summarized at the next session start`);
      return 0;
    }
    case "flush": {
      // Internal: started detached by a session start or a stop; sends what is queued, then summarizes the sessions that are over for the next flush.
      const at = flagValue(rest, "root") ?? root;
      const given = flagValue(rest, "host");
      const host = given !== undefined && (HOSTS as readonly string[]).includes(given) ? (given as (typeof HOSTS)[number]) : "unknown";
      await flushQueue(env, send);
      if (rest.includes("--collect")) collectSessions(at, flagValue(rest, "current"), host, env);
      return 0;
    }
    default:
      io.err(`usage:\n${TELEMETRY_USAGE}`);
      return 64;
  }
}
