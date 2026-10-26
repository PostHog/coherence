/**
 * Coherence's folder in the user's configuration: $XDG_CONFIG_HOME/coherence,
 * else ~/.config/coherence. The update check, telemetry and the parse store's
 * machine key keep their files there, never in a project.
 */

import { homedir } from "node:os";
import { join } from "node:path";

export function userConfigDir(env: Record<string, string | undefined> = process.env): string {
  const xdg = env["XDG_CONFIG_HOME"];
  const base = xdg !== undefined && xdg !== "" ? xdg : join(env["HOME"] ?? homedir(), ".config");
  return join(base, "coherence");
}
