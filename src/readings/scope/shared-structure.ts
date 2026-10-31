import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "../../lifecycle/work-meter.ts";

const sharedByRoot = new Map<string, string | undefined>();

/** The folder every git worktree of `root`'s repository shares for Structure state, inside git's common dir; undefined outside a repository. */
export function sharedStructureDir(root: string): string | undefined {
  if (sharedByRoot.has(root)) return sharedByRoot.get(root);
  const common = spawnSync("git", ["-C", root, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" });
  const commonDir = common.status === 0 ? common.stdout.trim() : "";
  const shared = commonDir === "" ? undefined : join(commonDir, "coherence", "structure");
  sharedByRoot.set(root, shared);
  return shared;
}

/** Write `text` to `path` whole or not at all: a reader never sees half a file. */
export function writeAtomically(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, text, "utf8");
  renameSync(temporary, path);
}
