/**
 * Write-time advice: what a tool is about to write, looked up against the
 * advice index the last mirror reading kept, so a copy of a fact the project
 * already names is told its home before it lands, never after the count rose.
 *
 * The full reading never runs here. A hook reads the kept index once per
 * process (and again only when the file changed) and looks the incoming text
 * up: its quoted strings in a map of named constants, its string lists in a
 * map of named lists that are used as sets, its regular expressions and
 * chains of string tests against named rules that share a word with them,
 * and a JSON.parse cast to a named type against the parsers of that type. No
 * parser, no compiler: plain text, a few milliseconds.
 *
 * It speaks only where it is sure, and once:
 *   - only four classes: a copy of a named constant, a list within one member
 *     of a named list used as a set, a pattern that accepts what a named rule
 *     accepts, and a parser of a type a named function already parses with
 *     the same checks; never a bare literal with no named home, never prose
 *     or a UI string (anything with a space in it), never a value another
 *     party owns, a generated file, a migration, an example app, a file the
 *     config's restatements key names, or a test;
 *   - never for content that already imports the home, nor in the home's own
 *     file, nor in a file the reading already knows as a copy;
 *   - one message per family per session, and nothing more on a family once
 *     the session declined it: a `differs on purpose` comment, or a second
 *     write after it was told;
 *   - silent when no index is kept or it cannot be read.
 * It adds context and never blocks or denies, on any host.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileStemOf } from "../../journal/session-token.ts";
import { predicateOf, relate, type ChainLeaf, type PredicateSite } from "./predicates.ts";

export const ADVICE_DIR = join(".coherence", "mirrors");
const INDEX_FILE = "advice.json";
const SESSIONS_DIR = "advised";
export const ADVICE_VERSION = 1;

/** One named home the index keeps. */
export interface Home {
  name: string;
  file: string;
  line: number;
  exported: boolean;
}

export interface AdviceIndex {
  version: number;
  commit: string;
  at: string;
  /** Whether the project writes an import's extension (`./a.ts`) or leaves it off (`./a`). */
  importExtension: boolean;
  /** Folders whose files are tests by the project's rule, and the config's data and scripts globs as regular expressions: files the advice never speaks in. */
  testFolders: string[];
  quiet: string[];
  constants: (Home & { value: string; copies: string[] })[];
  lists: (Home & { members: string[]; copies: string[] })[];
  rules: (Home & { site: PredicateSite; atoms: string[]; copies: string[] })[];
  parsers: (Home & { type: string; fields: string[]; copies: string[] })[];
  /** A test that already holds a copy equal across a boundary: the precedent a file that cannot import is pointed to. */
  precedent?: string;
  /** For each home's file, the project files it imports, directly or not: a file among them importing the home back would make a cycle. */
  reaches?: Record<string, string[]>;
}

function indexPath(root: string): string {
  return join(root, ADVICE_DIR, INDEX_FILE);
}

/** Keep the index for the hooks. */
export function recordAdviceIndex(root: string, index: AdviceIndex): void {
  const path = indexPath(root);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(index));
  renameSync(temporary, path);
}

/** The kept index, read once per process and again only when its file changed; undefined when none is kept, it cannot be read, or it is of another version. */
const LOADED = new Map<string, { mtime: number; index: Loaded | undefined }>();

interface Loaded {
  index: AdviceIndex;
  byValue: Map<string, AdviceIndex["constants"][number]>;
  byMember: Map<string, AdviceIndex["lists"][number][]>;
  byAtom: Map<string, AdviceIndex["rules"][number][]>;
  byType: Map<string, AdviceIndex["parsers"][number][]>;
  quiet: RegExp[];
}

export function loadAdvice(root: string): Loaded | undefined {
  const path = indexPath(root);
  let mtime: number;
  try {
    mtime = statSync(path).mtimeMs;
  } catch {
    return undefined;
  }
  const kept = LOADED.get(root);
  if (kept !== undefined && kept.mtime === mtime) return kept.index;
  let loaded: Loaded | undefined;
  try {
    const index = JSON.parse(readFileSync(path, "utf8")) as AdviceIndex;
    loaded = index.version !== ADVICE_VERSION ? undefined : loadedOf(index);
  } catch {
    loaded = undefined;
  }
  LOADED.set(root, { mtime, index: loaded });
  return loaded;
}

