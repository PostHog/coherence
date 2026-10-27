/**
 * The parser path: a language plugin may name a tree-sitter parser and the
 * queries its text is read through (its manifest's treeSitter), and the core
 * derives the plugin's text readings from them: the names a file declares at
 * its top level, what each declares, and every name it imports and from
 * where, a whole module's narrowed to the names the file uses through the
 * name it binds where the queries capture those uses (Go's st.Seal). One
 * parse answers each reading, so no two readings of one language can
 * disagree about its text, as two hand-written readers of Python's imports
 * did (df-7ac38ee4); and a statement is read whole, whatever lines it spans.
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
import { fileURLToPath } from "node:url";
import { userConfigDir } from "../lifecycle/user-dir.ts";
import { createRequire } from "node:module";
import { Language, Parser, Query, type Node, type QueryMatch } from "web-tree-sitter";
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
 * statement as @import, in the import's own match or in a match of its own
 * that holds it.
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
  /** Every name the text uses through a qualifier (@use.qualifier, @use.name: Go's st.Seal), by the qualifier; empty for a language whose queries capture no use. */
  uses(text: string): Map<string, Set<string>>;
  /** The names the text exports as its default by name (TypeScript's export default foo, export { foo as default }): each @default a match without a declaration captures. */
  defaults(text: string): string[];
}

/**
 * The capture names a plugin's queries may use: any other is refused by
 * name, never passed over, but for one whose name starts with an underscore,
 * which is the queries' own for a predicate to test (#eq? @_alias "default")
 * and is read by nothing.
 */
export const CAPTURES = ["import", "import.from", "import.module", "import.name", "import.alias", "import.glob", "import.default", "import.prefix", "declaration.body", "declaration.value", "declaration.type", "declaration.unknown", "bound", "name", "exported", "default", "use.qualifier", "use.name"] as const;

/** The captures whose text a reading reads (an import's specifier spelled whole, with its prefixes; a qualified use's qualifier and name); every other capture is read by its name and line. */
const TEXT_READ = new Set(["import.from", "import.module", "import.name", "import.alias", "import.default", "name", "default", "use.qualifier", "use.name"]);

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
const STORE_FORMAT = 4;

/**
 * Each treeSitter key, by whether what a kept parse holds depends on it: a
 * file whose bytes shape every match (the parser, the queries), a value that
 * shapes the text kept (the separator a prefix is joined by), or nothing kept
 * (privateName and resolve are read after the store, by the reader). A Record
 * over the manifest's keys, so a key added to treeSitter fails to compile
 * until it is placed here, and a key that shapes a parse is never left out of
 * the fingerprint (the separator was, until this was written).
 */
export const KEPT_FROM: Readonly<Record<keyof TreeSitterManifest, "file" | "value" | false>> = { parser: "file", queries: "file", separator: "value", privateName: false, resolve: false };

/**
 * The fingerprint a plugin's kept parses are filed under: every treeSitter
 * input KEPT_FROM says a parse depends on, the store's format, the
 * web-tree-sitter release, and this module's own source, which is the code
 * that turns a tree into what is kept. A parse kept under any other is never
 * read, so changing any of them parses every file again.
 */
export function fingerprintOf(dir: string, declared: TreeSitterManifest): string {
  const hash = createHash("sha256");
  for (const key of (Object.keys(KEPT_FROM) as (keyof TreeSitterManifest)[]).sort()) {
    const how = KEPT_FROM[key];
    if (how === false) continue;
    const value = declared[key];
    hash.update(`\u0000${key}\u0000`);
    hash.update(value === undefined ? "\u0001" : how === "file" ? readFileSync(resolve(dir, value)) : `\u0002${value}`);
  }
  return hash.update(`\u0000${STORE_FORMAT}\u0000${runtimeVersion()}\u0000${extractionDigest()}`).digest("base64url").slice(0, 16);
}

let extraction: string | undefined;
/** This module's own source, digested once: an edit to how a tree is read changes every fingerprint, so no parse kept by the old code is read by the new. */
function extractionDigest(): string {
  extraction ??= createHash("sha256").update(readFileSync(fileURLToPath(import.meta.url))).digest("base64url");
  return extraction;
}

