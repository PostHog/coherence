/**
 * The relief reading: what Scope's Structure view draws that the rest of the
 * state does not already hold. Per component, its files with their lines and
 * whether an enforcement reaches them (from mass), and its defect records; the
 * folders with no spec inside a component that holds others, each a district
 * of its own; and the landings on HEAD's first-parent line, each with the lines
 * it changed per component and per file. Invariants, crossings, refutations and
 * reliance come from the spec and the component interfaces the state carries.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { computeMass } from "../../economy/mass.ts";
import { LOCKFILES } from "../../lifecycle/lockfiles.ts";
import type { JournalRecord } from "../../journal/record.ts";
import { loadSpecModel, type SpecModel } from "../../spec/model.ts";

export interface ReliefFile {
  file: string;
  lines: number;
  /** How many invariants reach it; 0 is unreached. */
  reached: number;
}

export interface ReliefComponent {
  folder: string;
  /** The spec's name, or for a district its folder below the component that holds it, ending in a slash. */
  name: string;
  /** A folder with no spec inside a component that holds other components: unclaimed land, drawn as a district. */
  district?: true;
  files: ReliefFile[];
  lines: number;
  unreached: number;
  defects: number;
}

/** One first-parent commit: per component [index, lines changed], per file [component, file, lines changed]. */
export interface ReliefLanding {
  sha: string;
  date: string;
  subject: string;
  /** Files it touched, lockfiles and .coherence/ left out. */
  n: number;
  c: [number, number][];
  f: [number, number, number][];
}

export type ReliefReading =
  | { kind: "read"; components: ReliefComponent[]; landings: ReliefLanding[]; head: string; leftOut: string[] }
  | { kind: "unread"; because: string };

/** The most landings a reading carries, newest first: the first load is bounded, and a busy repository lands hundreds a day. */
export const LANDINGS_MAX = 1500;

/** A folder must hold this many code files before it stands as a district: the threshold mass names a folder by. */
const DISTRICT_FILES = 3;

// Lockfiles churn with every dependency bump and say nothing about the code: the ones Coherence recognizes are left out.
const LOCKFILE_NAMES = new Set(LOCKFILES.map(([file]) => file));
const leftOut = (path: string): boolean => path.startsWith(".coherence/") || path.includes("/.coherence/") || LOCKFILE_NAMES.has(path.slice(path.lastIndexOf("/") + 1));

/** The folder a path belongs to: the deepest of the given folders holding it, "." holding everything. */
function ownerIn(folders: readonly string[], path: string): string {
  let best = ".";
  for (const folder of folders) if (folder !== "." && (path === folder || path.startsWith(folder + "/")) && folder.length > best.length) best = folder;
  return best;
}

/**
 * A container's own files split by the folder below it that holds them. A
 * folder holding most of the container's own lines is opened into its
 * subfolders, so frontend/src is never one district holding nearly everything;
 * files loose in an opened folder stay with the container.
 */
export function districtsOf(folder: string, files: readonly ReliefFile[]): Map<string, ReliefFile[]> {
  const base = folder === "." ? "" : folder + "/";
  const total = files.reduce((n, f) => n + f.lines, 0) || 1;
  const split = (prefix: string, among: readonly ReliefFile[]): Map<string, ReliefFile[]> => {
    const groups = new Map<string, ReliefFile[]>();
    for (const f of among) {
      const rest = f.file.slice(prefix.length);
      const slash = rest.indexOf("/");
      if (slash < 0) continue;
      const key = prefix + rest.slice(0, slash);
      groups.set(key, [...(groups.get(key) ?? []), f]);
    }
    return groups;
  };
  const out = new Map<string, ReliefFile[]>();
  const todo = [...split(base, files)];
  while (todo.length > 0) {
    const [sub, held] = todo.pop()!;
    const lines = held.reduce((n, f) => n + f.lines, 0);
    const inner = split(sub + "/", held);
    if (lines > 0.75 * total && inner.size >= 2) todo.push(...inner);
    else if (held.length >= DISTRICT_FILES) out.set(sub, held);
  }
  return new Map([...out].sort(([a], [b]) => a.localeCompare(b)));
}

