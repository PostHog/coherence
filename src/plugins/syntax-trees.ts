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
 * before any command); a parser loads on first use and stays. Parses are
 * kept in the user's cache, outside every project, a file each, by the
 * parser's fingerprint and the text's digest: the warm-up a session start
 * launches reads every file once (warmParses), and a later reading of the
 * whole project, or of any project holding the same text, parses only what
 * changed. Every tree is
 * freed before the reader returns: web-tree-sitter trees hold WebAssembly
 * memory only delete() returns, and the old harness crashed an adopter at
 * parse #638 of one file by never freeing them.
 */

import { createHash, randomBytes } from "node:crypto";
import { closeSync, constants, fstatSync, futimesSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { userCacheDir } from "../lifecycle/user-dir.ts";
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

/** A reader of a project's files: its store, a text's key there, and a text's matches with whether a kept parse answered them. */
type KeptReader = TreeReader & { store: ParseStore | undefined; keyOf(text: string): string; read(text: string): { found: Found; kept?: true } };

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
const readers = new Map<string, KeptReader>();

/** How many texts' matches a reader keeps in memory: enough for the readings one pass asks of a file in turn, few enough to hold no project. */
const RECENT = 4;

/** Bumped when what a kept parse holds changes, so an older store is never read as this one's. */
const STORE_FORMAT = 8;

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
  return hash.update(`\u0000${STORE_FORMAT}\u0000${runtimeVersion()}\u0000${extractionDigest()}`).digest("hex").slice(0, 24);
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
 * root, the reading of a project's files, its parses are kept in the user's
 * cache by each text's digest, so a later process parses only the texts that
 * changed since; without one (a line read alone), nothing is kept.
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
    reader = readerOver(parser, root === undefined ? undefined : ParseStore.of(plugin.name, parser.fingerprint));
    readers.set(key, reader);
  }
  return reader;
}

/**
 * Pre-read a project's files of one plugin's language, as the warm-up a
 * session start launches does: every text is read through the parser, a kept
 * parse answering where the text is unchanged and each new parse kept as it
 * is made, and then the store is swept of what no process has read in
 * RETAIN_DAYS. Two warm-ups at once need no lock: each parse is one file
 * written whole, so neither can spoil what the other writes, and each reads
 * what the other has kept by then.
 */
export function warmParses(plugin: LoadedPlugin, root: string, texts: Iterable<string>): { read: number; parsed: number; audited: number; stale: number } {
  const reader = treeReaderOf(plugin, root) as KeptReader | undefined;
  if (reader === undefined || reader.store === undefined) return { read: 0, parsed: 0, audited: 0, stale: 0 };
  const store = reader.store;
  let read = 0;
  const before = store.parsed;
  // A sample of the texts a kept parse answers, chosen evenly over the pass (a reservoir), each held after the pass to a fresh parse of it.
  const sample: { text: string; kept: Found }[] = [];
  let hits = 0;
  for (const text of texts) {
    // Each text read on its own: one the reader cannot read is kept nowhere, and the pass goes on to the next.
    let answer: { found: Found; kept?: true };
    try {
      answer = reader.read(text);
    } catch {
      continue;
    }
    if (answer.kept === true) {
      const kept = answer.found;
      hits++;
      if (sample.length < AUDIT_SAMPLE) sample.push({ text, kept });
      else {
        const at = Math.floor(Math.random() * hits);
        if (at < AUDIT_SAMPLE) sample[at] = { text, kept };
      }
    }
    read++;
  }
  const parsed = store.parsed - before;
  // A kept parse that differs from a fresh parse of the same text was kept under a fingerprint that leaves out something the parse depends on:
  // the store is removed whole, since no entry of it can be trusted, and the next session start says so (staleParsesNotice).
  const fresh = compiled.get(plugin.dir)!;
  const stale = sample.filter(({ text, kept }) => JSON.stringify(fresh.parse(text)) !== JSON.stringify(kept)).length;
  if (stale > 0) {
    store.discard({ sampled: sample.length, stale });
    for (const key of [...readers.keys()]) if (key.startsWith(`${plugin.dir}\u0000`)) readers.delete(key);
  }
  ParseStore.sweep();
  return { read, parsed, audited: sample.length, stale };
}

/** What a project's store would keep of a text read through a plugin's parser, as JSON: what the audit and the fingerprint's test hold kept parses to. */
export function keptParseOf(plugin: LoadedPlugin, text: string): string {
  if (plugin.manifest.treeSitter === undefined) throw new Error(`plugin ${plugin.name} names no parser`);
  treeReaderOf(plugin);
  return JSON.stringify(compiled.get(plugin.dir)!.parse(text));
}

