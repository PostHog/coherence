/**
 * The reading of every component interface: the set of resolved references
 * from one component to another, taken through the language adapter.
 *
 * The reading is bounded to the declared components. The code it reads is
 * the component code: every non-test source file the config's bounds keep
 * (its ignore list, and the folders no walk enters) whose nearest spec
 * folder is a component, each file belonging to that nearest component only,
 * so the root component holds the bounded files no deeper component claims
 * and never the whole tree below it. Only a declaration in component code is
 * ever asked about. A reference site counts toward an interface when it
 * sits in component code of another component. A site inside the bounds in
 * code no component owns is outside: counted per callee component and said,
 * never drawn and never silently dropped. Code past the config's bounds is
 * not the project's by the adopter's own word, so a site there is never
 * counted, and the server the reading starts for itself (a Python one) is
 * bounded the same way, which is what makes a monorepo readable: a
 * references query scans every workspace file that spells the name, and on
 * a whole monorepo one common name costs gigabytes.
 *
 * Before the server is asked, one word index is built over the component
 * code, once per reading: every identifier token of every file, with the
 * components whose files spell it. An exported declaration is asked for its
 * references only when a file of another component spells its name, or a
 * name it is aliased to, or a whole-module import or re-export there names
 * its file, or it is a default export. That is sound, not a heuristic: the
 * server reports a reference only where the text names the thing, so a name
 * no other component's text spells cannot have a site there. The escape
 * hatches are handled, not assumed away: a star import (`from x import *`)
 * or a wildcard re-export (`export * from`) spells no name and the adapters
 * report a site at it for every declaration of the module, so every
 * declaration of a module another component star-imports is asked; an alias
 * (`import a as b`, `export { a as b }`) extends the name to its aliases,
 * wherever the alias is written, so a caller that spells only the alias is
 * still found; a default export is imported under any name, so it is always
 * asked; `__all__` lists and `getattr` strings are tokens like any other,
 * since the index reads strings and comments too. Aliases are read over the
 * component code, where every site that counts sits.
 *
 * Each entrance's handler is resolved the same way, with its static reach:
 * the declarations its code references and every one those reference,
 * through value references only, and the component interfaces that reach
 * uses. The reach needs a component's own references too, which the word
 * index cannot rule out, so it is read to a fixed point: a declaration is
 * asked for the reach when a file the reach has already entered spells it
 * (its name or an alias), since a reference enclosed by a reached
 * declaration sits in that declaration's file. A private declaration is
 * resolved only for the reach: it is referenced from its own file and is
 * never an interface.
 *
 * The reading is bounded in time and in the language server's memory. When
 * either budget is spent it stops asking, keeps what it read, and says it is
 * partial, which budget stopped it, and whose declarations were not all
 * read; a partial map is never presented as complete.
 *
 * Nothing here is stored: the builder passes the reading into the page
 * state, and every list is sorted, so one tree reads the same every time.
 * The adapter is started in this process and never writes into the tree it
 * reads, so a read-only project can be read.
 *
 * This is Node-only; the browser bundle never imports it.
 */

import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Definition, LanguageAdapter, ReferenceSite } from "../../adapters/adapter.ts";
import { configIgnore, projectFiles, projectSites, underIgnored } from "../../adapters/project-files.ts";
import { adapterFor, type Language } from "../../adapters/index.ts";
import { resolveDotted } from "../../adapters/python.ts";
import { resolveSpecifier } from "../../adapters/typescript.ts";
import { EXCLUDED_FOLDERS, componentOf, declarationsOf, isSourceFile, isTest } from "../../economy/source.ts";
import { readEnforcementConfig } from "../../enforcement/config.ts";
import { loadSpecModel, type SpecModel } from "../../spec/model.ts";
import type { EntranceResolution, InterfaceReading, InterfaceSymbol, ReachReference } from "./model.ts";

