/**
 * The glossary check: two questions asked of a corpus of prose and code.
 *
 * REJECTED NAME: a name some concept refused, appearing as a whole word or
 * phrase in prose, or as a whole identifier token (camelCase and snake_case
 * split) in code. Each finding carries the concept and its because.
 *
 * UNKNOWN NOUN: a term prose uses as a name (backticked, Title Case away from
 * a sentence start, or the name of a component folder) that no glossary
 * declares, is not a common word, and appears at least twice. Precision over
 * recall: every finding is meant to be acted on with one of three answers,
 * declare it, map it, or fix it.
 *
 * Inside a project, the project's sense of a name wins: a Coherence rejected
 * name that the project accepts as a concept or alias is not a finding there,
 * a hit inside a longer accepted phrase (a project alias that happens to
 * contain a rejected word) is not a hit, and Coherence's names are held
 * against the project's prose only, never its identifiers, which belong to
 * the project's own domain.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, relative, resolve, sep } from "node:path";
import { acceptedNames, rejectedNames, type Glossary, type RejectedName } from "./glossary.ts";
import { STOPLIST } from "./stoplist.ts";

export interface CheckOptions {
  root: string;
  /** Files or folders to check; the whole project when empty. */
  paths?: string[];
  coherence: Glossary;
  project?: Glossary | undefined;
}

export interface Location {
  file: string;
  line: number;
}

export interface RejectedFinding extends Location {
  name: string;
  /** The text as it appeared. */
  text: string;
  concept: string;
  because: string;
}

export interface UnknownFinding {
  term: string;
  count: number;
  locations: Location[];
  options: { declare: string; map: string; fix: string };
}

export interface CheckReport {
  files: number;
  rejected: RejectedFinding[];
  unknown: UnknownFinding[];
}

const PROSE_EXTENSIONS = new Set([".md"]);
const CODE_EXTENSIONS = new Set([".ts"]);
const EXCLUDED_FOLDERS = new Set(["node_modules", "public", ".coherence", ".git", "dist", ".claude", ".codex"]);

/** Identifiers the language itself owns; a rejected name that is also one of these is not a finding in code. */
const LANGUAGE_GLOBALS = new Set([
  "Promise", "HTMLElement", "HTMLAnchorElement", "HTMLInputElement", "HTMLDetailsElement", "Element", "Document", "Event", "Node", "Object", "Array", "Map", "Set", "WeakMap", "WeakSet", "Symbol", "Proxy", "Reflect",
  "Error", "Date", "JSON", "Math", "Intl", "Atomics", "Buffer", "URL", "Request", "Response", "Blob", "Event",
]);

/* --------------------------------------------------------------- corpus */

interface CorpusFile {
  path: string;
  rel: string;
  kind: "prose" | "code";
  lines: string[];
}

function kindOf(path: string): "prose" | "code" | undefined {
  const ext = extname(path);
  if (PROSE_EXTENSIONS.has(ext)) return "prose";
  if (CODE_EXTENSIONS.has(ext)) return "code";
  return undefined;
}

async function walk(dir: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_FOLDERS.has(entry.name)) continue;
      await walk(path, out);
    } else if (entry.isFile() && kindOf(path) !== undefined) {
      out.push(path);
    }
  }
}

/** Every file the check reads, excluding the glossary files, docs/retired.md, and docs/reference/ (written in the reference vocabulary). */
export async function collectFiles(options: CheckOptions): Promise<string[]> {
  const excluded = new Set<string>([resolve(options.coherence.path), resolve(options.root, "docs", "retired.md")]);
  const referenceDocs = resolve(options.root, "docs", "reference");
  if (options.project !== undefined) excluded.add(resolve(options.project.path));
  const found: string[] = [];
  const roots = options.paths === undefined || options.paths.length === 0 ? [options.root] : options.paths;
  for (const given of roots) {
    const path = resolve(options.root, given);
    let info;
    try {
      info = await stat(path);
    } catch {
      continue;
    }
    if (info.isDirectory()) await walk(path, found);
    else if (info.isFile() && kindOf(path) !== undefined) found.push(path);
  }
  return [...new Set(found)].filter((p) => {
    if (excluded.has(p)) return false;
    if (p === referenceDocs || p.startsWith(referenceDocs + sep)) return false;
    const folders = dirname(relative(options.root, p)).split(sep);
    return !folders.some((part) => EXCLUDED_FOLDERS.has(part));
  });
}

