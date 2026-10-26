/**
 * The parser path: a language plugin may name a tree-sitter parser and the
 * queries its text is read through (its manifest's treeSitter), and the core
 * derives the plugin's text readings from them: the names a file declares at
 * its top level, what each declares, and every name it imports and from
 * where. One parse answers each reading, so no two readings of one language
 * can disagree about its text, as two hand-written readers of Python's
 * imports did (df-7ac38ee4); and a statement is read whole, whatever lines it
 * spans.
 *
 * The runtime starts once per process (startParsers, which the CLI awaits
 * before any command); a parser loads on first use and stays. A project's
 * parses are kept under .coherence/parses by each text's digest: the warm-up
 * a session start launches reads every file once (warmParses), and a later
 * reading of the whole project parses only what changed. Every tree is
 * freed before the reader returns: web-tree-sitter trees hold WebAssembly
 * memory only delete() returns, and the old harness crashed an adopter at
 * parse #638 of one file by never freeing them.
 */

import { createHash, createHmac, randomBytes } from "node:crypto";
import { closeSync, constants, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { userConfigDir } from "../lifecycle/user-dir.ts";
import { createRequire } from "node:module";
import { Language, Parser, Query } from "web-tree-sitter";
import type { LoadedPlugin, TreeSitterManifest } from "./plugin.ts";

/** What a declaration declares, as the observation's interface reading names it. */
export type Declares = "body" | "value" | "type" | "unknown";

/** One imported name, or a whole module, as the plugin's queries read it. */
export interface TreeImport {
  /** The name brought in; undefined for a whole-module import. */
  name: string | undefined;
  /** The name it is bound to here, when the import renames it. */
  alias?: string;
  /** Whether the import brings in every name the module exports. */
  glob?: true;
  /** The module as the text names it. */
  specifier: string;
  /** One-based. */
  line: number;
}

/** One name a file declares at its top level. */
export interface TreeDeclaration {
  name: string;
  /** One-based: the line its name stands on. */
  line: number;
  exported: boolean;
  declares: Declares;
  /** Whether it is its module's default export (TypeScript's export default function): its match captures @default. */
  isDefault: boolean;
}

/** The shapes an import takes, as the census counts them: what it brings in, and how it is written. */
export const IMPORT_SHAPES = ["named", "renamed", "glob", "whole module", "spans lines", "inside a block"] as const;
export type ImportShape = (typeof IMPORT_SHAPES)[number];

/**
 * The shape of every import in a text, through the plugin's parser and
 * queries: one entry per import the queries match, at the line its statement
 * starts. Inside a block is known only where the queries capture the whole
 * statement as @import.
 */
export function importShapes(plugin: LoadedPlugin, text: string): { line: number; shapes: ImportShape[]; specifier: string }[] {
  treeReaderOf(plugin);
  return compiled.get(plugin.dir)!.census(text);
}

/** Whether a plugin's queries capture an import's whole statement (@import), so the census can say whether it sits inside a block. */
export function capturesStatements(plugin: LoadedPlugin): boolean {
  treeReaderOf(plugin);
  return compiled.get(plugin.dir)!.capturesStatements;
}

/** What the core reads of a language's text through its parser. */
export interface TreeReader {
  imports(text: string): TreeImport[];
  declarations(text: string): TreeDeclaration[];
  /** Every name the text binds at its top level: each declaration's, and each a @bound match names (Python's lowercase module variables). */
  topLevel(text: string): Set<string>;
  /** The names the text exports as its default by name (TypeScript's export default foo, export { foo as default }): each @default a match without a declaration captures. */
  defaults(text: string): string[];
}

/**
 * The capture names a plugin's queries may use: any other is refused by
 * name, never passed over, but for one whose name starts with an underscore,
 * which is the queries' own for a predicate to test (#eq? @_alias "default")
 * and is read by nothing.
 */
export const CAPTURES = ["import", "import.from", "import.module", "import.name", "import.alias", "import.glob", "import.default", "declaration.body", "declaration.value", "declaration.type", "declaration.unknown", "bound", "name", "exported", "default"] as const;

/** The captures whose text a reading reads; every other capture is read by its name and line. */
const TEXT_READ = new Set(["import.from", "import.module", "import.name", "import.alias", "import.default", "name", "default"]);

/** A capture the queries keep for a predicate alone. */
const ownCapture = (name: string): boolean => name.startsWith("_");

let started: Promise<void> | undefined;
let ready = false;

/** Start the parser runtime: once per process, before any reading of a language read through a parser. */
export function startParsers(): Promise<void> {
  started ??= Parser.init().then(() => {
    ready = true;
  });
  return started;
}

/** One match's captures, as a parse keeps them: each capture's name, its text and its one-based line. */
type Found = [name: string, text: string, line: number][][];

/** A parser compiled once per plugin: what every reader of its language shares. */
interface Compiled {
  parse(text: string): Found;
  census(text: string): { line: number; shapes: ImportShape[]; specifier: string }[];
  capturesStatements: boolean;
  marksExports: boolean;
  exportedName(name: string): boolean;
  /** The parser's and queries' digest: a parse kept under another is never read as this one's. */
  fingerprint: string;
}

const compiled = new Map<string, Compiled>();
const readers = new Map<string, TreeReader & { store: ParseStore | undefined; keyOf(text: string): string }>();

/** How many texts' matches a reader keeps in memory: enough for the readings one pass asks of a file in turn, few enough to hold no project. */
const RECENT = 4;

/** Parses a process makes itself before it reads the project's kept parses: a hook that reads a file or two parses them, cheaper than loading every file's. */
const DIRECT_PARSES = 16;

/** Bumped when what a kept parse holds changes, so an older store is never read as this one's. */
const STORE_FORMAT = 3;

/**
 * The reader of a plugin's language through its parser and queries, built on
 * first use; undefined for a plugin that names no parser. With a project
 * root, its parses are kept in the project's .coherence/parses by each text's
 * digest, so a later process parses only the files that changed since.
 */
export function treeReaderOf(plugin: LoadedPlugin, root?: string): TreeReader | undefined {
  if (plugin.manifest.treeSitter === undefined) return undefined;
  const key = `${plugin.dir}\u0000${root ?? ""}`;
  let reader = readers.get(key);
  if (reader === undefined) {
    if (!ready) throw new Error(`plugin ${plugin.name} reads its language through a parser, and the parser runtime is not started: await startParsers() (src/plugins/syntax-trees.ts) before a reading, as the CLI does`);
    let parser = compiled.get(plugin.dir);
    if (parser === undefined) {
      parser = compile(plugin, plugin.manifest.treeSitter);
      compiled.set(plugin.dir, parser);
    }
    reader = readerOver(parser, root === undefined ? undefined : ParseStore.of(root, plugin.name, parser.fingerprint));
    readers.set(key, reader);
  }
  return reader;
}

/**
 * Pre-read a project's files of one plugin's language, as the warm-up a
 * session start launches does: every text is read through the parser (a kept
 * parse answering where the text is unchanged), and the project's kept
 * parses are rewritten to hold exactly these texts', so a file deleted or
 * changed since leaves nothing behind.
 */
export function warmParses(plugin: LoadedPlugin, root: string, texts: Iterable<string>): { read: number; parsed: number; skipped?: true } {
  const reader = treeReaderOf(plugin, root) as (TreeReader & { store: ParseStore | undefined; keyOf(text: string): string }) | undefined;
  if (reader === undefined || reader.store === undefined) return { read: 0, parsed: 0 };
  // One warm-up at a time: another that is running already reads every file.
  if (!reader.store.lock()) return { read: 0, parsed: 0, skipped: true };
  try {
    const keep = new Set<string>();
    let read = 0;
    const before = reader.store.parsed;
    for (const text of texts) {
      reader.imports(text);
      keep.add(reader.keyOf(text));
      read++;
    }
    const parsed = reader.store.parsed - before;
    reader.store.rewrite(keep);
    return { read, parsed };
  } finally {
    reader.store.unlock();
  }
}

function compile(plugin: LoadedPlugin, declared: TreeSitterManifest): Compiled {
  const binary = readFileSync(resolve(plugin.dir, declared.parser));
  const source = readFileSync(resolve(plugin.dir, declared.queries), "utf8");
  const language = Language.loadSync(new WebAssembly.Module(binary));
  let query: Query;
  try {
    query = new Query(language, source);
  } catch (error) {
    throw new Error(`plugin ${plugin.name}'s queries (${declared.queries}) do not compile against its parser: ${(error as Error).message}`);
  }
  const unknown = query.captureNames.filter((name) => !(CAPTURES as readonly string[]).includes(name) && !ownCapture(name));
  if (unknown.length > 0) throw new Error(`plugin ${plugin.name}'s queries capture ${unknown.map((n) => `@${n}`).join(", ")}, which Coherence reads nothing by; the captures are ${CAPTURES.map((c) => `@${c}`).join(", ")}`);
  // A language whose queries mark what is exported says it by @exported; one with no such mark exports by name, unless its privateName says otherwise.
  const privateName = declared.privateName === undefined ? undefined : new RegExp(declared.privateName);
  const parser = new Parser();
  parser.setLanguage(language);
  return {
    marksExports: query.captureNames.includes("exported"),
    capturesStatements: query.captureNames.includes("import"),
    exportedName: (name) => privateName === undefined || !privateName.test(name),
    fingerprint: createHash("sha256").update(binary).update("\u0000").update(source).update(`\u0000${STORE_FORMAT}\u0000${runtimeVersion()}`).digest("base64url").slice(0, 16),
    census(text) {
      const tree = parser.parse(text);
      if (tree === null) throw new Error(`plugin ${plugin.name}'s parser returned no tree`);
      try {
        return query.matches(tree.rootNode).flatMap((match) => {
          const of = (name: string) => match.captures.find((c) => c.name === name)?.node;
          if (of("import.from") === undefined && of("import.module") === undefined) return [];
          const statement = of("import");
          const nodes = statement === undefined ? match.captures.map((c) => c.node) : [statement];
          const start = Math.min(...nodes.map((n) => n.startPosition.row));
          const end = Math.max(...nodes.map((n) => n.endPosition.row));
          const shapes: ImportShape[] = [of("import.module") !== undefined ? "whole module" : of("import.glob") !== undefined ? "glob" : "named"];
          if (of("import.alias") !== undefined) shapes.push("renamed");
          if (end > start) shapes.push("spans lines");
          // Inside a block only where the queries say which node is the statement: an indented line is no evidence (Go's import block indents).
          if (statement !== undefined && statement.parent !== null && statement.parent.type !== tree.rootNode.type) shapes.push("inside a block");
          return [{ line: start + 1, shapes, specifier: (of("import.from") ?? of("import.module"))!.text }];
        });
      } finally {
        tree.delete();
      }
    },
    // Every match of the queries over the text: read inside the tree's life, and the tree freed however the read ends.
    parse(text) {
      const tree = parser.parse(text);
      if (tree === null) throw new Error(`plugin ${plugin.name}'s parser returned no tree`);
      try {
        // A capture whose text no reading reads (a declaration's whole node, @bound, @exported) keeps its name and line alone, so a kept parse holds names, not bodies.
        return query.matches(tree.rootNode).map((match) => match.captures.filter((c) => !ownCapture(c.name)).map((c) => [c.name, TEXT_READ.has(c.name) ? c.node.text : "", c.node.startPosition.row + 1] as [string, string, number]));
      } finally {
        tree.delete();
      }
    },
  };
}

function readerOver(compiled: Compiled, store: ParseStore | undefined): TreeReader & { store: ParseStore | undefined; keyOf(text: string): string } {
  const { marksExports, exportedName } = compiled;
  const keyOf = (text: string): string => createHash("sha256").update(text).digest("base64url").slice(0, 22);
  // The last few texts' matches in memory, so the readings a pass asks of one file (its declarations, then its imports) share one parse;
  // past the first few parses, the project's kept parses, so a file unchanged since an earlier process is not parsed again.
  const recent: { text: string; found: Found }[] = [];
  let direct = 0;
  const raw = (text: string): Found => {
    const kept = recent.find((r) => r.text === text);
    if (kept !== undefined) return kept.found;
    const key = store === undefined ? undefined : keyOf(text);
    let found = key !== undefined && direct >= DIRECT_PARSES ? store!.get(key) : undefined;
    if (found === undefined) {
      found = compiled.parse(text);
      direct++;
      if (key !== undefined) store!.put(key, found);
    }
    recent.unshift({ text, found });
    recent.length = Math.min(recent.length, RECENT);
    return found;
  };
  const matches = (text: string): { name: string; text: string; line: number }[][] => raw(text).map((captures) => captures.map(([name, value, line]) => ({ name, text: value, line })));

  return {
    imports(text) {
      const found: TreeImport[] = [];
      for (const captures of matches(text)) {
        const of = (name: string) => captures.find((c) => c.name === name);
        const from = of("import.from");
        const module = of("import.module");
        if (from === undefined && module === undefined) continue;
        const alias = of("import.alias")?.text;
        const bindsDefault = of("import.default");
        if (module !== undefined) found.push({ name: undefined, specifier: module.text, line: module.line, ...(alias === undefined ? {} : { alias }) });
        else if (of("import.glob") !== undefined) found.push({ name: undefined, glob: true, specifier: from!.text, line: from!.line });
        // A default import brings in the module's default export, bound to a name of the file's own: no rename of any name the module declares.
        else if (bindsDefault !== undefined) found.push({ name: "default", specifier: from!.text, line: bindsDefault.line });
        else {
          const name = of("import.name");
          if (name !== undefined) found.push({ name: name.text, specifier: from!.text, line: name.line, ...(alias === undefined ? {} : { alias }) });
        }
      }
      return found;
    },
    declarations(text) {
      const found: TreeDeclaration[] = [];
      for (const captures of matches(text)) {
        const kind = captures.find((c) => c.name.startsWith("declaration."));
        const name = captures.find((c) => c.name === "name");
        if (kind === undefined || name === undefined) continue;
        const exported = marksExports ? captures.some((c) => c.name === "exported") : exportedName(name.text);
        found.push({ name: name.text, line: name.line, exported, declares: kind.name.slice("declaration.".length) as Declares, isDefault: captures.some((c) => c.name === "default") });
      }
      // A name declared twice is the first declaration's, as a reader going down the file meets it; of two matches of one name on one line,
      // the one that says what it declares, so queries may match any value as unknown beside the values they know (TypeScript's const x = <anything>).
      const seen = new Set<string>();
      const unknown = (d: TreeDeclaration): number => (d.declares === "unknown" ? 1 : 0);
      return found.sort((a, b) => a.line - b.line || unknown(a) - unknown(b)).filter((d) => !seen.has(d.name) && seen.add(d.name) !== undefined);
    },
    topLevel(text) {
      const names = new Set<string>();
      for (const captures of matches(text)) {
        const name = captures.find((c) => c.name === "name");
        if (name !== undefined && captures.some((c) => c.name === "bound" || c.name.startsWith("declaration."))) names.add(name.text);
      }
      return names;
    },
    defaults(text) {
      const names: string[] = [];
      for (const captures of matches(text)) {
        if (captures.some((c) => c.name.startsWith("declaration."))) continue;
        for (const c of captures) if (c.name === "default") names.push(c.text);
      }
      return names;
    },
    store,
    keyOf,
  };
}

/**
 * A project's kept parses for one plugin: .coherence/parses/<plugin>/<fingerprint>.json,
 * what the last warm-up read, and beside it an appended log of what each
 * process parsed since, read together. Loaded only when first asked, and
 * written only where the project already has its .coherence folder, so a
 * project Coherence never ran in gains none.
 *
 * A project is not trusted to hold the store honestly (df-7c50adfe): every
 * folder on its path must be a real folder, never a link (a repository that
 * commits .coherence/parses/python as a link to ~/.ssh would otherwise have
 * the warm-up empty ~/.ssh); nothing is read or appended through a link; a
 * temporary file is created exclusively; only the store's own files are ever
 * removed; every entry read is checked for shape; and a store, or a log,
 * whose first line is not signed with this machine's key is never read, so a
 * store committed to a repository feeds no reading anywhere it is cloned.
 */
class ParseStore {
  private static stores = new Map<string, ParseStore>();
  private entries: Map<string, Found> | undefined;
  private added: [string, Found][] = [];
  /** Texts this store's process parsed itself. */
  parsed = 0;

  static of(root: string, plugin: string, fingerprint: string): ParseStore | undefined {
    // A plugin's name names a folder of the store: one that could step out of it keeps no parses.
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(plugin) || plugin.includes("..")) return undefined;
    const dir = join(resolve(root), ".coherence", "parses", plugin);
    const key = `${dir}\u0000${fingerprint}`;
    let store = ParseStore.stores.get(key);
    if (store === undefined) {
      store = new ParseStore(resolve(root), dir, fingerprint);
      ParseStore.stores.set(key, store);
      if (ParseStore.stores.size === 1) process.once("exit", () => ParseStore.stores.forEach((s) => s.flush()));
    }
    return store;
  }

  private readonly root: string;
  private readonly dir: string;
  private readonly fingerprint: string;
  private readonly seal: string;

  private constructor(root: string, dir: string, fingerprint: string) {
    this.root = root;
    this.dir = dir;
    this.fingerprint = fingerprint;
    this.seal = `${STORE_SEAL}${createHmac("sha256", machineKey()).update(fingerprint).digest("base64url")}`;
  }

  private get base(): string {
    return join(this.dir, `${this.fingerprint}.json`);
  }

  private get log(): string {
    return join(this.dir, `${this.fingerprint}.added.jsonl`);
  }

  /** Whether every folder from the project's .coherence down to the store's is a real folder or not there yet: never a link, never a file. */
  private safe(): boolean {
    let at = join(this.root, ".coherence");
    for (const part of ["", "parses", basename(this.dir)]) {
      if (part !== "") at = join(at, part);
      let stat;
      try {
        stat = lstatSync(at);
      } catch {
        return part !== "";
      }
      if (stat.isSymbolicLink() || !stat.isDirectory()) return false;
    }
    return true;
  }

  /** A file of the store's own, read only when it is a regular file and signed with this machine's key on its first line. */
  private readSigned(path: string): string[] {
    try {
      if (!lstatSync(path).isFile()) return [];
      const lines = readFileSync(path, "utf8").split("\n");
      return lines[0] === this.seal ? lines.slice(1) : [];
    } catch {
      return [];
    }
  }

  get(key: string): Found | undefined {
    if (this.entries === undefined) {
      const entries = new Map<string, Found>();
      if (this.safe()) {
        try {
          const kept = JSON.parse(this.readSigned(this.base).join("\n") || "{}") as unknown;
          if (typeof kept === "object" && kept !== null && !Array.isArray(kept)) for (const [k, found] of Object.entries(kept)) if (isFound(found)) entries.set(k, found);
        } catch {
          // What a warm-up kept is unreadable: every text is parsed, and the next warm-up writes it again.
        }
        for (const line of this.readSigned(this.log)) {
          if (line === "") continue;
          try {
            const entry = JSON.parse(line) as unknown;
            if (Array.isArray(entry) && entry.length === 2 && typeof entry[0] === "string" && isFound(entry[1])) entries.set(entry[0], entry[1]);
          } catch {
            // A line a process was killed while writing: that text is parsed again.
          }
        }
      }
      for (const [k, found] of this.added) entries.set(k, found);
      this.entries = entries;
    }
    return this.entries.get(key);
  }

  put(key: string, found: Found): void {
    this.parsed++;
    this.added.push([key, found]);
    this.entries?.set(key, found);
    // A process that lives long (the warm server, hook-serve) appends as it goes, so what it holds unwritten stays small.
    if (this.added.length >= FLUSH_EVERY) this.flush();
  }

  /** Append what this process parsed, where the project has its .coherence folder and the store's path holds no link; never through a link. */
  flush(): void {
    if (this.added.length === 0) return;
    const lines = this.added.map((entry) => `${JSON.stringify(entry)}\n`).join("");
    this.added = [];
    if (!existsSync(join(this.root, ".coherence")) || !this.safe()) return;
    try {
      mkdirSync(this.dir, { recursive: true });
      if (!this.safe()) return;
      const fresh = !existsSync(this.log);
      const fd = openSync(this.log, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
      try {
        writeSync(fd, `${fresh ? `${this.seal}\n` : ""}${lines}`);
      } finally {
        closeSync(fd);
      }
    } catch {
      // A store that cannot be written only means the next process parses again.
    }
  }

  /**
   * Take the store's warm-up lock: true when this process holds it, false
   * when a live warm-up of another process does, so two warm-ups (a session
   * start and the prompt after it) never parse the project twice or remove
   * each other's files. A lock whose process is gone, or older than
   * WARM_LOCK_MS, is taken over.
   */
  lock(): boolean {
    if (!existsSync(join(this.root, ".coherence")) || !this.safe()) return false;
    mkdirSync(this.dir, { recursive: true });
    if (!this.safe()) return false;
    const path = join(this.dir, WARM_LOCK);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        writeSync(fd, `${process.pid} ${Date.now()}`);
        closeSync(fd);
        return true;
      } catch {
        let held: { pid: number; at: number } | undefined;
        try {
          if (lstatSync(path).isFile()) {
            const [pid, at] = readFileSync(path, "utf8").split(" ").map(Number);
            held = { pid: pid ?? 0, at: at ?? 0 };
          }
        } catch {
          continue;
        }
        if (held === undefined) return false;
        if (alive(held.pid) && Date.now() - held.at < WARM_LOCK_MS) return false;
        rmSync(path, { force: true });
      }
    }
    return false;
  }

  /** Give the warm-up lock back. */
  unlock(): void {
    const path = join(this.dir, WARM_LOCK);
    try {
      if (lstatSync(path).isFile() && readFileSync(path, "utf8").startsWith(`${process.pid} `)) rmSync(path, { force: true });
    } catch {
      // Not held.
    }
  }

  /**
   * Keep exactly the texts named, from what is held and what this process
   * parsed, in one signed file, and remove the store's own other files: the
   * log, other fingerprints' stores, and temporary files a killed warm-up
   * left. Nothing else in the folder is touched.
   */
  rewrite(keep: ReadonlySet<string>): void {
    if (!existsSync(join(this.root, ".coherence")) || !this.safe()) return;
    this.get("");
    const kept: Record<string, Found> = {};
    for (const [k, found] of this.entries!) if (keep.has(k)) kept[k] = found;
    mkdirSync(this.dir, { recursive: true });
    if (!this.safe()) return;
    const temporary = `${this.base}.${process.pid}`;
    rmSync(temporary, { force: true });
    writeFileSync(temporary, `${this.seal}\n${JSON.stringify(kept)}`, { flag: "wx", mode: 0o600 });
    renameSync(temporary, this.base);
    for (const name of readdirSync(this.dir)) {
      if (name === `${this.fingerprint}.json` || !STORE_FILE.test(name)) continue;
      const path = join(this.dir, name);
      try {
        if (lstatSync(path).isFile()) rmSync(path, { force: true });
      } catch {
        // Gone already.
      }
    }
    this.added = [];
  }
}

