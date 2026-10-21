/**
 * A language the project declares in its config: any language with a
 * language server, read through the protocol alone, with no code of its own.
 * The config's `languages` object names, per language, the file extensions
 * it owns and the argv of a server speaking the protocol over stdio, and
 * optionally a test filter template and a refutation template.
 *
 * What the protocol gives, the adapter uses: workspace/symbol and the
 * document symbols resolve a name, textDocument/references lists the sites.
 * What it does not give, the adapter does not claim. Nothing in the protocol
 * says whether the language enforces visibility, so nothing above
 * reference-choked is earned: the one rung is Coherence's check at the edit
 * and in CI. The refutation stages the config's `refute` template as an
 * unsaved document beside the protected thing (outside an exempted folder
 * when the chokepoint governs only references from outside one) and requires
 * the server to report the reference it holds; with no template it is not
 * run, and says why, so the chokepoint reads not run, never pass.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash, randomBytes } from "node:crypto";
import {
  outsideOfFolder,
  parseName,
  rangeContains,
  isTestPath,
  type Definition,
  type Ladder,
  type LanguageAdapter,
  type Position,
  type Range,
  type ReferenceSite,
  type Refutation,
  type ResolveHint,
  type Resolved,
  type Rung,
  type Visibility,
} from "./adapter.ts";
import { JsonRpcClient } from "./jsonrpc.ts";
import { languageOfFile } from "./language-files.ts";
import { fileIdentity, keepProjectFiles, walkBounds, walkedProjectFiles } from "./project-files.ts";

/** One language the config declares. */
export interface DeclaredLanguage {
  /** Its name, as the config's `language` and a test setup's `language` name it; never a built-in's. */
  name: string;
  /** The file extensions it owns, each with its dot (".swift"); no built-in owns one. */
  extensions: string[];
  /** The language server's argv, speaking the protocol over stdio; a relative program path is the project's. */
  server: string[];
  /** How a `via` becomes the test runner's filter: `{name}` is the via. */
  testFilter?: string;
  /** The unsaved document a refutation stages: it must reference the protected thing (see REFUTE_PLACEHOLDERS). */
  refute?: string;
}

/** What a `refute` template may name, and what each becomes. */
export const REFUTE_PLACEHOLDERS: Readonly<Record<string, string>> = {
  "{name}": "the protected thing's name (a module's first top-level symbol)",
  "{module}": "the protected thing's file name without its extension",
  "{file}": "the protected thing's file, relative to the staged document's folder (./secrets.swift, ../store/secrets.swift)",
  "{path}": "the protected thing's file, relative to the project root",
};

/**
 * The most files of a declared language the adapter opens before asking for
 * references: a server that answers only from open documents then sees the
 * project's code. Past it the completeness check (unreportedFiles) still
 * stands between an unseen bypass and a pass.
 */
const OPEN_LIMIT = 2000;

/** The language names the built-in adapters answer to, which a declared language may not take. */
const BUILT_IN = new Set(["typescript", "python", "rust"]);
const NAME = /^[a-z][a-z0-9-]*$/;
const EXTENSION = /^\.[A-Za-z0-9][A-Za-z0-9.+-]*$/;

/**
 * The config's `languages` object, read strictly: every problem is stated,
 * never skipped. `path` names the config file in each message.
 */
