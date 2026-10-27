/**
 * Coherence's folder in the user's configuration: $XDG_CONFIG_HOME/coherence,
 * else ~/.config/coherence. The update check, telemetry and the parse store's
 * machine key keep their files there, never in a project.
 */

import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

export function userConfigDir(env: Record<string, string | undefined> = process.env): string {
  // A relative XDG_CONFIG_HOME is invalid by the XDG base directory spec and is ignored: it would put the machine key in whatever folder a process starts in.
  const xdg = env["XDG_CONFIG_HOME"];
  const base = xdg !== undefined && isAbsolute(xdg) ? xdg : join(env["HOME"] ?? homedir(), ".config");
  return join(base, "coherence");
}
