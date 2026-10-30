/**
 * The relief reading: what Scope's Structure view draws that the rest of the
 * state does not already hold. Per component, its totals and how many files it
 * holds, with the files themselves (their lines, whether an enforcement
 * reaches them, from mass, and the landings that changed each) kept aside by
 * folder for the live page to load on demand, so the first load never grows
 * with the code; the folders with no spec inside a component that holds
 * others, each a district of its own; and the landings on HEAD's first-parent
 * line, each with the lines it changed per component. Invariants, crossings,
 * refutations, reliance and open defects come from the spec, the component
 * interfaces and the journal the state carries, so none goes stale here as
 * they change.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Worker } from "node:worker_threads";
import { computeMass } from "../../economy/mass.ts";
import { LOCKFILES } from "../../lifecycle/lockfiles.ts";
import { loadSpecModel } from "../../spec/model.ts";

export interface ReliefFile {
  file: string;
  lines: number;
  /** How many invariants reach it; 0 is unreached. */
  reached: number;
}

/** A file as the page loads it: the landings that changed it as [index into the reading's landings, lines changed], absent when none did. */
export interface ReliefFileLanded extends ReliefFile {
  l?: [number, number][];
}

export interface ReliefComponent {
  folder: string;
  /** The spec's name, or for a district its folder below the component that holds it, ending in a slash. */
  name: string;
  /** A folder with no spec inside a component that holds other components: unclaimed land, drawn as a district. */
  district?: true;
  /** How many files it holds; the files themselves load by folder, never with the first load. */
  files: number;
  lines: number;
  unreached: number;
}

/** One first-parent commit: per component [index, lines changed]. What it changed per file rides with each file. */
export interface ReliefLanding {
  sha: string;
  date: string;
  subject: string;
  /** Files it touched, lockfiles and .coherence/ left out. */
  n: number;
  c: [number, number][];
}

export type ReliefReading =
  | {
      kind: "read";
      components: ReliefComponent[];
      landings: ReliefLanding[];
      head: string;
      leftOut: string[];
      /** A digest of everything read, files included: files a page fetched under another stamp belong to another reading. */
      stamp: string;
      /** A snapshot's files by folder, as many whole folders as SNAPSHOT_FILES_BYTES holds; a live first load carries none. */
      files?: Record<string, ReliefFileLanded[]>;
      /** How many folders holding files a snapshot left out of `files`. */
      filesLeftOut?: number;
    }
  | { kind: "unread"; because: string };

/** A relief as read: the reading the state carries, and each folder's files as the live page loads them, JSON text ready to send. */
export interface ReliefRead {
  reading: ReliefReading;
  files: ReadonlyMap<string, string>;
}

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

/** One path a commit or a diff changed, with the lines it added and deleted; git counts none for a binary file, which is null. */
export interface NumstatEntry {
  path: string;
  lines: [number, number] | null;
}

/**
 * Numstat entries read with -z from tokens[i] on, into `into`: each is
 * "added<TAB>deleted<TAB>path", or for a rename "added<TAB>deleted<TAB>" with
 * the old path and the new as tokens of their own, counted under the new one.
 * Stops at an empty token, which opens a log's next commit; returns where.
 */
function numstatFrom(tokens: readonly string[], i: number, into: NumstatEntry[]): number {
  while (i < tokens.length && tokens[i] !== "") {
    // A log puts a newline between a commit's header and its first entry.
    const entry = tokens[i]!.replace(/^\n/, "");
    i++;
    const first = entry.indexOf("\t"), second = entry.indexOf("\t", first + 1);
    if (first < 0 || second < 0) continue;
    let path = entry.slice(second + 1);
    if (path === "") {
      path = tokens[i + 1] ?? "";
      i += 2;
    }
    const added = entry.slice(0, first), deleted = entry.slice(first + 1, second);
    into.push({ path, lines: added === "-" ? null : [Number(added), Number(deleted)] });
  }
  return i;
}