function loadedOf(index: AdviceIndex): Loaded {
  const byMember = new Map<string, AdviceIndex["lists"][number][]>();
  for (const l of index.lists) for (const m of l.members) byMember.set(m, [...(byMember.get(m) ?? []), l]);
  const byAtom = new Map<string, AdviceIndex["rules"][number][]>();
  for (const r of index.rules) for (const a of r.atoms) byAtom.set(a, [...(byAtom.get(a) ?? []), r]);
  const byType = new Map<string, AdviceIndex["parsers"][number][]>();
  for (const p of index.parsers) byType.set(p.type, [...(byType.get(p.type) ?? []), p]);
  return { index, byValue: new Map(index.constants.map((c) => [c.value, c])), byMember, byAtom, byType, quiet: index.quiet.map((q) => new RegExp(q)) };
}

/* ------------------------------------------------------------ the overlay */

/** The homes a session wrote since its index was kept, by the file that defines them: what the kept index cannot know yet. */
type Overlay = Record<string, Pick<AdviceIndex, "constants" | "lists" | "rules" | "parsers">>;

function overlayPath(root: string, session: string): string {
  return join(root, ADVICE_DIR, SESSIONS_DIR, `${fileStemOf(session)}.overlay.json`);
}

function readOverlay(root: string, session: string): Overlay {
  try {
    return JSON.parse(readFileSync(overlayPath(root, session), "utf8")) as Overlay;
  } catch {
    return {};
  }
}

const TOP_CONSTANT = /^(export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(["'])((?:\\.|(?!\3)[^\\\n])*)\3\s*(?:as const\s*)?;?\s*$/;
const TOP_LIST = /^(export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:new Set(?:<[^>]*>)?\(\s*)?\[([^\]]*)\]/;
const TOP_REGEX = /^(export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*\/((?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])+)\/([dgimsuy]*)\s*;?\s*$/;
const TOP_FUNCTION = /^(export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/;

/**
 * The homes a written file defines at its top level, read from its text
 * alone as the hook has it: a constant bound to a string with no space, a
 * list of three or more strings the file exports or asks for membership, a
 * regular expression with a word of its own, and a function that parses
 * JSON into a named type checking two or more fields. The same strict
 * classes the kept index holds; a test, a generated file or a quiet file
 * defines none.
 */
export function homesIn(loaded: Loaded, file: string, text: string): Overlay[string] {
  const out: Overlay[string] = { constants: [], lists: [], rules: [], parsers: [] };
  if (quietFile(loaded, file, text)) return out;
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    const c = TOP_CONSTANT.exec(line);
    if (c !== null && c[4]!.length >= 6 && !/\s/.test(c[4]!) && /[A-Za-z]/.test(c[4]!)) out.constants.push({ value: c[4]!, name: c[2]!, file, line: i + 1, exported: c[1] !== undefined, copies: [] });
    const l = TOP_LIST.exec(line);
    if (l !== null) {
      const members = [...l[3]!.matchAll(QUOTED)].map((m) => m[2]!).filter((m) => m.length >= 2);
      const used = l[1] !== undefined || [".has(", ".includes(", ".indexOf(", ".some(", ".every("].some((m) => text.includes(`${l[2]!}${m}`));
      if (new Set(members).size >= 3 && used) out.lists.push({ members, name: l[2]!, file, line: i + 1, exported: l[1] !== undefined, copies: [] });
    }
    const r = TOP_REGEX.exec(line);
    if (r !== null) {
      const site: PredicateSite = { file, line: i + 1, form: "regex", text: r[3]!, flags: r[4]!, bound: r[2]!, topLevel: true, exported: r[1] !== undefined };
      const pred = predicateOf(site);
      if (pred !== undefined && pred.atoms.some((a) => a.length >= 3)) out.rules.push({ site, atoms: pred.atoms, name: r[2]!, file, line: i + 1, exported: r[1] !== undefined, copies: [] });
    }
    const f = TOP_FUNCTION.exec(line);
    if (f !== null) {
      const end = lines.findIndex((x, k) => k > i && /^}/.test(x));
      const body = lines.slice(i, end < 0 ? lines.length : end + 1).join("\n");
      const type = /\bas\s+(?:Partial<\s*)?([A-Z][\w$]*)/.exec(body)?.[1];
      const fields = [...new Set([...body.matchAll(/typeof\s+[\w$]+\.([\w$]+)/g)].map((m) => m[1]!))];
      if (body.includes("JSON.parse") && type !== undefined && fields.length >= 2) out.parsers.push({ type, fields, name: f[2]!, file, line: i + 1, exported: f[1] !== undefined, copies: [] });
    }
  });
  return out;
}

/** Fold what these writes define into the session's overlay, each file's homes replacing what that file defined before; silent and a no-op when the kept index is cold. */
export function foldWrites(root: string, session: string | undefined, files: readonly { file: string; text: string }[]): void {
  const loaded = loadAdvice(root);
  if (loaded === undefined || session === undefined || files.length === 0) return;
  const overlay = readOverlay(root, session);
  let changed = false;
  for (const { file, text } of files) {
    const homes = homesIn(loaded, file, text);
    const empty = homes.constants.length + homes.lists.length + homes.rules.length + homes.parsers.length === 0;
    if (empty && overlay[file] === undefined) continue;
    if (empty) delete overlay[file];
    else overlay[file] = homes;
    changed = true;
  }
  // A file a writing tool wrote was looked at before it was written: the shell re-check leaves it alone until it changes again.
  const state = readSessionAdvice(root, session);
  for (const { file } of files) {
    try {
      state.seen = { ...state.seen, [file]: statSync(join(root, file)).mtimeMs };
    } catch {
      continue;
    }
  }
  keepSessionAdvice(root, session, state);
  if (!changed) return;
  const path = overlayPath(root, session);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(overlay));
}

