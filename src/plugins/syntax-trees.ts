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

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { closeSync, constants, fstatSync, linkSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { userConfigDir } from "../lifecycle/user-dir.ts";
import { createRequire } from "node:module";
import { Language, Parser, Query, type Node, type QueryMatch, type Tree } from "web-tree-sitter";
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
const STORE_FORMAT = 6;

/**
 * Each treeSitter key, by whether what a kept parse holds depends on it: a
 * file whose bytes shape every match (the parser, the queries), a value that
 * shapes the text kept (the separator a prefix is joined by), or nothing kept
 * (privateName and resolve are read after the store, by the reader). A Record
 * over the manifest's keys, so a key added to treeSitter fails to compile
 * until it is placed here, and a key that shapes a parse is never left out of
 * the fingerprint (the separator was, until this was written).
 */
export const KEPT_FROM: Readonly<Record<keyof TreeSitterManifest, "file" | "value" | false>> = { parser: "file", alternate: "file", queries: "file", separator: "value", privateName: false, resolve: false };

/**
 * The fingerprint a plugin's kept parses are filed under: every treeSitter
 * input KEPT_FROM says a parse depends on, the store's format, the
 * web-tree-sitter release, and this module's own source, which is the code
 * that turns a tree into what is kept. A parse kept under any other is never
 * read, so changing any of them parses every file again.
 */
export function fingerprintOf(dir: string, declared: TreeSitterManifest, read: (path: string) => Buffer = (path) => readFileSync(resolve(dir, path))): string {
  const hash = createHash("sha256");
  for (const key of (Object.keys(KEPT_FROM) as (keyof TreeSitterManifest)[]).sort()) {
    const how = KEPT_FROM[key];
    if (how === false) continue;
    const value = declared[key];
    hash.update(`\u0000${key}\u0000`);
    hash.update(value === undefined ? "\u0001" : how === "file" ? read(value) : `\u0002${value}`);
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
      // Each text read on its own: one the reader cannot read is kept nowhere, and the pass goes on to the next.
      try {
        reader.imports(text);
      } catch {
        continue;
      }
      if (kept !== undefined) {
        hits++;
        if (sample.length < AUDIT_SAMPLE) sample.push({ text, kept });
        else {
          const at = Math.floor(Math.random() * hits);
          if (at < AUDIT_SAMPLE) sample[at] = { text, kept };
        }
      }
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
  const lines: string[] = [];
  // As many plugins' folders as a project could run, read sorted: a repository's thousand folders cost a session start no more.
  for (const folder of StoreFolder.all(root).slice(0, AUDIT_FOLDERS_MAX)) {
    const plugin = folder.name;
    const text = folder.read(AUDIT_FILE, AUDIT_MAX_BYTES);
    if (text === undefined) continue;
    try {
      const audit = JSON.parse(text) as unknown;
      if (typeof audit !== "object" || audit === null) continue;
      const { at, sampled, stale } = audit as Record<string, unknown>;
      if (typeof at !== "number" || typeof sampled !== "number" || typeof stale !== "number" || !Number.isInteger(sampled) || !Number.isInteger(stale)) continue;
      // Said only when this machine wrote it, for this folder, in bounds a warm-up's audit can reach: a repository's own audit.json says nothing.
      if (stale < 1 || stale > sampled || sampled > AUDIT_SAMPLE || !same(text, auditText(plugin, { at, sampled, stale }))) continue;
      if (now - at > AUDIT_NOTICE_DAYS * 86_400_000 || at > now) continue;
      lines.push(`Kept parses: plugin ${plugin}'s kept parses differed from a fresh parse of the same text on ${stale} of the ${sampled} its warm-up sampled (${new Date(at).toISOString().slice(0, 10)}), so its store was discarded and every file is parsed again. The fingerprint they were kept under leaves out something a parse depends on (KEPT_FROM, fingerprintOf in src/plugins/syntax-trees.ts, or a change to the plugin's parsing that names no new parser or queries): a defect to record.`);
    } catch {
      // No audit, or one that will not read: nothing to say.
    }
  }
  return lines.map((line) => `${line}\n\n`).join("");
}

function compile(plugin: LoadedPlugin, declared: TreeSitterManifest): Compiled {
  // Each file read once, and the fingerprint digests the very bytes compiled, so an edit between two reads files no parse under the wrong one.
  const files = new Map<string, Buffer<ArrayBuffer>>();
  const read = (path: string): Buffer<ArrayBuffer> => {
    let bytes = files.get(path);
    if (bytes === undefined) files.set(path, (bytes = readFileSync(resolve(plugin.dir, path))));
    return bytes;
  };
  const source = read(declared.queries).toString("utf8");
  const load = (path: string, which: string): { language: Language; query: Query } => {
    const language = Language.loadSync(new WebAssembly.Module(read(path)));
    try {
      return { language, query: new Query(language, source) };
    } catch (error) {
      throw new Error(`plugin ${plugin.name}'s queries (${declared.queries}) do not compile against its ${which} (${path}): ${(error as Error).message}`);
    }
  };
  const { language, query } = load(declared.parser, "parser");
  // The alternate is compiled the first time a tree errs (215 of PostHog's 21,160 TypeScript files), so a process that never needs it,
  // a hook's among them, never pays for it; queries that do not compile against it are refused by name then.
  let alternate: { language: Language; query: Query; parser: Parser } | undefined;
  const second = (): { language: Language; query: Query; parser: Parser } | undefined => {
    if (declared.alternate === undefined) return undefined;
    if (alternate === undefined) {
      const loaded = load(declared.alternate, "alternate parser");
      const parser = new Parser();
      parser.setLanguage(loaded.language);
      alternate = { ...loaded, parser };
    }
    return alternate;
  };
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
  // The text's tree and the queries compiled for its parser: the parser's, unless it errs and the alternate's errors cover less of the text
  // (TypeScript's TSX grammar reads an old-style cast, <any>x, as a JSX tag that swallows the rest of the file; its TypeScript grammar reads it whole).
  // Measured in what the errors cover, not how many there are: one error that swallows the file loses more than two that hold a token each.
  const treeOf = (text: string): { tree: Tree; query: Query } => {
    const tree = parser.parse(text);
    if (tree === null) throw new Error(`plugin ${plugin.name}'s parser returned no tree`);
    if (declared.alternate === undefined || !tree.rootNode.hasError) return { tree, query };
    // Each tree freed however the choice ends: the alternate's refusal of the queries throws here.
    let other: Tree | null = null;
    try {
      other = second()!.parser.parse(text);
      if (other === null || errorSpan(other.rootNode) >= errorSpan(tree.rootNode)) return { tree, query };
      const chosen = other;
      other = null;
      tree.delete();
      return { tree: chosen, query: alternate!.query };
    } catch (error) {
      tree.delete();
      throw error;
    } finally {
      other?.delete();
    }
  };
  return {
    marksExports: query.captureNames.includes("exported"),
    capturesStatements: query.captureNames.includes("import"),
    exportedName: (name) => privateName === undefined || !privateName.test(name),
    fingerprint: fingerprintOf(plugin.dir, declared, read),
    census(text) {
      const { tree, query } = treeOf(text);
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
      const { tree, query } = treeOf(text);
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
 * How much of the text a tree's errors cover, in bytes: an error node its
 * whole span, a missing node one; descending only into what holds one. Walked
 * with a stack of its own, never by recursion: a file nested ten thousand
 * deep around an error is a project's to write, and a reading's stack is not.
 */
function errorSpan(root: Node): number {
  let span = 0;
  const pending: Node[] = [root];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (node.isError) span += Math.max(1, node.endIndex - node.startIndex);
    else if (node.isMissing) span += 1;
    else for (const child of node.children) if (child !== null && (child.hasError || child.isMissing)) pending.push(child);
  }
  return span;
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
 * file it touches it touches through its StoreFolder, which refuses a link,
 * a pipe or a folder where a file goes and reads with a bounded cost; every
 * entry read is checked for shape; and the store, and each line of its log,
 * is read only where this machine's key signs it, so a store committed to a
 * repository feeds no reading anywhere it is cloned.
 *
 * The store's first line carries its generation, which only a rewrite or a
 * discard changes, and each log line the generation it was appended under:
 * a log line of another generation is never read, and a process that loaded
 * one generation reads the store again when the file holds another. An
 * append changes no generation, so no process's append can hide another's
 * rewrite or discard.
 */
class ParseStore {
  private static stores = new Map<string, ParseStore>();
  private entries: Map<string, { found: Found; day: number }> | undefined;
  private added: [string, Found, number][] = [];
  /** Texts this store's process parsed itself. */
  parsed = 0;

  static of(root: string, plugin: string, fingerprint: string): ParseStore | undefined {
    const folder = StoreFolder.of(root, plugin);
    if (folder === undefined) return undefined;
    const key = `${folder.key}\u0000${fingerprint}`;
    let store = ParseStore.stores.get(key);
    if (store === undefined) {
      store = new ParseStore(folder, fingerprint);
      ParseStore.stores.set(key, store);
      if (ParseStore.stores.size === 1) process.once("exit", () => ParseStore.stores.forEach((s) => s.flush()));
    }
    return store;
  }

  private readonly folder: StoreFolder;
  private readonly fingerprint: string;
  /** The generation of the store this process loaded or last wrote: "" where there was none it could trust. */
  private generation = "";
  /** The store file's first line as this process last saw it, trusted or not: it reads the store again only once the line changes. */
  private seen: string | undefined;
  private checked = 0;

  private constructor(folder: StoreFolder, fingerprint: string) {
    this.folder = folder;
    this.fingerprint = fingerprint;
  }

  /** This machine's signature of text kept under this store's fingerprint: a store or a log line is read only when it carries it. */
  private sign(text: string): string {
    return createHmac("sha256", machineKey()).update(this.fingerprint).update("\u0000").update(text).digest("base64url");
  }

  private get base(): string {
    return `${this.fingerprint}.json`;
  }

  private get log(): string {
    return `${this.fingerprint}.added.jsonl`;
  }

  /** The generation and signature a store's first line names, or undefined where it names none. */
  private static sealOf(line: string | undefined): { generation: string; signature: string } | undefined {
    const match = line === undefined ? null : /^coherence-parses ([A-Za-z0-9_-]{12}) ([A-Za-z0-9_-]{43})$/.exec(line);
    return match === null ? undefined : { generation: match[1]!, signature: match[2]! };
  }

  get(key: string): Found | undefined {
    // A process that lives long (the warm server) reads the store again once another process rewrote or discarded it, looking at most once a
    // second. It looks at the first line as it last saw it, not at the generation it trusted: a store this machine did not sign is read once,
    // and again only when it changes.
    if (this.entries !== undefined && Date.now() - this.checked > RELOAD_MS) {
      this.checked = Date.now();
      if (this.folder.firstLine(this.base) !== this.seen) this.entries = undefined;
    }
    if (this.entries === undefined) {
      const entries = new Map<string, { found: Found; day: number }>();
      this.checked = Date.now();
      this.generation = "";
      const { text, firstLine } = this.folder.readWithFirstLine(this.base);
      this.seen = firstLine;
      if (text !== undefined) {
        try {
          // The store's first line signs its generation and the rest: a store whose contents this machine did not write is never read, whatever its seal.
          const newline = text.indexOf("\n");
          const seal = ParseStore.sealOf(newline < 0 ? text : text.slice(0, newline));
          const body = newline < 0 ? "" : text.slice(newline + 1);
          if (seal !== undefined && same(seal.signature, this.sign(`${seal.generation}\n${body}`))) {
            const kept = JSON.parse(body) as unknown;
            if (typeof kept === "object" && kept !== null && !Array.isArray(kept)) for (const [k, value] of Object.entries(kept)) if (Array.isArray(value) && value.length === 2 && typeof value[0] === "number" && isFound(value[1])) entries.set(k, { day: value[0], found: value[1] });
            this.generation = seal.generation;
          }
        } catch {
          // What a warm-up kept is unreadable: every text is parsed, and the next warm-up writes it again.
        }
      }
      // Each line of the log signs itself: "<signature> <entry>", the entry naming the generation it was appended under. A log this machine
      // wrote fails only where a killed process tore a line, so one that fails more than LOG_TORN_MAX times is no log of ours and is read no
      // further: a repository's log of a million short lines costs a few signatures, not a million.
      let torn = 0;
      for (const signed of this.folder.lines(this.log)) {
        if (signed === "") continue;
        const space = signed.indexOf(" ");
        const line = signed.slice(space + 1);
        if (space !== SIGNATURE_LENGTH || !same(signed.slice(0, space), this.sign(line))) {
          if (++torn > LOG_TORN_MAX) break;
          continue;
        }
        try {
          const entry = JSON.parse(line) as unknown;
          if (Array.isArray(entry) && entry.length === 4 && typeof entry[0] === "string" && isFound(entry[1]) && typeof entry[2] === "number" && entry[3] === this.generation) entries.set(entry[0], { found: entry[1], day: entry[2] });
        } catch {
          // A line a process was killed while writing: that text is parsed again.
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

  /** Append what this process parsed, under the generation it trusted: a process that never loaded the store loads it first, so it never tags its lines with a generation it did not check. */
  flush(): void {
    if (this.added.length === 0) return;
    if (this.entries === undefined) this.get("");
    const generation = this.generation;
    const lines = this.added.map(([k, found, day]) => JSON.stringify([k, found, day, generation])).map((line) => `${this.sign(line)} ${line}\n`).join("");
    this.added = [];
    if (this.folder.ensure()) this.folder.append(this.log, lines);
  }

  /**
   * Take the store's warm-up lock: true when this process holds it, false
   * when a live warm-up of another process does, so two warm-ups (a session
   * start and the prompt after it) never parse the project twice or remove
   * each other's files. A lock whose process is gone, older than
   * WARM_LOCK_MS, stamped in the future, or no lock a warm-up writes (one it
   * cannot read) is taken over, by one warm-up alone however many try at
   * once; a folder or a link where the lock goes is no warm-up's, and the
   * warm-up goes on without it.
   */
  lock(): boolean {
    if (!this.folder.ensure()) return false;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (this.folder.create(WARM_LOCK, `${process.pid} ${Date.now()}`)) return true;
      if (this.folder.holdsOther(WARM_LOCK)) return true;
      const held = this.folder.firstLine(WARM_LOCK);
      if (held !== undefined) {
        const [pid, at] = held.split(" ").map(Number);
        const age = Date.now() - (at ?? 0);
        if (alive(pid ?? 0) && age >= 0 && age < WARM_LOCK_MS) return false;
      }
      if (!this.takeOver(held)) return false;
    }
    return false;
  }

  /**
   * Remove a lock judged dead, by its first line (undefined: one no warm-up
   * can read), as one warm-up alone may: under a lock of the taking-over's
   * own, which only one process creates, and only while the lock is still
   * the one judged, so a warm-up that judged a lock another has since taken
   * never removes the live one in its place. Whether to try the lock again;
   * false where another warm-up is taking it over now.
   */
  private takeOver(judged: string | undefined): boolean {
    const guarded = this.folder.create(WARM_TAKEOVER, `${process.pid} ${Date.now()}`);
    if (!guarded && !this.folder.holdsOther(WARM_TAKEOVER)) {
      // A taking-over is a moment's work: one older than WARM_TAKEOVER_MS, or no taking-over's at all, died in it and is removed.
      const [, at] = (this.folder.firstLine(WARM_TAKEOVER) ?? "").split(" ").map(Number);
      const age = Date.now() - (at ?? 0);
      if (!(age >= 0 && age < WARM_TAKEOVER_MS)) this.folder.remove(WARM_TAKEOVER);
      return false;
    }
    // A folder or a link where the taking-over's lock goes is no warm-up's: the lock is taken over unguarded, as a repository chose.
    try {
      if (!this.folder.holdsOther(WARM_LOCK) && this.folder.firstLine(WARM_LOCK) === judged) this.folder.remove(WARM_LOCK);
      return true;
    } finally {
      if (guarded) this.folder.remove(WARM_TAKEOVER);
    }
  }

  /** Give the warm-up lock back. */
  unlock(): void {
    if (this.folder.read(WARM_LOCK)?.startsWith(`${process.pid} `)) this.folder.remove(WARM_LOCK);
  }

  /**
   * Drop every kept parse, in memory and on disk, and leave the audit that
   * found them stale beside the store for orient to say (staleParsesNotice).
   * The store is sealed empty under a new generation, so every process that
   * loaded it reads again, whatever generation it held, and only the store's
   * own other files are removed.
   */
  discard(audit: { sampled: number; stale: number }): void {
    this.entries = new Map();
    this.added = [];
    this.checked = Date.now();
    if (!this.folder.ensure()) return;
    this.seal({});
    this.folder.remove(AUDIT_FILE);
    this.folder.create(AUDIT_FILE, auditText(this.folder.name, { at: Date.now(), ...audit }));
  }

  /**
   * Keep the texts named, as seen today, and every other kept parse seen in
   * the last RETAIN_DAYS, in one signed file of a new generation, and remove
   * the store's own other files: the log, other fingerprints' stores, and
   * temporary files a killed warm-up left. Nothing else in the folder is
   * touched.
   */
  rewrite(keep: ReadonlySet<string>): void {
    if (!this.folder.ensure()) return;
    this.get("");
    const kept: Record<string, [number, Found]> = {};
    // What this pass read is kept as seen today; anything else is kept while it was seen in the last RETAIN_DAYS, so one leaf's pass of a
    // repository's shared store never drops another leaf's files, and a file gone or changed ages out.
    const now = today();
    for (const [k, { found, day }] of this.entries!) if (keep.has(k) || now - day <= RETAIN_DAYS) kept[k] = [keep.has(k) ? now : day, found];
    this.seal(kept);
    this.added = [];
  }

  /**
   * Write the store whole under a new generation, signed, and remove the
   * store's own other files: the log, other fingerprints' stores, a killed
   * warm-up's temporary files. The one place a generation is made and the
   * store's file written, for a rewrite and a discard alike.
   */
  private seal(kept: Record<string, [number, Found]>): void {
    const body = JSON.stringify(kept);
    const generation = newGeneration();
    const first = `${STORE_SEAL}${generation} ${this.sign(`${generation}\n${body}`)}`;
    // A store path the project holds as something else (a folder named as the store's file): nothing is kept, and the warm-up goes on.
    if (!this.folder.replace(this.base, `${first}\n${body}`)) return;
    for (const name of this.folder.names()) if (name !== this.base && STORE_FILE.test(name)) this.folder.remove(name);
    this.generation = generation;
    this.seen = first;
    this.checked = Date.now();
  }
}

/** A store's new generation: made only where the store is sealed (a rewrite or a discard), so no append can change the generation a process loaded. */
function newGeneration(): string {
  return randomBytes(9).toString("base64url");
}

/** The folder of a project's kept parses for one plugin, or of all of them: .coherence/parses[/<plugin>]. The one place its path is made. */
function parsesFolder(root: string, plugin?: string): string {
  const parses = join(resolve(root), ".coherence", "parses");
  return plugin === undefined ? parses : join(parses, plugin);
}

/**
 * The one way Coherence touches a file of a project's parse store. A
 * repository controls everything under its .coherence, so each operation here
 * acts only where every folder from .coherence down is a real folder (never a
 * link), opens without following a link or blocking on a pipe, acts on a
 * regular file only, reads no file larger than STORE_MAX_BYTES, reads a
 * log a chunk at a time so its reader can stop early, writes a whole file
 * under a temporary name and renames it into place, creates a file only where
 * none is, and removes only a regular file. The store's path is made here
 * alone (parsesFolder), so no other code holds a path to touch the store by.
 */
class StoreFolder {
  readonly #root: string;
  readonly #dir: string;
  /** The plugin's folder name. */
  readonly name: string;

  private constructor(root: string, name: string) {
    this.#root = resolve(root);
    this.#dir = parsesFolder(root, name);
    this.name = name;
  }

  /** A plugin's folder of the store; undefined for a name that could step out of it. */
  static of(root: string, plugin: string): StoreFolder | undefined {
    if (!PLUGIN_FOLDER.test(plugin) || plugin.includes("..")) return undefined;
    return new StoreFolder(root, plugin);
  }

  /** Every plugin's folder the project's store holds, where the store's own folder is a real one. */
  static all(root: string): StoreFolder[] {
    try {
      if (!lstatSync(join(resolve(root), ".coherence")).isDirectory() || !lstatSync(parsesFolder(root)).isDirectory()) return [];
      return readdirSync(parsesFolder(root)).filter((name) => PLUGIN_FOLDER.test(name)).sort().map((name) => new StoreFolder(root, name));
    } catch {
      return [];
    }
  }

  /** What tells this folder apart from another project's or plugin's. */
  get key(): string {
    return this.#dir;
  }

  /** Whether every folder from the project's .coherence down to this one is a real folder or not there yet: never a link, never a file. */
  #safe(): boolean {
    let at = join(this.#root, ".coherence");
    for (const part of ["", "parses", this.name]) {
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

  /** Make the folder where the project has its .coherence and the path holds no link: whether it may be written. */
  ensure(): boolean {
    if (!this.#safe()) return false;
    try {
      if (!lstatSync(join(this.#root, ".coherence")).isDirectory()) return false;
      mkdirSync(this.#dir, { recursive: true });
    } catch {
      return false;
    }
    return this.#safe();
  }

  /** A file of the folder opened to read: a regular file no larger than max bytes, never through a link or a pipe. */
  #open(name: string, max: number = STORE_MAX_BYTES): number | undefined {
    return this.#openFile(name, constants.O_RDONLY, max);
  }

  /**
   * The one way a file of the store is opened, to read or to write: where
   * every folder from .coherence down is a real folder, never through a link
   * (O_NOFOLLOW), never waiting on a pipe (O_NONBLOCK), and kept open only
   * where it is a regular file no larger than max bytes and, to be written,
   * has no second name a hard link could carry the write out by. A caller
   * names what it does, never how the file is opened, so no caller can open
   * one another way.
   */
  #openFile(name: string, flags: number, max: number = STORE_MAX_BYTES): number | undefined {
    if (!this.#safe()) return undefined;
    let fd: number;
    try {
      fd = openSync(join(this.#dir, name), flags | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
    } catch {
      return undefined;
    }
    try {
      const stat = fstatSync(fd);
      const writes = (flags & (constants.O_WRONLY | constants.O_RDWR)) !== 0;
      if (stat.isFile() && stat.size <= max && (!writes || stat.nlink === 1)) return fd;
    } catch {
      // Unreadable: as if absent.
    }
    closeSync(fd);
    return undefined;
  }

  /** A file's whole text, or undefined where it is absent, larger than max bytes, or no file of the store's may be. */
  read(name: string, max: number = STORE_MAX_BYTES): string | undefined {
    return this.readWithFirstLine(name, max).text;
  }

  /** A file's whole text and its first line as firstLine reads it, both from one opening of the file, so the two never describe two files. */
  readWithFirstLine(name: string, max: number = STORE_MAX_BYTES): { text: string | undefined; firstLine: string | undefined } {
    const fd = this.#open(name, max);
    if (fd === undefined) return { text: undefined, firstLine: undefined };
    try {
      const bytes = readFileSync(fd);
      return { text: bytes.toString("utf8"), firstLine: StoreFolder.#head(bytes) };
    } catch {
      return { text: undefined, firstLine: undefined };
    } finally {
      closeSync(fd);
    }
  }

  /** A file's first line, reading no more of it than MAX_FIRST_LINE bytes. */
  firstLine(name: string): string | undefined {
    const fd = this.#open(name);
    if (fd === undefined) return undefined;
    try {
      const head = Buffer.alloc(MAX_FIRST_LINE);
      return StoreFolder.#head(head.subarray(0, readSync(fd, head, 0, head.length, 0)));
    } catch {
      return undefined;
    } finally {
      closeSync(fd);
    }
  }

  /** The first line of a file's bytes, no more of them than MAX_FIRST_LINE read. */
  static #head(bytes: Buffer): string {
    const head = bytes.subarray(0, MAX_FIRST_LINE);
    const end = head.indexOf(10);
    return head.subarray(0, end < 0 ? head.length : end).toString("utf8");
  }

  /** A file's lines, read a chunk at a time, so a reader that stops early reads no further than it got. */
  *lines(name: string): Generator<string> {
    const fd = this.#open(name);
    if (fd === undefined) return;
    try {
      const chunk = Buffer.alloc(1 << 20);
      // The pieces of a line not yet ended, joined once when it ends: a line of any length costs its own bytes, never their square.
      let pending: Buffer[] = [];
      for (;;) {
        const got = readSync(fd, chunk, 0, chunk.length, null);
        if (got === 0) break;
        let text = chunk.subarray(0, got);
        // A newline byte is never inside a character's bytes, so each line decodes whole.
        for (let end = text.indexOf(10); end >= 0; end = text.indexOf(10)) {
          yield Buffer.concat([...pending, text.subarray(0, end)]).toString("utf8");
          pending = [];
          text = text.subarray(end + 1);
        }
        if (text.length > 0) pending.push(Buffer.from(text));
      }
      if (pending.length > 0) yield Buffer.concat(pending).toString("utf8");
    } finally {
      closeSync(fd);
    }
  }

  /** Append to a regular file, made where absent, never through a link or into a pipe. */
  append(name: string, text: string): void {
    const fd = this.#openFile(name, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT);
    if (fd === undefined) return;
    try {
      writeSync(fd, text);
    } catch {
      // A file that cannot be written only means the next process parses again.
    } finally {
      closeSync(fd);
    }
  }

  /** A new file written whole, made exclusively: false where one, or anything else, already is at the name. */
  #write(name: string, text: string): boolean {
    const fd = this.#openFile(name, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL);
    if (fd === undefined) return false;
    try {
      writeSync(fd, text);
      return true;
    } catch {
      return false;
    } finally {
      closeSync(fd);
    }
  }

  /**
   * Create a file where none is, whole: written under a temporary name of
   * this process's, then linked into place, which fails where anything is
   * at the name. No reader ever sees it empty or half written. False where
   * one, or anything else, already is.
   */
  create(name: string, text: string): boolean {
    if (!this.#safe()) return false;
    const temporary = `${name}.${process.pid}.new`;
    this.remove(temporary);
    if (!this.#write(temporary, text)) return false;
    try {
      linkSync(join(this.#dir, temporary), join(this.#dir, name));
      return true;
    } catch {
      return false;
    } finally {
      this.remove(temporary);
    }
  }

  /** Whether something other than a regular file (a folder, a link, a pipe) is at a name. */
  holdsOther(name: string): boolean {
    try {
      return !lstatSync(join(this.#dir, name)).isFile();
    } catch {
      return false;
    }
  }

  /** Write a file whole: under a temporary name of this process's, created exclusively, then renamed over the name, which a rename replaces and never follows. */
  replace(name: string, text: string): boolean {
    if (!this.#safe()) return false;
    const temporary = `${name}.${process.pid}`;
    this.remove(temporary);
    if (!this.#write(temporary, text)) return false;
    try {
      renameSync(join(this.#dir, temporary), join(this.#dir, name));
      return true;
    } catch {
      this.remove(temporary);
      return false;
    }
  }

  /** Remove a regular file; a link, a folder or a pipe at the name stays as it is. */
  remove(name: string): void {
    if (!this.#safe()) return;
    try {
      if (lstatSync(join(this.#dir, name)).isFile()) rmSync(join(this.#dir, name), { force: true });
    } catch {
      // Gone already.
    }
  }

  /** The names in the folder. */
  names(): string[] {
    if (!this.#safe()) return [];
    try {
      return readdirSync(this.#dir);
    } catch {
      return [];
    }
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

/** An audit as a warm-up writes it: its counts, and this machine's signature of them and the store's folder. */
function auditText(plugin: string, audit: { at: number; sampled: number; stale: number }): string {
  const counts = JSON.stringify([plugin, audit.at, audit.sampled, audit.stale]);
  return JSON.stringify({ ...audit, signature: createHmac("sha256", machineKey()).update(`audit\u0000${counts}`).digest("base64url") });
}

/** A signature's length: an HMAC-SHA256 in base64url. */
const SIGNATURE_LENGTH = 43;

/** Whether a signature a file carries is the one this machine makes, compared in a time that says nothing of where they differ. */
function same(carried: string, made: string): boolean {
  const a = Buffer.from(carried);
  const b = Buffer.from(made);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** How many lines of a log may fail their signature (a line a killed process tore) before the log is read no further. */
const LOG_TORN_MAX = 8;

/** The largest store or log file read: PostHog's whole frontend and Python keep about 41 MB. */
const STORE_MAX_BYTES = 256 * 1024 * 1024;

/** How often, at most, a long-lived process looks whether another rewrote the store it loaded. */
const RELOAD_MS = 1000;

/** The file a warm-up that found the store stale leaves beside it, how long orient says so, and the folder names a plugin's store may have. */
const AUDIT_FILE = "audit.json";
const AUDIT_NOTICE_DAYS = 7;
/** The most of an audit read (a warm-up's is about 150 bytes), and of plugins' folders whose audits a session start reads. */
const AUDIT_MAX_BYTES = 4096;
const AUDIT_FOLDERS_MAX = 64;
const PLUGIN_FOLDER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** The warm-up lock's file, beside the store, and how long one holds before another warm-up may take it over. */
const WARM_LOCK = "warming.lock";
const WARM_LOCK_MS = 10 * 60 * 1000;
/** The lock one warm-up holds while it takes over a dead warm-up lock, and how long one lasts before it is a dead taking-over's. */
const WARM_TAKEOVER = "warming.lock.takeover";
const WARM_TAKEOVER_MS = 30 * 1000;

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

/** The first line of a store's file: its generation and its signature. */
const STORE_SEAL = "coherence-parses ";

/** The most of a store's file read for its first line: the seal is 74 bytes. */
const MAX_FIRST_LINE = 256;

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
  // Written whole under a name of this process's, then linked into place, which fails where another process's key got there first:
  // a reader never sees a key half written, and a key file too short to be one (an empty file) is replaced, never kept as is.
  const temporary = `${path}.${process.pid}`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    rmSync(temporary, { force: true });
    writeFileSync(temporary, made, { flag: "wx", mode: 0o600 });
    try {
      linkSync(temporary, path);
    } catch {
      if (readFileSync(path).length < 32) renameSync(temporary, path);
    }
  } catch {
    // The folder will not take it.
  } finally {
    rmSync(temporary, { force: true });
  }
  try {
    const read = readFileSync(path);
    if (read.length >= 32) return (key = read);
  } catch {
    // Unkeepable: this process's key is its own.
  }
  return (key = made);
}