export function readDeclaredLanguages(raw: unknown, path: string): DeclaredLanguage[] {
  if (raw === undefined) return [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error(`${path}: languages is an object of declared languages, each keyed by its name`);
  const owners = new Map<string, string>();
  const declared: DeclaredLanguage[] = [];
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    const where = `${path}: languages.${name}`;
    if (BUILT_IN.has(name)) throw new Error(`${where} is a built-in language; a declared language takes another name`);
    if (!NAME.test(name)) throw new Error(`${where}: a declared language's name is lowercase letters, digits and hyphens, starting with a letter`);
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${where} is an object with extensions and server`);
    const entry = value as Record<string, unknown>;
    const extensions = entry["extensions"];
    if (!Array.isArray(extensions) || extensions.length === 0 || !extensions.every((e): e is string => typeof e === "string" && EXTENSION.test(e))) {
      throw new Error(`${where}.extensions is a list of file extensions, each with its dot (".swift")`);
    }
    for (const extension of extensions) {
      const builtIn = languageOfFile(`file${extension}`);
      if (builtIn !== undefined) throw new Error(`${where}.extensions names ${extension}, which the built-in ${builtIn} adapter reads; a declared language takes extensions no built-in owns`);
      const other = owners.get(extension);
      if (other !== undefined) throw new Error(`${where}.extensions names ${extension}, which languages.${other} already owns`);
      owners.set(extension, name);
    }
    const server = entry["server"];
    if (!Array.isArray(server) || server.length === 0 || !server.every((s): s is string => typeof s === "string" && s !== "")) {
      throw new Error(`${where}.server is the language server's command as a list of arguments (["sourcekit-lsp"]), speaking the protocol over stdio`);
    }
    const language: DeclaredLanguage = { name, extensions: [...extensions], server: [...server] };
    for (const key of ["testFilter", "refute"] as const) {
      const template = entry[key];
      if (template === undefined) continue;
      if (typeof template !== "string" || template === "") throw new Error(`${where}.${key} is a template string`);
      language[key] = template;
    }
    if (language.refute !== undefined && !language.refute.includes("{name}") && !language.refute.includes("{module}")) {
      throw new Error(`${where}.refute names neither {name} nor {module}, so the document it stages could reference nothing`);
    }
    const unknown = Object.keys(entry).filter((k) => !["extensions", "server", "testFilter", "refute"].includes(k));
    if (unknown.length > 0) throw new Error(`${where} has ${unknown.join(", ")}; a declared language reads extensions, server, testFilter and refute`);
    declared.push(language);
  }
  return declared;
}

/** The declared language a file is written in, by its extension; undefined for any other file. */
export function declaredLanguageOf(file: string, declared: readonly DeclaredLanguage[]): DeclaredLanguage | undefined {
  const base = file.trim();
  return declared.find((language) => language.extensions.some((extension) => base.endsWith(extension)));
}

/** Programs that run a server rather than being one: the server they run is named in their first argument that is not a flag. */
const RUNNERS = new Set(["node", "nodejs", "bun", "deno", "python", "python3", "java", "npx"]);

/** How a reader names what answered for a declared language: the language and its server, and where it was declared. */
export function declaredInstrument(language: DeclaredLanguage): string {
  const base = (path: string): string => path.slice(path.lastIndexOf("/") + 1);
  const [program, ...args] = language.server;
  const run = RUNNERS.has(base(program!)) ? args.find((a) => !a.startsWith("-")) : undefined;
  return `${language.name} via ${base(run ?? program!)} (declared in the config)`;
}

interface DocumentSymbol {
  name: string;
  kind: number;
  range: Range;
  selectionRange: Range;
  children?: DocumentSymbol[];
}

interface SymbolInformation {
  name: string;
  kind: number;
  location: { uri: string; range: Range };
}

interface Location {
  uri: string;
  range: Range;
}

interface Candidate {
  file: string;
  symbol: DocumentSymbol;
}

function flatten(symbols: DocumentSymbol[], prefix: string[] = []): { path: string[]; symbol: DocumentSymbol }[] {
  const out: { path: string[]; symbol: DocumentSymbol }[] = [];
  for (const symbol of symbols) {
    const path = [...prefix, symbol.name];
    out.push({ path, symbol });
    if (symbol.children !== undefined) out.push(...flatten(symbol.children, path));
  }
  return out;
}

/** One candidate: the only one, else the only one outside test folders, else the only one under the component; ambiguity is reported, never guessed. */
function choose(candidates: Candidate[], hint: ResolveHint): Candidate | undefined {
  if (candidates.length === 1) return candidates[0];
  const nonTest = candidates.filter((c) => !isTestPath(c.file, hint.testFolders));
  if (nonTest.length === 1) return nonTest[0];
  const pool = nonTest.length > 0 ? nonTest : candidates;
  const prefix = hint.component === "." ? "" : hint.component + "/";
  const under = pool.filter((c) => c.file.startsWith(prefix));
  return under.length === 1 ? under[0] : undefined;
}