async function readCorpus(options: CheckOptions): Promise<CorpusFile[]> {
  const files = await collectFiles(options);
  const out: CorpusFile[] = [];
  for (const path of files) {
    const text = await readFile(path, "utf8");
    out.push({ path, rel: relative(options.root, path), kind: kindOf(path)!, lines: text.split(/\r?\n/) });
  }
  return out;
}

/* ---------------------------------------------------------------- words */

const WORD = "[A-Za-z0-9_]";

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/** "Auth-Code" and "auth_code" and "auth  code" all normalize to "auth code". */
export function normalizeTerm(text: string): string {
  return text.toLowerCase().replace(/[\s_-]+/g, " ").trim();
}

/** A phrase matcher: whole words, separators of space, underscore or hyphen, an optional English plural. */
function phraseRegex(phrases: string[]): RegExp | undefined {
  if (phrases.length === 0) return undefined;
  const sorted = [...phrases].sort((a, b) => b.length - a.length);
  const alternatives = sorted.map((phrase) => {
    const words = phrase.split(/[\s_-]+/).map(escapeRegex);
    const body = words.join("[\\s_-]+");
    const plural = /[a-z]$/i.test(phrase) ? "(?:e?s)?" : "";
    return body + plural;
  });
  return new RegExp(`(?<!${WORD})(?:${alternatives.join("|")})(?!${WORD})`, "gi");
}

function singular(term: string): string {
  if (term.endsWith("ies") && term.length > 4) return term.slice(0, -3) + "y";
  if (/(ss|sh|ch|x|z)es$/.test(term)) return term.slice(0, -2);
  if (term.endsWith("s") && !term.endsWith("ss") && term.length > 3) return term.slice(0, -1);
  return term;
}

/** Find which known phrase a matched text is, allowing for a plural. */
function lookup<T>(text: string, byPhrase: Map<string, T>): T | undefined {
  const key = normalizeTerm(text);
  return byPhrase.get(key) ?? byPhrase.get(singular(key)) ?? byPhrase.get(key.replace(/e?s$/, ""));
}

/** Split an identifier into its words: camelCase, PascalCase, snake_case, SCREAMING_CASE; digits stay with their word. */
export function identifierWords(identifier: string): string[] {
  return identifier
    .split("_")
    .flatMap((part) => part.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/))
    .filter((w) => w !== "")
    .map((w) => w.toLowerCase());
}

interface Token {
  word: string;
  start: number;
  end: number;
  /** The whole identifier this word came from, as written. */
  identifier: string;
  /** True when the identifier is a member access (`match.index`): a name the object's API owns, not this project. */
  member: boolean;
}

/** The word tokens of a line of code, in order, with their spans: identifiers split at camelCase and snake_case seams. */
function codeTokens(line: string): Token[] {
  const tokens: Token[] = [];
  for (const match of line.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
    const identifier = match[0];
    const member = /\.\s*$/.test(line.slice(0, match.index)) && !/\.\.\.\s*$/.test(line.slice(0, match.index));
    let offset = match.index;
    for (const part of identifier.split("_")) {
      for (const w of part.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/)) {
        if (w !== "") tokens.push({ word: w.toLowerCase(), start: offset, end: offset + w.length, identifier, member });
        offset += w.length;
      }
      offset += 1;
    }
  }
  return tokens;
}