/** numstat's path for a rename, either form, as the path it now has. */
function renamedPath(path: string): string {
  const brace = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(path);
  if (brace) return (brace[1]! + brace[3]! + brace[4]!).replace(/\/\//g, "/");
  return path.includes(" => ") ? path.split(" => ")[1]! : path;
}

const git = (root: string, ...args: string[]): string => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 512 << 20, stdio: ["ignore", "pipe", "ignore"] });

export function readRelief(rootGiven: string, journal: readonly JournalRecord[], given?: SpecModel): ReliefReading {
  const root = resolve(rootGiven);
  let mass;
  let model: SpecModel;
  try {
    model = given ?? loadSpecModel(root);
    mass = computeMass(root, { model });
  } catch (error) {
    return { kind: "unread", because: `mass could not be read: ${(error as Error).message}` };
  }
  const specced = [...new Set([".", ...model.components.map((c) => c.folder)])].sort();
  const files = new Map<string, ReliefFile[]>(specced.map((f) => [f, []]));
  for (const f of mass.files) files.get(ownerIn(specced, f.file))!.push({ file: f.file, lines: f.lines, reached: f.reachedBy.length });

  // A component holding others gives up its own files' folders as districts; a leaf's subfolders are its spec's to claim.
  const holdsOthers = (folder: string) => specced.some((o) => o !== folder && (folder === "." || o.startsWith(folder + "/")));
  const districts = new Map<string, { of: string; files: ReliefFile[] }>();
  for (const folder of specced.filter(holdsOthers)) {
    const groups = districtsOf(folder, files.get(folder)!);
    if (groups.size < 2) continue; // one district would only be the component again
    const moved = new Set<string>();
    for (const [sub, held] of groups) {
      districts.set(sub, { of: folder, files: held });
      for (const f of held) moved.add(f.file);
    }
    files.set(folder, files.get(folder)!.filter((f) => !moved.has(f.file)));
  }

  const name = new Map(model.components.map((c) => [c.folder, c.name]));
  const folders = [...specced, ...districts.keys()].sort();
  const components: ReliefComponent[] = folders.map((folder) => {
    const district = districts.get(folder);
    const held = (district?.files ?? files.get(folder)!).slice().sort((a, b) => b.lines - a.lines || a.file.localeCompare(b.file));
    return {
      folder,
      name: district ? folder.slice(district.of === "." ? 0 : district.of.length + 1) + "/" : (name.get(folder) ?? (folder === "." ? "root" : folder)),
      ...(district ? { district: true as const } : {}),
      files: held,
      lines: held.reduce((n, f) => n + f.lines, 0),
      unreached: held.reduce((n, f) => n + (f.reached ? 0 : f.lines), 0),
      defects: 0,
    };
  });
  const index = new Map(folders.map((f, i) => [f, i]));
  const districtFolders = [...districts.keys()];
  // A path belongs to its deepest component, then within it to the district whose folder holds it, tests and all.
  const owner = (path: string): number => {
    const own = ownerIn(specced, path);
    const district = districtFolders.find((d) => path.startsWith(d + "/") && districts.get(d)!.of === own);
    return index.get(district ?? own)!;
  };
  for (const record of journal) if (record.kind === "defect") for (const ci of new Set(record.files.map(owner))) components[ci]!.defects++;

  const at = new Map<string, [number, number]>();
  components.forEach((c, ci) => c.files.forEach((f, fi) => at.set(f.file, [ci, fi])));
  let landings: ReliefLanding[] = [];
  let head = "";
  try {
    head = git(root, "log", "-1", "--format=%h %ad", "--date=short").trim();
    const out = git(root, "log", "--first-parent", "--diff-merges=first-parent", "--numstat", "--format=@@%h%x09%ad%x09%s", "--date=short", "-n", String(LANDINGS_MAX), "HEAD");
    for (const chunk of out.split("@@").slice(1)) {
      const [first, ...rest] = chunk.split("\n");
      const [sha = "", date = "", subject = ""] = first!.split("\t");
      const perComponent = new Map<number, number>();
      const perFile: [number, number, number][] = [];
      let n = 0;
      for (const line of rest) {
        const parts = line.split("\t");
        if (parts.length < 3 || parts[0] === "-") continue;
        const path = renamedPath(parts.slice(2).join("\t"));
        if (leftOut(path)) continue;
        const changed = Number(parts[0]) + Number(parts[1]);
        n++;
        const ci = owner(path);
        perComponent.set(ci, (perComponent.get(ci) ?? 0) + changed);
        const hit = at.get(path);
        if (hit) perFile.push([hit[0], hit[1], changed]);
      }
      if (perComponent.size > 0) landings.push({ sha, date, subject, n, c: [...perComponent], f: perFile });
    }
  } catch {
    landings = []; // not a git checkout, or no history: heights are flat and the view says so
  }
  return { kind: "read", components, landings, head, leftOut: [".coherence/", ...[...LOCKFILE_NAMES].sort()] };
}

