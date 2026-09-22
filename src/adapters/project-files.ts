/**
 * The project's own files: the one rule for what may ever be evidence.
 *
 * A file belongs to the project when git would call it the project's — it
 * is tracked, or untracked and not ignored (`git ls-files --cached --others
 * --exclude-standard`) — and it does not lie inside a nested checkout: a
 * folder below the root holding a `.git` file or folder, which is another
 * repository or another worktree of this one (an agent's copy under
 * `.claude/worktrees/`, a vendored clone, a submodule). Git alone does not
 * settle the second half: a `.git` file whose gitdir it cannot follow makes
 * the folder read as ordinary untracked files, so the nesting is checked on
 * disk as well. Outside a repository there are no ignore rules to read, so
 * every file under the root that no nested checkout holds belongs, except
 * under node_modules, the one dependency folder assumed ignored everywhere.
 *
 * Every walk of the project and every reference an instrument reports goes
 * through this rule: a copy of a file in an agent's worktree is someone
 * else's working state, and a reference found there is not a reference in
 * this project, so it is never a bypass, never vocabulary, never mass.
 */

import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

/** The most bytes one git listing may carry; a larger project is a failure worth reporting, not a truncated answer. */
const GIT_LISTING_LIMIT = 256 * 1024 * 1024;
/** Pathspecs per git call when asking about named files. */
const PATHSPEC_BATCH = 400;

const repositoryCache = new Map<string, boolean>();

/** Whether git answers for the root: a repository's work tree, at its top or below it. */
function inRepository(root: string): boolean {
  const cached = repositoryCache.get(root);
  if (cached !== undefined) return cached;
  const probe = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: root, encoding: "utf8" });
  const answer = probe.status === 0 && probe.stdout.trim() === "true";
  repositoryCache.set(root, answer);
  return answer;
}

/** A path as project-relative with forward slashes, or undefined when it is the root or lies outside it. */
function projectRelative(root: string, path: string): string | undefined {
  const absolute = isAbsolute(path) ? path : resolve(root, path);
  const rel = relative(root, absolute).split(sep).join("/");
  if (rel === "" || rel === ".." || rel.startsWith("../") || isAbsolute(rel)) return undefined;
  return rel;
}

/** Whether the folder (project-relative, "" for the root) is the top of a checkout of its own. */
function holdsCheckout(root: string, folder: string, memo: Map<string, boolean>): boolean {
  let answer = memo.get(folder);
  if (answer === undefined) {
    answer = folder !== "" && existsSync(join(root, folder, ".git"));
    memo.set(folder, answer);
  }
  return answer;
}

/** Whether a project-relative path lies inside a nested checkout: some folder strictly between the root and it holds a `.git`. */
function insideNested(root: string, rel: string, memo: Map<string, boolean>): boolean {
  const parts = rel.split("/");
  for (let i = 1; i < parts.length; i++) {
    if (holdsCheckout(root, parts.slice(0, i).join("/"), memo)) return true;
  }
  return false;
}

function isFileOnDisk(root: string, rel: string): boolean {
  try {
    return !lstatSync(join(root, rel)).isDirectory();
  } catch {
    return false;
  }
}

function isFolderOnDisk(root: string, rel: string): boolean {
  try {
    return lstatSync(join(root, rel)).isDirectory();
  } catch {
    return false;
  }
}

function gitList(root: string, pathspecs: readonly string[]): string[] {
  const args = ["--literal-pathspecs", "ls-files", "--cached", "--others", "--exclude-standard", "-z", ...(pathspecs.length === 0 ? [] : ["--", ...pathspecs])];
  const listed = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: GIT_LISTING_LIMIT });
  if (listed.status !== 0) {
    const reason = (listed.stderr ?? "").trim() || (listed.error?.message ?? `exit ${listed.status}`);
    throw new Error(`the project's files are not known: git ls-files failed in ${root}: ${reason}`);
  }
  // A nested repository git lists as one folder entry ("nested/"), never as files: not the project's.
  return listed.stdout.split("\0").filter((entry) => entry !== "" && !entry.endsWith("/"));
}

/** Outside a repository: every file under the root, never into a nested checkout, a `.git`, or node_modules. */
function walkUnversioned(root: string, memo: Map<string, boolean>): string[] {
  const found: string[] = [];
  const walk = (folder: string): void => {
    let entries;
    try {
      entries = readdirSync(join(root, folder), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const rel = folder === "" ? entry.name : `${folder}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!holdsCheckout(root, rel, memo)) walk(rel);
      } else {
        found.push(rel);
      }
    }
  };
  walk("");
  return found;
}

/**
 * Every file of the project under the root, project-relative with forward
 * slashes, sorted. The one enumeration every walk starts from; a walker may
 * narrow it (by extension, by folder) but never widen it.
 */
export function projectFiles(root: string): string[] {
  const base = resolve(root);
  const memo = new Map<string, boolean>();
  const listed = inRepository(base) ? gitList(base, []) : walkUnversioned(base, memo);
  return [...new Set(listed)].filter((rel) => !insideNested(base, rel, memo) && isFileOnDisk(base, rel)).sort();
}

/**
 * The given paths (absolute or project-relative) that are project files, as
 * project-relative paths with forward slashes. The same rule as
 * projectFiles, asked of a few paths at once: an instrument's reference
 * sites, a file an edit wrote. A tracked file an edit just deleted is still
 * the project's until the deletion is committed.
 */
export function keepProjectFiles(root: string, paths: readonly string[]): Set<string> {
  const base = resolve(root);
  const memo = new Map<string, boolean>();
  const candidates = [...new Set(paths.map((p) => projectRelative(base, p)).filter((rel): rel is string => rel !== undefined))].filter(
    (rel) => !insideNested(base, rel, memo) && !isFolderOnDisk(base, rel) && !rel.split("/").includes(".git"),
  );
  if (candidates.length === 0 || !inRepository(base)) {
    return new Set(inRepository(base) ? [] : candidates.filter((rel) => !rel.split("/").includes("node_modules")));
  }
  const kept = new Set<string>();
  for (let i = 0; i < candidates.length; i += PATHSPEC_BATCH) {
    for (const rel of gitList(base, candidates.slice(i, i + PATHSPEC_BATCH))) kept.add(rel);
  }
  return new Set(candidates.filter((rel) => kept.has(rel)));
}

/**
 * The reference sites that sit in the project's own files, in their order.
 * Every consumer of an instrument's references accepts sites through this,
 * whatever instrument answered: a warm server started before this rule
 * existed may still report a nested checkout's copy.
 */
export function projectSites<T extends { file: string }>(root: string, sites: readonly T[]): T[] {
  const own = keepProjectFiles(root, sites.map((site) => site.file));
  return sites.filter((site) => own.has(site.file));
}

/** Whether one path (absolute or project-relative) is a project file. */
export function isProjectFile(root: string, path: string): boolean {
  return keepProjectFiles(root, [path]).size === 1;
}

/**
 * The nested checkouts under the root, project-relative, outermost only: the
 * folders a language server must be told to leave out of its workspace.
 * node_modules and `.git` are never entered.
 */
export function nestedCheckouts(root: string): string[] {
  const base = resolve(root);
  const found: string[] = [];
  const walk = (folder: string): void => {
    let entries;
    try {
      entries = readdirSync(join(base, folder), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === ".git" || entry.name === "node_modules") continue;
      const rel = folder === "" ? entry.name : `${folder}/${entry.name}`;
      if (existsSync(join(base, rel, ".git"))) found.push(rel);
      else walk(rel);
    }
  };
  walk("");
  return found.sort();
}
