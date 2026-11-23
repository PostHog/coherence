/**
 * Vocabulary coverage: a reproducible reading of observed uses, not a claim
 * about every word's meaning, and never a count to act on. What it hands a
 * reader is a short ranked signal: the recurring terms that lack a definition
 * and the uses whose sense is at risk.
 *
 * Code and prose are different populations. From code, only declared and
 * exported names (and the fields of exported types) are candidate sources;
 * local identifiers, the words and
 * n-grams of split identifiers, strings, regular-expression fragments, paths,
 * ids, and punctuation-bearing tokens never are. From prose (docs, specs, and
 * the journal's and work's records), a candidate is a name written as a name:
 * Title Case away from a sentence start, a heading word, a single backticked
 * word. A candidate stands only when it recurs: a prose name on three lines,
 * or two across two components; a declared name where prose writes it as
 * words (never inside an identifier's spelling) on ten lines across four
 * components.
 * Well-known names (well-known.json, the config's wellKnown, the project's
 * own name), names the lexicon declares (concepts, aliases, instances,
 * properties, and its "not:" confusables), and general English and
 * programming words are never candidates. A common word written as a
 * project's proper noun still is; a function word (a preposition,
 * conjunction, determiner, pronoun, or auxiliary) never is, however written.
 *
 * Sense review is asked only where meaning is at risk: a name with more than
 * one recorded sense, or a use on or beside a prose line carrying a name
 * rejected for that same concept. In an adopter only the project's own
 * senses and rejected names count: a word Coherence also uses is the
 * project's word wherever the project writes it, records and spec grammar
 * included, and Coherence's lexicon there only says what Coherence's own
 * terms mean.
 */
import { existsSync, realpathSync } from "node:fs";
import { exclusionOf, projectFilesEnding, walkBounds } from "../adapters/project-files.ts";
import type { Language } from "../adapters/index.ts";
import { languageOfFile } from "../adapters/language-files.ts";
import { memberScanOf } from "../plugins/languages.ts";
import { readFile } from "node:fs/promises";
import { createHash, hash, type Hash } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { loadJournal } from "../journal/store.ts";
import { recordWords } from "../journal/record.ts";
import { countWork } from "./work-meter.ts";
import {
  corpusFiles,
  readCorpus,
  type CorpusFile,
  type UnreadablePath,
} from "./check.ts";
import {
  acceptedNames,
  aliasNames,
  rejectedNames,
  type Concept,
  type Lexicon,
  type RejectedName,
} from "./lexicon.ts";
import { isCoherenceItself, loadProjectLexicons, vocabularyFacts, within } from "./project.ts";
import { BASELINE_CHOSE } from "./lexicon-baseline.ts";
import { FUNCTION_WORD_SET, STOPLIST } from "./stoplist.ts";
import { singularForms } from "./inflection.ts";
import { LEXICON_PAGE_LIMITS } from "../readings/scope/lexicon-projection.ts";
import { clean, proseNominations, type Nomination } from "./nomination.ts";

export { proseNominations };
import { isWellKnown, wellKnown, type WellKnown } from "./well-known.ts";

export interface VocabularyUse {
  file: string;
  line: number;
  component: string;
  text: string;
  kind: string;
  fingerprint: string;
}
export interface VocabularyContext {
  component: string;
  fingerprint: string;
  disposition: string;
  because: string | null;
  /** Why this context's sense is at risk; absent when nothing puts it at risk, and then no review is asked. */
  risk?: string;
}
/** The lexicon stack's layers a term's meaning can come from: Coherence's, a plugin's (src/plugins/lexicon.ts), or the project's. */
export type LexiconLayer = "coherence" | "project" | `plugin ${string}`;

export interface VocabularyTerm {
  term: string;
  state:
    | "concept"
    | "alias"
    | "instance"
    | "declared"
    | "rejected"
    | "unresolved";
  concept: string | null;
  layer: LexiconLayer | null;
  definition: string | null;
  properties: Record<string, unknown>;
  confusables: string[];
  /** Present when one observed spelling names properties owned by multiple concepts. */
  meaningAlternatives?: {
    concept: string;
    layer: LexiconLayer;
    definition: string;
    properties: Record<string, unknown>;
    confusables: string[];
  }[];
  /** For a candidate (state unresolved): the prose lines it recurs on and the components it spans. */
  recurrence?: { prose: number; components: number };
  fingerprint: string;
  count: number;
  uses: VocabularyUse[];
  contexts: VocabularyContext[];
}
export interface Coverage {
  version: 1;
  projectLexicon: string | null;
  fingerprint: string;
  population: {
    files: { file: string; kind: string; lines: number }[];
    /** The project-relative paths the reading was narrowed to; absent when it read the whole project. */
    paths?: string[];
    /** The files an edit's reading read, without walking the corpus; absent when it read the whole project or its paths. */
    named?: string[];
    excluded: UnreadablePath[];
    unreadable: UnreadablePath[];
    extraction: string;
    limits: string[];
  };
  terms: VocabularyTerm[];
  /** Population facts about the observed reading, for tools; never a to-do count, and never injected. */
  totals: {
    terms: number;
    uses: number;
    known: number;
    rejected: number;
    unresolved: number;
    /** Contexts whose sense is at risk and not yet settled by a review. */
    unreviewedContexts: number;
  };
}
export const digest = (value: unknown): string => hash("sha256", JSON.stringify(value));
/** A digest over many parts without building one string of them all: a large corpus must not exceed a string's length. */
function digestAll(parts: Iterable<unknown>): string {
  const hash: Hash = createHash("sha256");
  for (const part of parts) hash.update(JSON.stringify(part) ?? "null").update("\n");
  return hash.digest("hex");
}

/**
 * A structured sense review as a decision's text: the vocabulary verb,
 * "review", then its JSON. The verb is matched by shape, not by name, so a
 * review recorded before the concept was renamed (under the name it now
 * rejects) keeps its ruling: the journal is append-only and is read as written.
 */
const REVIEW = /^[a-z]+ review (\{.*\})$/s;
/** The same for an applied proposal: the verb, "apply", the proposal id. */
const APPLY = /^[a-z]+ apply [a-z]p-[a-f0-9]{24} /;

/** Recover only lexicon review decisions with a matching current evidence key. Old answers are history. */
function rulings(
  root: string,
): Map<string, { disposition: string; because: string }> {
  const result = new Map<string, { disposition: string; because: string }>();
  for (const r of loadJournal(root).records) {
    if (r.kind !== "decision") continue;
    const review = REVIEW.exec(r.chose);
    if (!review) continue;
    try {
      const data = JSON.parse(review[1]!) as Record<string, unknown>;
      if (
        typeof data["evidence"] === "string" &&
        typeof data["disposition"] === "string"
      )
        result.set(data["evidence"], {
          disposition: data["disposition"],
          because: r.because,
        });
    } catch {
      /* A prose decision that is not a structured review remains prose. */
    }
  }
  return result;
}
interface KnownMeaning {
  state: VocabularyTerm["state"];
  concept: Concept | null;
  layer: LexiconLayer;
  propertyOwners?: { concept: Concept; layer: LexiconLayer }[];
}

