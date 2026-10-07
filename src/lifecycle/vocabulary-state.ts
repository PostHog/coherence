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
import { readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { cacheDir, storeVersion, withLock, writeKept } from "./kept-parse.ts";
import { lexiconReading, singularForms, type Contribution, type Coverage } from "./lexicon-coverage.ts";
import type { Lexicon } from "./lexicon.ts";
import { vocabularyFacts } from "./project.ts";

const SHAPE = "vocabulary-1";
/** Buckets per kind: an edit reads at most this many term buckets, whatever the project's size. */
export const BUCKETS = 64;

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

function bucketOf(name: string): string {
  return String(createHash("sha1").update(name).digest().readUInt32BE(0) % BUCKETS).padStart(2, "0");
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
  const next = (record[key] ?? 0) + by;
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
    const total = (b.pool[term] ??= { named: 0, sites: {}, code: {}, declared: 0, declaredIn: {} });
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
    const total = (b.words[term] ??= { words: 0, byComponent: {} });
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
export async function keepVocabulary(root: string, layers: { coherence: Lexicon; project: Lexicon | undefined }, contributions: ReadonlyMap<string, Contribution>): Promise<void> {
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
  const present = (t: string): boolean => terms.get(bucketOf(t))?.pool[t] !== undefined;
  const declared = new Set<string>();
  for (const b of terms.values()) for (const [term, total] of Object.entries(b.pool)) if (total.declared > 0) declared.add(canonicalOf(term, present));
  withLock(join(cacheDir(root), "vocabulary.lock"), () => {
    const aside = `${stateDir(root)}.${process.pid}.tmp`;
    // An aside a process died before renaming is removed by the next whole write.
    for (const name of readdirSync(cacheDir(root))) if (/^vocabulary\.\d+\.tmp$/.test(name)) rmSync(join(cacheDir(root), name), { recursive: true, force: true });
    for (const [id, b] of files) writeKept(join(aside, "files", `${id}.json`), b);
    for (const [id, b] of terms) writeKept(join(aside, "terms", `${id}.json`), b);
    writeKept(join(aside, "declared.json"), [...declared].sort());
    writeKept(join(aside, "meta.json"), { version });
    rmSync(stateDir(root), { recursive: true, force: true });
    try {
      renameSync(aside, stateDir(root));
    } catch {
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

function termBuckets(root: string, ids: Iterable<string>): Map<string, TermBucket> {
  const out = new Map<string, TermBucket>();
  for (const id of new Set(ids)) out.set(id, readJson<TermBucket>(join(stateDir(root), "terms", `${id}.json`)) ?? { pool: {}, words: {} });
  return out;
}

function fileBuckets(root: string, files: readonly string[]): Map<string, FileBucket> {
  const out = new Map<string, FileBucket>();
  for (const id of new Set(files.map(bucketOf))) out.set(id, readJson<FileBucket>(join(stateDir(root), "files", `${id}.json`)) ?? {});
  return out;
}

/** Whether the group counted under `canonical` is a candidate by these totals: the reading's rule, by name or by word. */
function candidacy(canonical: string, terms: Map<string, TermBucket>): { candidate: boolean; prose: number; components: number } {
  const total = (t: string): PoolTotal | undefined => terms.get(bucketOf(t))?.pool[t];
  const members = [canonical, ...pluralsOf(canonical)].map(total).filter((t): t is PoolTotal => t !== undefined);
  if (members.length === 0) return { candidate: false, prose: 0, components: 0 };
  const named = members.reduce((n, m) => n + m.named, 0);
  const sites = new Set(members.flatMap((m) => Object.keys(m.sites)));
  const code = new Set(members.flatMap((m) => Object.keys(m.code)));
  const declared = members.some((m) => m.declared > 0);
  const words = terms.get(bucketOf(canonical))?.words[canonical];
  const wordComponents = new Set([...Object.keys(words?.byComponent ?? {}), ...code]);
  const byName = named >= 3 || (named >= 2 && sites.size >= 2);
  const byWord = declared && (words?.words ?? 0) >= 10 && wordComponents.size >= 4;
  return { candidate: byName || byWord, prose: named + (words?.words ?? 0), components: new Set([...sites, ...Object.keys(words?.byComponent ?? {})]).size };
}

/**
 * The vocabulary changes an edit to `written` introduced, judged against the
 * kept state, and the kept state taking the edit in; undefined when no kept
 * state is valid for this code, lexicon and config, and the caller takes a
 * full reading instead. `candidates` names the terms the baseline already
 * holds as candidates, never named again.
 */
export async function editVocabulary(root: string, layers: { coherence: Lexicon; project: Lexicon | undefined }, written: readonly string[], candidates: ReadonlySet<string>): Promise<EditVocabulary | undefined> {
  const meta = readJson<{ version: string }>(join(stateDir(root), "meta.json"));
  if (meta === undefined || meta.version !== (await stateVersion(root, layers))) return undefined;
  const declared = new Set(readJson<string[]>(join(stateDir(root), "declared.json")) ?? []);
  const reading = await lexiconReading(root, layers, undefined, { files: written, declared, rulings: false, contributions: true });
  const fresh = new Map([...reading.contributions].filter(([file]) => written.includes(file)));
  if (fresh.size === 0) return { changes: [], keep: () => {} };
  const files = fileBuckets(root, [...fresh.keys()]);
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
  const before = termBuckets(root, [...related].map(bucketOf));
  const after = new Map([...before].map(([id, b]) => [id, JSON.parse(JSON.stringify(b)) as TermBucket]));
  for (const [file, c] of fresh) {
    const was = old.get(file);
    if (was !== undefined) apply(after, was, -1);
    apply(after, c, 1);
  }
  const has = (terms: Map<string, TermBucket>) => (t: string): boolean => terms.get(bucketOf(t))?.pool[t] !== undefined;
  const changes: EditChange[] = [];
  const named = new Set<string>();
  for (const term of moved) {
    const canonical = canonicalOf(term, has(after));
    if (named.has(canonical) || candidates.has(canonical)) continue;
    const then = candidacy(canonicalOf(term, has(before)), before);
    const now = candidacy(canonical, after);
    if (!now.candidate || then.candidate) continue;
    named.add(canonical);
    const file = [...fresh.keys()].find((f) => fresh.get(f)!.pool[term] !== undefined || fresh.get(f)!.words[term] !== undefined) ?? [...fresh.keys()][0]!;
    changes.push({ term: canonical, component: file, evidence: "", state: "unresolved", reason: `recurs without a definition (${now.prose} prose lines, ${now.components} components)` });
  }
  // A known name newly written where its sense is at risk: the reading of the written files says where, the kept totals what code elsewhere declares.
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
      let risk = context?.risk;
      if (risk === undefined && found !== undefined && found.layer === "coherence" && layers.project !== undefined && found.state !== "unresolved" && found.state !== "rejected") {
        const total = after.get(bucketOf(term))?.pool[term];
        if ((total?.declaredIn[c.component] ?? 0) > 0) risk = `declared in this project's code (in ${c.component}) with its own sense, while the definition is Coherence's`;
      }
      if (risk === undefined) continue;
      risked.add(term);
      changes.push({ term, component: c.component, evidence: context?.fingerprint ?? "", state: found?.state ?? "declared", reason: `sense at risk: ${risk}` });
    }
  }
  // The kept state takes the edit in, against the contributions as they are now under the lock, so two edits at once both count.
  const keep = (): void => void withLock(join(cacheDir(root), "vocabulary.lock"), () => {
    const locked = fileBuckets(root, [...fresh.keys()]);
    const lockedOld = new Map([...fresh.keys()].map((file) => [file, locked.get(bucketOf(file))?.[file]]));
    const touched = new Set<string>();
    for (const c of [...fresh.values(), ...lockedOld.values()]) if (c !== undefined) for (const t of [...Object.keys(c.pool), ...Object.keys(c.words)]) touched.add(t);
    const buckets = termBuckets(root, [...touched].map(bucketOf));
    for (const [file, c] of fresh) {
      const was = lockedOld.get(file);
      if (was !== undefined) apply(buckets, was, -1);
      apply(buckets, c, 1);
      locked.get(bucketOf(file))![file] = c;
    }
    for (const [id, b] of locked) writeKept(join(stateDir(root), "files", `${id}.json`), b);
    for (const [id, b] of buckets) writeKept(join(stateDir(root), "terms", `${id}.json`), b);
    // The declared names change only when the edit declared or undeclared one.
    const present = has(buckets);
    let changed = false;
    for (const t of touched) {
      const total = buckets.get(bucketOf(t))?.pool[t];
      const canonical = canonicalOf(t, present);
      const is = total !== undefined && total.declared > 0;
      if (is && !declared.has(canonical)) {
        declared.add(canonical);
        changed = true;
      }
    }
    if (changed) writeKept(join(stateDir(root), "declared.json"), [...declared].sort());
  });
  return { changes, keep };
}

/** A full reading that also keeps the state an edit reads. */
export async function keptReading(root: string, layers: { coherence: Lexicon; project: Lexicon | undefined }): Promise<Coverage> {
  const { coverage, contributions } = await lexiconReading(root, layers, undefined, { contributions: true });
  await keepVocabulary(root, layers, contributions);
  return coverage;
}