/**
 * What orient says of kept parses a warm-up found stale in the last
 * AUDIT_NOTICE_DAYS: whose, on how many of the texts it sampled, and that the
 * store was removed. A stale store means a fingerprint leaves out something a
 * parse depends on, a defect of Coherence or of the plugin, so it is said
 * rather than healed in silence. Read from the user's cache, where only this
 * user's warm-ups write. Empty when none was.
 */
export function staleParsesNotice(now: number = Date.now()): string {
  return ParseStore.audits()
    .filter(({ at, sampled, stale }) => stale >= 1 && stale <= sampled && sampled <= AUDIT_SAMPLE && at <= now && now - at <= AUDIT_NOTICE_DAYS * 86_400_000)
    .map(({ plugin, at, sampled, stale }) => `Kept parses: plugin ${plugin}'s kept parses differed from a fresh parse of the same text on ${stale} of the ${sampled} its warm-up sampled (${new Date(at).toISOString().slice(0, 10)}), so its store was removed and every text is parsed again. The fingerprint they were kept under leaves out something a parse depends on (KEPT_FROM, fingerprintOf in src/plugins/syntax-trees.ts, or a change to the plugin's parsing that names no new parser or queries): a defect to record.\n\n`)
    .join("");
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

function readerOver(compiled: Compiled, store: ParseStore | undefined): KeptReader {
  const { marksExports, exportedName } = compiled;
  const keyOf = (text: string): string => createHash("sha256").update(text).digest("hex").slice(0, 32);
  // The last few texts' matches in memory, so the readings a pass asks of one file (its declarations, then its imports) share one parse;
  // then the text's kept parse, so a file unchanged since an earlier process is not parsed again.
  const recent: { text: string; found: Found }[] = [];
  const read = (text: string): { found: Found; kept?: true } => {
    const known = recent.find((r) => r.text === text);
    if (known !== undefined) return { found: known.found };
    const key = store === undefined ? undefined : keyOf(text);
    const kept = key !== undefined ? store!.get(key) : undefined;
    const found = kept ?? compiled.parse(text);
    if (kept === undefined && key !== undefined) store!.put(key, found);
    recent.unshift({ text, found });
    recent.length = Math.min(recent.length, RECENT);
    return kept === undefined ? { found } : { found, kept: true };
  };
  const raw = (text: string): Found => read(text).found;
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
    read,
  };
}


/**
 * The kept parses of one parser fingerprint, in the user's cache outside
 * every project (parsesFolder), shared by every project, worktree and process
 * of the user's. A kept parse is a function of its text and the fingerprint
 * alone, so each is a file of its own named by the text's digest, written
 * whole under a temporary name, renamed into place and never written again,
 * as git keeps a loose object. A reading opens the one file it asks for and
 * holds nothing of the store in memory, so what another process writes is
 * read at once, what another removes answers no more, and no process merges,
 * reloads or locks. A file read is stamped as read at most once a day, and a
 * warm-up's sweep removes what no process has read in RETAIN_DAYS. No file of
 * a project's is read or written, so a repository can neither feed a reading
 * through the store nor stop one; and a stale store, which only a fingerprint
 * that leaves something out can make, is removed whole.
 */
class ParseStore {
  private static stores = new Map<string, ParseStore | undefined>();
  readonly #dir: string;
  readonly #plugin: string;
  /** Texts this store's process parsed itself. */
  parsed = 0;

  private constructor(plugin: string, dir: string) {
    this.#plugin = plugin;
    this.#dir = dir;
  }

  /** A fingerprint's store; undefined where its folder, or any on the path to it, is not the user's alone (usersAlone). */
  static of(plugin: string, fingerprint: string): ParseStore | undefined {
    if (!ParseStore.stores.has(fingerprint)) {
      const parses = parsesFolder();
      const dir = parses === undefined || !FINGERPRINT.test(fingerprint) ? undefined : join(parses, fingerprint);
      try {
        if (dir !== undefined) mkdirSync(dir, { recursive: true, mode: 0o700 });
      } catch {
        // A folder that cannot be made is no folder of the user's alone, which usersAlone answers.
      }
      ParseStore.stores.set(fingerprint, dir !== undefined && usersAlone(dir) ? new ParseStore(plugin, dir) : undefined);
    }
    return ParseStore.stores.get(fingerprint);
  }

  /** A text's kept parse, read from its own file; undefined where none is kept, or the file is not this user's own regular file of a parse's shape. */
  get(key: string): Found | undefined {
    const path = this.#path(key);
    if (!ownFolder(dirname(path))) return undefined;
    const kept = ownFile(path, PARSE_MAX_BYTES, true);
    if (kept === undefined) return undefined;
    try {
      const found = JSON.parse(kept) as unknown;
      return isFound(found) ? found : undefined;
    } catch {
      return undefined;
    }
  }