/** The kept index with the session's overlay folded in, a home the kept index has winning over the session's own; the kept one alone when the session wrote none. */
export function withOverlay(root: string, session: string | undefined, loaded: Loaded): Loaded {
  if (session === undefined) return loaded;
  const overlay = readOverlay(root, session);
  const files = Object.keys(overlay);
  if (files.length === 0) return loaded;
  const kept = new Set(loaded.index.constants.map((c) => c.value));
  const index: AdviceIndex = {
    ...loaded.index,
    constants: [...loaded.index.constants, ...files.flatMap((f) => overlay[f]!.constants.filter((c) => !kept.has(c.value)))],
    lists: [...loaded.index.lists, ...files.flatMap((f) => overlay[f]!.lists)],
    rules: [...loaded.index.rules, ...files.flatMap((f) => overlay[f]!.rules)],
    parsers: [...loaded.index.parsers, ...files.flatMap((f) => overlay[f]!.parsers)],
  };
  return loadedOf(index);
}

/* ------------------------------------------------------------- the lookup */

export type AdviceClass = "constant" | "list" | "rule" | "parser";

export interface Advice {
  /** The family: one class and one home, the unit a session is told once. */
  family: string;
  cls: AdviceClass;
  home: Home;
  text: string;
  /** The write binds the home's own name: a move as often as a copy, which the write alone cannot tell, so it is said at the stop, and only if the home still defines the name. */
  second?: true;
}

/** Whether a text binds a name at its top level, as a constant, a function or a class: read as words, never a pattern built from the name. */
export function definesName(text: string, name: string): boolean {
  return definedNames(text).has(name);
}

/** The names a text binds at its top level, read once. */
function definedNames(text: string): Set<string> {
  const out = new Set<string>();
  for (const line of text.split("\n")) {
    if (!/^(?:export\s+)?(?:default\s+)?(?:const|let|var|function|class|async)\b/.test(line)) continue;
    const words = line.replace(/^export\s+(?:default\s+)?/, "").match(/[\w$]+/g) ?? [];
    const at = ["const", "let", "var", "function", "class"].includes(words[0] ?? "") ? 1 : words[0] === "async" && words[1] === "function" ? 2 : -1;
    if (at > 0 && words[at] !== undefined) out.add(words[at]);
  }
  return out;
}