export class DeclaredAdapter implements LanguageAdapter {
  readonly language: string;
  readonly ladder: Ladder;
  private readonly root: string;
  private readonly declared: DeclaredLanguage;
  private client: JsonRpcClient | undefined;
  private starting: Promise<{ ok: true } | { ok: false; reason: string }> | undefined;
  private readonly opened = new Set<string>();
  private readonly documents = new Map<string, { identity: string | undefined; hash: string }>();
  private readonly versions = new Map<string, number>();
  private readonly symbolCache = new Map<string, DocumentSymbol[]>();
  /** Files whose text the server may hold since the last forget. */
  private readonly touched = new Set<string>();
  /** The unsaved documents a refutation has open: their sites are evidence though no file holds them. */
  private readonly probes = new Set<string>();
  private walked: string[] | undefined;

  constructor(root: string, declared: DeclaredLanguage) {
    this.root = resolve(root);
    this.declared = declared;
    this.language = declared.name;
    const rung: Rung = { grade: "reference-choked", enforcer: "Coherence's check at the edit and in CI", fact: `${declaredInstrument(declared)} reports every reference, and every one in the project is inside the chokepoint` };
    this.ladder = { top: "reference-choked", because: `nothing declares ${declared.name}'s visibility rules, so no compiler or checker is credited`, rungs: [rung] };
  }

  serverPid(): number | undefined {
    return this.client?.pid;
  }

  ready(): Promise<{ ok: true } | { ok: false; reason: string }> {
    this.starting ??= this.start();
    return this.starting;
  }