/** Whether a declaration line declares a type only (an interface or a type alias): a route never follows one. */
export function isTypeDeclaration(line: string, language: string): boolean {
  return language === "typescript" && /^(?:export\s+)?(?:declare\s+)?(?:interface|type)\s/.test(line.trim());
}

interface ReachNode {
  component: string;
  name: string;
  file: string;
  type: boolean;
}

/** The nodes a handler's static reach enters: the start and every value declaration reached from it. */
function reachedFrom(start: string, nodes: ReadonlyMap<string, ReachNode>, calls: ReadonlyMap<string, ReadonlyMap<string, number>>): Set<string> {
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length > 0) {
    const at = queue.shift()!;
    for (const to of (calls.get(at) ?? new Map<string, number>()).keys()) {
      const target = nodes.get(to);
      if (target === undefined || target.type || seen.has(to)) continue;
      seen.add(to);
      queue.push(to);
    }
  }
  return seen;
}

/**
 * A handler's static reach: every declaration its code references, and every
 * one those reference, through value references only (a type is never
 * followed), and the component interfaces that reach uses: each reference
 * from a reached declaration into another component's value declaration.
 */
export function reachOf(start: string, nodes: ReadonlyMap<string, ReachNode>, calls: ReadonlyMap<string, ReadonlyMap<string, number>>): ReachReference[] {
  const seen = new Set([start]);
  const queue = [start];
  const used = new Map<string, ReachReference>();
  while (queue.length > 0) {
    const at = queue.shift()!;
    const from = nodes.get(at);
    for (const [to, sites] of calls.get(at) ?? []) {
      const target = nodes.get(to);
      if (target === undefined || target.type) continue;
      if (from !== undefined && target.component !== from.component) {
        const key = `${from.component}\u0000${target.component}\u0000${target.name}\u0000${target.file}`;
        const known = used.get(key);
        if (known === undefined) used.set(key, { from: from.component, to: target.component, symbol: target.name, file: target.file, sites });
        else known.sites += sites;
      }
      if (seen.has(to)) continue;
      seen.add(to);
      queue.push(to);
    }
  }
  return [...used.values()].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.symbol.localeCompare(b.symbol) || a.file.localeCompare(b.file));
}

/* ------------------------------------------------------------ the bounds */

/** The extensions a language server can report a reference site in; a site in any of them is component code when it lies in a component. */
const SITE_EXTENSIONS: Record<Language, readonly string[]> = {
  typescript: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"],
  python: [".py", ".pyi"],
};

/** Whether a project-relative file lies inside the config's bounds: under no ignored folder, no folder no walk enters, and no dot folder. */
export function withinBounds(file: string, skip: Set<string>): boolean {
  if (file.split("/").slice(0, -1).some((name) => name.startsWith("."))) return false;
  return !underIgnored(file, skip);
}

/** The adapter the reading starts for itself: bounded to the config's ignore list, when it names one and the language's server can be bounded. */
function boundedAdapter(language: Language, root: string, ignore: readonly string[]): LanguageAdapter {
  return ignore.length === 0 ? adapterFor(language, root) : adapterFor(language, root, { exclude: ignore });
}

/**
 * A server of its own for a reader that keeps one warm (the live Scope
 * server) and would otherwise read through its whole-workspace instrument:
 * a bounded adapter, with the bounds it was made for, when the language's
 * server narrows to bounds (Python) and the config names any; undefined
 * when the shared instrument reads the same (TypeScript's server reads its
 * tsconfig's project either way, and no bounds means the whole workspace).
 */
export function interfaceAdapter(root: string): { adapter: LanguageAdapter; bounds: string } | undefined {
  const language = readEnforcementConfig(root).language;
  const ignore = configIgnore(root);
  if (language !== "python" || ignore.length === 0) return undefined;
  return { adapter: boundedAdapter(language, root, ignore), bounds: ignore.join("\n") };
}

/** The bounds interfaceAdapter would build for the root now, to tell when a kept one is stale. */
export function interfaceBounds(root: string): string {
  return configIgnore(root).join("\n");
}

