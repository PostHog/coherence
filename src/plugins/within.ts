/**
 * Whether a path a plugin's config or an eject names lands inside the
 * project once symbolic links are followed: a folder named inside the
 * project that is a link to one outside it would otherwise carry a plugin's
 * code, or an eject's writes, out of it.
 */

import { lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

/**
 * Where `path` lands on disk: the real path of its nearest existing ancestor
 * with the rest appended; a link on the way that leads nowhere is named,
 * since what it would land on cannot be said.
 */
export function landing(path: string): { real: string } | { dangling: string } {
  const rest: string[] = [];
  for (let at = resolve(path); ; at = dirname(at)) {
    try {
      return { real: join(realpathSync(at), ...rest.reverse()) };
    } catch {
      let present = false;
      try {
        lstatSync(at);
        present = true;
      } catch {
        // Absent: its parent is asked.
      }
      if (present) return { dangling: at };
      if (dirname(at) === at) return { real: resolve(path) };
      rest.push(at.slice(dirname(at).length).replace(/^[\\/]/, ""));
    }
  }
}

/** Whether `path` lands inside `root` (or is it), symlinks followed on both; undefined when a link on the way leads nowhere. */
export function landsWithin(root: string, path: string): boolean | undefined {
  const top = landing(root);
  const at = landing(path);
  if ("dangling" in at || "dangling" in top) return undefined;
  const from = relative(top.real, at.real);
  return from === "" || (!from.startsWith("..") && !isAbsolute(from));
}