function table(
  lexicon: Lexicon,
  given: LexiconLayer,
  into: Map<string, KnownMeaning>,
  properties: Map<string, { concept: Concept; layer: LexiconLayer }[]>,
  senses: Map<string, Set<string>>,
): void {
  const sense = (name: string, c: Concept): void => {
    const set = senses.get(name) ?? new Set<string>();
    // The same concept name in both layers is the project restating the tool's concept, one sense; a different concept is another.
    set.add(c.name);
    senses.set(name, set);
  };
  // Project/trust-level declarations have no owning concept; property declarations are attached below.
  for (const name of acceptedNames(lexicon))
    if (!into.has(clean(name))) into.set(clean(name), { state: "declared", concept: null, layer: given });
  for (const c of lexicon.concepts) {
    // A plugin's concept, composed into the tool layer, answers as its own plugin's layer.
    const layer = c.layer === undefined ? given : (`plugin ${c.layer}` as const);
    into.set(clean(c.name), { state: "concept", concept: c, layer });
    sense(clean(c.name), c);
    for (const name of c.instances ?? []) {
      into.set(clean(name), { state: "instance", concept: c, layer });
      sense(clean(name), c);
    }
    for (const alias of c.aliases)
      for (const name of aliasNames(alias)) {
        into.set(clean(name), { state: "alias", concept: c, layer });
        sense(clean(name), c);
      }
    for (const key of Object.keys(c.properties))
      for (const name of aliasNames(key)) {
        const normalized = clean(name);
        const owners = properties.get(normalized) ?? [];
        owners.push({ concept: c, layer });
        properties.set(normalized, owners);
      }
  }
}

/** The singulars a word may be the plural of, as the reading merges a plural into its singular: the check's own rules (inflection.ts). */
export { singularForms };
const singular = singularForms;

/** Inflection is accepted only when its conservative singular is an already-known complete name. */
function knownMeaning(term: string, known: Map<string, KnownMeaning>): KnownMeaning | undefined {
  const exact = known.get(term);
  if (exact) return exact;
  const words = term.split(" ");
  for (const one of singular(words.at(-1)!)) {
    const meaning = known.get([...words.slice(0, -1), one].join(" "));
    if (meaning) return { ...meaning, state: "declared" };
  }
  return undefined;
}

function isLexiconDecision(line: string): boolean {
  try {
    const record = JSON.parse(line) as Record<string, unknown>;
    return (
      record["kind"] === "decision" &&
      typeof record["chose"] === "string" &&
      (REVIEW.test(record["chose"]) || APPLY.test(record["chose"]) || BASELINE_CHOSE.test(record["chose"]))
    );
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------ candidates */

/**
 * A spelling that could name a concept at all: one to three words of letters,
 * each at least two long. Anything carrying a digit (a hash, a work-order or
 * decision id, a UUID, a version), a path, a dot, or other punctuation never
 * reaches here as a candidate.
 */
const ELIGIBLE = /^[a-z]{2,}(?: [a-z]{2,}){0,2}$/;

/**
 * Normalized, space-padded text with every occurrence of each phrase blanked,
 * so a shorter name inside a longer one is not read as itself. A pass splits on
 * the phrase with its spaces, so two occurrences sharing a space leave the
 * second standing; masking repeats until none is left.
 */
function maskPhrases(text: string, phrases: readonly string[]): string {
  return phrases.reduce((line, p) => {
    let masked = line;
    while (masked.includes(" " + p + " ")) masked = masked.split(" " + p + " ").join("   ");
    return masked;
  }, text);
}

function allCommon(term: string): boolean {
  return term.split(" ").every((w) => STOPLIST.has(w) || singular(w).some((s) => STOPLIST.has(s)));
}

/** The names a code line declares or exports: the only code a candidate may come from. */
const DECLARATIONS: RegExp[] = [
  // TypeScript and JavaScript exports.
  /^\s*export\s+(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:const|let|var|function\*?|class|interface|type|enum|namespace)\s+([A-Za-z$][\w$]*)/,
  // Python top-level definitions; a leading underscore is private by convention and never matches.
  /^(?:async\s+)?def\s+([A-Za-z]\w*)/,
  /^class\s+([A-Za-z]\w*)/,
  // Go exports are capitalized.
  /^func\s+(?:\([^)]*\)\s*)?([A-Z]\w*)/,
  /^type\s+([A-Z]\w*)/,
  // Rust, Swift, Kotlin, Java public declarations.
  /^\s*pub(?:\([^)]*\))?\s+(?:async\s+)?(?:fn|struct|enum|trait|type|const|mod)\s+([A-Za-z]\w*)/,
  /^\s*(?:public|open)\s+(?:final\s+)?(?:static\s+)?(?:class|struct|enum|protocol|interface|func|fun)\s+([A-Za-z]\w*)/,
];

function declaredName(line: string): string | undefined {
  for (const pattern of DECLARATIONS) {
    const match = pattern.exec(line);
    if (match?.[1] !== undefined) return match[1];
  }
  return undefined;
}

/** How a code file's exported type bodies read, per language (languageOfFile), as its plugin's manifest says: the line that opens a body, the line that closes it, and a field inside. A file no language claims, or whose plugin says nothing, has no type bodies read. */
export interface MemberScan {
  opens: RegExp;
  closes: RegExp;
  field: RegExp;
}

/**
 * A field an exported type declares: a member of an exported TypeScript
 * interface, type or class, or an annotated field of a top-level Python
 * class. The file's own locals never match.
 */
function memberName(line: string, inside: boolean, scan: MemberScan | undefined): string | undefined {
  if (!inside || scan === undefined) return undefined;
  return scan.field.exec(line)?.[1];
}

interface Word {
  lower: string;
  original: string;
}

/**
 * The runs of plain words in a prose text: an identifier's spelling
 * (camelCase, snake_case), a path, a dotted name, a token with a digit or
 * other punctuation breaks the run, and so does sentence punctuation. A
 * declared name recurs in prose only where prose writes it as words.
 */
function isSecretFile(rel: string): boolean {
  return /(^|\/)\.env(?:$|\.)/.test(rel);
}