/* ---------------------------------------------------------- diffs, for the live page */

/** The working tree, as the later end of a diff. */
export const WORKTREE = "WORKTREE";
/** A commit a diff may name: an abbreviated or full object name, nothing a shell or git could read as an option. */
export const REVISION = /^[0-9a-f]{4,40}$/;

export interface ReliefCommit {
  rev: string;
  sha: string;
  date: string;
  subject: string;
  on: string;
  tag: string | null;
}

/** numstat's lines as path → [added, deleted]; a rename counts under its new path, binary files and left-out paths not at all. */
function numstat(out: string): Map<string, [number, number]> {
  const changed = new Map<string, [number, number]>();
  for (const line of out.split("\n")) {
    const parts = line.split("\t");
    if (parts.length < 3 || parts[0] === "-") continue;
    const path = renamedPath(parts.slice(2).join("\t"));
    if (leftOut(path)) continue;
    const [a, d] = changed.get(path) ?? [0, 0];
    changed.set(path, [a + Number(parts[0]), d + Number(parts[1])]);
  }
  return changed;
}

/** Untracked files not ignored, each as lines added: the working tree's new files, which git diff does not list. */
function untracked(root: string): Map<string, [number, number]> {
  const found = new Map<string, [number, number]>();
  for (const path of git(root, "ls-files", "--others", "--exclude-standard").split("\n").filter(Boolean)) {
    if (leftOut(path)) continue;
    try {
      const text = readFileSync(resolve(root, path), "utf8");
      if (!text.includes("\0")) found.set(path, [text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0), 0]);
    } catch {
      // unreadable: not counted
    }
  }
  return found;
}

/** The trunk a branch is measured from: main, or master where there is no main. */
function trunk(root: string): string {
  try {
    git(root, "rev-parse", "--verify", "-q", "main");
    return "main";
  } catch {
    return "master";
  }
}

/** The commits a reader can diff between: this branch's own, then the trunk's recent first-parent line, each with its tag. */
export function reliefCommits(rootGiven: string): { branch: string; base: string; worktree: ReliefCommit; list: ReliefCommit[] } {
  const root = resolve(rootGiven);
  const tags = new Map<string, string>();
  for (const line of git(root, "tag", "--format=%(objectname:short=7)%09%(*objectname:short=7)%09%(refname:short)").split("\n").filter(Boolean)) {
    const [obj = "", peeled = "", name = ""] = line.split("\t");
    tags.set(peeled || obj, name);
  }
  const branch = git(root, "rev-parse", "--abbrev-ref", "HEAD").trim();
  const t = trunk(root);
  let base = "";
  try {
    base = git(root, "merge-base", t, "HEAD").trim().slice(0, 7);
  } catch {
    base = git(root, "rev-parse", "--short=7", "HEAD").trim();
  }
  const rows = (range: string, on: string, ...extra: string[]): ReliefCommit[] =>
    git(root, "log", "--first-parent", "--format=%h%x09%ad%x09%s", "--date=short", "--abbrev=7", ...extra, range)
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [sha = "", date = "", subject = ""] = line.split("\t");
        return { rev: sha, sha, date, subject, on, tag: tags.get(sha) ?? null };
      });
  const mine = branch === t ? [] : rows(`${t}..HEAD`, branch);
  return { branch, base, worktree: { rev: WORKTREE, sha: "working tree", date: "", subject: `uncommitted work on ${branch}`, on: branch, tag: null }, list: [...mine, ...rows(t, t, "-n", "150")] };
}

