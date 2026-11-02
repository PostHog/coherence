import { randomBytes } from "node:crypto";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gitEnvironment, gitPlaceOf } from "../../adapters/project-config.ts";
import { spawnSync } from "../../lifecycle/work-meter.ts";

/** The folder every git worktree of a repository shares for Structure state, and the project's folder within the repository that names what it keeps there. */
export interface SharedStructure {
  dir: string;
  /** The project root's folder below the checkout's top: "" at the top, else ending in "/". */
  prefix: string;
}

const sharedByRoot = new Map<string, SharedStructure | undefined>();

/**
 * The folder every git worktree of `root`'s repository shares for Structure
 * state, inside git's common folder; undefined outside a repository, and
 * undefined where `root` is no folder the repository tracks (an untracked or
 * ignored folder inside some other checkout), so nothing of the project is
 * ever written into a repository it is not part of.
 */
export function sharedStructureDir(root: string): SharedStructure | undefined {
  if (sharedByRoot.has(root)) return sharedByRoot.get(root);
  const place = gitPlaceOf(root);
  let shared: SharedStructure | undefined;
  if (place !== undefined && (place.prefix === "" || tracked(root))) shared = { dir: join(place.common, "coherence", "structure"), prefix: place.prefix };
  sharedByRoot.set(root, shared);
  return shared;
}

/** Whether the commit checked out holds `root`'s folder: one the repository tracks, not a folder that only lies inside its checkout. */
function tracked(root: string): boolean {
  return spawnSync("git", ["rev-parse", "--quiet", "--verify", "HEAD:./"], { cwd: root, env: gitEnvironment(), stdio: "ignore" }).status === 0;
}

/** Write `text` to `path` whole or not at all: a reader never sees half a file, and two writers never share a temporary file. */
export function writeAtomically(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    writeFileSync(temporary, text, "utf8");
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}
