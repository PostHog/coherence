/**
 * The vocabulary kept between readings, so an edit pays for the files it
 * names and never for the corpus.
 *
 * A full coverage reading (a session's start, a prompt over a moved tree, a
 * stop) keeps each file's contribution (lexicon-coverage.ts: the names it
 * nominates and where, the declared names it writes as words, the known
 * names it uses) and the totals they add up to, under
 * .coherence/cache/vocabulary, in a fixed number of buckets by file and by
 * term. An edit reads the files it wrote, and only those, scans them as the
 * reading would, and compares each with its kept contribution: a name whose
 * totals cross the threshold a candidate needs with this edit is named, and
 * a known name newly written where its sense is at risk is named. Then the
 * kept contributions and totals take the edit in, under a lock, once what
 * the edit named reached the host.
 *
 * What an edit reads is bounded: the files it wrote, one bucket per file,
 * and at most every term bucket, a fixed number. What it judges is the
 * totals as the last full reading left them plus every edit since; a file
 * changed without a hook seeing it counts as it was until the next full
 * reading, and so does a name whose recurrence rests on code the edit
 * newly declared and prose it never touched. A line that names both a term
 * and its plural counts twice here and once in a full reading. The kept
 * state is keyed by Coherence's code identity and by the lexicons and the
 * config's names: any change to either, and the edit takes a full reading,
 * which keeps the state again.
 */

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "./work-meter.ts";
import { basename, join } from "node:path";
import { cacheDir, storeVersion, withLock, writeKept } from "./kept-parse.ts";
import { boundedTerm, buildTerm, candidacyOf, coverageFingerprint, coverageTotals, digest, lexiconReading, singularForms, type Candidate, type Contribution, type Coverage, type FileTerm, type FileTerms, type TermFacts, type VocabularyTerm, type VocabularyUse } from "./lexicon-coverage.ts";
import { corpusFiles, NESTED_CHECKOUT, walkRules } from "./check.ts";
import { projectFiles } from "../adapters/project-files.ts";
import type { Lexicon } from "./lexicon.ts";
import { bucketAmong, bucketOf, openScanCache } from "./scan-cache.ts";
import { vocabularyFacts } from "./project.ts";
import { markedFolders } from "../plugins/languages.ts";
import { journalFileKeys } from "../journal/store.ts";
import { isStoreFile, storeDir } from "../journal/stores.ts";

const SHAPE = "vocabulary-1";

interface PoolTotal {
  named: number;
  sites: Record<string, number>;
  code: Record<string, number>;
  declared: number;
  declaredIn: Record<string, number>;
}

interface WordTotal {
  words: number;
  byComponent: Record<string, number>;
}

interface TermBucket {
  pool: Record<string, PoolTotal>;
  words: Record<string, WordTotal>;
}

type FileBucket = Record<string, Contribution>;

function stateDir(root: string): string {
  return join(cacheDir(root), "vocabulary");
}

function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

/** What the kept state is valid for: the code that made it, the lexicons and the config's names. */
async function stateVersion(root: string, layers: { coherence: Lexicon; project: Lexicon | undefined }): Promise<string> {
  const facts = await vocabularyFacts(root);
  const lexicons = createHash("sha256").update(JSON.stringify([layers.coherence, layers.project ?? null, facts])).digest("hex").slice(0, 16);
  return `${storeVersion(root, SHAPE, ["lifecycle/lexicon-coverage.ts", "lifecycle/vocabulary-state.ts"])}:${lexicons}`;
}

function bump(record: Record<string, number>, key: string, by: number): void {
  const next = (ownEntry(record, key) ?? 0) + by;
  if (next === 0) delete record[key];
  else record[key] = next;
}

/** Add (`sign` 1) or take away (-1) one contribution's part of the totals, for the terms `only` names, or all. */
function apply(buckets: Map<string, TermBucket>, c: Contribution, sign: 1 | -1, only?: ReadonlySet<string>): void {
  const bucket = (term: string): TermBucket => {
    const id = bucketOf(term);
    const found = buckets.get(id);
    if (found !== undefined) return found;
    const made: TermBucket = { pool: {}, words: {} };
    buckets.set(id, made);
    return made;
  };
  for (const [term, stats] of Object.entries(c.pool)) {
    if (only !== undefined && !only.has(term)) continue;
    const b = bucket(term);
    const total = ownEntry(b.pool, term) ?? (b.pool[term] = { named: 0, sites: {}, code: {}, declared: 0, declaredIn: {} });
    total.named += sign * stats.named;
    bump(total.sites, c.component, sign * stats.sites);
    bump(total.code, c.component, sign * stats.code);
    if (stats.declared) {
      total.declared += sign;
      bump(total.declaredIn, c.component, sign);
    }
    if (Object.keys(total.sites).length === 0 && total.named === 0) delete b.pool[term];
  }
  for (const [term, n] of Object.entries(c.words)) {
    if (only !== undefined && !only.has(term)) continue;
    const b = bucket(term);
    const total = ownEntry(b.words, term) ?? (b.words[term] = { words: 0, byComponent: {} });
    total.words += sign * n;
    bump(total.byComponent, c.component, sign * n);
    if (total.words === 0) delete b.words[term];
  }
}

/** The canonical name each term is counted under: its singular when the pool holds that, as the reading merges plurals. */
function canonicalOf(term: string, has: (t: string) => boolean): string {
  const words = term.split(" ");
  return singularForms(words.at(-1)!).map((s) => [...words.slice(0, -1), s].join(" ")).find(has) ?? term;
}

/** The plural spellings that would be counted under `term`. */
function pluralsOf(term: string): string[] {
  const words = term.split(" ");
  const last = words.at(-1)!;
  const forms = [last + "s", last + "es", ...(last.endsWith("y") ? [last.slice(0, -1) + "ies"] : [])];
  return forms.filter((f) => singularForms(f).includes(last)).map((f) => [...words.slice(0, -1), f].join(" "));
}

/**
 * Keep the state a full reading's contributions make: written whole, aside,
 * and swapped into place under the lock.
 */
export async function keepVocabulary(root: string, layers: { coherence: Lexicon; project: Lexicon | undefined }, contributions: ReadonlyMap<string, Contribution>, tree: Record<string, string> | undefined, coverage: Coverage, records: Record<string, string> | undefined, readFromMs: number, index?: ReadingIndex): Promise<void> {
  // A tree git cannot describe keeps no state: every edit then reads in full.
  if (tree === undefined) return;
  const version = await stateVersion(root, layers);
  const files = new Map<string, FileBucket>();
  const terms = new Map<string, TermBucket>();
  for (const [file, c] of contributions) {
    const id = bucketOf(file);
    const b = files.get(id) ?? {};
    b[file] = c;
    files.set(id, b);
    apply(terms, c, 1);
  }
  const present = (t: string): boolean => ownEntry(terms.get(bucketOf(t))?.pool ?? {}, t) !== undefined;
  const declared = new Set<string>();
  for (const b of terms.values()) for (const [term, total] of Object.entries(b.pool)) if (total.declared > 0) declared.add(canonicalOf(term, present));
  withLock(join(cacheDir(root), "vocabulary.lock"), () => {
    const aside = `${stateDir(root)}.${process.pid}.tmp`;
    // An aside a process died before renaming is removed by the next whole write.
    for (const name of readdirSync(cacheDir(root))) if (/^vocabulary\.\d+\.tmp$/.test(name)) rmSync(join(cacheDir(root), name), { recursive: true, force: true });
    try {
      // Every part is written before the whole is swapped in, and a part that cannot be written keeps the aside from ever being used.
      for (const [id, b] of files) writeKept(join(aside, "files", `${id}.json`), b, false, true);
      for (const [id, b] of terms) writeKept(join(aside, "terms", `${id}.json`), b, false, true);
      writeKept(join(aside, "declared.json"), [...declared].sort(), false, true);
      if (index !== undefined) writeIndex(aside, index, declared);
      if (records !== undefined) writeKept(join(aside, "reading.json"), { version, tree, records, readFromMs, readToMs: Date.now(), coverage, digest: digest(coverage) }, false, true);
      writeKept(join(aside, "meta.json"), { version, buckets: { files: [...files.keys()].sort(), terms: [...terms.keys()].sort() }, tree } satisfies Meta, false, true);
      rmSync(stateDir(root), { recursive: true, force: true });
      renameSync(aside, stateDir(root));
    } catch {
      // No state kept: the next edit finds none and takes the full reading, which tries again.
      rmSync(aside, { recursive: true, force: true });
    }
  });
}

