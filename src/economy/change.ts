/**
 * The working change, read from git: the paths an economy of the change
 * starts from when the caller names none.
 *
 *   staged      the index against HEAD (`git diff --cached`)
 *   unstaged    the working tree against the index (`git diff`)
 *   untracked   files git would add, not ignored (`git ls-files --others --exclude-standard`)
 *   since       everything from the merge base of <ref> and HEAD to the working
 *               tree (`git diff <base>`): with an ancestor commit the base is the
 *               commit itself; with a branch such as main it is where this side
 *               left it, so the whole change set of the branch counts
 *
 * Only project files count, by the one rule in adapters/project-files.ts: a
 * path on disk is kept through keepProjectFiles; a deleted path, which the
 * index may no longer hold, was tracked (git reported it from a diff) and is
 * kept unless it lies inside one of the rule's nested checkouts. A rename
 * counts as its new path, noting the old. Nothing is stored; the reading is
 * sorted by path and every path's sources are in one fixed order.
 */

import { spawnSync } from "node:child_process";
import { lstatSync } from "node:fs";
import { resolve } from "node:path";
import { keepProjectFiles, nestedCheckouts } from "../adapters/project-files.ts";

export type ChangeSource = "staged" | "unstaged" | "untracked" | "since";
export const CHANGE_SOURCES: readonly ChangeSource[] = ["staged", "unstaged", "untracked", "since"];

export type ChangeState = "added" | "modified" | "deleted" | "renamed";

export interface ChangedPath {
  /** Project-relative, forward slashes; for a rename, the new path. */
  path: string;
  state: ChangeState;
  /** The old path of a rename. */
  from?: string;
  /** Which readings of git reported it, in CHANGE_SOURCES order. */
  sources: ChangeSource[];
}

export interface WorkingChange {
  /** The --since reading, when asked: the ref as given and the merge base it resolved to. */
  since: { ref: string; base: string } | null;
  /** Every changed project file, sorted by path. */
  paths: ChangedPath[];
}

export class ChangeError extends Error {}

/** Variables a git hook sets that would point git at another index or repository than the root's own. */
const GIT_LOCATION_VARIABLES = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_COMMON_DIR", "GIT_PREFIX", "GIT_NAMESPACE"];
const GIT_OUTPUT_LIMIT = 256 * 1024 * 1024;

function git(root: string, args: readonly string[]): { ok: boolean; stdout: string; reason: string } {
  const env = { ...process.env };
  for (const name of GIT_LOCATION_VARIABLES) delete env[name];
  const result = spawnSync("git", ["-c", "core.quotepath=off", ...args], { cwd: root, encoding: "utf8", env, maxBuffer: GIT_OUTPUT_LIMIT });
  const reason = (result.stderr ?? "").trim() || (result.error?.message ?? `exit ${result.status}`);
  return { ok: result.status === 0, stdout: result.stdout ?? "", reason };
}

function mustGit(root: string, args: readonly string[], what: string): string {
  const result = git(root, args);
  if (!result.ok) throw new ChangeError(`the working change is not known: ${what} failed in ${root}: ${result.reason}`);
  return result.stdout;
}

interface DiffEntry {
  letter: string;
  path: string;
  from?: string;
}

/** `git diff --name-status -z` output: a status, then one path, or two for a rename or copy. */
function parseNameStatus(text: string): DiffEntry[] {
  const fields = text.split("\0").filter((f) => f !== "");
  const entries: DiffEntry[] = [];
  for (let i = 0; i < fields.length; ) {
    const letter = fields[i]!.charAt(0);
    if (letter === "R" || letter === "C") {
      const from = fields[i + 1]!;
      const path = fields[i + 2]!;
      entries.push(letter === "R" ? { letter, path, from } : { letter: "A", path });
      i += 3;
    } else {
      entries.push({ letter, path: fields[i + 1]! });
      i += 2;
    }
  }
  return entries;
}

function diff(root: string, args: readonly string[]): DiffEntry[] {
  return parseNameStatus(mustGit(root, ["diff", "--name-status", "-z", "-M", "--relative", "--no-color", "--no-ext-diff", ...args], `git diff ${args.join(" ")}`.trim()));
}

function onDisk(root: string, rel: string): boolean {
  try {
    return !lstatSync(resolve(root, rel)).isDirectory();
  } catch {
    return false;
  }
}