/** The spans of module specifiers on a line of code: `from "node:fs/x"`, `import("x")`, `require("x")`. A module's name is its author's, not this project's. */
function moduleSpecifierSpans(line: string): Span[] {
  const out: Span[] = [];
  for (const match of line.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)(["'])([^"'\n]*)\1/g)) {
    const start = match.index + match[0].length - match[2]!.length - 1;
    out.push({ start, end: start + match[2]!.length });
  }
  return out;
}

/** Whether the text between two tokens is nothing but separators, so a phrase may span them. */
function joined(line: string, a: Token, b: Token): boolean {
  return /^[\s_-]*$/.test(line.slice(a.end, b.start));
}

interface Span {
  start: number;
  end: number;
}

function inside(span: Span, spans: Span[]): boolean {
  return spans.some((s) => span.start >= s.start && span.end <= s.end);
}

/** The spans of inline code on a prose line. */
function backtickSpans(line: string): Span[] {
  return [...line.matchAll(/`([^`\n]+)`/g)].map((m) => ({ start: m.index + 1, end: m.index + 1 + m[1]!.length }));
}

/* ---------------------------------------------------------- rejected */

interface NameTable {
  byPhrase: Map<string, RejectedName>;
  /** Names matched anywhere in prose. */
  prose: RegExp | undefined;
  /** Names matched only where prose names an identifier (inside backticks). */
  identifierOnly: RegExp | undefined;
  /** Every name as a word list, for code, longest first. */
  wordLists: { words: string[]; entry: RejectedName }[];
}

function nameTable(names: RejectedName[]): NameTable {
  const byPhrase = new Map<string, RejectedName>();
  for (const entry of names) byPhrase.set(normalizeTerm(entry.name), entry);
  const entries = [...byPhrase.entries()];
  return {
    byPhrase,
    prose: phraseRegex(entries.filter(([, e]) => !e.identifierOnly).map(([p]) => p)),
    identifierOnly: phraseRegex(entries.filter(([, e]) => e.identifierOnly).map(([p]) => p)),
    wordLists: entries.map(([phrase, entry]) => ({ words: phrase.split(" "), entry })).sort((a, b) => b.words.length - a.words.length),
  };
}

interface Guard {
  regex: RegExp | undefined;
  wordLists: { words: string[]; entry: undefined }[];
}

/** Accepted phrases of two or more words: a rejected word inside one is not a finding. */
function guardTable(accepted: Set<string>): Guard {
  const phrases = [...accepted].map(normalizeTerm).filter((p) => p.includes(" "));
  return {
    regex: phraseRegex(phrases),
    wordLists: phrases.map((p) => ({ words: p.split(" "), entry: undefined })).sort((a, b) => b.words.length - a.words.length),
  };
}

/** Match word lists against a token stream; returns the spans of every match. */
function matchWordLists<T>(
  line: string,
  tokens: Token[],
  lists: { words: string[]; entry: T }[],
): { span: Span; entry: T; text: string; identifier: string; member: boolean }[] {
  const out: { span: Span; entry: T; text: string; identifier: string; member: boolean }[] = [];
  for (let i = 0; i < tokens.length; i++) {
    for (const { words, entry } of lists) {
      if (i + words.length > tokens.length) continue;
      let ok = true;
      for (let j = 0; j < words.length; j++) {
        const token = tokens[i + j]!;
        const expected = words[j]!;
        const last = j === words.length - 1;
        const wordOk = token.word === expected || (last && singular(token.word) === expected);
        if (!wordOk || (j > 0 && !joined(line, tokens[i + j - 1]!, token))) {
          ok = false;
          break;
        }
      }
      if (ok) {
        const span = { start: tokens[i]!.start, end: tokens[i + words.length - 1]!.end };
        out.push({ span, entry, text: line.slice(span.start, span.end), identifier: tokens[i]!.identifier, member: tokens[i]!.member });
        break;
      }
    }
  }
  return out;
}

function rejectedInProse(file: CorpusFile, names: NameTable, guard: Guard): RejectedFinding[] {
  const out: RejectedFinding[] = [];
  file.lines.forEach((line, i) => {
    const guarded = guard.regex === undefined ? [] : [...line.matchAll(guard.regex)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
    const code = backtickSpans(line);
    const consider = (regex: RegExp | undefined, onlyInCode: boolean): void => {
      if (regex === undefined) return;
      for (const match of line.matchAll(regex)) {
        const span = { start: match.index, end: match.index + match[0].length };
        if (inside(span, guarded)) continue;
        if (onlyInCode && !inside(span, code)) continue;
        const entry = lookup(match[0], names.byPhrase);
        if (entry === undefined) continue;
        out.push({ file: file.rel, line: i + 1, name: entry.name, text: match[0], concept: entry.concept, because: entry.because });
      }
    };
    consider(names.prose, false);
    consider(names.identifierOnly, true);
  });
  return out;
}

function rejectedInCode(file: CorpusFile, names: NameTable, guard: Guard): RejectedFinding[] {
  const out: RejectedFinding[] = [];
  if (names.wordLists.length === 0) return out;
  file.lines.forEach((line, i) => {
    const tokens = codeTokens(line);
    if (tokens.length === 0) return;
    const guarded = [...matchWordLists(line, tokens, guard.wordLists).map((m) => m.span), ...moduleSpecifierSpans(line)];
    for (const hit of matchWordLists(line, tokens, names.wordLists)) {
      if (inside(hit.span, guarded)) continue;
      if (LANGUAGE_GLOBALS.has(hit.identifier) || hit.member) continue;
      out.push({ file: file.rel, line: i + 1, name: hit.entry.name, text: hit.text, concept: hit.entry.concept, because: hit.entry.because });
    }
  });
  return out;
}

/* ----------------------------------------------------------- unknown */

interface Candidate {
  term: string;
  /** Every place prose used the term as a name. */
  locations: Location[];
}

/** Whether the text before a match on a line puts the match at the start of a sentence. */
function atSentenceStart(prefix: string): boolean {
  const lead = prefix.replace(/^[\s>*\-+|#]*(?:\d+[.)]\s*)?/, "");
  if (lead.trim() === "") return true;
  const trimmed = lead.replace(/[\s"'*_)\]]+$/, "");
  return /[.!?:|]$/.test(trimmed) || trimmed === "";
}

function nominate(term: string, accepted: Set<string>, rejected: Set<string>): string | undefined {
  const key = normalizeTerm(term);
  if (key.length < 3 || !/[a-z]/.test(key)) return undefined;
  const words = key.split(" ");
  if (words.length > 3) return undefined;
  if (words.some((w) => w.length < 2)) return undefined;
  // A common word is not a name on its own; inside a longer phrase ("durable object") it may be part of one.
  if (words.every((w) => STOPLIST.has(w) || STOPLIST.has(singular(w)))) return undefined;
  const singularForm = [...words.slice(0, -1), singular(words[words.length - 1]!)].join(" ");
  if ([key, singularForm].some((f) => accepted.has(f) || rejected.has(f))) return undefined;
  return key;
}

/**
 * Candidates from one prose line. A backticked term counts when it is
 * written as a name rather than a field or a file: a snake_case token, so
 * `archived_at` and `_charter` nominate while `title` and `dev-seed` do not.
 * A Title Case phrase (hyphens allowed, so a header name is one phrase)
 * counts away from a sentence start.
 */
function candidatesOnLine(line: string, accepted: Set<string>, rejected: Set<string>): string[] {
  const out: string[] = [];
  let blanked = line;
  for (const match of line.matchAll(/`([^`\n]+)`/g)) {
    const code = match[1]!;
    if (/^_?[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(code)) {
      const term = nominate(code, accepted, rejected);
      if (term !== undefined) out.push(term);
    }
    blanked = blanked.slice(0, match.index) + " ".repeat(match[0].length) + blanked.slice(match.index + match[0].length);
  }
  blanked = blanked.replace(/\[([^\]]*)\]\([^)]*\)/g, (m, label: string) => label.padEnd(m.length));
  for (const match of blanked.matchAll(/(?<![A-Za-z0-9_'-])[A-Z][a-z]+(?:[\s-]+[A-Z][a-z]+)*(?![A-Za-z0-9_-])/g)) {
    // A capitalized common word opening the phrase ("Every Durable Object") is the sentence's, not the name's.
    let phrase = match[0];
    let start = match.index;
    for (;;) {
      const lead = /^([A-Za-z]+)[\s-]+/.exec(phrase);
      if (lead === null || !STOPLIST.has(lead[1]!.toLowerCase())) break;
      phrase = phrase.slice(lead[0].length);
      start += lead[0].length;
    }
    if (atSentenceStart(blanked.slice(0, start))) continue;
    const term = nominate(phrase, accepted, rejected);
    if (term !== undefined) out.push(term);
  }
  return out;
}

/** The names of components: folders (other than the root) holding a *.spec.md. */
function componentNames(files: CorpusFile[], root: string): string[] {
  const names = new Set<string>();
  for (const file of files) {
    if (!file.path.endsWith(".spec.md")) continue;
    const folder = dirname(file.path);
    if (resolve(folder) === resolve(root)) continue;
    names.add(basename(folder));
  }
  return [...names];
}

function acceptedTerms(options: CheckOptions): Set<string> {
  const accepted = new Set<string>();
  for (const g of [options.coherence, options.project]) {
    if (g === undefined) continue;
    for (const name of acceptedNames(g)) accepted.add(normalizeTerm(name));
    for (const concept of g.concepts) {
      for (const entry of concept.notToBeConfusedWith) {
        const lead = normalizeTerm(entry.split(":")[0] ?? "");
        if (lead !== "" && lead.split(" ").length <= 3) accepted.add(lead);
      }
    }
  }
  return accepted;
}

/**
 * A term is counted where prose uses it as a name, not wherever the word
 * occurs: "the Structure view" twice is a name, "evidence" sixty times in
 * ordinary sentences is English. A component name counts wherever it
 * appears, since the folder is already using it as a name.
 */
function unknownNouns(files: CorpusFile[], options: CheckOptions, accepted: Set<string>, rejected: Set<string>): UnknownFinding[] {
  const prose = files.filter((f) => f.kind === "prose");
  const candidates = new Map<string, Candidate>();
  const add = (term: string, location: Location): void => {
    const existing = candidates.get(term);
    if (existing === undefined) candidates.set(term, { term, locations: [location] });
    else existing.locations.push(location);
  };
  for (const file of prose) {
    let fenced = false;
    let frontMatter = file.lines[0] === "---";
    file.lines.forEach((line, i) => {
      if (frontMatter) {
        if (i > 0 && line === "---") frontMatter = false;
        return;
      }
      if (/^\s*(```|~~~)/.test(line)) {
        fenced = !fenced;
        return;
      }
      if (fenced || /^\s*#/.test(line)) return;
      for (const term of candidatesOnLine(line, accepted, rejected)) add(term, { file: file.rel, line: i + 1 });
    });
  }
  for (const name of componentNames(files, options.root)) {
    const term = nominate(name, accepted, rejected);
    if (term === undefined || candidates.has(term)) continue;
    const regex = phraseRegex([term])!;
    const locations: Location[] = [];
    for (const file of prose) {
      file.lines.forEach((line, i) => {
        for (const _ of line.matchAll(regex)) locations.push({ file: file.rel, line: i + 1 });
      });
    }
    candidates.set(term, { term, locations });
  }

  const findings: UnknownFinding[] = [];
  for (const candidate of candidates.values()) {
    if (candidate.locations.length < 2) continue;
    findings.push({
      term: candidate.term,
      count: candidate.locations.length,
      locations: candidate.locations.slice(0, 3),
      options: {
        declare: `add "${candidate.term}" to the glossary as a concept`,
        map: `add "${candidate.term}" as an alias of an existing concept`,
        fix: `it is a rejected name or a mistake; replace it`,
      },
    });
  }
  findings.sort((a, b) => b.count - a.count || a.term.localeCompare(b.term));
  return findings;
}

/* ------------------------------------------------------------- report */

/** The rejected names in force for a project: both layers, minus Coherence names the project accepts. */
export function rejectedNamesInForce(coherence: Glossary, project: Glossary | undefined): { coherence: RejectedName[]; project: RejectedName[] } {
  const names = rejectedNames(coherence);
  if (project === undefined) return { coherence: names, project: [] };
  const projectAccepts = new Set([...acceptedNames(project)].map(normalizeTerm));
  const kept = names.filter((n) => !projectAccepts.has(normalizeTerm(n.name)) && !projectAccepts.has(singular(normalizeTerm(n.name))));
  return { coherence: kept, project: rejectedNames(project) };
}

export async function runCheck(options: CheckOptions): Promise<CheckReport> {
  const files = await readCorpus(options);
  const inForce = rejectedNamesInForce(options.coherence, options.project);
  const proseNames = nameTable([...inForce.coherence, ...inForce.project]);
  const codeNames = options.project === undefined ? proseNames : nameTable(inForce.project);
  const accepted = acceptedTerms(options);
  const guard = guardTable(accepted);
  const rejected: RejectedFinding[] = [];
  for (const file of files) {
    rejected.push(...(file.kind === "prose" ? rejectedInProse(file, proseNames, guard) : rejectedInCode(file, codeNames, guard)));
  }
  const unknown = unknownNouns(files, options, accepted, new Set(proseNames.byPhrase.keys()));
  return { files: files.length, rejected, unknown };
}

export function formatReport(report: CheckReport): string {
  const lines: string[] = [];
  for (const f of report.rejected) {
    lines.push(`REJECTED NAME  ${f.file}:${f.line}  "${f.text}"  rejected for ${f.concept}${f.because ? `: ${f.because}` : ""}`);
  }
  for (const f of report.unknown) {
    const where = f.locations.map((l) => `${l.file}:${l.line}`).join(", ");
    lines.push(`UNKNOWN NOUN   "${f.term}" (${f.count})  ${where}`);
    lines.push(`               declare: ${f.options.declare} | map: ${f.options.map} | fix: ${f.options.fix}`);
  }
  const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;
  lines.push(`${plural(report.rejected.length, "rejected name")}, ${plural(report.unknown.length, "unknown noun")} (${plural(report.files, "file")})`);
  return lines.join("\n") + "\n";
}

export function hasFindings(report: CheckReport): boolean {
  return report.rejected.length > 0 || report.unknown.length > 0;
}