/**
 * What an edit introduced, and the kept state taking it in: the caller
 * keeps it once the line reached the host, or at once when there is
 * nothing to say, so a line that never reached the agent is said again.
 */
export interface EditVocabulary {
  changes: EditChange[];
  keep: () => void;
}

/** What an edit's vocabulary line names, in coverageChanges' shape. */
export interface EditChange {
  term: string;
  component: string;
  evidence: string;
  state: string;
  reason: string;
}

/** A part of the kept state that cannot be trusted: the edit reads in full instead, says so, and writes nothing back. */
class BucketUnusable extends Error {}

interface Meta {
  version: string;
  writing?: boolean;
  /** The buckets the state holds, by kind: one listed and missing or torn is a broken state, never an empty bucket. */
  buckets: { files: string[]; terms: string[] };
  /** The tree as the state last took it in: each file git lists as changed or untracked, with its size, modification and change time. */
  tree: Record<string, string>;
}

/** The key the tree's HEAD is kept under: no path git lists can be spelled so. */
export const HEAD_KEY = "\u0000HEAD";
const SPARSE_KEY = "\u0000SPARSE";

/**
 * The commit HEAD names, through the git door: one rev-parse. "unborn" for a
 * repository with no commit yet; undefined when git cannot answer.
 */
export function headCommit(root: string): string | undefined {
  const head = spawnSync("git", ["rev-parse", "--verify", "-q", "HEAD"], { cwd: root, encoding: "utf8" });
  if (head.status === 0) return head.stdout.trim();
  // --verify -q exits 1 and prints nothing when HEAD names no commit; anything else is git failing.
  return head.status === 1 && head.stdout.trim() === "" && head.stderr.trim() === "" ? "unborn" : undefined;
}

/**
 * The tree's key: the commit HEAD names, and every file git lists as changed
 * against HEAD or untracked, outside .coherence, with its size, modification
 * and change time; a rev-parse, two git listings and a stat each, never a
 * read. Undefined when git cannot answer. HEAD is in it because a checkout,
 * a pull or a branch switch onto a clean tree changes files the two listings
 * never name: they list what differs from HEAD, and HEAD moved with them.
 * The index's own stat is left out: git rewrites it whenever it refreshes,
 * which changes no file's text.
 * A write no hook saw (a code generator, a checkout, a shell command the
 * shell reader did not parse) moves it, and the next edit reads in full.
 * Coherence's own records under .coherence are left out: the commands that
 * write them run at every turn, and a full reading at the next prompt or stop
 * reads them.
 */