const GENERATED_NAME = /(?:\.gen|(?:^|[/._-])generated)\.[^/.]+$/;
const GENERATED_HEAD = /@generated|auto-?generated|do not (?:edit|modify)|automatically generated|(?:is|was|has been) generated|generated (?:by|using|with|from) /i;
const MIGRATION = /(?:^|\/)migrations?\/(?:.*\/)?(?:\d{3,}|V\d+[._])[^/]*$/;
const TEST_NAME = /\.(?:test|spec|e2e|e2e-spec)\.[a-z]+$/;
const CODE = /\.[cm]?[jt]sx?$/;

/** Whether the advice stays silent for a file, whatever it holds: a test, a generated file, a migration, or one the index says to leave quiet (the config's data and scripts, an example app). */
export function quietFile(loaded: Loaded, file: string, text: string): boolean {
  if (!CODE.test(file) || file.endsWith(".d.ts")) return true;
  const parts = file.split("/");
  if (TEST_NAME.test(parts[parts.length - 1] ?? "") || /fixture/.test(file) || parts.some((p) => loaded.index.testFolders.includes(p))) return true;
  if (GENERATED_NAME.test(file) || MIGRATION.test(file)) return true;
  if (GENERATED_HEAD.test(text.split("\n", 12).filter((l) => /^\s*(?:\/\/|\/\*|\*)/.test(l)).join("\n"))) return true;
  return loaded.quiet.some((q) => q.test(file));
}

/** The import a file would write to take a name from its home. */
function importLine(loaded: Loaded, from: string, home: Home): string {
  let rel = posix.relative(posix.dirname(from), home.file);
  if (!rel.startsWith(".")) rel = `./${rel}`;
  if (!loaded.index.importExtension) rel = rel.replace(/\.[cm]?[jt]sx?$/, "");
  return `import { ${home.name} } from "${rel}"`;
}