/** The folders the bounds leave out: the config's ignore list and the folders no walk enters. */
export function boundsOf(ignore: readonly string[]): Set<string> {
  return new Set([...EXCLUDED_FOLDERS, ...ignore]);
}

/**
 * The component a file's code belongs to for this reading: its nearest
 * component, when it is a non-test file of the language inside the config's
 * bounds; otherwise undefined, and a reference site there is outside.
 */
function componentCodeOf(model: SpecModel, file: string, language: Language, skip: Set<string>, testFolders: readonly string[]): string | undefined {
  if (!SITE_EXTENSIONS[language].some((ext) => file.endsWith(ext)) || isTest(file, testFolders) || !withinBounds(file, skip)) return undefined;
  return componentOf(model, file)?.folder;
}

/* ------------------------------------------------------- the word index */

const TOKEN = /[A-Za-z_$][A-Za-z0-9_$]*/g;
/** A TypeScript import or export list: `import { a as b } from`, `export { a as b }`, `export type { … }`. */
const TS_LIST = /\b(?:import|export)\s+(?:type\s+)?(?:[A-Za-z_$][\w$]*\s*,\s*)?\{([^}]*)\}/g;
/** A Python import statement, a parenthesized list or one logical line: `import a as b`, `from m import (a as b, c)`. */
const PY_IMPORT = /^[ \t]*(?:from\s+\S+\s+)?import\s+(\([^)]*\)|[^\n]*(?:\\\n[^\n]*)*)/gm;
const ALIAS = /([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)/g;
/** A TypeScript default export by name: `export default foo;`, `export = foo`, `export { foo as default }` is read as an alias to "default". */
const TS_DEFAULT_NAME = /^export\s+(?:default\s+|=\s*)([A-Za-z_$][\w$]*)\s*;?\s*$/gm;
const TS_WILDCARD = /^export\s+(?:type\s+)?\*(?:\s+as\s+[A-Za-z_$][A-Za-z0-9_$]*)?\s+from\s*["']([^"']+)["']/gm;
const PY_STAR = /^from\s+(\.*)([A-Za-z0-9_.]*)\s+import\s+\*/gm;

/**
 * What the prefilter knows about the component code's text: which
 * components' files spell each token, which files (by index) spell it, the
 * aliases each name is given, the names exported as a default, and the
 * files some component star-imports or wildcard re-exports with the
 * components that do.
 */
export interface WordIndex {
  files: string[];
  /** token -> the components whose files spell it. */
  owners: Map<string, Set<string>>;
  /** token -> the indexes (into files) of the files that spell it, with how many times each does. */
  where: Map<string, Map<number, number>>;
  /** name -> every name it is aliased to, transitively. */
  aliases: Map<string, Set<string>>;
  /** Names exported as a default, imported under any name. */
  defaults: Set<string>;
  /** A module file -> the components whose files import or re-export it whole. */
  wildcards: Map<string, Set<string>>;
}

/** The word index over the component code, each file with the component it belongs to. */
export function wordIndex(root: string, code: ReadonlyMap<string, string>, language: Language, read: (file: string) => string = (file) => readFileSync(join(root, file), "utf8")): WordIndex {
  const files = [...code.keys()].sort();
  const owners = new Map<string, Set<string>>();
  const where = new Map<string, Map<number, number>>();
  const direct = new Map<string, Set<string>>();
  const defaults = new Set<string>();
  const wildcards = new Map<string, Set<string>>();
  const add = <K, V>(map: Map<K, Set<V>>, key: K, value: V): void => {
    const set = map.get(key) ?? new Set<V>();
    set.add(value);
    map.set(key, set);
  };
  files.forEach((file, index) => {
    const owner = code.get(file)!;
    let text: string;
    try {
      text = read(file);
    } catch {
      return;
    }
    const counts = new Map<string, number>();
    for (const token of text.match(TOKEN) ?? []) counts.set(token, (counts.get(token) ?? 0) + 1);
    for (const [token, count] of counts) {
      add(owners, token, owner);
      const files = where.get(token) ?? new Map<number, number>();
      files.set(index, count);
      where.set(token, files);
    }
    const lists = language === "typescript" ? [...text.matchAll(TS_LIST)].map((m) => m[1]!) : [...text.matchAll(PY_IMPORT)].map((m) => m[1]!);
    for (const list of lists) {
      for (const [, original, alias] of list.matchAll(ALIAS)) {
        if (alias === "default") defaults.add(original!);
        else add(direct, original!, alias!);
      }
    }
    if (language === "typescript") {
      for (const [, name] of text.matchAll(TS_DEFAULT_NAME)) defaults.add(name!);
      for (const [, specifier] of text.matchAll(TS_WILDCARD)) {
        const target = resolveSpecifier(file, specifier!);
        if (target === undefined) continue;
        const stripped = target.replace(/\.(ts|tsx|mts|cts)$/, "");
        for (const candidate of [target, `${stripped}.ts`, `${stripped}.tsx`, `${stripped}.mts`, `${stripped}.cts`, `${stripped}/index.ts`]) add(wildcards, candidate, owner);
      }
    } else {
      for (const [, dots, dotted] of text.matchAll(PY_STAR)) {
        const target = resolveDotted(file, dots!, dotted!);
        if (target === undefined) continue;
        add(wildcards, `${target}.py`, owner);
        add(wildcards, `${target}/__init__.py`, owner);
      }
    }
  });
  // Every name an alias chain reaches, so a caller that spells only the last alias still counts.
  const aliases = new Map<string, Set<string>>();
  for (const name of direct.keys()) {
    const reached = new Set<string>();
    const queue = [name];
    while (queue.length > 0) {
      for (const next of direct.get(queue.shift()!) ?? []) {
        if (next === name || reached.has(next)) continue;
        reached.add(next);
        queue.push(next);
      }
    }
    aliases.set(name, reached);
  }
  return { files, owners, where, aliases, defaults, wildcards };
}

/** The spellings a declaration can be referenced by: its name and every alias it is given. */
function spellings(index: WordIndex, name: string): string[] {
  return [name, ...(index.aliases.get(name) ?? [])];
}

/**
 * Whether component code of a component other than `owner` could hold a
 * reference to the declaration: it spells the name or an alias, it
 * star-imports or wildcard re-exports the declaration's file, or the
 * declaration is a default export.
 */
export function namedElsewhere(index: WordIndex, name: string, file: string, owner: string, isDefault: boolean): boolean {
  if (isDefault || index.defaults.has(name)) return true;
  for (const component of index.wildcards.get(file) ?? []) if (component !== owner) return true;
  for (const spelling of spellings(index, name)) {
    for (const component of index.owners.get(spelling) ?? []) if (component !== owner) return true;
  }
  return false;
}

/**
 * Whether a file the reach has entered spells the declaration (its name or
 * an alias) somewhere other than where it is declared, or it is a default
 * export. The declaring file always spells the name once, at the
 * declaration, which the server never reports as a reference.
 */
function namedIn(index: WordIndex, name: string, own: number | undefined, entered: ReadonlySet<number>, isDefault: boolean): boolean {
  if (isDefault || index.defaults.has(name)) return true;
  for (const spelling of spellings(index, name)) {
    for (const [at, count] of index.where.get(spelling) ?? []) if (entered.has(at) && (at !== own || spelling !== name || count > 1)) return true;
  }
  return false;
}

/* ------------------------------------------------------------- the budget */

/** How much the reading may spend: wall time, and the resident memory of the language server it asks. */
export interface InterfaceBudget {
  seconds: number;
  memoryMB: number;
}

/**
 * The default budget. Ten minutes is the totality oracle's own ceiling
 * (TOTALITY_TIMEOUT_MS) and some forty times what Coherence's own reading
 * takes warm; a bounded reading of a PostHog subsystem finishes well inside
 * it, so a reading that has not finished by then is stuck, not slow. Three
 * gigabytes is under the four a language server's Node heap is capped at by
 * default, so the reading stops before the server thrashes or dies, and
 * well over what an adoption the size of a PostHog subsystem needs.
 */
export const DEFAULT_INTERFACE_BUDGET: InterfaceBudget = { seconds: 600, memoryMB: 3072 };

/** The config key that overrides the budget: `"interfaceBudget": { "seconds": 600, "memoryMB": 3072 }`. */
export const BUDGET_KEY = "interfaceBudget";

/** The budget the config sets, each part falling back to the default. */
export function configuredBudget(root: string): InterfaceBudget {
  const budget = { ...DEFAULT_INTERFACE_BUDGET };
  try {
    const path = join(root, "coherence.config.json");
    if (!existsSync(path)) return budget;
    const value = (JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>)[BUDGET_KEY];
    if (typeof value !== "object" || value === null) return budget;
    const { seconds, memoryMB } = value as Record<string, unknown>;
    if (typeof seconds === "number" && seconds > 0) budget.seconds = seconds;
    if (typeof memoryMB === "number" && memoryMB > 0) budget.memoryMB = memoryMB;
  } catch {
    // A malformed config is the spec walker's to refuse; the reading keeps the default.
  }
  return budget;
}

/** The flags that override the budget for one reading, as the scope and query commands take them. */
export const BUDGET_FLAGS = "[--interface-seconds <n>] [--interface-memory <MB>]";

/** The budget the flags `--interface-seconds` and `--interface-memory` give, or why a value is refused. */
export function budgetFlags(values: ReadonlyMap<string, string>): Partial<InterfaceBudget> | string {
  const budget: Partial<InterfaceBudget> = {};
  for (const [flag, key] of [["interface-seconds", "seconds"], ["interface-memory", "memoryMB"]] as const) {
    const value = values.get(flag);
    if (value === undefined) continue;
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return `--${flag} takes a positive number, not "${value}"`;
    budget[key] = n;
  }
  return budget;
}

/** A process that is a language server by its command line. */
const LANGUAGE_SERVER = /pyright|langserver|tsserver|typescript-language-server/;

/**
 * The resident memory, in megabytes, of the language server the reading
 * asks: the process `pid` and every process it started, when the adapter
 * names its server; otherwise every language server this process started,
 * found by command line among its descendants (a test runner the warm
 * server spawned is a descendant too, and is never counted). Undefined when
 * `ps` cannot answer.
 */
export function languageServerMemory(pid?: number): Promise<number | undefined> {
  return new Promise((resolve) => {
    execFile("ps", ["-A", "-o", "pid=,ppid=,rss=,args="], { maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
      if (error !== null) return resolve(undefined);
      const rows = stdout.split("\n").flatMap((line) => {
        const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line);
        return m === null ? [] : [{ pid: Number(m[1]), ppid: Number(m[2]), rss: Number(m[3]), args: m[4]! }];
      });
      const children = new Map<number, typeof rows>();
      for (const row of rows) children.set(row.ppid, [...(children.get(row.ppid) ?? []), row]);
      let kb = 0;
      const walk = (pid: number, counted: boolean): void => {
        for (const child of children.get(pid) ?? []) {
          const server = counted || LANGUAGE_SERVER.test(child.args);
          if (server) kb += child.rss;
          walk(child.pid, server);
        }
      };
      const own = pid === undefined ? undefined : rows.find((row) => row.pid === pid);
      if (own !== undefined) {
        kb += own.rss;
        walk(own.pid, true);
      } else walk(process.pid, false);
      resolve(Math.round(kb / 1024));
    });
  });
}