function described(root: string, rev: string): { rev: string; sha: string; date: string; subject: string } {
  if (rev === WORKTREE) {
    const head = git(root, "log", "-1", "--format=%h").trim();
    return { rev, sha: "working tree", date: new Date().toISOString().slice(0, 10), subject: `uncommitted work on top of ${head}` };
  }
  const [sha = "", date = "", subject = ""] = git(root, "log", "-1", "--format=%h%x09%ad%x09%s", "--date=short", rev).trim().split("\t");
  return { rev, sha, date, subject };
}

/** Lines per file at a revision, or in the working tree: the empty tree diffed against it. */
function linesAt(root: string, rev: string): Map<string, number> {
  const EMPTY = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
  const changed = rev === WORKTREE ? numstat(git(root, "diff", "--numstat", EMPTY)) : numstat(git(root, "diff", "--numstat", EMPTY, rev));
  if (rev === WORKTREE) for (const [path, v] of untracked(root)) changed.set(path, v);
  return new Map([...changed].map(([path, [added]]) => [path, added]));
}

/**
 * What changed between two revisions, the later one possibly the working
 * tree: per path its lines at each end and the lines added and deleted. Both
 * ends are checked before git sees them; a name that is not a commit is
 * refused, never passed on.
 */
export function reliefDiff(rootGiven: string, a: string, b: string): { a: ReturnType<typeof described>; b: ReturnType<typeof described>; files: { path: string; la: number; lb: number; add: number; del: number }[] } {
  if (!REVISION.test(a) || !(REVISION.test(b) || b === WORKTREE)) throw new Error("a and b must be commit ids (b may be WORKTREE)");
  const root = resolve(rootGiven);
  const la = linesAt(root, a), lb = linesAt(root, b);
  const changed = b === WORKTREE ? numstat(git(root, "diff", "--numstat", "-M", a)) : numstat(git(root, "diff", "--numstat", "-M", a, b));
  if (b === WORKTREE) for (const [path, v] of untracked(root)) if (!changed.has(path)) changed.set(path, v);
  const files = [...new Set([...la.keys(), ...lb.keys(), ...changed.keys()])].map((path) => {
    const [add, del] = changed.get(path) ?? [0, 0];
    return { path, la: la.get(path) ?? 0, lb: lb.get(path) ?? 0, add, del };
  });
  return { a: described(root, a), b: described(root, b), files };
}

/* ---------------------------------------------------------- agent activity */

/** One file or files a session touched, as a trace line records it: what the Structure view lights. */
export interface Touch {
  kind: "read" | "write";
  files: string[];
  session: string;
  at: string;
}

/**
 * The touches in text appended to a read trace, and how much of it was whole
 * lines: a line still being written is left for the next look, a damaged line
 * lights nothing, and a snapshot is no touch.
 */
export function touchesOf(appended: string): { touches: Touch[]; consumed: number } {
  const complete = appended.lastIndexOf("\n") + 1;
  const touches: Touch[] = [];
  for (const line of appended.slice(0, complete).split("\n")) {
    if (line.trim() === "") continue;
    try {
      const record = JSON.parse(line) as { kind?: string; file?: unknown; files?: unknown; session?: unknown; at?: unknown };
      const session = typeof record.session === "string" ? record.session : "", at = typeof record.at === "string" ? record.at : "";
      if (record.kind === "read" && typeof record.file === "string") touches.push({ kind: "read", files: [record.file], session, at });
      else if (record.kind === "write" && Array.isArray(record.files)) touches.push({ kind: "write", files: record.files.filter((f): f is string => typeof f === "string"), session, at });
    } catch {
      // a damaged line lights nothing
    }
  }
  return { touches, consumed: Buffer.byteLength(appended.slice(0, complete)) };
}