  private async start(): Promise<{ ok: true } | { ok: false; reason: string }> {
    const [program, ...args] = this.declared.server;
    // A program named by a path is the project's; a bare name is looked up on the PATH, as the shell would.
    const command = program!.includes("/") && !isAbsolute(program!) ? join(this.root, program!) : program!;
    const client = JsonRpcClient.spawn(command, args, this.root);
    this.client = client;
    try {
      await client.request("initialize", {
        processId: process.pid,
        rootUri: pathToFileURL(this.root).href,
        workspaceFolders: [{ uri: pathToFileURL(this.root).href, name: "project" }],
        capabilities: { textDocument: { documentSymbol: { hierarchicalDocumentSymbolSupport: true } }, workspace: { symbol: {}, workspaceFolders: true } },
      });
      client.notify("initialized", {});
      // One of the language's files open, so a server that loads its project around an open document loads it.
      const seed = this.files()[0];
      if (seed !== undefined) this.open(seed);
      return { ok: true };
    } catch (error) {
      client.kill();
      this.client = undefined;
      return { ok: false, reason: `${declaredInstrument(this.declared)}: ${this.declared.server.join(" ")} failed to start or initialize: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  private async live(): Promise<JsonRpcClient> {
    const state = await this.ready();
    if (!state.ok) throw new Error(state.reason);
    if (this.client === undefined || !this.client.alive) {
      this.starting = undefined;
      this.opened.clear();
      this.versions.clear();
      this.documents.clear();
      const again = await this.ready();
      if (!again.ok) throw new Error(again.reason);
    }
    return this.client!;
  }

  /** The project's files in this language, as the walk reads them, taken once per forget. */
  private files(): string[] {
    return (this.walked ??= walkedProjectFiles(walkBounds(this.root, [])).files.filter((f) => declaredLanguageOf(f, [this.declared]) !== undefined));
  }

  private uri(file: string): string {
    return pathToFileURL(join(this.root, file)).href;
  }

  private relative(uri: string): string {
    return relative(this.root, fileURLToPath(uri)).split(sep).join("/");
  }

  private open(file: string, text?: string, identity?: string): void {
    if (this.opened.has(file)) return;
    const content = text ?? readFileSync(join(this.root, file), "utf8");
    this.client!.notify("textDocument/didOpen", { textDocument: { uri: this.uri(file), languageId: this.declared.name, version: 1, text: content } });
    this.opened.add(file);
    this.versions.set(file, 1);
    this.documents.set(file, { identity: identity ?? fileIdentity(join(this.root, file)), hash: createHash("sha256").update(content).digest("hex") });
  }

  private change(file: string, text: string, identity: string | undefined): void {
    const version = (this.versions.get(file) ?? 1) + 1;
    this.versions.set(file, version);
    this.client!.notify("textDocument/didChange", { textDocument: { uri: this.uri(file), version }, contentChanges: [{ text }] });
    this.documents.set(file, { identity, hash: createHash("sha256").update(text).digest("hex") });
  }

  private closeDocument(file: string): void {
    if (!this.opened.has(file)) return;
    this.client!.notify("textDocument/didClose", { textDocument: { uri: this.uri(file) } });
    this.opened.delete(file);
    this.documents.delete(file);
  }

  private async documentSymbols(file: string): Promise<DocumentSymbol[]> {
    const cached = this.symbolCache.get(file);
    if (cached !== undefined) return cached;
    if (!this.probes.has(file) && !existsSync(join(this.root, file))) {
      this.symbolCache.set(file, []);
      return [];
    }
    const client = await this.live();
    if (!this.probes.has(file)) this.open(file);
    const result = await client.request<DocumentSymbol[] | SymbolInformation[] | null>("textDocument/documentSymbol", { textDocument: { uri: this.uri(file) } });
    const symbols: DocumentSymbol[] = (result ?? []).map((s) => ("location" in s ? { name: s.name, kind: s.kind, range: s.location.range, selectionRange: s.location.range } : s));
    this.symbolCache.set(file, symbols);
    return symbols;
  }

  /**
   * The server is made to see the current disk text of every document it may
   * hold and of every named file, as the TypeScript adapter does: a changed
   * open document gets its whole text, a touched or named one not open yet is
   * opened, a gone one is closed, and the forget waits for one documentSymbol
   * answer after the last change, which the server gives only once every
   * change before it is applied.
   */
  async forget(files: readonly string[] = []): Promise<void> {
    this.walked = undefined;
    if (this.client === undefined) {
      this.symbolCache.clear();
      return;
    }
    const named = keepProjectFiles(this.root, files.filter((f) => declaredLanguageOf(f, [this.declared]) !== undefined));
    const forced = new Set(files.filter((file) => named.has(file)));
    const refresh = new Set([...this.touched, ...forced, ...this.opened]);
    this.touched.clear();
    let last: string | undefined;
    const unchanged = new Set<string>();
    for (const file of refresh) {
      const identity = fileIdentity(join(this.root, file));
      if (identity === undefined) {
        this.closeDocument(file);
        continue;
      }
      if (!forced.has(file) && this.documents.get(file)?.identity === identity) {
        unchanged.add(file);
        continue;
      }
      const text = readFileSync(join(this.root, file), "utf8");
      if (!forced.has(file) && this.documents.get(file)?.hash === createHash("sha256").update(text).digest("hex")) {
        this.documents.set(file, { identity, hash: this.documents.get(file)!.hash });
        unchanged.add(file);
        continue;
      }
      last = file;
      if (this.opened.has(file)) this.change(file, text, identity);
      else this.open(file, text, identity);
    }
    for (const file of [...this.symbolCache.keys()]) if (!unchanged.has(file)) this.symbolCache.delete(file);
    if (last !== undefined) await this.documentSymbols(last);
  }

  async resolve(name: string, hint: ResolveHint): Promise<Resolved> {
    const parsed = parseName(name);
    if (parsed.form === "prose") return { ok: false, reason: `"${name}" is prose, not a symbol or a module; write the symbol, the symbol in its file (\`name in file${this.declared.extensions[0]}\`), or the module path` };
    if (parsed.form === "module") {
      const path = join(this.root, parsed.path);
      if (!existsSync(path) || !statSync(path).isFile()) return { ok: false, reason: `module ${parsed.path} is not a file under the project` };
      if (declaredLanguageOf(parsed.path, [this.declared]) === undefined) return { ok: false, reason: `module ${parsed.path} is not a ${this.declared.name} file (${this.declared.extensions.join(", ")})` };
      if (!keepProjectFiles(this.root, [parsed.path]).has(parsed.path)) return { ok: false, reason: `module ${parsed.path} is not one of the project's files (ignored, or inside a nested checkout)` };
      const lines = readFileSync(path, "utf8").split(/\r?\n/);
      const first = (await this.documentSymbols(parsed.path))[0];
      return {
        ok: true,
        definition: {
          name,
          kind: "module",
          file: parsed.path,
          range: { start: { line: 0, character: 0 }, end: { line: Math.max(0, lines.length - 1), character: (lines[lines.length - 1] ?? "").length } },
          selection: first?.selectionRange.start ?? { line: 0, character: 0 },
        },
      };
    }
    const candidates = parsed.fileHint === undefined ? await this.searchWorkspace(parsed.name) : await this.searchFiles(parsed.name, parsed.fileHint);
    if (candidates.length === 0) {
      return { ok: false, reason: parsed.fileHint === undefined ? `${declaredInstrument(this.declared)} knows no symbol named ${parsed.name} in the project` : `no symbol named ${parsed.name} in a ${this.declared.name} file ending with ${parsed.fileHint}` };
    }
    const chosen = choose(candidates, hint);
    if (chosen === undefined) {
      return { ok: false, reason: `${parsed.name} is declared in ${candidates.length} places; write \`${parsed.name} in <file>\``, candidates: candidates.map((c) => `${c.file}:${c.symbol.selectionRange.start.line + 1}`) };
    }
    return { ok: true, definition: { name, kind: "symbol", file: chosen.file, range: chosen.symbol.range, selection: chosen.symbol.selectionRange.start } };
  }

  private async searchWorkspace(name: string): Promise<Candidate[]> {
    const client = await this.live();
    const found = await client.request<SymbolInformation[] | null>("workspace/symbol", { query: name });
    const files = new Set<string>();
    for (const info of found ?? []) {
      if (info.name !== name) continue;
      const file = this.relative(info.location.uri);
      if (!file.startsWith("..") && declaredLanguageOf(file, [this.declared]) !== undefined) files.add(file);
    }
    const own = keepProjectFiles(this.root, [...files]);
    const candidates: Candidate[] = [];
    for (const file of [...files].filter((f) => own.has(f)).sort()) candidates.push(...(await this.declarationsIn(file, name)));
    if (candidates.length > 0) return candidates;
    // A server that has not loaded every file yet answers for what it has: the files whose text spells the name are asked,
    // and a declaration is taken from their document symbols, never from the text alone.
    const spelled = new RegExp(`(^|[^\\w$])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\w$]|$)`);
    for (const file of this.files()) {
      let text: string;
      try {
        text = readFileSync(join(this.root, file), "utf8");
      } catch {
        continue;
      }
      if (spelled.test(text)) candidates.push(...(await this.declarationsIn(file, name)));
    }
    return candidates;
  }

  private async searchFiles(name: string, fileHint: string): Promise<Candidate[]> {
    const candidates: Candidate[] = [];
    for (const file of this.files().filter((f) => f === fileHint || f.endsWith(`/${fileHint}`))) candidates.push(...(await this.declarationsIn(file, name)));
    return candidates;
  }

  /** Top-level declarations named `name` in a file (a nested declaration is not a module member). */
  private async declarationsIn(file: string, name: string): Promise<Candidate[]> {
    return (await this.documentSymbols(file)).filter((s) => s.name === name).map((symbol) => ({ file, symbol }));
  }

  async references(definition: Definition): Promise<ReferenceSite[]> {
    const client = await this.live();
    this.open(definition.file);
    this.touched.add(definition.file);
    // A server may answer only from the documents it has open (sourcekit-lsp with no index store does): every file of the language is opened first.
    for (const file of this.files().slice(0, OPEN_LIMIT)) this.open(file);
    // A module's references are its top-level symbols' (the protocol has no reference to a file).
    const starts: Position[] = definition.kind === "module" ? (await this.documentSymbols(definition.file)).map((s) => s.selectionRange.start) : [definition.selection];
    const reported: Location[] = [];
    for (const position of starts) {
      const locations = await client.request<Location[] | null>("textDocument/references", { textDocument: { uri: this.uri(definition.file) }, position, context: { includeDeclaration: false } });
      reported.push(...(locations ?? []));
    }
    const own = keepProjectFiles(this.root, reported.map((l) => this.relative(l.uri)));
    const seen = new Set<string>();
    const sites: ReferenceSite[] = [];
    for (const location of reported) {
      const file = this.relative(location.uri);
      if (!own.has(file) && !this.probes.has(file)) continue;
      const start = location.range.start;
      if (file === definition.file && starts.some((s) => rangeContains({ start: s, end: s }, start))) continue;
      const key = `${file}:${start.line}:${start.character}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!this.probes.has(file)) this.touched.add(file);
      sites.push({ file, line: start.line + 1, character: start.character, symbol: await this.enclosingSymbol(file, start) });
    }
    sites.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.character - b.character);
    return sites;
  }

  private async enclosingSymbol(file: string, position: Position): Promise<string | undefined> {
    let symbols: DocumentSymbol[];
    try {
      symbols = await this.documentSymbols(file);
    } catch {
      return undefined;
    }
    let best: { path: string[]; symbol: DocumentSymbol } | undefined;
    for (const entry of flatten(symbols)) {
      if (!rangeContains(entry.symbol.range, position)) continue;
      if (best === undefined || entry.path.length > best.path.length) best = entry;
    }
    return best?.path.join(".");
  }

  async visibility(definition: Definition): Promise<Visibility> {
    const evidence = `${declaredInstrument(this.declared)} is read through the language server protocol alone, which says nothing of visibility, and no rule for ${this.declared.name}'s visibility is declared; ${definition.file} is taken as reachable from anywhere`;
    return { enforced: false, visible: true, evidence, rung: { ...this.ladder.rungs[0]! } };
  }

  testFilter(via: string): string {
    return this.declared.testFilter === undefined ? via : this.declared.testFilter.split("{name}").join(via);
  }

  /** The name a staged document references: the declared name at the selection, a module's first top-level symbol. */
  private async stagedName(definition: Definition): Promise<string | undefined> {
    const symbols = await this.documentSymbols(definition.file);
    if (definition.kind === "module") return symbols[0]?.name;
    const at = symbols.find((s) => s.selectionRange.start.line === definition.selection.line && s.selectionRange.start.character === definition.selection.character)?.name;
    if (at !== undefined) return at;
    const parsed = parseName(definition.name);
    return parsed.form === "symbol" ? parsed.name : undefined;
  }

  async refute(protectedThing: Definition, _outsideOf: Definition | undefined, exempt?: string): Promise<Refutation> {
    const template = this.declared.refute;
    if (template === undefined) return { seen: false, staged: [], account: `no refute template declared for ${this.declared.name} (languages.${this.declared.name}.refute in the config), so no synthetic reference was staged` };
    const name = await this.stagedName(protectedThing);
    if (name === undefined) return { seen: false, staged: [], account: `${declaredInstrument(this.declared)} reports no symbol at ${protectedThing.file}:${protectedThing.selection.line + 1}, so the refute template has no name to reference` };
    // Beside the protected thing; where the chokepoint governs only references from outside a folder, beside that folder.
    const folder = exempt === undefined ? (dirname(protectedThing.file) === "." ? "" : `${dirname(protectedThing.file)}/`) : outsideOfFolder(exempt);
    if (folder === undefined) return { seen: false, staged: [], account: `the chokepoint exempts the project root, so there is no outside to stage a reference from` };
    const probe = `${folder}coherence-refutation-${randomBytes(4).toString("hex")}${this.declared.extensions[0]!}`;
    const base = protectedThing.file.slice(protectedThing.file.lastIndexOf("/") + 1);
    const fromProbe = relative(dirname(join(this.root, probe)), join(this.root, protectedThing.file)).split(sep).join("/");
    const values: Record<string, string> = {
      "{name}": name,
      "{module}": base.includes(".") ? base.slice(0, base.indexOf(".")) : base,
      "{file}": fromProbe.startsWith(".") ? fromProbe : `./${fromProbe}`,
      "{path}": protectedThing.file,
    };
    const text = Object.entries(values).reduce((t, [key, value]) => t.split(key).join(value), template);
    const what = `a reference to ${name} from the unsaved document ${probe}, staged from languages.${this.declared.name}.refute`;
    const client = await this.live();
    this.probes.add(probe);
    client.notify("textDocument/didOpen", { textDocument: { uri: this.uri(probe), languageId: this.declared.name, version: 1, text } });
    try {
      const sites = await this.references(protectedThing);
      const hit = sites.find((s) => s.file === probe);
      if (hit === undefined) return { seen: false, staged: [{ what }], account: `${declaredInstrument(this.declared)} did not report ${what} among ${sites.length} references; the check is vacuous` };
      // Seeing the staged document proves the server reports an open one, not that it read every file: a file whose text names the
      // thing with no site reported is a reference it may have missed, so the check proves nothing and reads not run, never pass.
      const missed = await this.unreportedFiles(protectedThing, sites);
      if (missed.length > 0) {
        const named = missed.slice(0, 3).map((m) => `${m.file}:${m.line}`).join(", ") + (missed.length > 3 ? ` and ${missed.length - 3} more` : "");
        return { seen: false, staged: [{ what, site: hit }], account: `${declaredInstrument(this.declared)} reported ${what}, but no reference in ${named}, whose text names ${name}; a server that answers only from the files it has open or indexed would miss a bypass there, so the check is vacuous` };
      }
      return { seen: true, staged: [{ what, site: hit }], account: `${declaredInstrument(this.declared)} reported ${what}, and a reference in every file whose text names it` };
    } finally {
      client.notify("textDocument/didClose", { textDocument: { uri: this.uri(probe) } });
      this.probes.delete(probe);
      this.symbolCache.delete(probe);
    }
  }

  /**
   * The project's files of this language whose text names the protected thing
   * (a module: any of its top-level symbols) as a whole word, past its own
   * declaration, where the server reported no site: each with the first line
   * that names it. A comment or a string naming it counts too, so the check
   * errs toward not run.
   */
  private async unreportedFiles(definition: Definition, sites: readonly ReferenceSite[]): Promise<{ file: string; line: number }[]> {
    const symbols = await this.documentSymbols(definition.file);
    const named = definition.kind === "module" ? symbols : symbols.filter((s) => s.selectionRange.start.line === definition.selection.line && s.selectionRange.start.character === definition.selection.character);
    const names = [...new Set(named.map((s) => s.name))];
    if (names.length === 0) return [];
    const declarations = new Set(named.map((s) => s.selectionRange.start.line));
    const word = new RegExp(`(^|[^\\w$])(?:${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})([^\\w$]|$)`);
    const reported = new Set(sites.map((s) => s.file));
    const missed: { file: string; line: number }[] = [];
    for (const file of this.files()) {
      if (reported.has(file)) continue;
      let lines: string[];
      try {
        lines = readFileSync(join(this.root, file), "utf8").split(/\r?\n/);
      } catch {
        continue;
      }
      const at = lines.findIndex((text, i) => !(file === definition.file && declarations.has(i)) && word.test(text));
      if (at !== -1) missed.push({ file, line: at + 1 });
    }
    return missed;
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    this.starting = undefined;
    if (client === undefined) return;
    try {
      await client.request("shutdown", null, 3_000);
      client.notify("exit", null);
    } catch {
      // The server is going down either way.
    }
    setTimeout(() => client.kill(), 500).unref();
  }
}