export interface ReadOptions {
  /** The budget; each part given overrides the config's, which overrides the default. */
  budget?: Partial<InterfaceBudget>;
  /** Ask every declaration, as before the word index: the oracle the prefilter is checked against. */
  exhaustive?: boolean;
  /** The language server's memory in megabytes (default: languageServerMemory); a test stubs it. */
  memory?: () => Promise<number | undefined>;
  /** How often memory is sampled, in milliseconds (default 2000). */
  sampleMs?: number;
}

const STOPPED = Symbol("stopped");

/* ------------------------------------------------------------ the reading */

interface Declared extends ReachNode {
  id: string;
  exported: boolean;
  isDefault: boolean;
}

/** Read every component interface of the project at `root` through `adapter` (started here when not given). */
export async function readComponentInterfaces(root: string, given?: LanguageAdapter, options: ReadOptions = {}): Promise<InterfaceReading> {
  const config = readEnforcementConfig(root);
  const model = loadSpecModel(root, { runs: false });
  const budget: InterfaceBudget = { ...configuredBudget(root), ...Object.fromEntries(Object.entries(options.budget ?? {}).filter(([, v]) => typeof v === "number" && v > 0)) };
  const started = Date.now();
  const deadline = started + budget.seconds * 1000;
  // Started here, the server reads only the config's bounds: nothing past them is ever counted, and a monorepo's
  // server that scans every file spelling a name would spend its memory on code the reading never draws.
  const ignore = configIgnore(root);
  const adapter = given ?? boundedAdapter(config.language, root, ignore);
  let stop: { limit: "time" | "memory"; observed?: number } | undefined;
  let memory: number | undefined;
  const measure = options.memory ?? (() => languageServerMemory(adapter.serverPid?.()));
  let sampling = false;
  const sampler = setInterval(() => {
    if (sampling) return;
    sampling = true;
    void measure()
      .then((mb) => {
        memory = mb;
      })
      .finally(() => {
        sampling = false;
      });
  }, options.sampleMs ?? 2000);
  sampler.unref();
  /** An adapter answer, or STOPPED once a budget is spent: a stalled server never holds the reading past its deadline. */
  const within = async <T>(question: () => Promise<T>): Promise<T | typeof STOPPED> => {
    if (stop === undefined && memory !== undefined && memory > budget.memoryMB) stop = { limit: "memory", observed: memory };
    if (stop === undefined && Date.now() >= deadline) stop = { limit: "time" };
    if (stop !== undefined) return STOPPED;
    let timer: NodeJS.Timeout | undefined;
    const expired = new Promise<typeof STOPPED>((resolve) => {
      timer = setTimeout(() => {
        stop ??= { limit: "time" };
        resolve(STOPPED);
      }, Math.max(0, deadline - Date.now()));
    });
    try {
      return await Promise.race([question(), expired]);
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    const ready = await within(() => adapter.ready());
    // One sample once the server is up, so a reading shorter than the sampling interval is still measured.
    if (ready !== STOPPED) memory = await measure();
    if (ready === STOPPED) return { kind: "unread", because: `the ${config.language} instrument did not start within the interface reading's time budget (${budget.seconds} s)` };
    if (!ready.ok) return { kind: "unread", because: `the ${config.language} instrument did not answer: ${ready.reason}` };
    const testFolders = config.testFolders;
    const skip = boundsOf(ignore);
    const language = config.language;
    // The component code: every bounded non-test file of the language whose nearest spec folder is a component.
    const code = new Map<string, string>();
    const unowned = { files: 0, lines: 0 };
    const declared: Declared[] = [];
    const nodes = new Map<string, ReachNode>();
    let declarations = 0;
    for (const file of projectFiles(root)) {
      if (!withinBounds(file, skip)) continue;
      const owner = componentCodeOf(model, file, language, skip, testFolders);
      const source = isSourceFile(file, language) && !isTest(file, testFolders);
      if (owner === undefined) {
        if (source) {
          unowned.files += 1;
          unowned.lines += readFileSync(join(root, file), "utf8").split("\n").length;
        }
        continue;
      }
      code.set(file, owner);
      if (!source) continue;
      const text = readFileSync(join(root, file), "utf8");
      const lines = text.split("\n");
      for (const declaration of declarationsOf(text, language)) {
        const line = lines[declaration.line - 1] ?? "";
        const type = isTypeDeclaration(line, language);
        const id = `${file}#${declaration.name}`;
        const isDefault = language === "typescript" && /^export\s+default\s/.test(line.trim());
        declared.push({ id, component: owner, name: declaration.name, file, type, exported: declaration.exported, isDefault });
        nodes.set(id, { component: owner, name: declaration.name, file, type });
        if (declaration.exported) declarations += 1;
      }
    }
    const index = wordIndex(root, code, language);
    const fileIndex = new Map(index.files.map((file, i) => [file, i]));

    const tally = new Map<string, InterfaceSymbol>();
    const outsideInto = new Map<string, number>();
    const outsideFiles = new Set<string>();
    let outsideSites = 0;
    // The static reach: every resolved declaration, and each reference site's enclosing top-level declaration to it.
    const calls = new Map<string, Map<string, number>>();
    const call = (from: string, to: string): void => {
      const out = calls.get(from) ?? new Map<string, number>();
      calls.set(from, out);
      out.set(to, (out.get(to) ?? 0) + 1);
    };
    const asked = new Set<string>();
    const answered = new Set<string>();
    /** Ask one declaration for its references and account for every site; false once a budget stops the reading. */
    const ask = async (d: Declared): Promise<boolean> => {
      asked.add(d.id);
      const resolved = await within(() => adapter.resolve(`${d.name} in ${d.file}`, { component: d.component, testFolders }));
      if (resolved === STOPPED) return false;
      if (!resolved.ok || resolved.definition.file !== d.file) {
        answered.add(d.id);
        return true;
      }
      const definition: Definition = resolved.definition;
      const reported = await within(() => adapter.references(definition));
      if (reported === STOPPED) return false;
      for (const site of projectSites(root, reported) as ReferenceSite[]) {
        if (isTest(site.file, testFolders)) continue;
        // A private declaration is reached only from its own file: it widens a handler's reach, never an interface.
        if (!d.exported && site.file !== d.file) continue;
        // Past the config's bounds is not the project's code: a whole-workspace server reports such sites, a bounded one never does, and neither counts.
        if (!withinBounds(site.file, skip)) continue;
        const from = componentCodeOf(model, site.file, language, skip, testFolders);
        if (from === undefined) {
          // Inside the bounds, in code no declared component owns: counted into its callee, never drawn, never dropped.
          if (!d.exported) continue;
          outsideSites += 1;
          outsideFiles.add(site.file);
          outsideInto.set(d.component, (outsideInto.get(d.component) ?? 0) + 1);
          continue;
        }
        const enclosing = site.symbol?.split(".")[0];
        if (enclosing !== undefined && enclosing !== "" && !(site.file === d.file && enclosing === d.name)) call(`${site.file}#${enclosing}`, d.id);
        if (from === d.component || !d.exported) continue;
        const key = `${from}\u0000${d.component}\u0000${d.name}\u0000${d.file}`;
        const known = tally.get(key);
        if (known === undefined) tally.set(key, { from, to: d.component, symbol: d.name, file: d.file, sites: 1, ...(d.type ? { kind: "type" as const } : {}) });
        else known.sites += 1;
      }
      answered.add(d.id);
      return true;
    };

    // The interface pass: an exported declaration another component's text could reference.
    const exhaustive = options.exhaustive === true;
    const interfacePass = declared.filter((d) => exhaustive || (d.exported && namedElsewhere(index, d.name, d.file, d.component, d.isDefault)));
    let reading = true;
    for (const d of interfacePass) {
      if (!(await ask(d))) {
        reading = false;
        break;
      }
    }

    const entrances: EntranceResolution[] = [];
    const starts: { at: number; start: string }[] = [];
    for (const component of model.components) {
      for (const entrance of component.entrances) {
        if (entrance.handler === undefined) {
          entrances.push({ component: component.folder, name: entrance.name, reason: "no handler is named" });
          continue;
        }
        if (!reading) {
          entrances.push({ component: component.folder, name: entrance.name, reason: stoppedBefore(stop, budget, "this handler was resolved") });
          continue;
        }
        const name = entrance.handler.split(/\s+in\s+/)[0]!;
        const handler = entrance.file === undefined ? entrance.handler : `${name} in ${entrance.file}`;
        const resolved = await within(() => adapter.resolve(handler, { component: component.folder, testFolders }));
        if (resolved === STOPPED) {
          reading = false;
          entrances.push({ component: component.folder, name: entrance.name, reason: stoppedBefore(stop, budget, "this handler was resolved") });
          continue;
        }
        if (!resolved.ok) {
          entrances.push({ component: component.folder, name: entrance.name, reason: resolved.reason });
          continue;
        }
        starts.push({ at: entrances.length, start: `${resolved.definition.file}#${name}` });
        entrances.push({ component: component.folder, name: entrance.name, file: resolved.definition.file });
      }
    }

    // The reach pass, to a fixed point: ask what a file the reach has entered spells, until nothing new is spelled.
    let reachRead = reading;
    if (reading && starts.length > 0 && !exhaustive) {
      for (;;) {
        const entered = new Set<number>();
        for (const { start } of starts) {
          for (const id of reachedFrom(start, nodes, calls)) {
            const file = nodes.get(id)?.file ?? id.slice(0, id.lastIndexOf("#"));
            const at = fileIndex.get(file);
            if (at !== undefined) entered.add(at);
          }
        }
        const next = declared.filter((d) => !asked.has(d.id) && namedIn(index, d.name, fileIndex.get(d.file), entered, d.isDefault));
        if (next.length === 0) break;
        for (const d of next) {
          if (!(await ask(d))) {
            reading = false;
            break;
          }
        }
        if (!reading) break;
      }
      reachRead = reading;
    }
    for (const { at, start } of starts) entrances[at]!.reach = reachOf(start, nodes, calls);

    const symbols = [...tally.values()].sort(
      (a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.symbol.localeCompare(b.symbol) || a.file.localeCompare(b.file),
    );
    const outside = {
      sites: outsideSites,
      files: outsideFiles.size,
      into: [...outsideInto].map(([component, sites]) => ({ component, sites })).sort((a, b) => a.component.localeCompare(b.component)),
    };
    const bounds = { components: model.components.length, files: code.size, candidates: interfacePass.length, asked: asked.size };
    if (stop !== undefined) {
      // Whose declarations were not all read: a component with a declaration the reading meant to ask and never
      // had answered, and, when the reach was cut short, every component an entrance with a handler is declared in.
      const unread = new Set<string>();
      for (const d of interfacePass) if (!answered.has(d.id)) unread.add(d.component);
      if (!reachRead) for (const e of entrances) if (e.reason === undefined || e.reason.startsWith("not read")) unread.add(e.component);
      return {
        kind: "read",
        language,
        declarations,
        symbols,
        entrances,
        unowned,
        bounds,
        outside,
        partial: {
          limit: stop.limit,
          budget: stop.limit === "time" ? `${budget.seconds} s` : `${budget.memoryMB} MB`,
          ...(stop.observed === undefined ? {} : { observed: `${stop.observed} MB` }),
          seconds: Math.round((Date.now() - started) / 1000),
          unread: [...unread].sort(),
        },
      };
    }
    return { kind: "read", language, declarations, symbols, entrances, unowned, bounds, outside };
  } catch (error) {
    return { kind: "unread", because: `the ${config.language} instrument failed: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    clearInterval(sampler);
    if (given === undefined) await adapter.close();
  }
}

/** Why an entrance has no resolution when a budget stopped the reading first. */
function stoppedBefore(stop: { limit: "time" | "memory" } | undefined, budget: InterfaceBudget, what: string): string {
  return `not read: the interface reading stopped at its ${stop?.limit === "memory" ? `memory budget (${budget.memoryMB} MB)` : `time budget (${budget.seconds} s)`} before ${what}`;
}