/** How many of a warm-up's kept parses it parses again to hold them to a fresh parse of the same text. */
const AUDIT_SAMPLE = 8;

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
export function warmParses(plugin: LoadedPlugin, root: string, texts: Iterable<string>): { read: number; parsed: number; audited: number; stale: number; skipped?: true } {
  const reader = treeReaderOf(plugin, root) as (TreeReader & { store: ParseStore | undefined; keyOf(text: string): string }) | undefined;
  if (reader === undefined || reader.store === undefined) return { read: 0, parsed: 0, audited: 0, stale: 0 };
  // One warm-up at a time: another that is running already reads every file.
  if (!reader.store.lock()) return { read: 0, parsed: 0, audited: 0, stale: 0, skipped: true };
  try {
    const keep = new Set<string>();
    let read = 0;
    const before = reader.store.parsed;
    // A sample of the texts a kept parse answers, chosen evenly over the pass (a reservoir), each held after the pass to a fresh parse of it.
    const sample: { text: string; kept: Found }[] = [];
    let hits = 0;
    for (const text of texts) {
      const key = reader.keyOf(text);
      const kept = reader.store.get(key);
      if (kept !== undefined) {
        hits++;
        if (sample.length < AUDIT_SAMPLE) sample.push({ text, kept });
        else {
          const at = Math.floor(Math.random() * hits);
          if (at < AUDIT_SAMPLE) sample[at] = { text, kept };
        }
      }
      reader.imports(text);
      keep.add(key);
      read++;
    }
    const parsed = reader.store.parsed - before;
    // A kept parse that differs from a fresh parse of the same text was kept under a fingerprint that leaves out something the parse depends on:
    // the store is discarded whole, since no entry of it can be trusted, and the next session start says so (staleParsesNotice).
    const fresh = compiled.get(plugin.dir)!;
    const stale = sample.filter(({ text, kept }) => JSON.stringify(fresh.parse(text)) !== JSON.stringify(kept)).length;
    if (stale > 0) {
      reader.store.discard({ sampled: sample.length, stale });
      readers.delete(`${plugin.dir}\u0000${root}`);
    } else reader.store.rewrite(keep);
    return { read, parsed, audited: sample.length, stale };
  } finally {
    reader.store.unlock();
  }
}

/** What a project's store would keep of a text read through a plugin's parser, as JSON: what the audit and the fingerprint's test hold kept parses to. */
export function keptParseOf(plugin: LoadedPlugin, text: string): string {
  if (plugin.manifest.treeSitter === undefined) throw new Error(`plugin ${plugin.name} names no parser`);
  treeReaderOf(plugin);
  return JSON.stringify(compiled.get(plugin.dir)!.parse(text));
}

/**
 * What orient says of a project's kept parses that a warm-up found stale in
 * the last AUDIT_NOTICE_DAYS: whose, on how many of the texts it sampled, and
 * that the store was discarded. A stale store means a fingerprint leaves out
 * something a parse depends on, a defect of Coherence or of the plugin, so it
 * is said rather than healed in silence. Empty when none was.
 */