export function treeKeys(root: string): Record<string, string> | undefined {
  const head = headCommit(root);
  if (head === undefined) return undefined;
  const files = new Set<string>();
  // Without --no-renames a rename lists only its new path, and the old one would never count as gone.
  for (const args of [["diff", "--name-only", "--no-renames", "--relative", "-z", "HEAD"], ["ls-files", "--others", "--exclude-standard", "-z"]]) {
    const listed = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (listed.status !== 0) return undefined;
    for (const f of listed.stdout.split("\0")) if (f !== "" && !f.startsWith(".coherence/")) files.add(f);
  }
  const out: Record<string, string> = { [HEAD_KEY]: head };
  const sparse = spawnSync("git", ["config", "--bool", "core.sparseCheckout"], { cwd: root, encoding: "utf8" });
  if (sparse.status !== 0 && sparse.status !== 1) return undefined;
  if (sparse.stdout.trim() === "true") {
    const listed = spawnSync("git", ["ls-files", "--cached", "-t", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    if (listed.status !== 0) return undefined;
    const skipped = listed.stdout.split("\0").filter((line) => line.startsWith("S ")).map((line) => line.slice(2));
    out[SPARSE_KEY] = createHash("sha256").update(JSON.stringify(skipped)).digest("hex");
  }
  for (const f of [...files].sort()) {
    try {
      const st = statSync(join(root, f));
      out[f] = `${st.size}:${st.mtimeMs}:${st.ctimeMs}`;
    } catch {
      out[f] = "gone";
    }
  }
  return out;
}

/** The files whose key differs between two trees, other than `except`. */
function movedBeyond(then: Record<string, string>, now: Record<string, string>, except: readonly string[]): string[] {
  const skip = new Set(except);
  return [...new Set([...Object.keys(then), ...Object.keys(now)])].filter((f) => !skip.has(f) && then[f] !== now[f]).sort();
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isCounts = (value: unknown): boolean => isRecord(value) && Object.values(value).every((n) => typeof n === "number");

function validTermBucket(value: unknown): value is TermBucket {
  if (!isRecord(value) || !isRecord(value["pool"]) || !isRecord(value["words"])) return false;
  const poolOk = Object.values(value["pool"]).every((t) => isRecord(t) && typeof t["named"] === "number" && typeof t["declared"] === "number" && isCounts(t["sites"]) && isCounts(t["code"]) && isCounts(t["declaredIn"]));
  const wordsOk = Object.values(value["words"]).every((t) => isRecord(t) && typeof t["words"] === "number" && isCounts(t["byComponent"]));
  return poolOk && wordsOk;
}

function validFileBucket(value: unknown): value is FileBucket {
  return isRecord(value) && Object.values(value).every((c) => isRecord(c) && typeof c["component"] === "string" && isRecord(c["pool"]) && isCounts(c["words"]) && Array.isArray(c["uses"]));
}

/** One bucket: validated when it is there; one the state lists and is not there, or is torn, throws; one never written is empty. */
function readBucket<T>(path: string, listed: boolean, valid: (value: unknown) => value is T, empty: () => T): T {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    if (listed) throw new BucketUnusable(`a kept bucket the state lists is missing (${basename(path)})`);
    return empty();
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new BucketUnusable(`a kept bucket is torn (${basename(path)})`);
  }
  if (!valid(value)) throw new BucketUnusable(`a kept bucket is not in the shape it is kept in (${basename(path)})`);
  return value;
}

function termBuckets(root: string, ids: Iterable<string>, meta: Meta): Map<string, TermBucket> {
  const out = new Map<string, TermBucket>();
  for (const id of new Set(ids)) out.set(id, readBucket(join(stateDir(root), "terms", `${id}.json`), meta.buckets.terms.includes(id), validTermBucket, () => ({ pool: {}, words: {} })));
  return out;
}

function fileBuckets(root: string, files: readonly string[], meta: Meta): Map<string, FileBucket> {
  const out = new Map<string, FileBucket>();
  for (const id of new Set(files.map(bucketOf))) out.set(id, readBucket(join(stateDir(root), "files", `${id}.json`), meta.buckets.files.includes(id), validFileBucket, () => ({})));
  return out;
}

/** The kept state's meta, validated; undefined when there is none. */
function readMeta(root: string): Meta | undefined {
  let text: string;
  try {
    text = readFileSync(join(stateDir(root), "meta.json"), "utf8");
  } catch {
    return undefined;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new BucketUnusable("its kept state's meta is torn");
  }
  const buckets = isRecord(value) ? value["buckets"] : undefined;
  if (!isRecord(value) || typeof value["version"] !== "string" || !isRecord(buckets) || !Array.isArray(buckets["files"]) || !Array.isArray(buckets["terms"]) || !isRecord(value["tree"])) throw new BucketUnusable("its kept state's meta is not in the shape it is kept in");
  return value as unknown as Meta;
}

function recordKeys(root: string): Record<string, string> | undefined {
  try {
    const out = Object.fromEntries([...journalFileKeys(root)].map(([name, key]) => [`journal/${name}`, key]));
    const dir = join(root, storeDir("work"));
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return undefined;
      names = [];
    }
    for (const name of names.filter(isStoreFile).sort()) {
      const stat = statSync(join(dir, name));
      out[`work/${name}`] = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
    }
    return out;
  } catch {
    return undefined;
  }
}

interface KeptCoverage {
  coverage: Coverage;
  isFresh: boolean;
  readFromMs: number;
  readToMs: number;
  saved: SavedReading;
  /** The tree's and the records' keys now, undefined when git or the stores could not be listed. */
  tree: Record<string, string> | undefined;
  records: Record<string, string> | undefined;
}

/** The last kept reading, and whether its tree and records keys still match; undefined when none is kept for this code and lexicon. */
export async function keptCoverage(root: string, layers: { coherence: Lexicon; project: Lexicon | undefined }): Promise<KeptCoverage | undefined> {
  const version = await stateVersion(root, layers);
  let meta: Meta | undefined;
  try {
    meta = readMeta(root);
  } catch (error) {
    if (!(error instanceof BucketUnusable)) throw error;
  }
  if (meta === undefined || meta.writing === true || meta.version !== version) return undefined;
  const saved = readJson<unknown>(join(stateDir(root), "reading.json"));
  if (!isRecord(saved) || saved["version"] !== meta.version || typeof saved["readFromMs"] !== "number" || typeof saved["readToMs"] !== "number") return undefined;
  const coverage = saved["coverage"];
  if (!isRecord(coverage) || coverage["version"] !== 1 || typeof saved["digest"] !== "string" || saved["digest"] !== digest(coverage)) return undefined;
  const tree = treeKeys(root);
  const records = recordKeys(root);
  const isFresh = tree !== undefined && records !== undefined && JSON.stringify(saved["tree"]) === JSON.stringify(tree) && JSON.stringify(saved["records"]) === JSON.stringify(records);
  return { coverage: coverage as unknown as Coverage, isFresh, readFromMs: saved["readFromMs"], readToMs: saved["readToMs"], saved: saved as unknown as SavedReading, tree, records };
}

/**
 * The reading the tree now holds: the kept one while its tree and records
 * keys match, else one taken from the kept index for the files that changed,
 * else a full reading. Each reading past the kept one logs its extent.
 */
export async function currentReading(root: string, layers: { coherence: Lexicon; project: Lexicon | undefined }): Promise<Coverage> {
  // Taken before the tree is keyed: a write during the reading moves the key, so the reading never claims a write it may have missed.
  const readFromMs = Date.now();
  const kept = await keptCoverage(root, layers);
  if (kept?.isFresh === true) return kept.coverage;
  if (kept === undefined) return fullReading(root, layers, "no kept reading for this code, lexicon and config", readFromMs);
  let done: IncrementalReading;
  try {
    done = await incrementalReading(root, layers, readFromMs, kept);
  } catch (error) {
    // Whatever the index cannot answer, a full reading can: its reason is logged, never hidden.
    const reason = error instanceof FullReading || error instanceof BucketUnusable ? error.message : `the incremental reading failed: ${error instanceof Error ? error.message : String(error)}`;
    return fullReading(root, layers, reason, readFromMs);
  }
  logExtent(root, { extent: done.extent, changed: done.changed, rebuilt: done.rebuilt, ms: Date.now() - readFromMs });
  if (process.env["COHERENCE_VOCABULARY_VERIFY"] === undefined) return done.coverage;
  return verifiedAgainstFull(root, layers, done.coverage, done.changed);
}

async function fullReading(root: string, layers: { coherence: Lexicon; project: Lexicon | undefined }, reason: string, readFromMs: number): Promise<Coverage> {
  const coverage = await keptReading(root, layers);
  logExtent(root, { extent: "full", reason, ms: Date.now() - readFromMs });
  return coverage;
}

/** Whether the group counted under `canonical` is a candidate by these totals: the reading's rule, by name or by word. */
function candidacy(canonical: string, terms: Map<string, TermBucket>): { candidate: boolean; prose: number; components: number } {
  const total = (t: string): PoolTotal | undefined => ownEntry(terms.get(bucketOf(t))?.pool ?? {}, t);
  const members = [canonical, ...pluralsOf(canonical)].map(total).filter((t): t is PoolTotal => t !== undefined);
  if (members.length === 0) return { candidate: false, prose: 0, components: 0 };
  const named = members.reduce((n, m) => n + m.named, 0);
  const sites = new Set(members.flatMap((m) => Object.keys(m.sites)));
  const code = new Set(members.flatMap((m) => Object.keys(m.code)));
  const declared = members.some((m) => m.declared > 0);
  const words = ownEntry(terms.get(bucketOf(canonical))?.words ?? {}, canonical);
  const wordComponents = new Set([...Object.keys(words?.byComponent ?? {}), ...code]);
  const byName = named >= 3 || (named >= 2 && sites.size >= 2);
  const byWord = declared && (words?.words ?? 0) >= 10 && wordComponents.size >= 4;
  return { candidate: byName || byWord, prose: named + (words?.words ?? 0), components: new Set([...sites, ...Object.keys(words?.byComponent ?? {})]).size };
}

/** Why an edit could not be judged against the kept state; `treeMoved` when only writes no hook saw stand in the way, which the incremental reading answers. */
export type EditUnavailable = { unavailable: string | undefined; treeMoved?: true };

/**
 * The vocabulary changes an edit to `written` introduced, judged against the
 * kept state, and the kept state taking the edit in; undefined when no kept
 * state is valid for this code, lexicon and config, and the caller takes a
 * full reading instead. `candidates` names the terms the baseline already
 * holds as candidates, never named again.
 */
export async function editVocabulary(root: string, layers: { coherence: Lexicon; project: Lexicon | undefined }, written: readonly string[], candidates: ReadonlySet<string>): Promise<EditVocabulary | EditUnavailable> {
  try {
    return await judgeEdit(root, layers, written, candidates);
  } catch (error) {
    // Any part of the state that cannot be trusted: the edit reads in full and says why, and nothing derived from the part is written back.
    if (error instanceof BucketUnusable) return { unavailable: error.message };
    throw error;
  }
}

async function judgeEdit(root: string, layers: { coherence: Lexicon; project: Lexicon | undefined }, written: readonly string[], candidates: ReadonlySet<string>): Promise<EditVocabulary | EditUnavailable> {
  const meta = readMeta(root);
  // None kept yet, or kept by other code or lexicons: the full reading is the ordinary way, and keeps the state again.
  if (meta === undefined || meta.version !== (await stateVersion(root, layers))) return { unavailable: undefined };
  if (meta.writing === true) return { unavailable: "its kept vocabulary was left half-written by an edit that stopped while writing it" };
  // A write no hook saw since the state was kept (a generator, a checkout, an unparsed shell command): the totals would be stale.
  const tree = treeKeys(root);
  if (tree === undefined) return { unavailable: "git could not list the tree's changes, so writes no hook saw cannot be ruled out" };
  const unseen = movedBeyond(meta.tree, tree, written);
  if (unseen.length > 0) return { unavailable: `the tree moved since its vocabulary was kept, beyond what this edit wrote (${unseen.slice(0, 3).map((f) => (f === HEAD_KEY ? "HEAD names another commit" : f)).join(", ")}${unseen.length > 3 ? `, and ${unseen.length - 3} more` : ""})`, treeMoved: true };
  const declaredRaw = readJson<unknown>(join(stateDir(root), "declared.json"));
  if (!Array.isArray(declaredRaw) || !declaredRaw.every((d) => typeof d === "string")) throw new BucketUnusable("its kept declared names are missing or torn");
  const declared = new Set(declaredRaw as string[]);
  const reading = await lexiconReading(root, layers, undefined, { files: written, declared, rulings: false, contributions: true });
  const fresh = new Map([...reading.contributions].filter(([file]) => written.includes(file)));
  if (fresh.size === 0) return { changes: [], keep: () => {} };
  const files = fileBuckets(root, [...fresh.keys()], meta);
  const old = new Map([...fresh.keys()].map((file) => [file, files.get(bucketOf(file))?.[file]]));
  // The terms whose totals this edit can move, their singulars and plurals: what its candidacy is judged on.
  const moved = new Set<string>();
  for (const c of [...fresh.values(), ...old.values()]) {
    if (c === undefined) continue;
    for (const term of [...Object.keys(c.pool), ...Object.keys(c.words), ...c.uses.map((u) => u.split("\t")[0]!)]) moved.add(term);
  }
  const related = new Set<string>();
  for (const term of moved) {
    related.add(term);
    const words = term.split(" ");
    for (const s of singularForms(words.at(-1)!)) related.add([...words.slice(0, -1), s].join(" "));
    for (const p of pluralsOf(term)) related.add(p);
  }
  const before = termBuckets(root, [...related].map(bucketOf), meta);
  const after = new Map([...before].map(([id, b]) => [id, JSON.parse(JSON.stringify(b)) as TermBucket]));
  for (const [file, c] of fresh) {
    const was = old.get(file);
    if (was !== undefined) apply(after, was, -1);
    apply(after, c, 1);
  }
  const has = (terms: Map<string, TermBucket>) => (t: string): boolean => ownEntry(terms.get(bucketOf(t))?.pool ?? {}, t) !== undefined;
  const changes: EditChange[] = [];
  const named = new Set<string>();
  for (const term of moved) {
    const canonical = canonicalOf(term, has(after));
    if (named.has(canonical) || candidates.has(canonical)) continue;
    const then = candidacy(canonicalOf(term, has(before)), before);
    const now = candidacy(canonical, after);
    if (!now.candidate || then.candidate) continue;
    named.add(canonical);
    const file = [...fresh.keys()].find((f) => ownEntry(fresh.get(f)!.pool, term) !== undefined || ownEntry(fresh.get(f)!.words, term) !== undefined) ?? [...fresh.keys()][0]!;
    changes.push({ term: canonical, component: file, evidence: "", state: "unresolved", reason: `recurs without a definition (${now.prose} prose lines, ${now.components} components)` });
  }
  // A known name newly written where its sense is at risk, as the reading of the written files judges it; a Coherence name declared only in code the edit did not write is named by the next full reading.
  const terms = new Map(reading.coverage.terms.map((t) => [t.term, t]));
  for (const [file, c] of fresh) {
    const was = new Map<string, number>();
    for (const u of old.get(file)?.uses ?? []) was.set(u, (was.get(u) ?? 0) + 1);
    const risked = new Set<string>();
    for (const u of c.uses) {
      const left = was.get(u) ?? 0;
      if (left > 0) {
        was.set(u, left - 1);
        continue;
      }
      const term = u.split("\t")[0]!;
      if (risked.has(term)) continue;
      const found = terms.get(term);
      const context = found?.contexts.find((x) => x.component === c.component);
      const risk = context?.risk;
      if (risk === undefined) continue;
      risked.add(term);
      changes.push({ term, component: c.component, evidence: context?.fingerprint ?? "", state: found?.state ?? "declared", reason: `sense at risk: ${risk}` });
    }
  }
  // The kept state takes the edit in, against the contributions as they are now under the lock, so two edits at once both count.
  // It is marked as being written first, so a stop half way leaves a state the next edit refuses and reads past in full;
  // one the edit cannot take in at all (no lock, no write) is dropped, so the next edit reads in full and keeps it again.
  const meta_ = join(stateDir(root), "meta.json");
  const keep = (): void => {
    let kept: boolean | undefined;
    try {
      kept = withLock(join(cacheDir(root), "vocabulary.lock"), () => {
        // Read again under the lock: a part another edit tore since is refused here too, and the state is dropped below.
        const now = readMeta(root);
        if (now === undefined || now.version !== meta.version || now.writing === true) return false;
        writeKept(meta_, { ...now, writing: true }, false, true);
        const ids = takeIn(now);
        const buckets = { files: [...new Set([...now.buckets.files, ...ids.files])].sort(), terms: [...new Set([...now.buckets.terms, ...ids.terms])].sort() };
        writeKept(meta_, { version: now.version, buckets, tree } satisfies Meta, false, true);
        return true;
      });
    } catch {
      kept = undefined;
    }
    if (kept !== true) rmSync(meta_, { force: true });
  };
  const takeIn = (now: Meta): { files: string[]; terms: string[] } => {
    const locked = fileBuckets(root, [...fresh.keys()], now);
    const lockedOld = new Map([...fresh.keys()].map((file) => [file, locked.get(bucketOf(file))?.[file]]));
    const touched = new Set<string>();
    for (const c of [...fresh.values(), ...lockedOld.values()]) if (c !== undefined) for (const t of [...Object.keys(c.pool), ...Object.keys(c.words)]) touched.add(t);
    const buckets = termBuckets(root, [...touched].map(bucketOf), now);
    for (const [file, c] of fresh) {
      const was = lockedOld.get(file);
      if (was !== undefined) apply(buckets, was, -1);
      apply(buckets, c, 1);
      locked.get(bucketOf(file))![file] = c;
    }
    for (const [id, b] of locked) writeKept(join(stateDir(root), "files", `${id}.json`), b, false, true);
    for (const [id, b] of buckets) writeKept(join(stateDir(root), "terms", `${id}.json`), b, false, true);
    // The declared names change only when the edit declared or undeclared one.
    const present = has(buckets);
    let changed = false;
    for (const t of touched) {
      const total = ownEntry(buckets.get(bucketOf(t))?.pool ?? {}, t);
      const canonical = canonicalOf(t, present);
      const is = total !== undefined && total.declared > 0;
      if (is && !declared.has(canonical)) {
        declared.add(canonical);
        changed = true;
      }
    }
    if (changed) writeKept(join(stateDir(root), "declared.json"), [...declared].sort(), false, true);
    return { files: [...locked.keys()], terms: [...buckets.keys()] };
  };
  return { changes, keep };
}

/** Term buckets in the index: a reading of a few files loads only the buckets of the terms they touch. */
const INDEX_BUCKETS = 1024;

/** What a full reading leaves for the incremental one: each file's part of each term, and what a reading of a few files cannot see for itself. */
export interface ReadingIndex {
  records: ReadonlyMap<string, FileTerms>;
  rejectedLines: ReadonlyMap<string, ReadonlyMap<number, string[]>>;
  digests: Record<string, string>;
  components: readonly string[];
  rulings: Record<string, { disposition: string; because: string }>;
}

type TermIndexBucket = Record<string, Record<string, FileTerm>>;
type FileIndexBucket = Record<string, string[]>;

interface IndexSide {
  components: string[];
  /** The declared names the indexed reading resolved prose words to; declared.json also takes in edits, which the index does not. */
  declared: string[];
  rejected: Record<string, Record<string, string[]>>;
  digests: Record<string, string>;
  rulings: Record<string, { disposition: string; because: string }>;
  termBuckets: string[];
  fileBuckets: string[];
}

/** A record's own value for a key: terms are words such as "constructor", which a plain object would answer with an inherited member. */
function ownEntry<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function indexDir(stateRoot: string): string {
  return join(stateRoot, "index");
}

function rejectedRecord(lines: ReadonlyMap<number, string[]>): Record<string, string[]> {
  return Object.fromEntries([...lines].map(([line, names]) => [String(line), names]));
}

function writeIndex(stateRoot: string, index: ReadingIndex, declared: ReadonlySet<string>): void {
  const terms = new Map<string, TermIndexBucket>();
  const files = new Map<string, FileIndexBucket>();
  for (const [file, parts] of index.records) {
    const fileBucket = files.get(bucketOf(file)) ?? {};
    fileBucket[file] = Object.keys(parts);
    files.set(bucketOf(file), fileBucket);
    for (const [term, part] of Object.entries(parts)) {
      const id = bucketAmong(term, INDEX_BUCKETS);
      const termBucket: TermIndexBucket = terms.get(id) ?? Object.create(null);
      (ownEntry(termBucket, term) ?? (termBucket[term] = Object.create(null) as Record<string, FileTerm>))[file] = part;
      terms.set(id, termBucket);
    }
  }
  for (const [id, bucket] of terms) writeKept(join(indexDir(stateRoot), "terms", `${id}.json`), bucket, false, true);
  for (const [id, bucket] of files) writeKept(join(indexDir(stateRoot), "files", `${id}.json`), bucket, false, true);
  const side: IndexSide = {
    components: [...index.components],
    declared: [...declared].sort(),
    rejected: Object.fromEntries([...index.rejectedLines].map(([file, lines]) => [file, rejectedRecord(lines)])),
    digests: index.digests,
    rulings: index.rulings,
    termBuckets: [...terms.keys()].sort(),
    fileBuckets: [...files.keys()].sort(),
  };
  writeKept(join(indexDir(stateRoot), "side.json"), side, false, true);
}

/** Why a reading could not be taken from the index: the hook takes a full reading instead, and the extent log says why. */
class FullReading extends Error {}

interface SavedReading {
  version: string;
  tree: Record<string, string>;
  records: Record<string, string>;
  coverage: Coverage;
}

function indexSide(root: string): IndexSide {
  const side = readJson<unknown>(join(indexDir(stateDir(root)), "side.json"));
  if (!isRecord(side) || !Array.isArray(side["components"]) || !Array.isArray(side["declared"]) || !isRecord(side["rejected"]) || !isRecord(side["digests"]) || !isRecord(side["rulings"]) || !Array.isArray(side["termBuckets"]) || !Array.isArray(side["fileBuckets"])) throw new FullReading("its kept index is missing or torn");
  return side as unknown as IndexSide;
}

/** The files that changed since the kept reading: those HEAD's move changed, those whose tree key moved, and the record stores whose key moved. */
function changedPaths(root: string, thenTree: Record<string, string>, nowTree: Record<string, string>, thenRecords: Record<string, string>, nowRecords: Record<string, string>): string[] {
  if (thenTree[SPARSE_KEY] !== nowTree[SPARSE_KEY]) throw new FullReading("the sparse checkout changed");
  const changed = new Set<string>();
  const headThen = thenTree[HEAD_KEY];
  const headNow = nowTree[HEAD_KEY];
  if (headThen !== headNow) {
    // The kept commit is read from a file a repository can carry: only an object name reaches git, never an option.
    if (headThen === undefined || headNow === undefined || !COMMIT_NAME.test(headThen) || !COMMIT_NAME.test(headNow)) throw new FullReading("HEAD moved from or to no commit");
    const listed = spawnSync("git", ["diff", "--name-only", "--no-renames", "--relative", "-z", "--end-of-options", headThen, headNow], { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    if (listed.status !== 0) throw new FullReading("git could not list what HEAD's move changed");
    for (const file of listed.stdout.split("\0")) if (file !== "" && !file.startsWith(".coherence/")) changed.add(file);
  }
  for (const file of new Set([...Object.keys(thenTree), ...Object.keys(nowTree)])) if (!file.startsWith("\0") && thenTree[file] !== nowTree[file]) changed.add(file);
  for (const key of new Set([...Object.keys(thenRecords), ...Object.keys(nowRecords)])) if (thenRecords[key] !== nowRecords[key]) changed.add(`.coherence/${key}`);
  return [...changed].sort();
}

const COMMIT_NAME = /^[0-9a-f]{40,64}$/;

/** Files whose change can move what the reading reads or how, a language plugin's folder markers among them: a full reading takes them in. */
function reshapingFiles(): Set<string> {
  return new Set(["coherence.config.json", ".gitignore", "package.json", "lexicon.json", ...markedFolders().flatMap((mark) => [mark.marker, mark.beside]).filter((name): name is string => name !== undefined)]);
}

/** The project's prose files holding any of these words, any case, as git can find them; a superset of where prose writes them as words. */
function filesWriting(root: string, words: ReadonlySet<string>): string[] {
  const listed = spawnSync("git", ["grep", "-l", "-z", "-i", "-F", "-I", "--untracked", ...[...words].flatMap((word) => ["-e", word])], { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (listed.status === 1) return [];
  if (listed.status !== 0) throw new FullReading("git could not search the project for a newly declared name's words");
  return listed.stdout.split("\0").filter((file) => file !== "");
}

/** A term's singular spellings: the names its plural merges into. */
function singularsOf(term: string): string[] {
  const words = term.split(" ");
  return singularForms(words.at(-1)!).map((s) => [...words.slice(0, -1), s].join(" "));
}

/** The last words whose windows can resolve to, or away from, a name: its own, and every singular and plural form reachable from it. */
function wordForms(names: Iterable<string>): Set<string> {
  const forms = new Set<string>();
  const waiting = [...names].map((name) => name.split(" ").at(-1)!);
  while (waiting.length > 0) {
    const word = waiting.pop()!;
    if (forms.has(word)) continue;
    forms.add(word);
    waiting.push(...singularForms(word), ...pluralsOf(word));
  }
  return forms;
}

function lastWordOf(term: string): string {
  return term.split(" ").at(-1)!;
}

/** The index of each term's parts by file, loaded a bucket at a time, with what changed kept for writing back. */
function openIndex(root: string, side: IndexSide) {
  const dir = indexDir(stateDir(root));
  const termBuckets = new Map<string, TermIndexBucket>();
  const fileBuckets = new Map<string, FileIndexBucket>();
  const changedTermBuckets = new Set<string>();
  const changedFileBuckets = new Set<string>();
  const termBucket = (term: string): TermIndexBucket => {
    const id = bucketAmong(term, INDEX_BUCKETS);
    const loaded = termBuckets.get(id);
    if (loaded !== undefined) return loaded;
    const read = readBucket(join(dir, "terms", `${id}.json`), side.termBuckets.includes(id), (value): value is TermIndexBucket => isRecord(value), () => ({}));
    termBuckets.set(id, read);
    return read;
  };
  const fileBucket = (file: string): FileIndexBucket => {
    const id = bucketOf(file);
    const loaded = fileBuckets.get(id);
    if (loaded !== undefined) return loaded;
    const read = readBucket(join(dir, "files", `${id}.json`), side.fileBuckets.includes(id), (value): value is FileIndexBucket => isRecord(value), () => ({}));
    fileBuckets.set(id, read);
    return read;
  };
  const partsOf = (term: string): Record<string, FileTerm> => ownEntry(termBucket(term), term) ?? {};
  const put = (term: string, file: string, part: FileTerm | undefined): void => {
    const bucket = termBucket(term);
    changedTermBuckets.add(bucketAmong(term, INDEX_BUCKETS));
    const parts = ownEntry(bucket, term) ?? (bucket[term] = {});
    if (part !== undefined) parts[file] = part;
    if (part === undefined) delete parts[file];
    if (Object.keys(parts).length === 0) delete bucket[term];
  };
  const termsOf = (file: string): string[] => ownEntry(fileBucket(file), file) ?? [];
  const setTermsOf = (file: string, terms: readonly string[]): void => {
    const bucket = fileBucket(file);
    changedFileBuckets.add(bucketOf(file));
    if (terms.length > 0) bucket[file] = [...terms];
    if (terms.length === 0) delete bucket[file];
  };
  /** Replace a file's parts of every term, and name each term whose parts moved. */
  const replaceFile = (file: string, parts: FileTerms, touched: Set<string>): void => {
    for (const term of termsOf(file)) {
      put(term, file, undefined);
      touched.add(term);
    }
    for (const [term, part] of Object.entries(parts)) {
      put(term, file, part);
      touched.add(term);
    }
    setTermsOf(file, Object.keys(parts));
  };
  const write = (stateRoot: string): { termBuckets: string[]; fileBuckets: string[] } => {
    for (const id of changedTermBuckets) writeKept(join(indexDir(stateRoot), "terms", `${id}.json`), termBuckets.get(id)!, false, true);
    for (const id of changedFileBuckets) writeKept(join(indexDir(stateRoot), "files", `${id}.json`), fileBuckets.get(id)!, false, true);
    return { termBuckets: [...new Set([...side.termBuckets, ...changedTermBuckets])].sort(), fileBuckets: [...new Set([...side.fileBuckets, ...changedFileBuckets])].sort() };
  };
  return { partsOf, put, termsOf, setTermsOf, replaceFile, write };
}

type ReadingIndexStore = ReturnType<typeof openIndex>;

/** One term rebuilt from its parts, through the reduce the full reading runs: its uses, its candidacy with plurals merged, then the shared builder. */
function termFromIndex(term: string, index: ReadingIndexStore, facts: TermFacts): VocabularyTerm | undefined {
  const isPresent = (name: string): boolean => Object.values(index.partsOf(name)).some((part) => (part.sites?.length ?? 0) > 0);
  const canonical = (name: string): string => canonicalOf(name, isPresent);
  const useOf = (file: string, part: FileTerm, line: number): VocabularyUse => ({ file, line, component: part.component, text: part.lines[line]!, kind: part.kind, fingerprint: part.prints?.[line] ?? part.fingerprint });
  const sortedParts = (name: string): [string, FileTerm][] => Object.entries(index.partsOf(name)).sort(([a], [b]) => a.localeCompare(b));
  const uses: VocabularyUse[] = [];
  const useKeys = new Set<string>();
  const addUse = (use: VocabularyUse): void => {
    const key = `${use.file}\n${use.line}`;
    if (useKeys.has(key)) return;
    useKeys.add(key);
    uses.push(use);
  };
  for (const [file, part] of sortedParts(term)) for (const line of part.adds ?? []) addUse(useOf(file, part, line));
  let candidate: Candidate | undefined;
  if (isPresent(term) && canonical(term) === term) {
    const members = [term, ...pluralsOf(term).filter((name) => isPresent(name) && canonical(name) === term)];
    const sites: VocabularyUse[] = [];
    const siteKeys = new Set<string>();
    let declared = false;
    for (const member of members)
      for (const [file, part] of sortedParts(member))
        for (const [line, isDeclared] of part.sites ?? []) {
          declared ||= isDeclared;
          const key = `${file}\n${line}`;
          if (siteKeys.has(key)) continue;
          siteKeys.add(key);
          sites.push(useOf(file, part, line));
        }
    const words = sortedParts(term).flatMap(([file, part]) => (part.words ?? []).map((line) => useOf(file, part, line)));
    candidate = candidacyOf({ declared, sites, siteKeys, words });
  }
  for (const use of candidate?.uses ?? []) addUse(use);
  if (uses.length === 0) return undefined;
  return buildTerm(term, uses, { ...facts, candidates: new Map(candidate === undefined ? [] : [[term, candidate]]) });
}

/** Whether a canonical name is declared by the index: some spelling counted under it carries a declared site. */
function isDeclaredIn(name: string, index: ReadingIndexStore): boolean {
  const isPresent = (term: string): boolean => Object.values(index.partsOf(term)).some((part) => (part.sites?.length ?? 0) > 0);
  if (!isPresent(name) || canonicalOf(name, isPresent) !== name) return false;
  return [name, ...pluralsOf(name)].some((member) => isPresent(member) && canonicalOf(member, isPresent) === name && Object.values(index.partsOf(member)).some((part) => part.sites?.some(([, declared]) => declared) === true));
}

interface IncrementalReading {
  coverage: Coverage;
  extent: "files" | "declared names";
  changed: number;
  rebuilt: number;
}

/**
 * The reading after a change, from the index the last reading kept: the
 * changed files read and scanned again, their parts replaced, and only the
 * terms they touch rebuilt by the full reading's own reduce. A newly
 * declared or undeclared name also reads again the prose files that may
 * write it as words. Anything the index cannot answer exactly throws
 * FullReading, and the caller reads in full.
 */
async function incrementalReading(root: string, layers: { coherence: Lexicon; project: Lexicon | undefined }, readFromMs: number, kept: KeptCoverage): Promise<IncrementalReading> {
  const version = await stateVersion(root, layers);
  const meta = readMeta(root);
  if (meta === undefined || meta.version !== version) throw new FullReading("no kept vocabulary for this code, lexicon and config");
  if (meta.writing === true) throw new FullReading("its kept vocabulary was left half-written");
  const { saved, tree, records } = kept;
  if (!isRecord(saved.tree) || !isRecord(saved.records)) throw new FullReading("its kept reading is missing or torn");
  const side = indexSide(root);
  if (tree === undefined || records === undefined) throw new FullReading("git could not list the tree's changes");
  // An edit keeps its file's contribution and meta.tree without the reading, so a file it wrote that is since put back matches the reading's tree yet not the buckets.
  const changed = [...new Set([...changedPaths(root, saved.tree, tree, saved.records, records), ...movedBeyond(meta.tree, tree, [HEAD_KEY]).filter((file) => !file.startsWith("\0"))])].sort();
  const reshaping = reshapingFiles();
  const reshaped = changed.find((file) => reshaping.has(basename(file)));
  if (reshaped !== undefined) throw new FullReading(`${reshaped} changed, which can change what the reading reads`);
  const population = saved.coverage.population;
  const listedThen = new Map(population.files.map((entry) => [entry.file, entry]));
  const excludedThen = new Map(population.excluded.map((entry) => [entry.file, entry.reason]));
  const unreadableThen = new Set(population.unreadable.map((entry) => entry.file));
  const onDisk = new Set(changed.filter((file) => isFileOnDisk(root, file)));
  const own = new Set(projectFiles(root));
  const walk = walkRules(root, own);
  // A folder can start or stop being walked into (a git init, a removed .git, its mode) with no file git lists as changed.
  const foldersWalked = new Set([...population.files, ...population.excluded, ...population.unreadable].flatMap((entry) => ancestorsOf(entry.file)));
  const unwalked = [...foldersWalked].find((folder) => !walk.descends(folder));
  if (unwalked !== undefined) throw new FullReading(`${unwalked} is no longer walked into`);
  const nowReadable = population.unreadable.find((entry) => walk.descends(entry.file));
  if (nowReadable !== undefined) throw new FullReading(`${nowReadable.file} can be read now`);
  const nestedGone = population.excluded.find((entry) => entry.reason === NESTED_CHECKOUT && !walk.leftOutAgain(entry.file, entry.reason));
  if (nestedGone !== undefined) throw new FullReading(`${nestedGone.file} is no longer a nested checkout`);
  // The walk would list these again exactly as the last reading did, so they are neither read nor a reason to read in full.
  const asListed = new Set<string>();
  for (const file of changed) {
    const folders = ancestorsOf(file);
    if (unreadableThen.has(file) || folders.some((folder) => unreadableThen.has(folder))) throw new FullReading(`${file} was left out of the last reading`);
    const leftOutAt = [file, ...folders].find((path) => excludedThen.has(path));
    if (leftOutAt !== undefined) {
      if (!walk.leftOutAgain(leftOutAt, excludedThen.get(leftOutAt)!)) throw new FullReading(`${file} was left out of the last reading`);
      asListed.add(file);
      continue;
    }
    if (file.endsWith(".spec.md") && listedThen.has(file) !== onDisk.has(file)) throw new FullReading(`a spec was added or removed (${file})`);
  }
  const toRead = [...onDisk].filter((file) => !asListed.has(file));
  const read = await corpusFiles({ root, coherence: layers.coherence, project: layers.project }, toRead.filter((file) => own.has(file)));
  const readRels = new Set(read.map((file) => file.rel));
  const leftOut = toRead.find((file) => !readRels.has(file) || !walk.reaches(file));
  if (leftOut !== undefined) throw new FullReading(`${leftOut} would be left out of the reading`);
  const declaredThen = new Set(side.declared);
  const scans = openScanCache(root, version);
  const scope = { records: true, contributions: true, scans, components: side.components } as const;
  const first = await lexiconReading(root, layers, undefined, { ...scope, files: [...readRels], corpus: read, wordKeys: declaredThen });
  const index = openIndex(root, side);
  const touched = new Set<string>();
  const contributions = new Map<string, Contribution | undefined>();
  for (const file of changed) {
    index.replaceFile(file, readRels.has(file) ? (first.records.get(file) ?? {}) : {}, touched);
    contributions.set(file, first.contributions.get(file));
    delete side.rejected[file];
    const rejectedHere = first.facts.rejectedLines.get(file);
    if (rejectedHere !== undefined) side.rejected[file] = rejectedRecord(rejectedHere);
  }
  const declared = new Set(declaredThen);
  const recheck = new Set<string>();
  const isPresent = (term: string): boolean => Object.values(index.partsOf(term)).some((part) => (part.sites?.length ?? 0) > 0);
  for (const term of touched) for (const related of [term, ...singularsOf(term), ...pluralsOf(term)]) recheck.add(related).add(canonicalOf(related, isPresent));
  for (const name of recheck) {
    if (isDeclaredIn(name, index)) {
      declared.add(name);
      continue;
    }
    declared.delete(name);
  }
  const flipped = [...new Set([...declared, ...declaredThen])].filter((name) => declared.has(name) !== declaredThen.has(name));
  let extent: IncrementalReading["extent"] = "files";
  if (flipped.length > 0) {
    extent = "declared names";
    const forms = wordForms(flipped);
    const changedFiles = new Set(changed);
    const corpusNow = new Set([...[...listedThen.keys()].filter((file) => !changedFiles.has(file)), ...readRels]);
    const again = [...new Set([...filesWriting(root, forms).filter((file) => corpusNow.has(file)), ...readRels])].sort();
    const alreadyRead = new Map(read.map((file) => [file.rel, file]));
    const readNow = new Map((await corpusFiles({ root, coherence: layers.coherence, project: layers.project }, again.filter((file) => !alreadyRead.has(file)))).map((file) => [file.rel, file]));
    const corpusAgain = again.flatMap((file) => { const found = alreadyRead.get(file) ?? readNow.get(file); return found === undefined ? [] : [found]; });
    const second = await lexiconReading(root, layers, undefined, { ...scope, files: again, corpus: corpusAgain, wordKeys: declared });
    for (const file of again) {
      contributions.set(file, second.contributions.get(file));
      const parts = second.records.get(file) ?? {};
      if (readRels.has(file)) {
        index.replaceFile(file, parts, touched);
        continue;
      }
      const kept = new Set(index.termsOf(file));
      for (const term of [...kept].filter((name) => forms.has(lastWordOf(name)))) {
        const part = index.partsOf(term)[file];
        if (part === undefined) continue;
        const { words: _dropped, ...rest } = part;
        const isEmpty = (rest.adds?.length ?? 0) === 0 && (rest.sites?.length ?? 0) === 0;
        index.put(term, file, isEmpty ? undefined : rest);
        if (isEmpty) kept.delete(term);
        touched.add(term);
      }
      for (const [term, part] of Object.entries(parts)) {
        if (!forms.has(lastWordOf(term)) || part.words === undefined) continue;
        const existing = index.partsOf(term)[file];
        const lines = { ...existing?.lines, ...Object.fromEntries(part.words.map((line) => [line, part.lines[line]!])) };
        const prints = part.prints === undefined ? existing?.prints : { ...existing?.prints, ...Object.fromEntries(part.words.map((line) => [line, part.prints![line]!])) };
        index.put(term, file, { ...(existing ?? { kind: part.kind, component: part.component, fingerprint: part.fingerprint }), words: part.words, lines, ...(prints === undefined ? {} : { prints }) });
        kept.add(term);
        touched.add(term);
      }
      index.setTermsOf(file, [...kept]);
    }
  }
  const rulings = Object.fromEntries(first.facts.decisions);
  const movedRulings = new Set([...new Set([...Object.keys(rulings), ...Object.keys(side.rulings)])].filter((evidence) => JSON.stringify(rulings[evidence]) !== JSON.stringify(side.rulings[evidence])));
  if (movedRulings.size > 0) for (const term of saved.coverage.terms) if (term.contexts.some((context) => movedRulings.has(context.fingerprint))) touched.add(term.term);
  side.rulings = rulings;
  const rebuild = new Set<string>();
  for (const term of touched) for (const related of [term, ...singularsOf(term), ...pluralsOf(term)]) rebuild.add(related);
  const facts: TermFacts = { ...first.facts, rejectedLines: new Map(Object.entries(side.rejected).map(([file, lines]) => [file, new Map(Object.entries(lines).map(([line, names]) => [Number(line), names]))])) };
  const termsByName = new Map(saved.coverage.terms.map((term) => [term.term, term]));
  for (const name of rebuild) {
    const built = termFromIndex(name, index, facts);
    if (built === undefined) {
      termsByName.delete(name);
      delete side.digests[name];
      continue;
    }
    const bounded = boundedTerm(built);
    termsByName.set(name, bounded);
    side.digests[name] = digest(bounded);
  }
  const terms = [...termsByName.values()].sort((a, b) => a.term.localeCompare(b.term));
  const files = new Map(listedThen);
  for (const file of changed) files.delete(file);
  for (const file of read) files.set(file.rel, { file: file.rel, kind: file.kind, lines: file.lines.length });
  const nextPopulation: Coverage["population"] = { ...population, files: [...files.values()].sort((a, b) => a.file.localeCompare(b.file)) };
  const coverage: Coverage = {
    version: 1,
    projectLexicon: saved.coverage.projectLexicon,
    fingerprint: coverageFingerprint(nextPopulation, terms.map((term) => ownEntry(side.digests, term.term)!)),
    population: nextPopulation,
    terms,
    totals: coverageTotals(terms),
  };
  keepIncremental(root, meta, { index, side, contributions, declared, tree, records, coverage, readFromMs });
  return { coverage, extent, changed: changed.length, rebuilt: rebuild.size };
}

/** The kept state taking an incremental reading in, under the lock, only while no other reading or edit moved it since this one began. */
function keepIncremental(root: string, began: Meta, kept: { index: ReadingIndexStore; side: IndexSide; contributions: ReadonlyMap<string, Contribution | undefined>; declared: ReadonlySet<string>; tree: Record<string, string>; records: Record<string, string>; coverage: Coverage; readFromMs: number }): void {
  const metaPath = join(stateDir(root), "meta.json");
  let isKept: boolean | undefined;
  try {
    isKept = withLock(join(cacheDir(root), "vocabulary.lock"), () => {
      const now = readMeta(root);
      if (now === undefined || now.version !== began.version || now.writing === true || JSON.stringify(now.tree) !== JSON.stringify(began.tree)) return true;
      writeKept(metaPath, { ...now, writing: true }, false, true);
      const files = fileBuckets(root, [...kept.contributions.keys()], now);
      const touched = new Set<string>();
      for (const [file, next] of kept.contributions) {
        const was = files.get(bucketOf(file))?.[file];
        for (const c of [was, next]) if (c !== undefined) for (const term of [...Object.keys(c.pool), ...Object.keys(c.words)]) touched.add(term);
      }
      const totals = termBuckets(root, [...touched].map(bucketOf), now);
      for (const [file, next] of kept.contributions) {
        const bucket = files.get(bucketOf(file))!;
        const was = bucket[file];
        if (was !== undefined) apply(totals, was, -1);
        if (next !== undefined) apply(totals, next, 1);
        if (next !== undefined) bucket[file] = next;
        if (next === undefined) delete bucket[file];
      }
      for (const [id, bucket] of files) writeKept(join(stateDir(root), "files", `${id}.json`), bucket, false, true);
      for (const [id, bucket] of totals) writeKept(join(stateDir(root), "terms", `${id}.json`), bucket, false, true);
      writeKept(join(stateDir(root), "declared.json"), [...kept.declared].sort(), false, true);
      const indexBuckets = kept.index.write(stateDir(root));
      writeKept(join(indexDir(stateDir(root)), "side.json"), { ...kept.side, ...indexBuckets, declared: [...kept.declared].sort() } satisfies IndexSide, false, true);
      writeKept(join(stateDir(root), "reading.json"), { version: now.version, tree: kept.tree, records: kept.records, readFromMs: kept.readFromMs, readToMs: Date.now(), coverage: kept.coverage, digest: digest(kept.coverage) }, false, true);
      const buckets = { files: [...new Set([...now.buckets.files, ...files.keys()])].sort(), terms: [...new Set([...now.buckets.terms, ...totals.keys()])].sort() };
      writeKept(metaPath, { version: now.version, buckets, tree: kept.tree } satisfies Meta, false, true);
      return true;
    });
  } catch {
    isKept = undefined;
  }
  // A state this reading could not take in whole is dropped: the next reading is a full one, which keeps it again.
  if (isKept !== true) rmSync(metaPath, { force: true });
}

function isFileOnDisk(root: string, rel: string): boolean {
  try {
    return statSync(join(root, rel)).isFile();
  } catch {
    return false;
  }
}

/** The folders above a project-relative path, outermost first. */
function ancestorsOf(rel: string): string[] {
  const parts = rel.split("/");
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("/"));
}

/** Where each reading's extent and reason are kept, for measuring how often each fires; the oldest half is dropped past its size. */
const EXTENT_LOG_LIMIT_BYTES = 256 * 1024;

function logExtent(root: string, entry: { extent: string; reason?: string; changed?: number; rebuilt?: number; ms: number }): void {
  const path = join(cacheDir(root), "vocabulary-extents.jsonl");
  try {
    if (existsSync(path) && statSync(path).size > EXTENT_LOG_LIMIT_BYTES) {
      const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
      writeFileSync(path, lines.slice(Math.floor(lines.length / 2)).join("\n") + "\n");
    }
    appendFileSync(path, JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
  } catch {
    // The log is for measuring; a reading never fails for want of it.
  }
}

/** With COHERENCE_VOCABULARY_VERIFY set, the incremental reading is checked against a full one; a mismatch is logged and the full one kept. */
async function verifiedAgainstFull(root: string, layers: { coherence: Lexicon; project: Lexicon | undefined }, coverage: Coverage, changed: number): Promise<Coverage> {
  const full = await keptReading(root, layers);
  if (JSON.stringify(full) === JSON.stringify(coverage)) return coverage;
  const fullTerms = new Map(full.terms.map((term) => [term.term, JSON.stringify(term)]));
  const mismatched = [...new Set([...full.terms.map((t) => t.term), ...coverage.terms.map((t) => t.term)])].filter((term) => fullTerms.get(term) !== JSON.stringify(coverage.terms.find((t) => t.term === term)));
  appendFileSync(join(cacheDir(root), "vocabulary-verify.log"), JSON.stringify({ at: new Date().toISOString(), changed, terms: mismatched.slice(0, 20), population: JSON.stringify(full.population) === JSON.stringify(coverage.population), fingerprint: full.fingerprint === coverage.fingerprint }) + "\n");
  return full;
}

/** A full reading that also keeps the state an edit reads. */
export async function keptReading(root: string, layers: { coherence: Lexicon; project: Lexicon | undefined }): Promise<Coverage> {
  // The tree is keyed before the corpus is read: a write during the reading moves it, and the next edit reads in full.
  const readFromMs = Date.now();
  const tree = treeKeys(root);
  const records = recordKeys(root);
  const scans = openScanCache(root, await stateVersion(root, layers));
  const reading = await lexiconReading(root, layers, undefined, { contributions: true, scans, records: true });
  scans.save();
  const coverage = boundedCoverage(reading.coverage);
  const index: ReadingIndex = {
    records: reading.records,
    rejectedLines: reading.facts.rejectedLines,
    digests: Object.fromEntries(reading.coverage.terms.map((term, n) => [term.term, reading.termDigests[n]!])),
    components: reading.components,
    rulings: Object.fromEntries(reading.facts.decisions),
  };
  try {
    await keepVocabulary(root, layers, reading.contributions, tree, coverage, records, readFromMs, index);
  } catch {
    // A state that cannot be kept costs the next edit a full reading of its own, never this reading.
  }
  return coverage;
}

function boundedCoverage(coverage: Coverage): Coverage {
  return { ...coverage, terms: coverage.terms.map(boundedTerm) };
}