/** `git diff --numstat -z` output as its entries. */
export function parseNumstat(out: string): NumstatEntry[] {
  const entries: NumstatEntry[] = [];
  const tokens = out.split("\0");
  for (let i = 0; i < tokens.length; i = numstatFrom(tokens, i, entries) + 1);
  return entries;
}

/** The format a landing is logged in, with -z: NUL before each field, the one byte no subject can hold. */
const LANDING_FORMAT = "%x00%h%x00%ad%x00%s";

/**
 * `git log -z --numstat --format=%x00%h%x00%ad%x00%s` as its commits, each
 * with the paths it changed. A commit opens at an empty token and its next
 * three are its id, date and subject, so a subject holding @@, a tab or
 * anything else git prints is read whole and never opens a commit of its own.
 */
export function parseLandings(out: string): { sha: string; date: string; subject: string; files: NumstatEntry[] }[] {
  const tokens = out.split("\0");
  const commits: { sha: string; date: string; subject: string; files: NumstatEntry[] }[] = [];
  let i = tokens.indexOf("");
  while (i >= 0 && i + 3 < tokens.length) {
    const files: NumstatEntry[] = [];
    commits.push({ sha: tokens[i + 1]!, date: tokens[i + 2]!, subject: tokens[i + 3]!, files });
    i = numstatFrom(tokens, i + 4, files);
  }
  return commits;
}

/** `git log -z --format=%h%x00%ad%x00%s` as its commits: three fields each, NUL between every one. */
export function parseCommitRows(out: string): { sha: string; date: string; subject: string }[] {
  const tokens = out.split("\0");
  const rows: { sha: string; date: string; subject: string }[] = [];
  for (let i = 0; i + 2 < tokens.length; i += 3) rows.push({ sha: tokens[i]!, date: tokens[i + 1]!, subject: tokens[i + 2]! });
  return rows;
}

/** The longest one git command may run for the relief, and the most it may print: a stuck or runaway git fails the reading, never the server. */
const GIT_TIMEOUT_MS = 60_000;
const GIT_BUFFER = 256 << 20;
const execGit = promisify(execFile);

// Asynchronous: the warm server that runs these also answers the agent's hooks, and one pass over a large repository takes seconds.
const git = async (root: string, ...args: string[]): Promise<string> =>
  (await execGit("git", args, { cwd: root, encoding: "utf8", maxBuffer: GIT_BUFFER, timeout: GIT_TIMEOUT_MS })).stdout;

/**
 * The relief, read in this thread. The spec model and mass are synchronous and
 * read every source file, seconds on a large project, so the warm server, which
 * also answers the agent's hooks, reads it apart (readReliefApart).
 */