export function staleParsesNotice(root: string, now: number = Date.now()): string {
  const folder = join(resolve(root), ".coherence", "parses");
  let plugins: string[];
  try {
    if (!lstatSync(folder).isDirectory()) return "";
    plugins = readdirSync(folder).filter((name) => PLUGIN_FOLDER.test(name)).sort();
  } catch {
    return "";
  }
  const lines: string[] = [];
  for (const plugin of plugins) {
    const path = join(folder, plugin, AUDIT_FILE);
    try {
      if (!lstatSync(join(folder, plugin)).isDirectory() || !lstatSync(path).isFile()) continue;
      const audit = JSON.parse(readFileSync(path, "utf8")) as unknown;
      if (typeof audit !== "object" || audit === null) continue;
      const { at, sampled, stale } = audit as Record<string, unknown>;
      if (typeof at !== "number" || typeof sampled !== "number" || typeof stale !== "number" || !Number.isInteger(sampled) || !Number.isInteger(stale)) continue;
      if (now - at > AUDIT_NOTICE_DAYS * 86_400_000 || at > now) continue;
      lines.push(`Kept parses: plugin ${plugin}'s kept parses differed from a fresh parse of the same text on ${stale} of the ${sampled} its warm-up sampled (${new Date(at).toISOString().slice(0, 10)}), so its store was discarded and every file is parsed again. The fingerprint they were kept under leaves out something a parse depends on (KEPT_FROM, fingerprintOf in src/plugins/syntax-trees.ts, or a change to the plugin's parsing that names no new parser or queries): a defect to record.`);
    } catch {
      // No audit, or one that will not read: nothing to say.
    }
  }
  return lines.map((line) => `${line}\n\n`).join("");
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
  // Read with Unicode's classes (\p{Lu}), since a language that exports by name may say it by a letter's case (Go).
  const privateName = declared.privateName === undefined ? undefined : new RegExp(declared.privateName, "u");
  const prefixed = query.captureNames.includes("import.prefix");
  if (prefixed && declared.separator === undefined) throw new Error(`plugin ${plugin.name}'s queries capture @import.prefix, and its treeSitter names no separator to join a prefix to the path it prefixes (Rust's "::")`);
  const spell = speller(declared.separator ?? "");
  const parser = new Parser();
  parser.setLanguage(language);
  return {
    marksExports: query.captureNames.includes("exported"),
    capturesStatements: query.captureNames.includes("import"),
    exportedName: (name) => privateName === undefined || !privateName.test(name),
    fingerprint: fingerprintOf(plugin.dir, declared),
    census(text) {
      const tree = parser.parse(text);
      if (tree === null) throw new Error(`plugin ${plugin.name}'s parser returned no tree`);
      try {
        const matches = query.matches(tree.rootNode);
        const spelled = prefixed ? spell(matches) : (node: Node) => node.text;
        // A statement its queries capture on its own ((use_declaration) @import): the import of a match that captures none is in the innermost one holding it.
        const statements = matches.flatMap((match) => match.captures.filter((c) => c.name === "import").map((c) => c.node));
        const holding = (node: Node): Node | undefined =>
          statements.filter((s) => s.startIndex <= node.startIndex && node.endIndex <= s.endIndex).sort((a, b) => a.endIndex - a.startIndex - (b.endIndex - b.startIndex))[0];
        return matches.flatMap((match) => {
          const of = (name: string) => match.captures.find((c) => c.name === name)?.node;
          if (of("import.from") === undefined && of("import.module") === undefined) return [];
          const statement = of("import") ?? holding((of("import.from") ?? of("import.module"))!);
          const nodes = statement === undefined ? match.captures.map((c) => c.node) : [statement];
          const start = Math.min(...nodes.map((n) => n.startPosition.row));
          const end = Math.max(...nodes.map((n) => n.endPosition.row));
          const shapes: ImportShape[] = [of("import.module") !== undefined ? "whole module" : of("import.glob") !== undefined ? "glob" : "named"];
          if (of("import.alias") !== undefined) shapes.push("renamed");
          if (end > start) shapes.push("spans lines");
          // Inside a block only where the queries say which node is the statement: an indented line is no evidence (Go's import block indents).
          if (statement !== undefined && statement.parent !== null && statement.parent.type !== tree.rootNode.type) shapes.push("inside a block");
          return [{ line: start + 1, shapes, specifier: spelled((of("import.from") ?? of("import.module"))!) }];
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
        // A capture whose text no reading reads (a declaration's whole node, @bound, @exported) keeps its name and line alone, so a kept parse holds names, not bodies;
        // an import's specifier is kept spelled whole, its prefixes joined to it, and a prefix, a statement captured on its own, or the queries' own capture is kept nowhere.
        const matches = query.matches(tree.rootNode);
        const spelled = prefixed ? spell(matches) : (node: Node) => node.text;
        return matches
          .map((match) => match.captures.filter((c) => c.name !== "import.prefix" && !ownCapture(c.name)).map((c) => [c.name, c.name === "import.from" || c.name === "import.module" ? spelled(c.node) : TEXT_READ.has(c.name) ? c.node.text : "", c.node.startPosition.row + 1] as [string, string, number]))
          .filter((captures) => captures.some(([name]) => name !== "import"));
      } finally {
        tree.delete();
      }
    },
  };
}

/**
 * An import's specifier spelled whole, for queries that capture @import.prefix:
 * a prefix (a path a group of imports shares, Rust's a in use a::{b, c})
 * prefixes every specifier its parent node holds after it, so prefixes nest
 * as the tree does, to any depth, and each specifier is the prefixes over it,
 * outer first, joined to its own text by the separator. A query reads one
 * node's text; a path a group spells in pieces is only whole here.
 */
function speller(separator: string): (matches: QueryMatch[]) => (node: Node) => string {
  return (matches) => {
    const prefixes: { start: number; end: number; within: [number, number]; text: string }[] = [];
    const seen = new Set<number>();
    for (const match of matches)
      for (const c of match.captures) {
        if (c.name !== "import.prefix" || seen.has(c.node.id) || c.node.parent === null) continue;
        seen.add(c.node.id);
        prefixes.push({ start: c.node.startIndex, end: c.node.endIndex, within: [c.node.parent.startIndex, c.node.parent.endIndex], text: c.node.text });
      }
    prefixes.sort((a, b) => a.start - b.start);
    return (node) => {
      const over = prefixes.filter((p) => p.end <= node.startIndex && p.within[0] <= node.startIndex && node.endIndex <= p.within[1]);
      return [...over.map((p) => p.text), node.text].join(separator);
    };
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
    uses(text) {
      const used = new Map<string, Set<string>>();
      for (const captures of matches(text)) {
        const qualifier = captures.find((c) => c.name === "use.qualifier");
        const name = captures.find((c) => c.name === "use.name");
        if (qualifier === undefined || name === undefined) continue;
        const names = used.get(qualifier.text) ?? new Set<string>();
        names.add(name.text);
        used.set(qualifier.text, names);
      }
      return used;
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
  private entries: Map<string, { found: Found; day: number }> | undefined;
  private added: [string, Found, number][] = [];
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
      const entries = new Map<string, { found: Found; day: number }>();
      if (this.safe()) {
        try {
          const kept = JSON.parse(this.readSigned(this.base).join("\n") || "{}") as unknown;
          if (typeof kept === "object" && kept !== null && !Array.isArray(kept)) for (const [k, value] of Object.entries(kept)) if (Array.isArray(value) && value.length === 2 && typeof value[0] === "number" && isFound(value[1])) entries.set(k, { day: value[0], found: value[1] });
        } catch {
          // What a warm-up kept is unreadable: every text is parsed, and the next warm-up writes it again.
        }
        for (const line of this.readSigned(this.log)) {
          if (line === "") continue;
          try {
            const entry = JSON.parse(line) as unknown;
            if (Array.isArray(entry) && entry.length === 3 && typeof entry[0] === "string" && isFound(entry[1]) && typeof entry[2] === "number") entries.set(entry[0], { found: entry[1], day: entry[2] });
          } catch {
            // A line a process was killed while writing: that text is parsed again.
          }
        }
      }
      for (const [k, found, day] of this.added) entries.set(k, { found, day });
      this.entries = entries;
    }
    return this.entries.get(key)?.found;
  }

  put(key: string, found: Found): void {
    this.parsed++;
    const day = today();
    this.added.push([key, found, day]);
    this.entries?.set(key, { found, day });
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
   * Drop every kept parse, in memory and on disk, and leave the audit that
   * found them stale beside the store for orient to say (staleParsesNotice).
   * Only the store's own files are removed; the audit is written afresh,
   * never through a link.
   */
  discard(audit: { sampled: number; stale: number }): void {
    this.entries = new Map();
    this.added = [];
    if (!existsSync(join(this.root, ".coherence")) || !this.safe()) return;
    for (const name of existsSync(this.dir) ? readdirSync(this.dir) : []) {
      if (!STORE_FILE.test(name)) continue;
      try {
        if (lstatSync(join(this.dir, name)).isFile()) rmSync(join(this.dir, name), { force: true });
      } catch {
        // Gone already.
      }
    }
    try {
      mkdirSync(this.dir, { recursive: true });
      if (!this.safe()) return;
      const path = join(this.dir, AUDIT_FILE);
      rmSync(path, { force: true });
      writeFileSync(path, JSON.stringify({ at: Date.now(), ...audit }), { flag: "wx", mode: 0o600 });
    } catch {
      // An audit that cannot be kept: the store is discarded all the same.
    }
  }

  /**
   * Keep the texts named, as seen today, and every other kept parse seen in
   * the last RETAIN_DAYS, in one signed file, and remove the store's own other
   * files: the
   * log, other fingerprints' stores, and temporary files a killed warm-up
   * left. Nothing else in the folder is touched.
   */
  rewrite(keep: ReadonlySet<string>): void {
    if (!existsSync(join(this.root, ".coherence")) || !this.safe()) return;
    this.get("");
    const kept: Record<string, [number, Found]> = {};
    // What this pass read is kept as seen today; anything else is kept while it was seen in the last RETAIN_DAYS, so one leaf's pass of a
    // repository's shared store never drops another leaf's files, and a file gone or changed ages out.
    const now = today();
    for (const [k, { found, day }] of this.entries!) if (keep.has(k) || now - day <= RETAIN_DAYS) kept[k] = [keep.has(k) ? now : day, found];
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

/** The file a warm-up that found the store stale leaves beside it, how long orient says so, and the folder names a plugin's store may have. */
const AUDIT_FILE = "audit.json";
const AUDIT_NOTICE_DAYS = 7;
const PLUGIN_FOLDER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

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

/** How many days a kept parse no warm-up read lasts: a file deleted or changed ages out; one read only at the repository's top is parsed again after. */
const RETAIN_DAYS = 14;

/** The day, counted from 1970, for the stamps kept parses carry. */
function today(): number {
  return Math.floor(Date.now() / 86_400_000);
}

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