  /** Keep a text's parse: written whole under a temporary name and renamed into place, so a reader meets the whole file or none. */
  put(key: string, found: Found): void {
    this.parsed++;
    const path = this.#path(key);
    try {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    } catch {
      return;
    }
    if (ownFolder(dirname(path))) writeWhole(path, JSON.stringify(found));
  }

  /** Remove every kept parse of this fingerprint, renamed out of the way first so no reader meets half a store, and leave the audit that found them stale for orient to say. */
  discard(audit: { sampled: number; stale: number }): void {
    const away = `${this.#dir}.stale-${randomBytes(8).toString("hex")}`;
    try {
      renameSync(this.#dir, away);
      rmSync(away, { recursive: true, force: true });
    } catch {
      // A store another warm-up removed first.
    }
    ParseStore.writeAudit(this.#plugin, { at: Date.now(), ...audit });
  }

  /** A kept parse's file: a folder of the key's first two digits, holding a file of the rest, as git files a loose object. */
  #path(key: string): string {
    if (!KEY.test(key)) throw new Error(`a kept parse's key is 32 lowercase hex digits, never ${JSON.stringify(key)}`);
    return join(this.#dir, key.slice(0, 2), key.slice(2));
  }

  /**
   * Remove, across every fingerprint, each kept parse no process has read in
   * RETAIN_DAYS, each temporary file a write that died left an hour on, each
   * store a discard left behind, and each folder that empties; at most once a
   * day, which the swept file's time says.
   */
  static sweep(now: number = Date.now()): void {
    const parses = parsesFolder();
    if (parses === undefined) return;
    const swept = join(parses, SWEPT);
    try {
      if (now - lstatSync(swept).mtimeMs < DAY_MS) return;
    } catch {
      // Never swept.
    }
    writeWhole(swept, "");
    const older = (path: string, ms: number): boolean => {
      try {
        return now - lstatSync(path).mtimeMs > ms;
      } catch {
        return false;
      }
    };
    for (const name of listed(parses)) {
      const path = join(parses, name);
      if (STALE_STORE.test(name)) rmSync(path, { recursive: true, force: true });
      if (!FINGERPRINT.test(name)) continue;
      for (const shard of listed(path).filter((s) => SHARD.test(s))) {
        const folder = join(path, shard);
        for (const file of listed(folder)) {
          if ((KEY_REST.test(file) && older(join(folder, file), RETAIN_DAYS * DAY_MS)) || (TEMPORARY.test(file) && older(join(folder, file), HOUR_MS))) rmSync(join(folder, file), { force: true });
        }
        removeIfEmpty(folder);
      }
      removeIfEmpty(path);
    }
  }

  /** Leave a warm-up's audit of a plugin's stale store for orient. */
  static writeAudit(plugin: string, audit: { at: number; sampled: number; stale: number }): void {
    const parses = parsesFolder();
    if (parses === undefined || !PLUGIN_NAME.test(plugin)) return;
    try {
      mkdirSync(join(parses, AUDITS), { recursive: true, mode: 0o700 });
    } catch {
      // An audit that cannot be kept is one orient does not say.
      return;
    }
    writeWhole(join(parses, AUDITS, `${plugin}.json`), JSON.stringify(audit));
  }

  /** The audits warm-ups left, by plugin, each checked for shape. */
  static audits(): { plugin: string; at: number; sampled: number; stale: number }[] {
    const parses = parsesFolder();
    if (parses === undefined) return [];
    return listed(join(parses, AUDITS))
      .filter((name) => name.endsWith(".json") && PLUGIN_NAME.test(name.slice(0, -5)))
      .flatMap((name) => {
        try {
          const { at, sampled, stale } = JSON.parse(ownFile(join(parses, AUDITS, name), AUDIT_MAX_BYTES, false) ?? "") as Record<string, unknown>;
          if (typeof at !== "number" || !Number.isInteger(sampled) || !Number.isInteger(stale)) return [];
          return [{ plugin: name.slice(0, -5), at, sampled: sampled as number, stale: stale as number }];
        } catch {
          return [];
        }
      });
  }
}

/**
 * The folder of the user's kept parses, or undefined where it cannot be the
 * user's alone. The one place the store's path is made, under the user's
 * cache (userCacheDir), never under a project.
 */
function parsesFolder(): string | undefined {
  const parses = join(userCacheDir(), "parses");
  try {
    mkdirSync(parses, { recursive: true, mode: 0o700 });
  } catch {
    return undefined;
  }
  return usersAlone(parses) ? parses : undefined;
}

/**
 * Whether no one but this user (and the system) can change what a path
 * leads to, as written and once every link on it is followed: each folder on
 * it, and each link, owned by this user or by the system, and no folder others
 * may write unless it is sticky (the system's temporary folder), where others
 * may add a name but never move this user's; and the folder itself, and the
 * one it is in (Coherence's in the cache), this user's own that no one else
 * may write. Nothing on the path can then be changed after the check by anyone
 * this user does not trust, so a store judged the user's alone stays so.
 */
function usersAlone(path: string): boolean {
  const me = process.getuid?.();
  const trusted = (entry: { uid: number }): boolean => me === undefined || entry.uid === me || entry.uid === 0;
  const own = (entry: { uid: number; mode: number }): boolean => (me === undefined || entry.uid === me) && (entry.mode & 0o022) === 0;
  const walk = (at: string): boolean => {
    for (let here = at; ; here = dirname(here)) {
      const entry = lstatSync(here);
      if (!trusted(entry)) return false;
      if (entry.isDirectory() && (entry.mode & 0o022) !== 0 && (entry.mode & 0o1000) === 0) return false;
      if (dirname(here) === here) return true;
    }
  };
  try {
    const real = realpathSync(path);
    // The folder and the one it is in this user's own; every folder and link on the way trusted.
    return walk(path) && walk(real) && own(lstatSync(real)) && own(lstatSync(dirname(real))) && lstatSync(real).isDirectory();
  } catch {
    return false;
  }
}

/** Whether a folder of the store's is this user's own, a real folder, not a link, that no one else may write: a kept parse's folder, checked at each read. */
function ownFolder(path: string): boolean {
  try {
    const entry = lstatSync(path);
    const me = process.getuid?.();
    return entry.isDirectory() && (me === undefined || entry.uid === me) && (entry.mode & 0o022) === 0;
  } catch {
    return false;
  }
}

/**
 * A file of the store's, as text: opened without following a link and
 * without waiting on a pipe, and read only where it is a regular file this
 * user owns, that no one else may write, of at most `max` bytes; a kept parse read is stamped as read when
 * its last stamp is a day old, so the sweep keeps what is still read.
 * Undefined for anything else, or a file that is gone.
 */
function ownFile(path: string, max: number, stamp: boolean): string | undefined {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch {
    return undefined;
  }
  try {
    const entry = fstatSync(fd);
    const me = process.getuid?.();
    if (!entry.isFile() || (me !== undefined && entry.uid !== me) || (entry.mode & 0o022) !== 0 || entry.size > max) return undefined;
    const now = Date.now();
    if (stamp && now - entry.mtimeMs > DAY_MS) futimesSync(fd, now / 1000, now / 1000);
    return readFileSync(fd, "utf8");
  } catch {
    return undefined;
  } finally {
    closeSync(fd);
  }
}

/** Write a file whole: under a temporary name no other write shares, then renamed into place; nothing where it cannot be written. */
function writeWhole(path: string, text: string): void {
  const temporary = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    writeFileSync(temporary, text, { flag: "wx", mode: 0o600 });
    renameSync(temporary, path);
  } catch {
    rmSync(temporary, { force: true });
  }
}

/** A folder's names; none where it is gone. */
function listed(folder: string): string[] {
  try {
    return readdirSync(folder);
  } catch {
    return [];
  }
}

/** Remove a folder that holds nothing; one that holds something stays. */
function removeIfEmpty(folder: string): void {
  try {
    rmdirSync(folder);
  } catch {
    // Not empty, or gone.
  }
}

/** A text's key, a fingerprint, a key's shard folder and the rest of its name, a write's temporary file, a store a discard renamed away, and a plugin's name in an audit's. Hex alone, so no two names differ by case on a file system that folds it. */
const KEY = /^[0-9a-f]{32}$/;
const FINGERPRINT = /^[0-9a-f]{24}$/;
const SHARD = /^[0-9a-f]{2}$/;
const KEY_REST = /^[0-9a-f]{30}$/;
const TEMPORARY = /\.tmp$/;
const STALE_STORE = /^[0-9a-f]{24}\.stale-[0-9a-f]{16}$/;
const PLUGIN_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const AUDITS = "audits";
const SWEPT = "swept";

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

/** How long orient says a stale store was found. */
const AUDIT_NOTICE_DAYS = 7;

/** How many days a kept parse no process reads lasts: a text gone from every project is removed by the first sweep after. */
const RETAIN_DAYS = 14;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** The largest kept parse read: one of the largest text a warm-up reads (16 MB) keeps less. */
const PARSE_MAX_BYTES = 32 * 1024 * 1024;

/** The largest audit read: one is a few numbers. */
const AUDIT_MAX_BYTES = 4096;

/** Whether a value is a kept parse: matches of captures, each [name, text, line]. */
function isFound(value: unknown): value is Found {
  return Array.isArray(value) && value.every((match) => Array.isArray(match) && match.every((c) => Array.isArray(c) && c.length === 3 && typeof c[0] === "string" && typeof c[1] === "string" && typeof c[2] === "number"));
}
