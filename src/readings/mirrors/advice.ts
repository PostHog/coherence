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
    if (index.version !== ADVICE_VERSION) loaded = undefined;
    else {
      const byMember = new Map<string, AdviceIndex["lists"][number][]>();
      for (const l of index.lists) for (const m of l.members) byMember.set(m, [...(byMember.get(m) ?? []), l]);
      const byAtom = new Map<string, AdviceIndex["rules"][number][]>();
      for (const r of index.rules) for (const a of r.atoms) byAtom.set(a, [...(byAtom.get(a) ?? []), r]);
      const byType = new Map<string, AdviceIndex["parsers"][number][]>();
      for (const p of index.parsers) byType.set(p.type, [...(byType.get(p.type) ?? []), p]);
      loaded = { index, byValue: new Map(index.constants.map((c) => [c.value, c])), byMember, byAtom, byType, quiet: index.quiet.map((q) => new RegExp(q)) };
    }
  } catch {
    loaded = undefined;
  }
  LOADED.set(root, { mtime, index: loaded });
  return loaded;
}

/* ------------------------------------------------------------- the lookup */

export type AdviceClass = "constant" | "list" | "rule" | "parser";

export interface Advice {
  /** The family: one class and one home, the unit a session is told once. */
  family: string;
  cls: AdviceClass;
  home: Home;
  text: string;
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
  const imports = (name: string): boolean => new RegExp(`import[^;]*\\b${name.replace(/[$]/g, "\\$")}\\b[^;]*from`).test(text) || new RegExp(`import[^;]*\\b${name.replace(/[$]/g, "\\$")}\\b[^;]*from`).test(existing);
  const skip = (home: Home & { copies: string[] }): boolean => home.file === file || home.copies.includes(file) || imports(home.name);
  const add = (cls: AdviceClass, home: Home & { copies: string[] }, body: string): void => {
    const family = `${cls}:${home.file}:${home.name}`;
    if (!out.has(family)) out.set(family, { family, cls, home: { name: home.name, file: home.file, line: home.line, exported: home.exported }, text: `${body} ${reuse(loaded, file, home)}` });
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
}

function sessionPath(root: string, session: string): string {
  return join(root, ADVICE_DIR, SESSIONS_DIR, `${fileStemOf(session)}.json`);
}

export function readSessionAdvice(root: string, session: string): SessionAdvice {
  try {
    const kept = JSON.parse(readFileSync(sessionPath(root, session), "utf8")) as SessionAdvice;
    return { told: kept.told ?? {}, declined: kept.declined ?? [], writes: kept.writes ?? {}, ...(kept.checkedAt === undefined ? {} : { checkedAt: kept.checkedAt }) };
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
  const loaded = loadAdvice(root);
  if (loaded === undefined || session === undefined || writes.length === 0) return none;
  const state = readSessionAdvice(root, session);
  const say: Advice[] = [];
  let changed = false;
  for (const w of writes) {
    for (const a of adviceFor(loaded, w.file, w.text, w.existing ?? "")) {
      state.writes[a.family] = (state.writes[a.family] ?? 0) + 1;
      changed = true;
      if (state.declined.includes(a.family)) continue;
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
  const twice = Object.entries(state.writes).filter(([, n]) => n >= 2).sort((x, y) => y[1] - x[1]);
  if (twice.length === 0) return "";
  const named = twice.slice(0, 5).map(([family, n]) => {
    const [, file, name] = family.split(":");
    return `${name} (${file}, written ${n} times)`;
  });
  return `Restatements: this session wrote ${twice.length === 1 ? "a fact" : `${twice.length} facts`} more than once: ${named.join("; ")}${twice.length > 5 ? "; and more" : ""}. Give each one home, or hold the copies by a test.`;
}

/** The files a shell command changed since this session last looked: tracked changes and untracked files, by their time, the project's code alone. */
export function changedSince(root: string, session: string, files: readonly string[], now: () => number = Date.now): { file: string; text: string }[] {
  const state = readSessionAdvice(root, session);
  const since = state.checkedAt ?? 0;
  const out: { file: string; text: string }[] = [];
  for (const file of files) {
    if (!CODE.test(file) || out.length >= 20) continue;
    try {
      const stat = statSync(join(root, file));
      if (stat.mtimeMs <= since || stat.size > 256 * 1024) continue;
      out.push({ file, text: readFileSync(join(root, file), "utf8") });
    } catch {
      continue;
    }
  }
  state.checkedAt = now();
  keepSessionAdvice(root, session, state);
  return out;
}