export async function readRelief(rootGiven: string): Promise<ReliefRead> {
  const root = resolve(rootGiven);
  let mass;
  let model;
  try {
    model = loadSpecModel(root);
    mass = computeMass(root, { model });
  } catch (error) {
    return unread(`mass could not be read: ${(error as Error).message}`);
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
  const held = folders.map((folder) => (districts.get(folder)?.files ?? files.get(folder)!).slice().sort((a, b) => b.lines - a.lines || a.file.localeCompare(b.file)));
  const components: ReliefComponent[] = folders.map((folder, ci) => {
    const district = districts.get(folder);
    const mine = held[ci]!;
    return {
      folder,
      name: district ? folder.slice(district.of === "." ? 0 : district.of.length + 1) + "/" : (name.get(folder) ?? (folder === "." ? "root" : folder)),
      ...(district ? { district: true as const } : {}),
      files: mine.length,
      lines: mine.reduce((n, f) => n + f.lines, 0),
      unreached: mine.reduce((n, f) => n + (f.reached ? 0 : f.lines), 0),
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

  const at = new Map<string, [number, number]>();
  held.forEach((mine, ci) => mine.forEach((f, fi) => at.set(f.file, [ci, fi])));
  // Per file, the landings that changed it, as [landing index, lines changed].
  const landed = held.map((mine) => mine.map((): [number, number][] => []));
  let landings: ReliefLanding[] = [];
  let head = "";
  try {
    const [headLine, out] = await Promise.all([
      git(root, "log", "-1", "--format=%h %ad", "--date=short"),
      git(root, "log", "-z", "--first-parent", "--diff-merges=first-parent", "--numstat", `--format=${LANDING_FORMAT}`, "--date=short", "-n", String(LANDINGS_MAX), "HEAD"),
    ]);
    head = headLine.trim();
    for (const { sha, date, subject, files: touched } of parseLandings(out)) {
      const perComponent = new Map<number, number>();
      const perFile: [number, number, number][] = [];
      let n = 0;
      for (const { path, lines } of touched) {
        if (lines === null || leftOut(path)) continue;
        const changed = lines[0] + lines[1];
        n++;
        const ci = owner(path);
        perComponent.set(ci, (perComponent.get(ci) ?? 0) + changed);
        const hit = at.get(path);
        if (hit) perFile.push([hit[0], hit[1], changed]);
      }
      if (perComponent.size === 0) continue;
      for (const [ci, fi, changed] of perFile) landed[ci]![fi]!.push([landings.length, changed]);
      landings.push({ sha, date, subject, n, c: [...perComponent] });
    }
  } catch {
    // Not a git checkout, or no history: heights are flat and the view says so.
    landings = [];
    for (const mine of landed) for (const l of mine) l.length = 0;
  }
  const texts = new Map(folders.map((folder, ci) => [folder, JSON.stringify(held[ci]!.map((f, fi): ReliefFileLanded => (landed[ci]![fi]!.length > 0 ? { ...f, l: landed[ci]![fi]! } : f)))]));
  const reading = { components, landings, head, leftOut: [".coherence/", ...[...LOCKFILE_NAMES].sort()] };
  const digest = createHash("sha256").update(JSON.stringify(reading));
  for (const [folder, text] of texts) digest.update(folder).update("\0").update(text);
  return { reading: { kind: "read", ...reading, stamp: digest.digest("base64url").slice(0, 16) }, files: texts };
}

const unread = (because: string): ReliefRead => ({ reading: { kind: "unread", because }, files: new Map() });

/** The worker that reads the relief apart: beside this module, with the same extension, so a checkout runs its source and the package its compiled module. */
const WORKER = new URL(`./worker${extname(fileURLToPath(import.meta.url))}`, import.meta.url);

/**
 * The relief, read in a worker thread. Mass reads every source file
 * synchronously, and on PostHog's tree that held the warm server, and every
 * hook waiting on it, for thirteen seconds. Each folder's files come back as
 * text, so the server keeps them without parsing them. A worker that fails
 * reads as a relief that could not be read, never as a failed server.
 */
export function readReliefApart(rootGiven: string): Promise<ReliefRead> {
  const root = resolve(rootGiven);
  return new Promise((done) => {
    let worker: Worker;
    try {
      // None of this process's flags: a test's --import would load the suite's leak guard into the worker.
      worker = new Worker(WORKER, { workerData: { root }, execArgv: [] });
    } catch (error) {
      done(unread(`the relief's worker did not start: ${(error as Error).message}`));
      return;
    }
    let answered = false;
    worker.once("message", (read: ReliefRead) => {
      answered = true;
      done(read);
    });
    worker.once("error", (error) => done(unread(`the relief's worker failed: ${error.message}`)));
    worker.once("exit", (code) => {
      if (!answered) done(unread(`the relief's worker stopped (exit ${code}) before it answered`));
    });
  });
}

/** The most a snapshot embeds of the relief's files: whole folders, in order, while they fit. */
export const SNAPSHOT_FILES_BYTES = 1 << 20;

/**
 * A relief as a snapshot carries it. No server stands behind a snapshot to
 * load files on demand, so it embeds as many whole folders as fit in `budget`
 * bytes, in the reading's order, and counts the folders holding files it left
 * out, which the Structure view says.
 */
export function withSnapshotFiles(read: ReliefRead, budget = SNAPSHOT_FILES_BYTES): ReliefReading {
  if (read.reading.kind !== "read") return read.reading;
  const files: Record<string, ReliefFileLanded[]> = {};
  let bytes = 0;
  let leftOut = 0;
  for (const c of read.reading.components) {
    const text = read.files.get(c.folder);
    if (c.files === 0 || text === undefined) continue;
    const size = Buffer.byteLength(text);
    if (bytes + size > budget) {
      leftOut++;
      continue;
    }
    bytes += size;
    files[c.folder] = JSON.parse(text) as ReliefFileLanded[];
  }
  return { ...read.reading, files, ...(leftOut > 0 ? { filesLeftOut: leftOut } : {}) };
}

/**
 * A name the files route may look up: "." for the root component, or a
 * relative path of plain segments. An absolute path, a "..", an option, a
 * backslash or a control character is refused before anything is looked up.
 */
export function folderName(name: string): boolean {
  if (name === ".") return true;
  if (name === "" || name.length > 1024 || name.startsWith("-") || name.startsWith("/") || /[\\\x00-\x1f]/.test(name)) return false;
  return name.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
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

/** Untracked files not ignored, each as lines added: the working tree's new files, which git diff does not list. */
async function untracked(root: string): Promise<Map<string, [number, number]>> {
  const found = new Map<string, [number, number]>();
  for (const path of (await git(root, "ls-files", "-z", "--others", "--exclude-standard")).split("\0").filter(Boolean)) {
    if (leftOut(path)) continue;
    try {
      const text = await readFile(resolve(root, path), "utf8");
      if (!text.includes("\0")) found.set(path, [text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0), 0]);
    } catch {
      // unreadable: not counted
    }
  }
  return found;
}

const ORIGIN_HEAD = "refs/remotes/origin/HEAD";

/** The refs that could be the trunk, most wanted first, each with the name git is then given: the branch origin's HEAD names, then main, then master, the local branch before origin's. */
function trunkCandidates(originHead: string): [ref: string, name: string][] {
  const prefix = "refs/remotes/origin/";
  const named = originHead.startsWith(prefix) && originHead !== ORIGIN_HEAD ? [originHead.slice(prefix.length)] : [];
  return [...new Set([...named, "main", "master"])].flatMap((name): [string, string][] => [[`refs/heads/${name}`, name], [`${prefix}${name}`, `origin/${name}`]]);
}

/**
 * The trunk a branch is measured from, given what origin's HEAD points at
 * ("" when unset) and which candidate refs exist: the first candidate that
 * does, or none, where the diff offers HEAD's own line.
 */
export function trunkOf(originHead: string, present: ReadonlySet<string>): string | null {
  return trunkCandidates(originHead).find(([ref]) => present.has(ref))?.[1] ?? null;
}

async function trunk(root: string): Promise<string | null> {
  const originHead = (await git(root, "symbolic-ref", "-q", ORIGIN_HEAD).catch(() => "")).trim();
  const refs = await git(root, "for-each-ref", "--format=%(refname)", ...trunkCandidates(originHead).map(([ref]) => ref));
  return trunkOf(originHead, new Set(refs.split("\n").filter(Boolean)));
}

/**
 * The commits a reader can diff between: this branch's own, then the trunk's
 * recent first-parent line, each with its tag. With no trunk, HEAD's own line
 * from HEAD, so every commit listed can still be diffed.
 */
export async function reliefCommits(rootGiven: string): Promise<{ branch: string; trunk: string | null; base: string; worktree: ReliefCommit; list: ReliefCommit[] }> {
  const root = resolve(rootGiven);
  const [tagLines, branchLine, t] = await Promise.all([
    git(root, "tag", "--format=%(objectname:short=7)%09%(*objectname:short=7)%09%(refname:short)"),
    git(root, "rev-parse", "--abbrev-ref", "HEAD"),
    trunk(root),
  ]);
  const tags = new Map<string, string>();
  for (const line of tagLines.split("\n").filter(Boolean)) {
    const [obj = "", peeled = "", name = ""] = line.split("\t");
    tags.set(peeled || obj, name);
  }
  const branch = branchLine.trim();
  const head = async () => (await git(root, "rev-parse", "--short=7", "HEAD")).trim();
  const base = t === null ? await head() : await git(root, "merge-base", t, "HEAD").then((out) => out.trim().slice(0, 7), head);
  const rows = async (range: string, on: string, ...extra: string[]): Promise<ReliefCommit[]> =>
    parseCommitRows(await git(root, "log", "-z", "--first-parent", "--format=%h%x00%ad%x00%s", "--date=short", "--abbrev=7", ...extra, range, "--")).map(({ sha, date, subject }) => ({ rev: sha, sha, date, subject, on, tag: tags.get(sha) ?? null }));
  const [mine, line] = await Promise.all([t === null || branch === t ? [] : rows(`${t}..HEAD`, branch), t === null ? rows("HEAD", branch, "-n", "150") : rows(t, t, "-n", "150")]);
  return { branch, trunk: t, base, worktree: { rev: WORKTREE, sha: "working tree", date: "", subject: `uncommitted work on ${branch}`, on: branch, tag: null }, list: [...mine, ...line] };
}

export interface ReliefEnd {
  rev: string;
  sha: string;
  date: string;
  subject: string;
}

async function described(root: string, rev: string): Promise<ReliefEnd> {
  if (rev === WORKTREE) {
    const head = (await git(root, "log", "-1", "--format=%h")).trim();
    return { rev, sha: "working tree", date: new Date().toISOString().slice(0, 10), subject: `uncommitted work on top of ${head}` };
  }
  const [row] = parseCommitRows(await git(root, "log", "-z", "-1", "--format=%h%x00%ad%x00%s", "--date=short", rev, "--"));
  return { rev, sha: row?.sha ?? "", date: row?.date ?? "", subject: row?.subject ?? "" };
}

/** One path a diff changed: lines added and deleted, and whether the later end no longer has it. */
export interface ReliefDiffFile {
  path: string;
  add: number;
  del: number;
  gone?: true;
}

/**
 * What changed between two revisions, the later one possibly the working
 * tree: only the paths that changed, each with the lines added and deleted; a
 * path the diff leaves out did not change. Both ends are checked before git
 * sees them, synchronously, so a name that is not a commit is refused (thrown)
 * before any git runs, never passed on.
 */
export function reliefDiff(rootGiven: string, a: string, b: string): Promise<{ a: ReliefEnd; b: ReliefEnd; files: ReliefDiffFile[] }> {
  if (!REVISION.test(a) || !(REVISION.test(b) || b === WORKTREE)) throw new Error("a and b must be commit ids (b may be WORKTREE)");
  return diffBetween(resolve(rootGiven), a, b);
}

async function diffBetween(root: string, a: string, b: string): Promise<{ a: ReliefEnd; b: ReliefEnd; files: ReliefDiffFile[] }> {
  // The ends are commits, then "--", so git reads neither as a path.
  const ends = b === WORKTREE ? [a, "--"] : [a, b, "--"];
  const [numstat, deleted, fresh, da, db] = await Promise.all([
    git(root, "diff", "-z", "--numstat", "-M", ...ends),
    git(root, "diff", "-z", "--name-only", "-M", "--diff-filter=D", ...ends),
    b === WORKTREE ? untracked(root) : new Map<string, [number, number]>(),
    described(root, a),
    described(root, b),
  ]);
  // Binary files count no lines, and left-out paths are not drawn.
  const changed = new Map<string, [number, number]>();
  for (const { path, lines } of parseNumstat(numstat)) {
    if (lines === null || leftOut(path)) continue;
    const [add, del] = changed.get(path) ?? [0, 0];
    changed.set(path, [add + lines[0], del + lines[1]]);
  }
  for (const [path, v] of fresh) if (!changed.has(path)) changed.set(path, v);
  const gone = new Set(deleted.split("\0").filter(Boolean));
  const files = [...changed].map(([path, [add, del]]): ReliefDiffFile => ({ path, add, del, ...(gone.has(path) ? { gone: true as const } : {}) }));
  return { a: da, b: db, files };
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