/** The steps to reuse a home: export it there first when it is private, then import it; across a part of the project that cannot import it, hold the copy by a test as the precedent does. */
function reuse(loaded: Loaded, from: string, home: Home): string {
  // The home's file already imports this one: importing back would make a cycle, so the value belongs in a module both can import.
  if (loaded.index.reaches?.[home.file]?.includes(from) === true) return `${home.file} imports ${from}, so importing back would make a cycle: move \`${home.name}\` to a module both can import, and import it in both.`;
  const top = (f: string): string => f.split("/")[0] ?? "";
  const across = top(from) !== top(home.file) && (top(from) === "plugins" || top(from) === "bench" || top(from) === "mods" || top(home.file) === "plugins");
  const steps = `${home.exported ? "" : `export it there as \`${home.name}\` first, then `}${importLine(loaded, from, home)}`;
  if (!across) return `Reuse it: ${steps}.`;
  return `Reuse it: ${steps}; if ${from} cannot import from ${home.file}, hold the copy equal by a test${loaded.index.precedent === undefined ? "" : `, as ${loaded.index.precedent} does`}.`;
}

const QUOTED = /(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
const LIST = /\[\s*((?:(["'])(?:\\.|(?!\2)[^\\\n])*\2\s*,\s*){2,}(["'])(?:\\.|(?!\3)[^\\\n])*\3\s*,?)\s*\]/g;
const REGEX_LITERAL = /(?:^|[=(,:!&|?{;[]|return|\n)\s*\/((?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])+)\/([dgimsuy]*)/g;
const CHAIN_LEAF = /([\w$.]+)\.(startsWith|endsWith|includes)\(\s*(["'])((?:\\.|(?!\3)[^\\\n])*)\3\s*\)/g;
const EQUALS_LEAF = /([\w$.]+)\s*(===|!==)\s*(["'])((?:\\.|(?!\3)[^\\\n])*)\3/g;

/** The advice for one write: what it copies, in the classes the advice speaks for, each family once. */
export function adviceFor(loaded: Loaded, file: string, text: string, existing = ""): Advice[] {
  if (quietFile(loaded, file, existing === "" ? text : existing)) return [];
  const out = new Map<string, Advice>();
  // Whether an import statement binds the name: the statements' words, compared as words, never a pattern built from the name.
  // Read once a write, on first need: a lookup per candidate would scan the write once per home.
  let imported: Set<string> | undefined;
  const imports = (name: string): boolean => {
    imported ??= new Set([text, existing].flatMap((t) => [...t.matchAll(/\bimport\b([^;]*?)\bfrom\b/g)].flatMap((m) => (m[1]!.match(/[\w$]+/g) ?? []) as string[])));
    return imported.has(name);
  };
  const skip = (home: Home & { copies: string[] }): boolean => home.file === file || home.copies.includes(file) || imports(home.name);
  let bound: Set<string> | undefined;
  const add = (cls: AdviceClass, home: Home & { copies: string[] }, body: string): void => {
    const family = `${cls}:${home.file}:${home.name}`;
    if (out.has(family)) return;
    bound ??= definedNames(text);
    out.set(family, { family, cls, home: { name: home.name, file: home.file, line: home.line, exported: home.exported }, text: `${body} ${reuse(loaded, file, home)}`, ...(bound.has(home.name) ? { second: true as const } : {}) });
  };

  // Named constants: a quoted string the index names, written again.
  for (const m of text.matchAll(QUOTED)) {
    const c = loaded.byValue.get(m[2]!);
    if (c !== undefined && !skip(c)) add("constant", c, `Restatement: ${JSON.stringify(c.value)} is \`${c.name}\` in ${c.file}:${c.line}.`);
  }

  // Named lists used as sets: a list of three or more strings within one member of one.
  for (const m of text.matchAll(LIST)) {
    const members = [...m[1]!.matchAll(QUOTED)].map((q) => q[2]!);
    if (new Set(members).size < 3) continue;
    const seen = new Set<AdviceIndex["lists"][number]>();
    for (const member of members) for (const l of loaded.byMember.get(member) ?? []) seen.add(l);
    for (const l of seen) {
      if (skip(l)) continue;
      const mine = new Set(members);
      const theirs = new Set(l.members);
      const onlyMine = [...mine].filter((x) => !theirs.has(x));
      const onlyTheirs = [...theirs].filter((x) => !mine.has(x));
      if (onlyMine.length + onlyTheirs.length > 1) continue;
      const odd = onlyMine.length === 1 ? `; it adds ${JSON.stringify(onlyMine[0])}, which ${l.name} lacks` : onlyTheirs.length === 1 ? `; it lacks ${JSON.stringify(onlyTheirs[0])}` : "";
      add("list", l, `Restatement: this list is \`${l.name}\` in ${l.file}:${l.line}${odd}.`);
    }
  }

  // Named rules: a regular expression or a chain of string tests that accepts what one accepts.
  const incoming: PredicateSite[] = [];
  for (const m of text.matchAll(REGEX_LITERAL)) incoming.push({ file, line: 0, form: "regex", text: m[1]!, flags: m[2]! });
  for (const m of text.matchAll(/new RegExp\(\s*`((?:\\.|[^`\\])*)`/g)) incoming.push({ file, line: 0, form: "regex", text: m[1]!.replace(/\$\{[^}]*\}/g, ".*").replace(/\\\\/g, "\\"), flags: "" });
  for (const chain of chainsIn(text)) incoming.push({ file, line: 0, form: "chain", text: "", chain });
  for (const site of incoming) {
    const pred = predicateOf(site);
    if (pred === undefined || pred.atoms.length === 0) continue;
    const homes = new Set<AdviceIndex["rules"][number]>();
    for (const a of pred.atoms) for (const r of loaded.byAtom.get(a) ?? []) homes.add(r);
    for (const r of homes) {
      if (skip(r) || !r.atoms.every((a) => pred.atoms.includes(a))) continue;
      const home = predicateOf(r.site);
      if (home === undefined || relate(home, pred) !== "equal") continue;
      add("rule", r, `Restatement: this ${site.form === "chain" ? "chain of string tests" : "pattern"} accepts what \`${r.name}\` in ${r.file}:${r.line} accepts.`);
    }
  }

  // Parsers: a JSON.parse cast to a type a named function already parses, checking the same fields.
  if (text.includes("JSON.parse")) {
    const fields = new Set([...text.matchAll(/typeof\s+[\w$]+\.([\w$]+)/g)].map((m) => m[1]!));
    for (const m of text.matchAll(/\bas\s+(?:Partial<\s*)?([A-Z][\w$]*)/g)) {
      for (const p of loaded.byType.get(m[1]!) ?? []) {
        if (skip(p) || p.fields.length < 2 || !p.fields.every((f) => fields.has(f))) continue;
        add("parser", p, `Restatement: this parses ${p.type} with the same ${p.fields.join(", ")} checks as \`${p.name}\` in ${p.file}:${p.line}.`);
      }
    }
  }
  return [...out.values()];
}

