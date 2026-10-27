/**
 * Coherence's folder in the user's configuration: $XDG_CONFIG_HOME/coherence,
 * else ~/.config/coherence. The update check, telemetry and the parse store's
 * machine key keep their files there, never in a project. Always an absolute
 * path: a relative one would land in whatever folder a process starts in.
 */

import { homedir, tmpdir, userInfo } from "node:os";
import { isAbsolute, join } from "node:path";

/** Where the user's home is asked for beyond HOME: the account's entry in the user database, and Node's own answer. */
export interface HomeSources {
  account(): string;
  home(): string;
}

const SYSTEM: HomeSources = { account: () => userInfo().homedir, home: homedir };

/**
 * Coherence's folder in the user's cache: $XDG_CACHE_HOME/coherence where it
 * is absolute, else ~/.cache/coherence under the same absolute home. What is
 * kept there (parses) can be made again, and lives outside every project.
 */
export function userCacheDir(env: Record<string, string | undefined> = process.env, sources: HomeSources = SYSTEM): string {
  const xdg = env["XDG_CACHE_HOME"];
  if (xdg !== undefined && isAbsolute(xdg)) return join(xdg, "coherence");
  return join(homeOf(env, sources), ".cache", "coherence");
}

export function userConfigDir(env: Record<string, string | undefined> = process.env, sources: HomeSources = SYSTEM): string {
  // A relative XDG_CONFIG_HOME is invalid by the XDG base directory spec and is ignored.
  const xdg = env["XDG_CONFIG_HOME"];
  if (xdg !== undefined && isAbsolute(xdg)) return join(xdg, "coherence");
  return join(homeOf(env, sources), ".config", "coherence");
}

/**
 * The user's home as an absolute path: HOME where it is one, else the
 * account's own, else Node's answer, else a folder named for the user in the
 * system's temporary folder. That last one another user could make first,
 * so what is kept there is trusted only as far as it is this user's alone
 * (the parse store's machine key: ownKey in src/plugins/syntax-trees.ts).
 */
function homeOf(env: Record<string, string | undefined>, sources: HomeSources): string {
  const asked = (source: () => string): string | undefined => {
    try {
      return source();
    } catch {
      // No account entry (a container's bare uid), or no home at all: the next candidate.
      return undefined;
    }
  };
  for (const home of [env["HOME"], asked(sources.account), asked(sources.home)]) if (home !== undefined && isAbsolute(home)) return home;
  return join(tmpdir(), `coherence-home-${process.getuid?.() ?? "user"}`);
}