/** The names of the store's own files: a fingerprint's store, its log, and a warm-up's temporary file. */
const STORE_FILE = /^[A-Za-z0-9_-]{16}\.(?:json|added\.jsonl|json\.\d+)$/;

/** The web-tree-sitter release that parses, read from its package once: a parse kept under another release is never read as this one's. */
let runtime: string | undefined;
function runtimeVersion(): string {
  if (runtime !== undefined) return runtime;
  try {
    const entry = createRequire(import.meta.url).resolve("web-tree-sitter");
    runtime = (JSON.parse(readFileSync(join(dirname(entry), "package.json"), "utf8")) as { version?: string }).version ?? "unknown";
  } catch {
    runtime = "unknown";
  }
  return runtime;
}

/** The warm-up lock's file, beside the store, and how long one holds before another warm-up may take it over. */
const WARM_LOCK = "warming.lock";
const WARM_LOCK_MS = 10 * 60 * 1000;

/** Whether a process is alive (signal 0 asks without sending). */
function alive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The first line of a store's file: its signature. */
const STORE_SEAL = "coherence-parses ";

/** How many parses a process holds before it appends them. */
const FLUSH_EVERY = 256;

/** Whether a value is a kept parse: matches of captures, each [name, text, line]. */
function isFound(value: unknown): value is Found {
  return Array.isArray(value) && value.every((match) => Array.isArray(match) && match.every((c) => Array.isArray(c) && c.length === 3 && typeof c[0] === "string" && typeof c[1] === "string" && typeof c[2] === "number"));
}

let key: Buffer | undefined;

/** This machine's key for signing kept parses, made once in the user's Coherence folder (userConfigDir); a fresh one each process where it cannot be kept, so nothing kept is trusted there. */
function machineKey(): Buffer {
  if (key !== undefined) return key;
  const path = join(userConfigDir(), "parses.key");
  try {
    const read = readFileSync(path);
    if (read.length >= 32) return (key = read);
  } catch {
    // Made below.
  }
  const made = randomBytes(32);
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, made, { flag: "wx", mode: 0o600 });
    return (key = made);
  } catch {
    // Another process made it first, or the folder will not take it.
    try {
      const read = readFileSync(path);
      if (read.length >= 32) return (key = read);
    } catch {
      // Unkeepable: this process's key is its own.
    }
    return (key = made);
  }
}