/** The merge base of the ref and HEAD: the ref itself when it is an ancestor, where this side left it otherwise. */
function mergeBase(root: string, ref: string): string {
  if (ref === "" || ref.startsWith("-")) throw new ChangeError(`--since takes a commit or a branch, not "${ref}"`);
  const commit = git(root, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`]);
  if (!commit.ok) throw new ChangeError(`--since ${ref}: not a commit in ${root}`);
  const base = git(root, ["merge-base", commit.stdout.trim(), "HEAD"]);
  if (!base.ok) throw new ChangeError(`--since ${ref}: no merge base with HEAD${base.reason.startsWith("exit ") ? " (unrelated histories)" : ` (${base.reason})`}`);
  return base.stdout.trim();
}

interface Gathered {
  sources: Set<ChangeSource>;
  letters: Map<ChangeSource, DiffEntry>;
}

/** The working change of the repository at root: staged, unstaged, untracked, and, when asked, everything since the merge base of `since` and HEAD. */
export function workingChange(rootGiven: string, options: { since?: string | undefined } = {}): WorkingChange {
  const root = resolve(rootGiven);
  const inside = git(root, ["rev-parse", "--is-inside-work-tree"]);
  if (!inside.ok || inside.stdout.trim() !== "true") throw new ChangeError(`the working change needs a git repository: ${root} is not inside one`);

  const since = options.since === undefined ? null : { ref: options.since, base: mergeBase(root, options.since) };
  const gathered = new Map<string, Gathered>();
  const note = (source: ChangeSource, entry: DiffEntry): void => {
    const g = gathered.get(entry.path) ?? { sources: new Set<ChangeSource>(), letters: new Map<ChangeSource, DiffEntry>() };
    g.sources.add(source);
    g.letters.set(source, entry);
    gathered.set(entry.path, g);
  };
  // An unborn HEAD has nothing to compare the index with but the empty tree, which --cached alone uses.
  for (const entry of diff(root, ["--cached"])) note("staged", entry);
  for (const entry of diff(root, [])) note("unstaged", entry);
  for (const path of mustGit(root, ["ls-files", "--others", "--exclude-standard", "-z"], "git ls-files --others").split("\0")) {
    if (path !== "" && !path.endsWith("/")) note("untracked", { letter: "?", path });
  }
  if (since !== null) for (const entry of diff(root, [since.base])) note("since", entry);

  const renamedFrom = new Set<string>();
  const shaped: ChangedPath[] = [];
  for (const [path, g] of gathered) {
    const sources = CHANGE_SOURCES.filter((s) => g.sources.has(s));
    // The widest reading speaks for the path: since spans the others, staged precedes unstaged.
    const letters = (["since", "staged", "unstaged"] as const).map((s) => g.letters.get(s)).filter((e): e is DiffEntry => e !== undefined);
    const rename = letters.find((e) => e.letter === "R");
    let state: ChangeState;
    if (!onDisk(root, path)) state = "deleted";
    else if (rename !== undefined) state = "renamed";
    else if (g.sources.has("untracked") || letters[0]?.letter === "A") state = "added";
    else state = "modified";
    const changed: ChangedPath = { path, state, sources };
    if (state === "renamed") {
      changed.from = rename!.from!;
      renamedFrom.add(rename!.from!);
    }
    shaped.push(changed);
  }

  // The old side of a rename is noted on the new path, not listed again as a deletion.
  const candidates = shaped.filter((c) => !(c.state === "deleted" && renamedFrom.has(c.path)));
  const present = keepProjectFiles(root, candidates.filter((c) => c.state !== "deleted").map((c) => c.path));
  const deleted = candidates.filter((c) => c.state === "deleted");
  const nested = deleted.length === 0 ? [] : nestedCheckouts(root);
  const keptDeleted = new Set(deleted.filter((c) => !nested.some((n) => c.path.startsWith(n + "/")) && !c.path.split("/").includes(".git")).map((c) => c.path));
  const paths = candidates.filter((c) => (c.state === "deleted" ? keptDeleted.has(c.path) : present.has(c.path)));
  paths.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { since, paths };
}

/** One line per changed path, for the printed economy. */
export function describeChanged(change: ChangedPath): string {
  const how = change.sources.join(", ");
  if (change.state === "renamed") return `${change.path}  renamed from ${change.from} (${how})`;
  return `${change.path}  ${change.state} (${how})`;
}
