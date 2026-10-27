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
 * kept in the user's cache, outside every project, by the parser's
 * fingerprint and each text's digest: the warm-up a session start launches
 * reads every file once (warmParses), and a later reading of the whole
 * project, or of any project holding the same text, parses only what changed. Every tree is
 * freed before the reader returns: web-tree-sitter trees hold WebAssembly
 * memory only delete() returns, and the old harness crashed an adopter at
 * parse #638 of one file by never freeing them.
 */

import { createHash, randomBytes } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
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
const STORE_FORMAT = 7;

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
 * session start launches does: every text is read through the parser (a kept
 * parse answering where the text is unchanged), what was parsed is written as
 * a segment of the store, and the store's segments are merged when they are
 * many, keeping what this pass read and what any pass wrote in the last
 * RETAIN_DAYS. One warm-up of a project at a time; another of the same
 * project skips.
 */
export function warmParses(plugin: LoadedPlugin, root: string, texts: Iterable<string>): { read: number; parsed: number; audited: number; stale: number; skipped?: true } {
  const reader = treeReaderOf(plugin, root) as (TreeReader & { store: ParseStore | undefined; keyOf(text: string): string }) | undefined;
  if (reader === undefined || reader.store === undefined) return { read: 0, parsed: 0, audited: 0, stale: 0 };
  const store = reader.store;
  if (!store.lock(root)) return { read: 0, parsed: 0, audited: 0, stale: 0, skipped: true };
  try {
    const keep = new Set<string>();
    let read = 0;
    const before = store.parsed;
    // A sample of the texts a kept parse answers, chosen evenly over the pass (a reservoir), each held after the pass to a fresh parse of it.
    const sample: { text: string; kept: Found }[] = [];
    let hits = 0;
    for (const text of texts) {
      const key = reader.keyOf(text);
      const kept = store.get(key);
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
    const parsed = store.parsed - before;
    // A kept parse that differs from a fresh parse of the same text was kept under a fingerprint that leaves out something the parse depends on:
    // the store is removed whole, since no entry of it can be trusted, and the next session start says so (staleParsesNotice).
    const fresh = compiled.get(plugin.dir)!;
    const stale = sample.filter(({ text, kept }) => JSON.stringify(fresh.parse(text)) !== JSON.stringify(kept)).length;
    if (stale > 0) {
      store.discard({ sampled: sample.length, stale });
      for (const key of [...readers.keys()]) if (key.startsWith(`${plugin.dir}\u0000`)) readers.delete(key);
    } else {
      store.flush();
      store.merge(keep);
    }
    StoreFolder.prune(compiled.get(plugin.dir)!.fingerprint);
    return { read, parsed, audited: sample.length, stale };
  } finally {
    store.unlock(root);
  }
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
  return StoreFolder.audits()
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
 * The kept parses of one parser fingerprint, in the user's cache outside
 * every project (parsesFolder), shared by every project, worktree and process
 * of the user's. A kept parse is a function of its text and the fingerprint
 * alone, so it is filed by the text's digest and never changes once written:
 * a process writes what it parsed as a segment, one file written whole under
 * a temporary name and renamed into place, and never opens a segment to
 * write again. A reader reads each segment once, and a long-lived one reads
 * the segments other processes wrote since, at most once a second; nothing
 * it has read is ever changed under it. No file of a project's is read or
 * written, so a repository can neither feed a reading through the store nor
 * stop one. A warm-up merges the segments when there are many, and a stale
 * store, which only a fingerprint that leaves something out can make, is
 * removed whole.
 */
class ParseStore {
  private static stores = new Map<string, ParseStore>();
  private readonly entries = new Map<string, Found>();
  /** The segment each kept parse was read from, for a merge's retention. */
  private readonly from = new Map<string, string>();
  /** The segments this process has read, or written itself. */
  private readonly read = new Set<string>();
  private added = new Map<string, Found>();
  private checked = 0;
  /** Texts this store's process parsed itself. */
  parsed = 0;
  /** How many times this process read segments it had not read: once, and again only once another process wrote one. */
  loads = 0;

  static of(plugin: string, fingerprint: string): ParseStore | undefined {
    let store = ParseStore.stores.get(fingerprint);
    if (store === undefined) {
      const folder = StoreFolder.of(fingerprint);
      if (folder === undefined) return undefined;
      store = new ParseStore(plugin, folder);
      ParseStore.stores.set(fingerprint, store);
      if (ParseStore.stores.size === 1) process.once("exit", () => ParseStore.stores.forEach((s) => s.flush()));
    }
    return store;
  }

  private readonly plugin: string;
  private readonly folder: StoreFolder;

  private constructor(plugin: string, folder: StoreFolder) {
    this.plugin = plugin;
    this.folder = folder;
  }

  get(key: string): Found | undefined {
    if (Date.now() - this.checked > RELOAD_MS) this.readNew();
    return this.entries.get(key);
  }

  /**
   * Read the segments not read yet: every one at first, and after that only
   * those another process wrote since. Where a segment read before is gone
   * (another process merged the store, or removed it as stale), what was
   * read is dropped and the store read again from the segments there are,
   * so a reader never answers from a segment the store no longer holds.
   */
  private readNew(): void {
    this.checked = Date.now();
    const present = this.folder.segments();
    const here = new Set(present);
    if ([...this.read].some((name) => !here.has(name))) {
      this.entries.clear();
      this.from.clear();
      this.read.clear();
      for (const [key, found] of this.added) this.entries.set(key, found);
    }
    const unread = present.filter((name) => !this.read.has(name));
    if (unread.length === 0) return;
    this.loads++;
    for (const name of unread) {
      this.read.add(name);
      for (const [key, found] of this.folder.readSegment(name)) {
        if (this.entries.has(key)) continue;
        this.entries.set(key, found);
        this.from.set(key, name);
      }
    }
  }

  put(key: string, found: Found): void {
    this.parsed++;
    this.entries.set(key, found);
    this.added.set(key, found);
    // A process that lives long (the warm server, hook-serve) writes as it goes, so what it holds unwritten stays small.
    if (this.added.size >= FLUSH_EVERY) this.flush();
  }

  /** Write what this process parsed and has not written as a segment of its own. Never a read: a process that exits writes and goes. */
  flush(): void {
    if (this.added.size === 0) return;
    const name = this.folder.writeSegment(this.added);
    if (name !== undefined) {
      this.read.add(name);
      for (const key of this.added.keys()) this.from.set(key, name);
    }
    this.added = new Map();
  }

  /**
   * Merge the store's segments into one when there are more than
   * SEGMENTS_MAX: every kept parse this pass read, and every one a segment
   * written in the last RETAIN_DAYS holds, so a text no pass has read since
   * ages out. The merged segments are removed after the merge is written;
   * one another process writes meanwhile is left as it is.
   */
  merge(keep: ReadonlySet<string>): void {
    this.checked = 0;
    this.readNew();
    const present = this.folder.segments().filter((name) => this.read.has(name));
    if (present.length <= SEGMENTS_MAX) return;
    const recent = new Set(present.filter((name) => this.folder.ageDays(name) <= RETAIN_DAYS));
    const merged = new Map<string, Found>();
    for (const [key, found] of this.entries) if (keep.has(key) || recent.has(this.from.get(key) ?? "")) merged.set(key, found);
    const name = this.folder.writeSegment(merged);
    if (name === undefined) return;
    this.read.add(name);
    for (const key of merged.keys()) this.from.set(key, name);
    for (const old of present) this.folder.remove(old);
  }

  /** Remove every kept parse of this fingerprint, in memory and in the cache, and leave the audit that found them stale for orient to say. */
  discard(audit: { sampled: number; stale: number }): void {
    this.entries.clear();
    this.from.clear();
    this.added = new Map();
    for (const name of this.folder.segments()) this.folder.remove(name);
    StoreFolder.writeAudit(this.plugin, { at: Date.now(), ...audit });
  }

  /**
   * Take a project's warm-up lock: true when this process holds it, false
   * when a live warm-up of the same project in another process does, so two
   * warm-ups (a session start and the prompt after it) never parse a project
   * twice. A lock whose process is gone, older than WARM_LOCK_MS, or stamped
   * in the future is taken over.
   */
  lock(root: string): boolean {
    const name = this.lockName(root);
    for (let attempt = 0; attempt < 2; attempt++) {
      if (this.folder.create(name, `${process.pid} ${Date.now()}`)) return true;
      const [pid, at] = (this.folder.read(name) ?? "").split(" ").map(Number);
      const age = Date.now() - (at ?? 0);
      if (alive(pid ?? 0) && age >= 0 && age < WARM_LOCK_MS) return false;
      this.folder.remove(name);
    }
    return false;
  }

  /** Give a project's warm-up lock back. */
  unlock(root: string): void {
    const name = this.lockName(root);
    if (this.folder.read(name)?.startsWith(`${process.pid} `)) this.folder.remove(name);
  }

  private lockName(root: string): string {
    return `warming-${createHash("sha256").update(resolve(root)).digest("hex").slice(0, 16)}.lock`;
  }
}

/**
 * The folder of the user's kept parses, or undefined where it cannot be the
 * user's alone. The one place the store's path is made, under the user's
 * cache (userCacheDir), never under a project.
 */
function parsesFolder(): string | undefined {
  const cache = userCacheDir();
  const parses = join(cache, "parses");
  try {
    mkdirSync(parses, { recursive: true, mode: 0o700 });
  } catch {
    return undefined;
  }
  return ownFolder(cache) && ownFolder(parses) ? parses : undefined;
}

/** Whether a folder is this user's alone: a real folder, not a link, owned by this user, that no one else may write. */
function ownFolder(path: string): boolean {
  try {
    const entry = lstatSync(path);
    const owner = process.getuid?.();
    return entry.isDirectory() && (owner === undefined || entry.uid === owner) && (entry.mode & 0o022) === 0;
  } catch {
    return false;
  }
}

/**
 * One fingerprint's folder of kept parses in the user's cache, and the audits
 * beside them. Its segments are named by random hex, written whole under a
 * temporary name and renamed into place, and only ever read or removed after.
 */
class StoreFolder {
  readonly #dir: string;

  private constructor(dir: string) {
    this.#dir = dir;
  }

  /** A fingerprint's folder; undefined where the user's cache is not the user's alone or will not take it. */
  static of(fingerprint: string): StoreFolder | undefined {
    const parses = parsesFolder();
    if (parses === undefined || !FINGERPRINT.test(fingerprint)) return undefined;
    const dir = join(parses, fingerprint);
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    } catch {
      return undefined;
    }
    return ownFolder(dir) ? new StoreFolder(dir) : undefined;
  }

  /** The segments the folder holds now. */
  segments(): string[] {
    try {
      return readdirSync(this.#dir).filter((name) => SEGMENT.test(name)).sort();
    } catch {
      return [];
    }
  }

  /** A segment's kept parses, each checked for shape; none where it is gone or will not read. */
  readSegment(name: string): [string, Found][] {
    try {
      const kept = JSON.parse(readFileSync(join(this.#dir, name), "utf8")) as unknown;
      if (typeof kept !== "object" || kept === null || Array.isArray(kept)) return [];
      return Object.entries(kept).filter((entry): entry is [string, Found] => isFound(entry[1]));
    } catch {
      return [];
    }
  }

  /** Write kept parses as a new segment, whole: under a temporary name, then renamed into place. Its name, or undefined where it could not be written. */
  writeSegment(entries: ReadonlyMap<string, Found>): string | undefined {
    const name = `${randomBytes(12).toString("hex")}.json`;
    const temporary = join(this.#dir, `${name}.${process.pid}.tmp`);
    try {
      writeFileSync(temporary, JSON.stringify(Object.fromEntries(entries)), { flag: "wx", mode: 0o600 });
      renameSync(temporary, join(this.#dir, name));
      return name;
    } catch {
      rmSync(temporary, { force: true });
      return undefined;
    }
  }

  /** How many days ago a segment was written; never where it is gone. */
  ageDays(name: string): number {
    try {
      return (Date.now() - statSync(join(this.#dir, name)).mtimeMs) / 86_400_000;
    } catch {
      return Number.POSITIVE_INFINITY;
    }
  }

  /** Create a small file where none is: false where one already is. */
  create(name: string, text: string): boolean {
    try {
      writeFileSync(join(this.#dir, name), text, { flag: "wx", mode: 0o600 });
      return true;
    } catch {
      return false;
    }
  }

  /** A small file's text, or undefined where it is gone. */
  read(name: string): string | undefined {
    try {
      return readFileSync(join(this.#dir, name), "utf8");
    } catch {
      return undefined;
    }
  }

  remove(name: string): void {
    rmSync(join(this.#dir, name), { force: true });
  }

  /** Remove the folders of other fingerprints no warm-up has written to in RETAIN_DAYS: a plugin or Coherence changed, and their parses will never be read again. */
  static prune(current: string): void {
    const parses = parsesFolder();
    if (parses === undefined) return;
    let names: string[];
    try {
      names = readdirSync(parses).filter((name) => FINGERPRINT.test(name) && name !== current);
    } catch {
      return;
    }
    for (const name of names) {
      const folder = new StoreFolder(join(parses, name));
      const newest = Math.min(...folder.segments().map((segment) => folder.ageDays(segment)), folder.ageDays("."));
      if (newest > RETAIN_DAYS) rmSync(join(parses, name), { recursive: true, force: true });
    }
  }

  /** Leave a warm-up's audit of a plugin's stale store for orient. */
  static writeAudit(plugin: string, audit: { at: number; sampled: number; stale: number }): void {
    const parses = parsesFolder();
    if (parses === undefined || !PLUGIN_NAME.test(plugin)) return;
    try {
      mkdirSync(join(parses, AUDITS), { recursive: true, mode: 0o700 });
      writeFileSync(join(parses, AUDITS, `${plugin}.json`), JSON.stringify(audit), { mode: 0o600 });
    } catch {
      // An audit that cannot be kept is one orient does not say.
    }
  }

  /** The audits warm-ups left, by plugin, each checked for shape. */
  static audits(): { plugin: string; at: number; sampled: number; stale: number }[] {
    const parses = parsesFolder();
    if (parses === undefined) return [];
    const folder = new StoreFolder(join(parses, AUDITS));
    let names: string[];
    try {
      names = readdirSync(join(parses, AUDITS)).filter((name) => name.endsWith(".json") && PLUGIN_NAME.test(name.slice(0, -5)));
    } catch {
      return [];
    }
    return names.flatMap((name) => {
      try {
        const { at, sampled, stale } = JSON.parse(folder.read(name) ?? "") as Record<string, unknown>;
        if (typeof at !== "number" || !Number.isInteger(sampled) || !Number.isInteger(stale)) return [];
        return [{ plugin: name.slice(0, -5), at, sampled: sampled as number, stale: stale as number }];
      } catch {
        return [];
      }
    });
  }
}

/** A fingerprint's folder name, a segment's name, a plugin's name in an audit's, and the audits' folder. */
const FINGERPRINT = /^[A-Za-z0-9_-]{16}$/;
const SEGMENT = /^[0-9a-f]{24}\.json$/;
const PLUGIN_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const AUDITS = "audits";

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

/** How often, at most, a long-lived process looks for segments other processes wrote. */
const RELOAD_MS = 1000;

/** How long orient says a stale store was found. */
const AUDIT_NOTICE_DAYS = 7;

/** How long a warm-up lock holds before another warm-up of the same project may take it over. */
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

/** How many days a kept parse no warm-up read lasts: a text gone from every project ages out at the next merge after. */
const RETAIN_DAYS = 14;

/** How many segments a fingerprint's folder holds before a warm-up merges them. */
const SEGMENTS_MAX = 8;

/** How many parses a process holds before it writes them. */
const FLUSH_EVERY = 256;

/** Whether a value is a kept parse: matches of captures, each [name, text, line]. */
function isFound(value: unknown): value is Found {
  return Array.isArray(value) && value.every((match) => Array.isArray(match) && match.every((c) => Array.isArray(c) && c.length === 3 && typeof c[0] === "string" && typeof c[1] === "string" && typeof c[2] === "number"));
}