function wordRuns(text: string): Word[][] {
  const runs: Word[][] = [];
  let run: Word[] = [];
  const cut = (): void => {
    if (run.length) runs.push(run);
    run = [];
  };
  for (const raw of text.split(/\s+/)) {
    const core = raw.replace(/^[("'`*_[{<]+/, "").replace(/[)"'`*_\]}>,.;:!?]+$/, "").replace(/'s$/, "");
    const breakAfter = /[,.;:!?)\]]$/.test(raw.replace(/["'`*_]+$/, ""));
    const plain = /^[A-Za-z]+(?:-[A-Za-z]+)*$/.test(core) && !/[a-z][A-Z]/.test(core);
    if (!plain) {
      cut();
      continue;
    }
    for (const part of core.split("-")) run.push({ lower: part.toLowerCase(), original: part });
    if (breakAfter) cut();
  }
  cut();
  return runs;
}

/**
 * The written prose of a journal or work record line: every field its role
 * table (journal/record.ts) calls prose, and a decision's over, whose refused
 * name is still a use of the words; ids, sessions, commits, paths and states
 * are not words. A line that will not parse is read whole.
 */
export function recordProse(line: string): string[] {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return [line];
  }
  return recordWords(value, (role) => role !== "meta");
}

interface Pool {
  proper: boolean;
  /** Declared or exported in code: its recurrence is counted wherever prose writes it as words. */
  declared: boolean;
  spellings: Set<string>;
  sites: VocabularyUse[];
  /** Each site's file and line, so a site is added once without a scan. */
  siteKeys: Set<string>;
  words: VocabularyUse[];
}

interface ProseLine {
  use: VocabularyUse;
  runs: Word[][];
}

/**
 * Every line of the project's own files that writes the term, as a word or
 * inside an identifier, whether or not it recurs enough to be a candidate. A
 * term a project has not declared yet is read here before it is named (step
 * one of settle a domain term); coverage's terms hold only what recurs.
 */
export async function liveUses(
  root: string,
  term: string,
  limit = 40,
): Promise<{ uses: VocabularyUse[]; total: number }> {
  const { coherence, project } = await loadProjectLexicons(root);
  const corpus = await readCorpus({ root, coherence, project });
  const wanted = " " + clean(term).replace(/[^a-z0-9 ]/g, " ").trim() + " ";
  if (wanted.trim() === "") return { uses: [], total: 0 };
  const components = corpus.files
    .filter((f) => f.rel.endsWith(".spec.md"))
    .map((f) => dirname(f.rel))
    .sort((a, b) => b.length - a.length);
  const found: VocabularyUse[] = [];
  for (const f of corpus.files) {
    const secret = /(^|\/)\.env(?:$|\.)/.test(f.rel);
    f.lines.forEach((source, n) => {
      if (f.kind === "record" && isLexiconDecision(source)) return;
      const observed = secret ? source.replace(/=.*/, "") : source;
      const normalized = " " + clean(observed).replace(/[^a-z0-9 ]/g, " ") + " ";
      if (!normalized.replace(/\s+/g, " ").includes(wanted)) return;
      found.push({
        file: f.rel,
        line: n + 1,
        component:
          components.find((c) => c === "." || f.rel.startsWith(c + "/")) ??
          "(no declared component)",
        text: (secret ? source.replace(/=.*/, "=<redacted>") : source).trim().slice(0, 360),
        kind: f.kind,
        fingerprint: digest(source),
      });
    });
  }
  return { uses: found.slice(0, limit), total: found.length };
}

/**
 * The paths a reading is narrowed to, each as the project-relative path its
 * corpus files are named under: relative to the root or absolute inside it,
 * and existing. A path outside the root, or one that does not exist, is
 * refused rather than read as nothing. The root itself is "".
 */
export function readingPaths(root: string, given: readonly string[]): string[] {
  const base = realpathSync(resolve(root));
  const outside = (path: string): Error =>
    new Error(`${path} is outside the project root ${resolve(root)}; name a folder or file inside it`);
  return [...new Set(given.map((path) => {
    const full = resolve(root, path);
    if (!within(root, full)) throw outside(path);
    if (!existsSync(full)) throw new Error(`${path} does not exist under the project root ${resolve(root)}`);
    const rel = relative(base, realpathSync(full));
    if (rel.startsWith("..") || isAbsolute(rel)) throw outside(path);
    return rel.split(sep).join("/");
  }))].sort();
}

/** Whether a corpus file lies under one of the reading's paths; every file does when the reading is not narrowed. */
function underPaths(file: string, paths: readonly string[] | undefined): boolean {
  return paths === undefined || paths.some((p) => p === "" || file === p || file.startsWith(p + "/"));
}

/** The component folders the corpus's specs declare, deepest first. */
function componentFolders(listed: readonly string[]): string[] {
  return listed
    .filter((rel) => rel.endsWith(".spec.md"))
    .map((rel) => dirname(rel))
    .sort((a, b) => b.length - a.length);
}

/** The component a file belongs to: the deepest declared folder holding it. */
function componentOf(file: string, components: readonly string[]): string {
  return components.find((c) => c === "." || file.startsWith(c + "/")) ?? "(no declared component)";
}

export interface CoverageScope {
  /**
   * Read only these project-relative files, without walking the corpus: an
   * edit's reading. Each file's component is the deepest folder above it
   * holding a spec, found by listing only the folders above it.
   */
  files?: readonly string[] | undefined;
  /** Terms code declares elsewhere in the project, so this reading counts their recurrence as words in its own files. */
  declared?: ReadonlySet<string> | undefined;
  /** False skips the journal's review rulings: an edit's reading names only what it introduced, whose evidence no ruling has seen. */
  rulings?: boolean | undefined;
  /** Also hand back each file's contribution, the kept vocabulary state's unit (vocabulary-state.ts). */
  contributions?: boolean | undefined;
  /** Each file's scan kept from an earlier reading, replayed in place of scanning it again (scan-cache.ts). */
  scans?: ScanCache | undefined;
  /** Also hand back each file's part of each term, the unit the incremental reading rebuilds terms from (vocabulary-state.ts). */
  records?: boolean | undefined;
  /** The component folders, as the whole reading found them: a reading of a few files then places each file as the whole reading would. */
  components?: readonly string[] | undefined;
  /** The names prose words resolve to, in place of the declared names this reading's own pool holds: an incremental reading's whole-project set. */
  wordKeys?: ReadonlySet<string> | undefined;
}

/** One file's part of one term: the lines that use it, nominate it, and write it as words, with each line's text and fingerprint. */
export interface FileTerm {
  kind: VocabularyUse["kind"];
  component: string;
  adds?: number[];
  sites?: [line: number, declared: boolean][];
  words?: number[];
  lines: Record<number, string>;
  /** The fingerprint of every line but a record's, which carries its own in `prints`. */
  fingerprint: string;
  prints?: Record<number, string>;
}

/** The reading's totals, from its terms alone. */
export function coverageTotals(terms: readonly VocabularyTerm[]): Coverage["totals"] {
  return {
    terms: terms.length,
    uses: terms.reduce((n, t) => n + t.count, 0),
    known: terms.filter((t) => !["unresolved", "rejected"].includes(t.state)).length,
    rejected: terms.filter((t) => t.state === "rejected").length,
    unresolved: terms.filter((t) => t.state === "unresolved").length,
    unreviewedContexts: terms.reduce((n, t) => n + t.contexts.filter(awaitsReview).length, 0),
  };
}

/** A file's parts of every term it holds, by term. */
export type FileTerms = Record<string, FileTerm>;

/** What scanning one line found, in the order the scan found it; replaying the events in order rebuilds the reading exactly. */
export type ScanEvent =
  | [line: number, kind: "add", phrase: string]
  | [line: number, kind: "rejected", names: string[]]
  | [line: number, kind: "nominate", term: string, spelling: string, proper: boolean, declared: boolean]
  | [line: number, kind: "prose", runs: string[][]];

export interface FileScan {
  comparisons: number;
  events: ScanEvent[];
}

export interface ScanCache {
  scanOf(rel: string, key: string): FileScan | undefined;
  keep(rel: string, key: string, scan: FileScan): void;
}

/**
 * What one file adds to the vocabulary: the names it nominates (sites it
 * writes them at, as a name in prose or records, in code, and whether code
 * declares them), the declared names it writes as words, and the known
 * names it uses, each as the term and its line's digest.
 */
export interface Contribution {
  component: string;
  pool: Record<string, { named: number; code: number; sites: number; declared: boolean }>;
  words: Record<string, number>;
  uses: string[];
}

/** The component folders, from a listing of the specs alone: what a reading of a few files needs to know whose they are. */
function specFolders(root: string): string[] {
  const bounds = walkBounds(root);
  return componentFolders(projectFilesEnding(root, ".spec.md").filter((rel) => exclusionOf(rel, bounds) === undefined));
}

export interface Candidate {
  uses: VocabularyUse[];
  prose: number;
  components: number;
}

/** Whether a pool entry, plurals merged, stands as a candidate, and with which uses: the full and the incremental reading share it. */
export function candidacyOf(entry: { declared: boolean; sites: readonly VocabularyUse[]; siteKeys: ReadonlySet<string>; words: readonly VocabularyUse[] }): Candidate | undefined {
  // Written as a name (backticked, Title Case, a heading): the unknown-noun check's sense of a use.
  const named = entry.sites.filter((u) => u.kind === "prose" || u.kind === "record");
  const namedSpread = new Set(entry.sites.map((u) => u.component)).size;
  // Declared in code and written as words in prose: the vocabulary the code and the documents share.
  const wordSpread = new Set([...entry.words, ...entry.sites.filter((u) => u.kind === "code")].map((u) => u.component)).size;
  const byName = named.length >= 3 || (named.length >= 2 && namedSpread >= 2);
  const byWord = entry.declared && entry.words.length >= 10 && wordSpread >= 4;
  if (!byName && !byWord) return undefined;
  const all = [...entry.sites];
  for (const u of entry.words) if (!entry.siteKeys.has(`${u.file}\n${u.line}`)) all.push(u);
  const prose = all.filter((u) => u.kind === "prose" || u.kind === "record").length;
  return { uses: all, prose, components: new Set(all.map((u) => u.component)).size };
}

/** What the reduce knows about the whole reading when it builds one term: the full and the incremental reading share it. */
export interface TermFacts {
  known: Map<string, KnownMeaning>;
  rejected: Map<string, RejectedName>;
  rawEntries: Map<string, Record<string, unknown>>;
  coherenceSenses: Map<string, Set<string>>;
  projectSenses: Map<string, Set<string>>;
  own: boolean;
  candidates: Map<string, { prose: number; components: number }>;
  rejectedLines: Map<string, Map<number, string[]>>;
  decisions: Map<string, { disposition: string; because: string }>;
}

// A name refused for this very concept, written on or beside a line that uses the concept: the writer may be mixing the two.
function near(list: VocabularyUse[], concept: string, facts: TermFacts): string | undefined {
  for (const u of list) {
    const byLine = facts.rejectedLines.get(u.file);
    if (!byLine) continue;
    for (let d = -1; d <= 1; d++) {
      const name = byLine.get(u.line + d)?.find((r) => facts.rejected.get(r)?.concept === concept);
      if (name) return `beside "${name}", a name rejected for ${concept}, at ${u.file}:${u.line + d}`;
    }
  }
  return undefined;
}

export function buildTerm(term: string, locations: VocabularyUse[], facts: TermFacts): VocabularyTerm {
  locations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  const candidate = facts.candidates.get(term);
  const item = candidate ? undefined : knownMeaning(term, facts.known);
  const refused = candidate ? undefined : facts.rejected.get(term);
  const original = item?.concept
    ? facts.rawEntries.get(item.layer + ":" + item.concept.name)
    : undefined;
  const alternatives = item?.propertyOwners?.map((owner) => ({
    concept: owner.concept.name,
    layer: owner.layer,
    definition: owner.concept.definition,
    properties: (facts.rawEntries.get(owner.layer + ":" + owner.concept.name)?.["properties"] as Record<string, unknown> | undefined) ?? owner.concept.properties,
    confusables: owner.concept.notToBeConfusedWith,
  }));
  const fingerprint = digest({
    term,
    concept: original ?? item?.concept ?? null,
    layer: item?.layer ?? null,
    propertyOwners: alternatives ?? null,
    rejected: refused ?? null,
  });
  // In an adopter only the project's own senses can differ: Coherence's sense of a word the project also uses is the tool's, and inside the project the project's sense wins.
  const senses = facts.own ? alternatives : alternatives?.filter((a) => a.layer === "project");
  const recorded = (facts.own ? facts.coherenceSenses : facts.projectSenses).get(term) ?? new Set<string>();
  const multiple = (): string | undefined => {
    if (senses && senses.length > 1) return `more than one recorded sense: ${senses.map((a) => `${a.concept} (${a.layer})`).join(", ")}`;
    return recorded.size > 1 ? `more than one recorded sense: ${[...recorded].join(", ")}` : undefined;
  };
  // Why a context's sense is at risk, if it is.
  const atRisk = (here: VocabularyUse[]): string | undefined => {
    if (candidate || refused || !item || (!item.concept && !alternatives?.length)) return undefined;
    return multiple() ?? (item.concept ? near(here, item.concept.name, facts) : undefined);
  };
  const locationsByComponent = new Map<string, VocabularyUse[]>();
  for (const location of locations) {
    const inComponent = locationsByComponent.get(location.component);
    if (inComponent === undefined) locationsByComponent.set(location.component, [location]);
    if (inComponent !== undefined) inComponent.push(location);
  }
  const contexts = [...locationsByComponent.keys()]
    .sort()
    .map((component) => {
      const here = locationsByComponent.get(component)!;
      const risk = atRisk(here);
      // Content, not line numbers, identifies a context; moving a line does not erase a human's answer.
      const evidence = digest({
        fingerprint,
        component,
        uses: [...new Set(here.map((u) => u.fingerprint + ":" + u.text))].sort(),
      });
      const ruling = facts.decisions.get(evidence);
      return {
        component,
        fingerprint: evidence,
        disposition: ruling?.disposition ?? "unreviewed",
        because: ruling?.because ?? null,
        ...(risk ? { risk } : {}),
      };
    });
  return {
    term,
    state: candidate ? "unresolved" : refused ? "rejected" : (item?.state ?? "unresolved"),
    concept: item?.concept?.name ?? refused?.concept ?? null,
    layer: item?.layer ?? null,
    definition: item?.concept?.definition ?? null,
    properties:
      (original?.["properties"] as Record<string, unknown> | undefined) ??
      item?.concept?.properties ??
      {},
    confusables: item?.concept?.notToBeConfusedWith ?? [],
    ...(alternatives && alternatives.length > 1 ? { meaningAlternatives: alternatives } : {}),
    ...(candidate ? { recurrence: { prose: candidate.prose, components: candidate.components } } : {}),
    fingerprint,
    count: locations.length,
    uses: locations,
    contexts,
  };
}

// The uses a bounded reading's readers show: termEvidence's first per component and first usesPerTerm, and attention's first prose or record use.
function keptUses(uses: readonly VocabularyUse[]): VocabularyUse[] {
  const seenComponents = new Set<string>();
  const firstWritten = uses.find((use) => use.kind === "prose" || use.kind === "record");
  return uses.filter((use, index) => {
    const isFirstOfComponent = !seenComponents.has(use.component);
    seenComponents.add(use.component);
    return isFirstOfComponent || index < LEXICON_PAGE_LIMITS.usesPerTerm || use === firstWritten;
  });
}

/** A term as a kept reading holds it: every count and context, and only the uses its readers show. */
export function boundedTerm(term: VocabularyTerm): VocabularyTerm {
  return { ...term, uses: keptUses(term.uses) };
}

/** The reading's fingerprint, over its population and each bounded term's digest in term order: every context's evidence digest covers its uses, so a reading that rebuilds a few terms recombines it without the rest of the uses. */
export function coverageFingerprint(population: Coverage["population"], termDigests: readonly string[]): string {
  return digestAll([population.extraction, ...population.limits, ...population.files, ...population.excluded, ...population.unreadable, ...termDigests]);
}

export async function lexiconCoverage(
  root: string,
  layers?: { coherence: Lexicon; project: Lexicon | undefined },
  paths?: readonly string[],
  scope: CoverageScope = {},
): Promise<Coverage> {
  return (await lexiconReading(root, layers, paths, scope)).coverage;
}

/** The coverage reading, and, when asked, each file's contribution to it. */
export async function lexiconReading(
  root: string,
  layers?: { coherence: Lexicon; project: Lexicon | undefined },
  paths?: readonly string[],
  scope: CoverageScope = {},
): Promise<{ coverage: Coverage; contributions: Map<string, Contribution>; records: Map<string, FileTerms>; facts: TermFacts; termDigests: string[]; components: readonly string[] }> {
  countWork("coverage reading");
  const { coherence, project } = layers ?? (await loadProjectLexicons(root));
  // Coherence's own lexicon is the project's only in Coherence's own checkout; an adopter without lexicon.json has none yet.
  const own = await isCoherenceItself(root);
  const rawEntries = new Map<string, Record<string, unknown>>();
  for (const g of [coherence, ...(project ? [project] : [])]) {
    const raw = JSON.parse(await readFile(g.path, "utf8")) as {
      concepts: Record<string, unknown>[];
    };
    for (const c of raw.concepts)
      rawEntries.set(
        (g === project ? "project" : "coherence") + ":" + String(c["name"]),
        c,
      );
  }
  // A reading narrowed to paths reads only the files under them, and the listing still names every component; an edit's reading names its files and walks nothing.
  const select = paths !== undefined ? (rel: string) => underPaths(rel, paths) : undefined;
  const corpus =
    scope.files !== undefined
      ? { files: await corpusFiles({ root, coherence, project }, scope.files), listed: [] as string[], unreadable: [] as UnreadablePath[], excluded: [] as UnreadablePath[] }
      : await readCorpus({ root, coherence, project }, select);
  const known = new Map<string, KnownMeaning>();
  const coherenceSenses = new Map<string, Set<string>>();
  const projectSenses = new Map<string, Set<string>>();
  const propertyOwners = new Map<string, { concept: Concept; layer: LexiconLayer }[]>();
  table(coherence, "coherence", known, propertyOwners, coherenceSenses);
  // Coherence's rejected names bind only in its own repository: in an adopter they are ordinary words of the project's, never read as refusals.
  const rejected = new Map(
    (own ? rejectedNames(coherence) : []).map((r) => [clean(r.name), r]),
  );
  // In an adopter they are no candidates either: the project's words, unremarked.
  const unremarked = new Set(own ? [] : rejectedNames(coherence).map((r) => clean(r.name)));
  if (project) {
    table(project, "project", known, propertyOwners, projectSenses);
    for (const r of rejectedNames(project)) rejected.set(clean(r.name), r);
  }
  for (const [name, owners] of propertyOwners) {
    const current = known.get(name);
    // An exact concept/alias/instance remains the primary meaning, but every property owner is still exposed.
    if (current?.concept) current.propertyOwners = owners;
    else if (owners.length === 1) known.set(name, { state: "declared", concept: owners[0]!.concept, layer: owners[0]!.layer, propertyOwners: owners });
    else if (owners.length > 1) known.set(name, { state: "declared", concept: null, layer: owners[0]!.layer, propertyOwners: owners });
  }
  // A project's explicit vocabulary owns its own sense, even where the tool refused the spelling.
  const projectNames = project
    ? new Set([...acceptedNames(project)].map(clean))
    : new Set<string>();
  for (const name of projectNames) rejected.delete(name);
  // The lexicon's "not:" entries name things it already knows are something else (Pyright, Python): never candidates.
  const confusables = new Set<string>();
  for (const g of [coherence, project])
    for (const c of g?.concepts ?? [])
      for (const entry of c.notToBeConfusedWith) {
        const lead = clean(entry.split(":")[0] ?? "");
        if (lead !== "") confusables.add(lead);
      }
  const facts = await vocabularyFacts(root);
  const famous: WellKnown = wellKnown(facts, [coherence.project, project?.project].filter((n): n is string => n !== undefined));
  const phrases = [...new Set([...known.keys(), ...rejected.keys()])].sort(
    (a, b) => b.length - a.length || a.localeCompare(b),
  );
  // Each phrase indexed by its first word: a line is tested only against the phrases its own words can start, in the phrases' order.
  const byFirstWord = new Map<string, number[]>();
  phrases.forEach((phrase, n) => {
    const first = phrase.split(" ")[0]!;
    byFirstWord.set(first, [...(byFirstWord.get(first) ?? []), n]);
  });
  const components = scope.components ?? (scope.files !== undefined ? specFolders(root) : componentFolders(corpus.listed));
  const uses = new Map<string, VocabularyUse[]>();
  const componentFor = (file: string): string => componentOf(file, components);
  // Each term's uses by file and line, so adding one is a lookup, never a scan of the uses so far.
  const useKeys = new Map<string, Set<string>>();
  const add = (term: string, use: VocabularyUse): void => {
    if (!term) return;
    const list = uses.get(term) ?? [];
    const keys = useKeys.get(term) ?? new Set<string>();
    const key = `${use.file}\n${use.line}`;
    if (!keys.has(key)) {
      keys.add(key);
      list.push(use);
    }
    useKeys.set(term, keys);
    uses.set(term, list);
  };
  const records = new Map<string, FileTerms>();
  const partOf = (term: string, use: VocabularyUse): FileTerm => {
    // Terms are words such as "constructor": a record with no prototype never mistakes one for an inherited member.
    const byTerm: FileTerms = records.get(use.file) ?? Object.create(null);
    records.set(use.file, byTerm);
    const part = (byTerm[term] ??= { kind: use.kind, component: use.component, lines: {}, fingerprint: use.kind === "record" ? "" : use.fingerprint });
    part.lines[use.line] = use.text;
    if (use.kind === "record") (part.prints ??= {})[use.line] = use.fingerprint;
    return part;
  };
  const recordAdd = (term: string, use: VocabularyUse): void => {
    if (scope.records !== true || !term) return;
    const adds = (partOf(term, use).adds ??= []);
    if (!adds.includes(use.line)) adds.push(use.line);
  };
  /** Rejected names on each line, keyed by file then line: sense is at risk beside them. */
  const rejectedLines = new Map<string, Map<number, string[]>>();
  const pool = new Map<string, Pool>();
  /** The files whose code declares each nominated name. */
  const declaredBy = new Map<string, Set<string>>();
  const proseLines: ProseLine[] = [];
  const nominate = (n: Nomination, site: VocabularyUse | undefined, declared = false): void => {
    const term = n.term;
    if (!ELIGIBLE.test(term) || term.length > 40) return;
    if (knownMeaning(term, known) || rejected.has(term)) {
      // An inflection of a known name is observed under its own spelling; an exact name already has its uses.
      if (site && !known.has(term) && !rejected.has(term)) {
        add(term, site);
        recordAdd(term, site);
      }
      return;
    }
    if (confusables.has(term) || unremarked.has(term) || isWellKnown(famous, term, n.spelling)) return;
    // Grammar, never a name: a phrase made only of function words is refused even capitalized ("Via", "And Or").
    if (term.split(" ").every((w) => FUNCTION_WORD_SET.has(w))) return;
    // A proper noun is a name even when the word is common; any other source must not be common words alone.
    if (!n.proper && allCommon(term)) return;
    // A participle is a state, not a thing: a declared "missing" or "resolved" is never a candidate.
    if (declared && /^[a-z]+[^e]ed$/.test(term)) return;
    const entry = pool.get(term) ?? { proper: false, declared: false, spellings: new Set<string>(), sites: [], siteKeys: new Set<string>(), words: [] };
    entry.proper ||= n.proper;
    entry.declared ||= declared;
    entry.spellings.add(n.spelling);
    if (site && !entry.siteKeys.has(`${site.file}\n${site.line}`)) {
      entry.siteKeys.add(`${site.file}\n${site.line}`);
      entry.sites.push(site);
    }
    if (declared && site) declaredBy.set(term, (declaredBy.get(term) ?? new Set<string>()).add(site.file));
    if (scope.records === true && site) {
      const sites = (partOf(term, site).sites ??= []);
      const found = sites.find(([line]) => line === site.line);
      if (found !== undefined) found[1] ||= declared;
      if (found === undefined) sites.push([site.line, declared]);
    }
    pool.set(term, entry);
  };
  // Components come from every spec in the corpus; only the files the reading was narrowed to were read for uses.
  const read = corpus.files;
  // Nothing here reads the pool or the uses: a file's events depend only on its lines and the lexicon, which the cache's version holds.
  const scanFile = (f: CorpusFile, scan: MemberScan | undefined): FileScan => {
    const events: ScanEvent[] = [];
    let comparisons = 0;
    let fenced = false;
    let exported = false;
    const secret = isSecretFile(f.rel);
    for (let n = 0; n < f.lines.length; n++) {
      const source = f.lines[n]!;
      // Review/maintenance decisions are outcomes, not fresh source-language observations of themselves.
      if (f.kind === "record" && isLexiconDecision(source)) continue;
      const observed = secret ? source.replace(/=.*/, "") : source;
      const normalized =
        " " + clean(observed).replace(/[^a-z0-9 ]/g, " ") + " ";
      // Every test of this line against a phrase goes through here, so the work meter counts the scan's real per-line cost.
      const writes = (phrase: string, plural = false): boolean => {
        comparisons += 1;
        if (normalized.includes(" " + phrase + " ")) return true;
        return plural && (normalized.includes(" " + phrase + "s ") || normalized.includes(" " + phrase + "es "));
      };
      const spans: string[] = [];
      const candidates: number[] = [];
      for (const word of new Set(normalized.split(" "))) {
        const starting = byFirstWord.get(word);
        if (starting !== undefined) candidates.push(...starting);
      }
      candidates.sort((a, b) => a - b);
      for (const i of candidates) {
        const phrase = phrases[i]!;
        if (writes(phrase)) {
          events.push([n, "add", phrase]);
          spans.push(phrase);
        }
      }
      const refused = spans.filter((p) => rejected.has(p));
      // Only prose a person can still edit puts a sense at risk: code shares words with the language (Promise), and a record is history.
      if (refused.length && f.kind === "prose") {
        // A rejected word inside a longer known name on the same line is that name, not the refusal.
        const masked = maskPhrases(normalized, spans.filter((p) => !rejected.has(p)));
        const standing = refused.filter((p) => masked.includes(" " + p + " "));
        if (standing.length) events.push([n, "rejected", standing]);
      }
      if (f.kind === "code") {
        const name = declaredName(observed);
        if (name !== undefined && !name.startsWith("_")) events.push([n, "nominate", clean(name), name, false, true]);
        const member = memberName(observed, exported, scan);
        if (member !== undefined) events.push([n, "nominate", clean(member), member, false, true]);
        // A body opened by an exported type (or a top-level Python class) holds declared fields until it closes at the margin.
        exported = scan?.opens.test(observed) ? true : scan?.closes.test(observed) ? false : exported;
        continue;
      }
      if (f.kind === "data") continue;
      if (f.kind === "prose" && /^\s*(```|~~~)/.test(observed)) {
        fenced = !fenced;
        continue;
      }
      if (fenced) continue;
      const texts = f.kind === "record" ? recordProse(observed) : [observed];
      // Words inside a known multi-word name on this line are that name's ("order" in "work order"), not another candidate's.
      // Only the phrases this line's own words start can be on it: a plural changes the last word, never the first.
      const inside = new Set(
        candidates
          .map((i) => phrases[i]!)
          .filter((p) => p.includes(" ") && writes(p, true))
          .flatMap((p) => p.split(" ").flatMap((w) => [w, w + "s", w + "es"])),
      );
      const runs: string[][] = [];
      for (const text of texts) {
        const heading = f.kind === "prose" && /^#{1,6}\s/.test(text);
        for (const nomination of proseNominations(text, heading))
          if (!(heading && inside.has(nomination.term))) events.push([n, "nominate", nomination.term, nomination.spelling, nomination.proper, false]);
        for (const run of wordRuns(text)) runs.push(run.map((word) => (inside.has(word.lower) ? "" : word.original)));
      }
      events.push([n, "prose", runs]);
    }
    return { comparisons, events };
  };
  // A kept scan is replayed only under every input the scan reads beyond its file: the phrases, the rejected names, and its language's member scan.
  const scanInputs = scope.scans === undefined ? "" : hash("sha1", JSON.stringify([phrases, [...rejected.keys()]]));
  let comparisons = 0;
  for (const f of read) {
    const language = languageOfFile(f.rel);
    const scan = language === undefined ? undefined : memberScanOf(language);
    const scanText = scan === undefined ? "" : [scan.opens, scan.closes, scan.field].map((pattern) => `${pattern.source}/${pattern.flags}`).join("\0");
    const key = scope.scans === undefined ? "" : hash("sha1", `${scanInputs}\0${language ?? ""}\0${scanText}\0${f.kind}\0${f.rel}\0${f.lines.join("\n")}`);
    const kept = scope.scans?.scanOf(f.rel, key);
    const scanned = kept ?? scanFile(f, scan);
    if (kept === undefined) scope.scans?.keep(f.rel, key, scanned);
    comparisons += scanned.comparisons;
    const component = componentFor(f.rel);
    const secret = isSecretFile(f.rel);
    let fileFingerprint: string | undefined;
    const fingerprintOf = (): string => (fileFingerprint ??= digest(f.lines.filter((line) => !(f.kind === "record" && isLexiconDecision(line)))));
    let lineUse: VocabularyUse | undefined;
    const useOfLine = (n: number): VocabularyUse => {
      if (lineUse?.line === n + 1) return lineUse;
      const source = f.lines[n]!;
      lineUse = {
        file: f.rel,
        line: n + 1,
        component,
        text: (secret ? source.replace(/=.*/, "=<redacted>") : source)
          .trim()
          .slice(0, 360),
        kind: f.kind,
        fingerprint: f.kind === "record" ? digest(source) : fingerprintOf(),
      };
      return lineUse;
    };
    for (const event of scanned.events) {
      const n = event[0];
      switch (event[1]) {
        case "add":
          add(event[2], useOfLine(n));
          recordAdd(event[2], useOfLine(n));
          break;
        case "rejected": {
          const byLine = rejectedLines.get(f.rel) ?? new Map<number, string[]>();
          byLine.set(n + 1, event[2]);
          rejectedLines.set(f.rel, byLine);
          break;
        }
        case "nominate":
          nominate({ term: event[2], spelling: event[3], proper: event[4] }, useOfLine(n), event[5]);
          break;
        case "prose":
          proseLines.push({ use: useOfLine(n), runs: event[2].map((run) => run.map((original) => ({ lower: original.toLowerCase(), original }))) });
          break;
      }
    }
  }
  countWork("phrase comparison", comparisons);
  for (const c of components)
    if (c !== ".") {
      const folder = c.split("/").at(-1)!;
      nominate({ term: clean(folder), spelling: folder, proper: false }, {
        file: c,
        line: 0,
        component: c,
        text: "Declared component folder",
        kind: "component",
        fingerprint: digest(c),
      });
    }
  // Each file's contribution, taken before the plural merge: a kept reading merges its own way (vocabulary-state.ts).
  const contributions = new Map<string, Contribution>();
  const contributionOf = (file: string, component: string): Contribution => {
    const found = contributions.get(file);
    if (found !== undefined) return found;
    const made: Contribution = { component, pool: {}, words: {}, uses: [] };
    contributions.set(file, made);
    return made;
  };
  if (scope.contributions === true) {
    for (const f of corpus.files) contributionOf(f.rel, componentFor(f.rel));
    for (const [term, entry] of pool)
      for (const site of entry.sites) {
        const c = contributionOf(site.file, site.component);
        const stats = (c.pool[term] ??= { named: 0, code: 0, sites: 0, declared: false });
        stats.sites += 1;
        if (site.kind === "prose" || site.kind === "record") stats.named += 1;
        if (site.kind === "code") stats.code += 1;
        if (declaredBy.get(term)?.has(site.file) === true) stats.declared = true;
      }
    for (const [term, list] of uses) for (const u of list) contributionOf(u.file, u.component).uses.push(`${term}\t${digest(u.text)}`);
  }
  // A plural nominated beside its singular is the singular's.
  const canonical = new Map<string, string>();
  for (const term of pool.keys()) {
    const words = term.split(" ");
    const one = singular(words.at(-1)!).map((s) => [...words.slice(0, -1), s].join(" ")).find((s) => pool.has(s));
    canonical.set(term, one ?? term);
  }
  for (const [term, into] of canonical)
    if (into !== term) {
      const from = pool.get(term)!;
      const to = pool.get(into)!;
      to.proper ||= from.proper;
      to.declared ||= from.declared;
      for (const s of from.spellings) to.spellings.add(s);
      for (const site of from.sites)
        if (!to.siteKeys.has(`${site.file}\n${site.line}`)) {
          to.siteKeys.add(`${site.file}\n${site.line}`);
          to.sites.push(site);
        }
      pool.delete(term);
    }
  // A declared name recurs wherever prose writes it as words, plural included; a well-known capitalized spelling is not a use.
  // Only a window whose last word, or its singular, ends some declared name can find one: the rest are skipped before any key is built.
  const isWordKey = scope.wordKeys !== undefined ? (key: string): boolean => scope.wordKeys!.has(key) : (key: string): boolean => pool.get(key)?.declared === true || scope.declared?.has(key) === true;
  const wordKeySource = scope.wordKeys !== undefined ? [...scope.wordKeys] : [...[...pool].filter(([, entry]) => entry.declared).map(([term]) => term), ...(scope.declared ?? [])];
  const declaredLastWords = new Set(wordKeySource.map((term) => term.split(" ").at(-1)!));
  const singularsByWord = new Map<string, string[]>();
  const singularsOf = (word: string): string[] => {
    const known = singularsByWord.get(word);
    if (known !== undefined) return known;
    const made = singular(word);
    singularsByWord.set(word, made);
    return made;
  };
  for (const line of proseLines) {
    const seen = new Set<string>();
    for (const run of line.runs)
      for (let i = 0; i < run.length; i++)
        for (let size = 1; size <= 3 && i + size <= run.length; size++) {
          const last = run[i + size - 1]!.lower;
          if (last === "") break;
          if (!declaredLastWords.has(last) && !singularsOf(last).some((form) => declaredLastWords.has(form))) continue;
          const words = run.slice(i, i + size);
          const head = words.slice(0, -1).map((w) => w.lower);
          // A reading of a few files also counts the names code declares elsewhere: the kept reading holds where.
          const key = [last, ...singularsOf(last)].map((w) => [...head, w].join(" ")).find(isWordKey);
          if (key === undefined || seen.has(key)) continue;
          if (isWellKnown(famous, key, words.map((w) => w.original).join(" "))) continue;
          seen.add(key);
          if (scope.records === true) {
            const words = (partOf(key, line.use).words ??= []);
            words.push(line.use.line);
          }
          if (scope.contributions === true) {
            const c = contributionOf(line.use.file, line.use.component);
            c.words[key] = (c.words[key] ?? 0) + 1;
          }
          pool.get(key)?.words.push(line.use);
        }
  }
  const candidates = new Map<string, Candidate>();
  for (const [term, entry] of pool) {
    const candidate = candidacyOf(entry);
    if (candidate !== undefined) candidates.set(term, candidate);
  }
  for (const [term, found] of candidates) for (const u of found.uses) add(term, u);
  const decisions = scope.rulings === false ? new Map<string, { disposition: string; because: string }>() : rulings(root);
  const termFacts: TermFacts = { known, rejected, rawEntries, coherenceSenses, projectSenses, own, candidates, rejectedLines, decisions };
  const terms: VocabularyTerm[] = [...uses].sort(([a], [b]) => a.localeCompare(b)).map(([term, locations]) => buildTerm(term, locations, termFacts));
  const population: Coverage["population"] = {
    files: read
      .map((f) => ({ file: f.rel, kind: f.kind, lines: f.lines.length }))
      .sort((a, b) => a.file.localeCompare(b.file)),
    ...(paths ? { paths: [...paths] } : {}),
    ...(scope.files !== undefined ? { named: [...scope.files] } : {}),
    // A narrowed reading reports what was left out under its paths, and any excluded folder a path lies inside.
    excluded: corpus.excluded
      .filter((e) => underPaths(e.file, paths) || (paths ?? []).some((p) => p.startsWith(e.file + "/")))
      .sort((a, b) => a.file.localeCompare(b.file)),
    unreadable: corpus.unreadable.filter((u) => underPaths(u.file, paths)),
    extraction:
      `Exact declared phrases in every kind. Candidates: from code, declared and exported names and the fields of exported types only; from prose and records, Title Case away from a sentence start, heading words, and single backticked words; declared component folders. A candidate stands only when prose writes it as a name on three lines, or on two across two components, or, for a name code declares (fields of exported types included), when prose writes it as words on ten lines across four components. Never candidates: ids, paths, fragments, punctuation-bearing tokens, general English and programming words, well-known names (list version ${famous.version}, the config's wellKnown, the project's own name), and names the lexicon declares or lists under "not:".`,
    limits: [
      "No exhaustive extraction or automatic proof of meaning.",
      "SQL/data/notebook bodies are text, not resolved language symbols; unsupported/binary files and symlinks are reported as excluded.",
      "Sense review is asked only where meaning is at risk: more than one recorded sense, or a use on or beside a line with a name rejected for that concept; in an adopter only the project's own senses and rejected names count. A matched spelling elsewhere is not a confirmed meaning either.",
      "Unknowns and deferred reviews are not covered. Journal review decisions do not nominate themselves.",
      "Totals are population facts about this reading, not a to-do count.",
    ],
  };
  const termDigests = terms.map((term) => digest(boundedTerm(term)));
  const coverage: Coverage = {
    version: 1,
    projectLexicon: project?.path ?? (own ? coherence.path : null),
    fingerprint: coverageFingerprint(population, termDigests),
    population,
    terms,
    totals: coverageTotals(terms),
  };
  return { coverage, contributions, records, facts: termFacts, termDigests, components };
}

/* -------------------------------------------------------------- attention */

export interface Attention {
  /** Recurring terms that lack a definition, most recurring first; a term every context dismissed is gone. */
  undefinedTerms: { term: string; prose: number; components: number; first: string; fingerprint: string }[];
  /** Uses whose sense is at risk and no review has settled. */
  senses: { term: string; component: string; reason: string; evidence: string; state: string }[];
}

/** What a sense review may rule about a context. */
export const DISPOSITIONS = ["confirmed", "not-domain", "deferred", "defect"] as const;
/** The rulings that settle a context: confirmed in the concept's sense, or dismissed as not the domain's word. */
const SETTLING: ReadonlySet<string> = new Set<(typeof DISPOSITIONS)[number]>(["confirmed", "not-domain"]);

/** Whether a review has settled a context: confirmed in the concept's sense, or dismissed as not the domain's word. */
export function isSettled(disposition: string): boolean {
  return SETTLING.has(disposition);
}

/**
 * Whether a context awaits sense review: its sense is at risk and no review
 * has confirmed or dismissed it. An ordinary use of a defined word carries no
 * risk and awaits nothing, whatever its disposition says. The one rule
 * coverage, Scope and the agent query count a review by.
 */
export function awaitsReview(context: VocabularyContext): boolean {
  return context.risk !== undefined && !isSettled(context.disposition);
}

/** The short ranked signal a reader can act on: which names to define, and which uses to check. */
export function attention(report: Coverage): Attention {
  const undefinedTerms = report.terms
    .filter((t) => t.state === "unresolved" && t.recurrence !== undefined && !t.contexts.every((c) => isSettled(c.disposition)))
    .map((t) => ({
      term: t.term,
      prose: t.recurrence!.prose,
      components: t.recurrence!.components,
      first: ((u) => (u ? `${u.file}:${u.line}` : ""))(t.uses.find((u) => u.kind === "prose" || u.kind === "record") ?? t.uses[0]),
      fingerprint: t.fingerprint,
    }))
    .sort((a, b) => b.prose * b.components - a.prose * a.components || b.prose - a.prose || a.term.localeCompare(b.term));
  const senses = report.terms
    .flatMap((t) =>
      t.contexts
        .filter(awaitsReview)
        .map((c) => ({ term: t.term, component: c.component, reason: c.risk!, evidence: c.fingerprint, state: t.state })),
    )
    .sort((a, b) => a.term.localeCompare(b.term) || a.component.localeCompare(b.component));
  return { undefinedTerms, senses };
}

function listed(names: string[]): string {
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * The ranked short list as one or two lines, or nothing at all when nothing
 * is owed. Never a total: a number nobody can act on trains a reader to skip
 * the line.
 */
export function attentionText(report: Coverage, cli = "coherence", limit = 5): string {
  const { undefinedTerms, senses } = attention(report);
  const lines: string[] = [];
  if (undefinedTerms.length > 0) {
    const shown = undefinedTerms.slice(0, limit).map((t) => t.term);
    const head =
      undefinedTerms.length <= limit
        ? `${undefinedTerms.length === 1 ? "A recurring term lacks" : `${undefinedTerms.length} recurring terms lack`} a definition: ${listed(shown)}.`
        : `Recurring terms that lack a definition, most recurring first: ${shown.join(", ")}; the rest: ${cli} lexicon coverage.`;
    lines.push(`${head} Declare each (${cli} lexicon propose declare <term> --definition "<text>" --because "<why>") or map it as an alias of an existing concept.`);
  }
  if (senses.length > 0) {
    // One entry per term: the same risk in five components is one thing to check, named once.
    const byTerm = new Map<string, { reason: string; components: string[] }>();
    for (const s of senses) {
      const entry = byTerm.get(s.term) ?? { reason: s.reason, components: [] };
      entry.components.push(s.component);
      byTerm.set(s.term, entry);
    }
    const shown = [...byTerm].slice(0, 3).map(([term, e]) => `${term} in ${e.components.slice(0, 2).join(", ")}${e.components.length > 2 ? " and elsewhere" : ""} (${e.reason})`);
    lines.push(`Sense at risk: ${shown.join("; ")}${byTerm.size > 3 ? `; the rest: ${cli} lexicon coverage` : ""}. Check each use against the definition: ${cli} lexicon review <term>.`);
  }
  return lines.join("\n");
}

/** The line that says which paths a narrowed reading read, and how many files it found under them. */
export function readLine(report: Coverage): string {
  const paths = report.population.paths ?? [];
  const n = report.population.files.length;
  return `Read only under ${paths.map((p) => p || ".").join(", ")}: ${n} ${n === 1 ? "file" : "files"}.`;
}

export function coverageText(
  report: Coverage,
  term?: string,
  live?: { uses: VocabularyUse[]; total: number },
): string {
  if (term) {
    const entries = report.terms.filter(
      (t) => t.term === clean(term) || clean(t.concept ?? "") === clean(term),
    );
    const below =
      live && live.total > 0
        ? [
            `"${term}" is written on ${live.total} ${live.total === 1 ? "line" : "lines"}, below the recurrence a candidate needs; its live uses:`,
            ...live.uses.map((u) => `  ${u.file}:${u.line} ${u.text}`),
            ...(live.total > live.uses.length ? [`  ${live.total - live.uses.length} more in --json.`] : []),
          ]
        : [`No observed use of "${term}" in this reading.`];
    return [
      ...(entries.length ? [] : below),
      ...entries.flatMap((t) => [
        `${t.term} [${t.state}${t.concept ? "; " + t.concept : ""}] ${t.count} uses${t.recurrence ? `; recurs on ${t.recurrence.prose} prose lines across ${t.recurrence.components} components` : ""}`,
        t.definition ?? "No settled definition.",
        `  properties: ${JSON.stringify(t.properties)}; confusables: ${t.confusables.join("; ") || "none declared"}`,
        ...(t.meaningAlternatives ? t.meaningAlternatives.map((meaning) => `  applicable property meaning: ${meaning.concept} (${meaning.layer}) — ${meaning.definition}; properties ${JSON.stringify(meaning.properties)}`) : []),
        ...t.contexts.map(
          (c) =>
            `  ${c.component}: ${c.disposition}${c.risk ? `; sense at risk: ${c.risk}` : ""}; evidence ${c.fingerprint}`,
        ),
        ...t.uses.map((u) => `  ${u.file}:${u.line} ${u.text}`),
      ]),
      ...report.population.limits,
    ].join("\n");
  }
  const { undefinedTerms, senses } = attention(report);
  const lead = attentionText(report, "coherence", 5);
  return [
    ...(report.population.paths ? [readLine(report), ""] : []),
    lead === "" ? "No recurring term lacks a definition, and no use's sense is at risk." : lead,
    ...(undefinedTerms.length
      ? ["", "Recurring terms without a definition (prose lines, components, first prose use):",
          ...undefinedTerms.slice(0, 40).map((t) => `  ${t.term}: ${t.prose} prose lines, ${t.components} components; ${t.first}`),
          ...(undefinedTerms.length > 40 ? ["  More in --json."] : [])]
      : []),
    ...(senses.length
      ? ["", "Senses at risk (term in component: why; evidence key for lexicon review):",
          ...senses.slice(0, 40).map((s) => `  ${s.term} in ${s.component}: ${s.reason}; evidence ${s.evidence}`),
          ...(senses.length > 40 ? ["  More in --json."] : [])]
      : []),
    "",
    "Every observed term, use and population fact: lexicon coverage --json; one term whole: lexicon review <term>.",
    ...report.population.limits,
  ].join("\n");
}