/** The chains of two or more string tests over one receiver joined by one operator, as written. */
function chainsIn(text: string): { join: "or" | "and"; leaves: ChainLeaf[] }[] {
  const out: { join: "or" | "and"; leaves: ChainLeaf[] }[] = [];
  for (const line of text.split("\n")) {
    for (const [op, join] of [["||", "or"], ["&&", "and"]] as const) {
      if (!line.includes(op)) continue;
      const byReceiver = new Map<string, ChainLeaf[]>();
      for (const m of line.matchAll(CHAIN_LEAF)) {
        const before = line.slice(0, m.index).trimEnd();
        const negated = before.endsWith("!");
        byReceiver.set(m[1]!, [...(byReceiver.get(m[1]!) ?? []), { op: m[2] as ChainLeaf["op"], value: m[4]!, negated }]);
      }
      for (const m of line.matchAll(EQUALS_LEAF)) byReceiver.set(m[1]!, [...(byReceiver.get(m[1]!) ?? []), { op: "equals", value: m[4]!, negated: m[2] === "!==" }]);
      for (const leaves of byReceiver.values()) if (leaves.length >= 2) out.push({ join, leaves });
    }
  }
  return out;
}

/* ------------------------------------------------------------ the session */

interface SessionAdvice {
  told: Record<string, string>;
  declined: string[];
  /** How many writes this session made that copied each family, told or not. */
  writes: Record<string, number>;
  /** When files a shell command wrote were last looked at. */
  checkedAt?: number;
  /** Families a write bound again under the home's own name, by the file that bound it: said at the stop if the home still defines the name. */
  second?: Record<string, string>;
  /** Each file a writing tool wrote, by its time then: the shell re-check leaves a file alone that has not changed since its tool write was looked at. */
  seen?: Record<string, number>;
}

function sessionPath(root: string, session: string): string {
  return join(root, ADVICE_DIR, SESSIONS_DIR, `${fileStemOf(session)}.json`);
}

export function readSessionAdvice(root: string, session: string): SessionAdvice {
  try {
    const kept = JSON.parse(readFileSync(sessionPath(root, session), "utf8")) as SessionAdvice;
    return { told: kept.told ?? {}, declined: kept.declined ?? [], writes: kept.writes ?? {}, ...(kept.checkedAt === undefined ? {} : { checkedAt: kept.checkedAt }), ...(kept.second === undefined ? {} : { second: kept.second }), ...(kept.seen === undefined ? {} : { seen: kept.seen }) };
  } catch {
    return { told: {}, declined: [], writes: {} };
  }
}

function keepSessionAdvice(root: string, session: string, state: SessionAdvice): void {
  const path = sessionPath(root, session);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state));
}

/**
 * What a session is told for these writes, and the commit that records it once
 * the line reached the host. A family already told is declined by this second
 * write and said no more; one a `differs on purpose` comment names is declined
 * at once; a declined family is never said again.
 */
export function sessionAdvice(root: string, session: string | undefined, writes: readonly { file: string; text: string; existing?: string }[], now: () => number = Date.now): { text: string; commit: () => void } {
  const none = { text: "", commit: () => {} };
  const kept = loadAdvice(root);
  // The overlay alone never speaks: with no kept index, nothing is said.
  if (kept === undefined || session === undefined || writes.length === 0) return none;
  const loaded = withOverlay(root, session, kept);
  const state = readSessionAdvice(root, session);
  const say: Advice[] = [];
  let changed = false;
  for (const w of writes) {
    for (const a of adviceFor(loaded, w.file, w.text, w.existing ?? "")) {
      state.writes[a.family] = (state.writes[a.family] ?? 0) + 1;
      changed = true;
      if (state.declined.includes(a.family)) continue;
      // Bound under the home's own name: a move or a second definition, which only the stop can tell apart.
      if (a.second === true) {
        state.second = { ...state.second, [a.family]: w.file };
        continue;
      }
      if (/differs on purpose from/.test(w.text) && w.text.includes(a.home.file.split("/").pop()!.replace(/\.[^.]+$/, ""))) {
        state.declined.push(a.family);
        continue;
      }
      if (state.told[a.family] !== undefined) {
        state.declined.push(a.family);
        continue;
      }
      if (!say.some((s) => s.family === a.family)) say.push(a);
    }
  }
  const commit = (): void => {
    for (const a of say) state.told[a.family] = new Date(now()).toISOString();
    if (changed || say.length > 0) keepSessionAdvice(root, session, state);
  };
  if (say.length === 0) {
    if (changed) keepSessionAdvice(root, session, state);
    return none;
  }
  return { text: say.map((a) => a.text).join("\n"), commit };
}

/** The Stop's one line: every family this session wrote more than once, from the session's own state alone, never waiting on anything. */
export function adviceStopText(root: string, session: string | undefined): string {
  if (session === undefined || !existsSync(sessionPath(root, session))) return "";
  const state = readSessionAdvice(root, session);
  // A name bound again in another file is a second definition only if the home still binds it at the stop; a moved home no longer does.
  const both = Object.entries(state.second ?? {})
    .filter(([family, file]) => {
      const [, home, name] = family.split(":");
      if (home === undefined || name === undefined || state.declined.includes(family)) return false;
      try {
        return definesName(readFileSync(join(root, home), "utf8"), name) && definesName(readFileSync(join(root, file), "utf8"), name);
      } catch {
        return false;
      }
    })
    .slice(0, 5)
    .map(([family, file]) => {
      const [, home, name] = family.split(":");
      return `${name} is defined in both ${home} and ${file}`;
    });
  const twice = Object.entries(state.writes).filter(([family, n]) => n >= 2 && state.second?.[family] === undefined).sort((x, y) => y[1] - x[1]);
  if (twice.length === 0 && both.length === 0) return "";
  const named = twice.slice(0, 5).map(([family, n]) => {
    const [, file, name] = family.split(":");
    return `${name} (${file}, written ${n} times)`;
  });
  const parts = [
    ...(twice.length === 0 ? [] : [`this session wrote ${twice.length === 1 ? "a fact" : `${twice.length} facts`} more than once: ${named.join("; ")}${twice.length > 5 ? "; and more" : ""}`]),
    ...(both.length === 0 ? [] : [both.join("; ")]),
  ];
  return `Restatements: ${parts.join(". ")}. Give each one home, or hold the copies by a test.`;
}

/** The files a shell command changed since this session last looked: tracked changes and untracked files, by their time, the project's code alone. */
export function changedSince(root: string, session: string, files: readonly string[], now: () => number = Date.now): { file: string; text: string }[] {
  const state = readSessionAdvice(root, session);
  // The first look of a session reaches back ten minutes, to the command that just ran, never to files left changed before the session.
  const since = state.checkedAt ?? now() - 10 * 60_000;
  const out: { file: string; text: string }[] = [];
  for (const file of files) {
    if (!CODE.test(file) || out.length >= 20) continue;
    try {
      const stat = statSync(join(root, file));
      if (stat.mtimeMs <= since || stat.size > 256 * 1024 || state.seen?.[file] === stat.mtimeMs) continue;
      out.push({ file, text: readFileSync(join(root, file), "utf8") });
    } catch {
      continue;
    }
  }
  state.checkedAt = now();
  keepSessionAdvice(root, session, state);
  return out;
}
