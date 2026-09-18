/**
 * The TypeScript adapter: the language server protocol over stdio to
 * typescript-language-server, found in the adopter's node_modules first,
 * then Coherence's own (it is an optional dependency), then on PATH.
 *
 * Symbols resolve through workspace/symbol (a bare name) or the hinted
 * file's textDocument/documentSymbol (`name in file.ts`); a module is its
 * file. References come from textDocument/references, and every site the
 * server reports is a reference, an import or re-export specifier
 * included: whether it is inside the chokepoint is the check's question,
 * not the adapter's. Exportedness is not in the protocol, so the adapter
 * reads the declaration text. The refutation opens an unsaved sibling
 * document that imports and uses the protected thing and asks whether the
 * instrument reports it.
 *
 * TypeScript enforces visibility: a symbol not exported from its module is
 * unreachable from any other module, so the top rung is visibility-choked.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import {
  isTestPath,
  parseName,
  rangeContains,
  type Definition,
  type Ladder,
  type LanguageAdapter,
  type Position,
  type Range,
  type ReferenceSite,
  type Refutation,
  type ResolveHint,
  type Resolved,
  type Visibility,
} from "./adapter.ts";
import { JsonRpcClient } from "./jsonrpc.ts";

const here = dirname(fileURLToPath(import.meta.url));
const COHERENCE_ROOT = resolve(here, "..", "..");
const SERVER_BIN = "typescript-language-server";
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);
const SKIPPED_FOLDERS = new Set(["node_modules", ".git", "dist", ".coherence", ".claude", ".codex", "public"]);

export const TYPESCRIPT_LADDER: Ladder = {
  top: "visibility-choked",
  because: "a symbol not exported from its module cannot be referenced from another module; the compiler refuses it",
  rungs: [
    { grade: "visibility-choked", enforcer: "the compiler", fact: "the protected thing is not exported from its module, so no other module can reference it" },
    { grade: "reference-choked", enforcer: "Coherence's check at the edit and in CI", fact: "the protected thing is exported, and every resolved reference in the project is inside the chokepoint" },
  ],
};

/** Where the language server binary is, or undefined with the places looked. */
export function locateServer(root: string): { path: string; looked: string[] } | undefined {
  const looked = [join(root, "node_modules", ".bin", SERVER_BIN), join(COHERENCE_ROOT, "node_modules", ".bin", SERVER_BIN)];
  for (const candidate of looked) if (existsSync(candidate)) return { path: candidate, looked };
  for (const dir of (process.env["PATH"] ?? "").split(":")) {
    const candidate = join(dir, SERVER_BIN);
    if (dir !== "" && existsSync(candidate)) return { path: candidate, looked: [...looked, candidate] };
  }
  return undefined;
}

/** The tsserver the server should drive: the adopter's typescript, else Coherence's optional one. */
function locateTsserver(root: string): string | undefined {
  for (const base of [root, COHERENCE_ROOT]) {
    const candidate = join(base, "node_modules", "typescript", "lib", "tsserver.js");
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
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
  containerName?: string;
}

interface Location {
  uri: string;
  range: Range;
}

/** The first source file under the root: opening it makes the language server load the project. */
function firstSourceFile(root: string): string | undefined {
  const walk = (dir: string): string | undefined => {
    let entries: string[];
    try {
      entries = readdirSync(dir).sort();
    } catch {
      return undefined;
    }
    for (const name of entries) {
      if (name.startsWith(".") || SKIPPED_FOLDERS.has(name)) continue;
      const path = join(dir, name);
      const stats = statSync(path);
      if (stats.isDirectory()) {
        const found = walk(path);
        if (found !== undefined) return found;
      } else if (stats.isFile() && SOURCE_EXTENSIONS.has(extensionOf(name)) && !/\.d\.ts$/.test(name)) {
        return path;
      }
    }
    return undefined;
  };
  return walk(root);
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot);
}

/** Every source file under the root whose project-relative path is the hint or ends with `/<hint>`. */
export function filesEndingWith(root: string, hint: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const name of entries) {
      if (name.startsWith(".") || SKIPPED_FOLDERS.has(name)) continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      const rel = relative(root, path).split(sep).join("/");
      if (rel === hint || rel.endsWith("/" + hint)) found.push(rel);
    }
  };
  walk(root);
  return found;
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

export class TypeScriptAdapter implements LanguageAdapter {
  readonly language = "typescript";
  readonly ladder = TYPESCRIPT_LADDER;
  private client: JsonRpcClient | undefined;
  private starting: Promise<{ ok: true } | { ok: false; reason: string }> | undefined;
  private readonly opened = new Set<string>();
  private readonly symbolCache = new Map<string, DocumentSymbol[]>();
  private readonly lineCache = new Map<string, string[]>();
  /** The document version last sent per open file; a change carries the next one. */
  private readonly versions = new Map<string, number>();
  /** The first source file, kept open so the project stays loaded. */
  private seed: string | undefined;
  /** Files a definition or a reference site landed in since the last forget: the ones a forget re-reads from disk. */
  private readonly touched = new Set<string>();
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  ready(): Promise<{ ok: true } | { ok: false; reason: string }> {
    this.starting ??= this.start();
    return this.starting;
  }

  private async start(): Promise<{ ok: true } | { ok: false; reason: string }> {
    const server = locateServer(this.root);
    if (server === undefined) {
      return { ok: false, reason: `${SERVER_BIN} not found; looked in the project's node_modules, Coherence's, and PATH. Install it: npm install --save-dev typescript-language-server typescript` };
    }
    const tsserver = locateTsserver(this.root);
    const client = JsonRpcClient.spawn(server.path, ["--stdio"], this.root);
    this.client = client;
    try {
      await client.request("initialize", {
        processId: process.pid,
        rootUri: pathToFileURL(this.root).href,
        workspaceFolders: [{ uri: pathToFileURL(this.root).href, name: "project" }],
        capabilities: {
          textDocument: { documentSymbol: { hierarchicalDocumentSymbolSupport: true } },
          workspace: { symbol: {}, workspaceFolders: true },
        },
        initializationOptions: {
          // One semantic server only: the syntax server the language server pairs it with by default sees
          // open documents alone, and workspace/symbol and references routed there answer for those.
          tsserver: {
            useSyntaxServer: "never",
            ...(tsserver === undefined ? {} : { path: tsserver }),
            ...(process.env["COHERENCE_TSSERVER_LOG"] === undefined ? {} : { logDirectory: process.env["COHERENCE_TSSERVER_LOG"], logVerbosity: "verbose" }),
          },
          preferences: { includeCompletionsForModuleExports: false },
        },
      });
      client.notify("initialized", {});
      const seed = firstSourceFile(this.root);
      this.seed = seed === undefined ? undefined : relative(this.root, seed).split(sep).join("/");
      if (this.seed !== undefined) this.open(this.seed);
      return { ok: true };
    } catch (error) {
      client.kill();
      this.client = undefined;
      return { ok: false, reason: `${SERVER_BIN} at ${server.path} failed to initialize: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  private async live(): Promise<JsonRpcClient> {
    const state = await this.ready();
    if (!state.ok) throw new Error(state.reason);
    if (this.client === undefined || !this.client.alive) {
      this.starting = undefined;
      this.opened.clear();
      this.versions.clear();
      const again = await this.ready();
      if (!again.ok) throw new Error(again.reason);
    }
    return this.client!;
  }

  private uri(file: string): string {
    return pathToFileURL(join(this.root, file)).href;
  }

  private relative(uri: string): string {
    return relative(this.root, fileURLToPath(uri)).split(sep).join("/");
  }

  private lines(file: string): string[] {
    let lines = this.lineCache.get(file);
    if (lines === undefined) {
      lines = readFileSync(join(this.root, file), "utf8").split(/\r?\n/);
      this.lineCache.set(file, lines);
    }
    return lines;
  }

  private open(file: string, text?: string): void {
    if (this.opened.has(file)) return;
    const content = text ?? readFileSync(join(this.root, file), "utf8");
    this.client!.notify("textDocument/didOpen", { textDocument: { uri: this.uri(file), languageId: "typescript", version: 1, text: content } });
    this.opened.add(file);
    this.versions.set(file, 1);
  }

  /** Replace an open document's whole text; the version only ever climbs, so the server never discards a change as old. */
  private change(file: string, text: string): void {
    const version = (this.versions.get(file) ?? 1) + 1;
    this.versions.set(file, version);
    this.client!.notify("textDocument/didChange", { textDocument: { uri: this.uri(file), version }, contentChanges: [{ text }] });
  }

  private closeDocument(file: string): void {
    if (!this.opened.has(file)) return;
    this.client!.notify("textDocument/didClose", { textDocument: { uri: this.uri(file) } });
    this.opened.delete(file);
  }

  private async documentSymbols(file: string): Promise<DocumentSymbol[]> {
    const cached = this.symbolCache.get(file);
    if (cached !== undefined) return cached;
    const client = await this.live();
    this.open(file);
    const result = await client.request<DocumentSymbol[] | SymbolInformation[] | null>("textDocument/documentSymbol", { textDocument: { uri: this.uri(file) } });
    const symbols: DocumentSymbol[] = (result ?? []).map((s) =>
      "location" in s ? { name: s.name, kind: s.kind, range: s.location.range, selectionRange: s.location.range } : s,
    );
    this.symbolCache.set(file, symbols);
    return symbols;
  }

  /**
   * Cached facts about files are dropped when their text may have changed (the
   * edit hook re-runs a check), and the server is made to see the current disk
   * text of every document this adapter may have open before any question is
   * asked. Closing a document is not enough: tsserver reloads a closed file
   * from disk only when it does not own the text, and a didOpen carrying the
   * text it already loaded leaves it owning the text, so a close after that
   * leaves the edit to its file watcher, which is late under load and blind to
   * an excluded file. So every open document, every file touched since the
   * last forget, and every file the caller names gets its whole current text
   * (didChange for an open document, didOpen for one not yet open, and it
   * stays open), and the forget waits for a documentSymbol answer per file,
   * which the server cannot give before the change is applied. A file that
   * no longer exists is closed.
   */
  async forget(files: readonly string[] = []): Promise<void> {
    this.symbolCache.clear();
    this.lineCache.clear();
    if (this.client === undefined) return;
    const refresh = new Set([...this.touched, ...files, ...this.opened]);
    this.touched.clear();
    const synced: string[] = [];
    for (const file of refresh) {
      const path = join(this.root, file);
      if (!existsSync(path) || !statSync(path).isFile()) {
        this.closeDocument(file);
        continue;
      }
      const text = readFileSync(path, "utf8");
      if (this.opened.has(file)) this.change(file, text);
      else this.open(file, text);
      synced.push(file);
    }
    // The acknowledgment: one answer per changed document, each ordered after its change.
    for (const file of synced) await this.documentSymbols(file);
  }

  async resolve(name: string, hint: ResolveHint): Promise<Resolved> {
    const parsed = parseName(name);
    if (parsed.form === "prose") {
      return { ok: false, reason: `"${name}" is prose, not a symbol or a module; write the symbol (\`writeClass\`), the symbol in its file (\`KERNEL_WRITE_POLICY in policy.ts\`), or the module path` };
    }
    if (parsed.form === "module") {
      const path = join(this.root, parsed.path);
      if (!existsSync(path) || !statSync(path).isFile()) return { ok: false, reason: `module ${parsed.path} is not a file under the project` };
      const lines = this.lines(parsed.path);
      const symbols = await this.documentSymbols(parsed.path);
      const first = symbols.find((s) => this.exportedIn(parsed.path, s));
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
      return { ok: false, reason: parsed.fileHint === undefined ? `no symbol named ${parsed.name} in the project` : `no symbol named ${parsed.name} in a file ending with ${parsed.fileHint}` };
    }
    const chosen = choose(candidates, hint);
    if (chosen === undefined) {
      const where = candidates.map((c) => `${c.file}:${c.symbol.selectionRange.start.line + 1}`);
      return { ok: false, reason: `${parsed.name} is declared in ${candidates.length} places; write \`${parsed.name} in <file>\``, candidates: where };
    }
    return {
      ok: true,
      definition: { name, kind: "symbol", file: chosen.file, range: chosen.symbol.range, selection: chosen.symbol.selectionRange.start },
    };
  }

  private async searchWorkspace(name: string): Promise<Candidate[]> {
    const client = await this.live();
    const found = await client.request<SymbolInformation[] | null>("workspace/symbol", { query: name });
    const files = new Set<string>();
    for (const info of found ?? []) {
      if (info.name !== name) continue;
      const file = this.relative(info.location.uri);
      if (file.startsWith("..") || file.startsWith("node_modules/")) continue;
      files.add(file);
    }
    const candidates: Candidate[] = [];
    for (const file of [...files].sort()) candidates.push(...(await this.declarationsIn(file, name)));
    return candidates;
  }

  private async searchFiles(name: string, fileHint: string): Promise<Candidate[]> {
    const candidates: Candidate[] = [];
    for (const file of filesEndingWith(this.root, fileHint)) candidates.push(...(await this.declarationsIn(file, name)));
    return candidates;
  }

  /** Top-level declarations named `name` in a file (a nested declaration is not a module member). */
  private async declarationsIn(file: string, name: string): Promise<Candidate[]> {
    const symbols = await this.documentSymbols(file);
    return symbols.filter((s) => s.name === name).map((symbol) => ({ file, symbol }));
  }

  async references(definition: Definition): Promise<ReferenceSite[]> {
    const client = await this.live();
    this.open(definition.file);
    this.touched.add(definition.file);
    const starts: Position[] = [];
    if (definition.kind === "module") {
      for (const symbol of await this.documentSymbols(definition.file)) {
        if (this.exportedIn(definition.file, symbol)) starts.push(symbol.selectionRange.start);
      }
    } else {
      starts.push(definition.selection);
    }
    const seen = new Set<string>();
    const sites: ReferenceSite[] = [];
    for (const position of starts) {
      const locations = await client.request<Location[] | null>("textDocument/references", {
        textDocument: { uri: this.uri(definition.file) },
        position,
        context: { includeDeclaration: false },
      });
      for (const location of locations ?? []) {
        const file = this.relative(location.uri);
        if (file.startsWith("..") || file.startsWith("node_modules/")) continue;
        const start = location.range.start;
        if (file === definition.file && rangeContains({ start: definition.selection, end: definition.selection }, start)) continue;
        const key = `${file}:${start.line}:${start.character}`;
        if (seen.has(key)) continue;
        seen.add(key);
        this.touched.add(file);
        sites.push({ file, line: start.line + 1, character: start.character, symbol: await this.enclosingSymbol(file, start) });
      }
    }
    sites.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.character - b.character);
    return sites;
  }

  private linesOf(file: string): string[] {
    try {
      return this.lines(file);
    } catch {
      return [];
    }
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

  private exportedIn(file: string, symbol: DocumentSymbol): boolean {
    return this.visibilityOf(file, symbol.name, symbol.range.start.line).visible;
  }

  private visibilityOf(file: string, name: string, declarationLine: number): Visibility {
    const lines = this.linesOf(file);
    const declaration = (lines[declarationLine] ?? "").trim();
    if (/^export\b/.test(declaration)) return { enforced: true, visible: true, evidence: `${file}:${declarationLine + 1} reads "${declaration.slice(0, 60)}"` };
    const listed = new RegExp(`export\\s*(type\\s*)?\\{[^}]*\\b${name}\\b[^}]*\\}`);
    const asDefault = new RegExp(`export\\s+default\\s+${name}\\b`);
    for (let i = 0; i < lines.length; i++) {
      const text = lines[i]!;
      if (listed.test(text) || asDefault.test(text)) return { enforced: true, visible: true, evidence: `${file}:${i + 1} exports ${name}` };
    }
    return { enforced: true, visible: false, evidence: `${file}:${declarationLine + 1} declares ${name} without export and no export list names it` };
  }

  async visibility(definition: Definition, _chokepoint?: Definition): Promise<Visibility> {
    if (definition.kind === "module") {
      return { enforced: true, visible: true, evidence: `${definition.file} is a module; any file may import it` };
    }
    const name = await this.declaredName(definition);
    if (name === undefined) return { enforced: true, visible: false, evidence: `no declaration at ${definition.file}:${definition.selection.line + 1}` };
    return this.visibilityOf(definition.file, name, definition.range.start.line);
  }

  /** The name as declared at the definition's selection, which the spec may have written with a file hint. */
  private async declaredName(definition: Definition): Promise<string | undefined> {
    const symbols = await this.documentSymbols(definition.file);
    return symbols.find((s) => s.selectionRange.start.line === definition.selection.line && s.selectionRange.start.character === definition.selection.character)?.name;
  }

  testFilter(via: string): string {
    return via;
  }

  async refute(protectedThing: Definition, _outsideOf: Definition | undefined): Promise<Refutation> {
    const client = await this.live();
    const symbols = await this.documentSymbols(protectedThing.file);
    let importName: string | undefined;
    if (protectedThing.kind === "module") {
      importName = symbols.find((s) => this.exportedIn(protectedThing.file, s))?.name;
      if (importName === undefined) return { seen: false, account: `${protectedThing.file} exports nothing, so no document can reference it` };
    } else {
      importName = await this.declaredName(protectedThing);
      if (importName === undefined) return { seen: false, account: `no declaration at ${protectedThing.file}:${protectedThing.selection.line + 1}` };
      const visibility = this.visibilityOf(protectedThing.file, importName, protectedThing.range.start.line);
      if (!visibility.visible) {
        // The language refuses the import; the synthetic reference stands in the protected file's own module instead.
        return this.refuteInside(protectedThing, importName);
      }
    }
    const dir = dirname(protectedThing.file);
    const base = protectedThing.file.slice(dir === "." ? 0 : dir.length + 1);
    const synthetic = `${dir === "." ? "" : dir + "/"}coherence-refutation-${randomBytes(4).toString("hex")}.ts`;
    const text = `import { ${importName} } from "./${base}";\nexport const coherenceRefutation = ${importName};\n`;
    return this.probe(client, protectedThing, synthetic, text, { line: 1, character: text.split("\n")[1]!.indexOf(importName) });
  }

  /** A not-exported thing can only be referenced from its own module: the synthetic reference is the file with one line added at its end. */
  private async refuteInside(protectedThing: Definition, importName: string): Promise<Refutation> {
    const original = readFileSync(join(this.root, protectedThing.file), "utf8");
    const lines = original.split(/\r?\n/);
    const added = `const coherenceRefutation = ${importName};`;
    const text = original.endsWith("\n") ? `${original}${added}\n` : `${original}\n${added}\n`;
    const line = original.endsWith("\n") ? lines.length - 1 : lines.length;
    this.open(protectedThing.file);
    this.change(protectedThing.file, text);
    this.symbolCache.delete(protectedThing.file);
    try {
      const sites = await this.references(protectedThing);
      const hit = sites.find((s) => s.file === protectedThing.file && s.line === line + 1);
      return {
        seen: hit !== undefined,
        ...(hit === undefined ? {} : { site: hit }),
        account: hit !== undefined
          ? `an unsaved edit of ${protectedThing.file} adding a use of ${importName} at line ${line + 1} was reported as a reference`
          : `an unsaved edit of ${protectedThing.file} adding a use of ${importName} at line ${line + 1} was not reported; the check is vacuous`,
      };
    } finally {
      this.change(protectedThing.file, original);
      this.symbolCache.delete(protectedThing.file);
    }
  }

  private async probe(client: JsonRpcClient, protectedThing: Definition, synthetic: string, text: string, at: Position): Promise<Refutation> {
    client.notify("textDocument/didOpen", { textDocument: { uri: this.uri(synthetic), languageId: "typescript", version: 1, text } });
    this.lineCache.set(synthetic, text.split("\n"));
    this.symbolCache.set(synthetic, []);
    try {
      const sites = await this.references(protectedThing);
      const hit = sites.find((s) => s.file === synthetic && s.line === at.line + 1);
      return {
        seen: hit !== undefined,
        ...(hit === undefined ? {} : { site: hit }),
        account: hit !== undefined
          ? `an unsaved document ${synthetic} importing and using the protected thing was reported as a reference at line ${hit.line}`
          : `an unsaved document ${synthetic} importing and using the protected thing was not reported among ${sites.length} references; the check is vacuous`,
      };
    } finally {
      client.notify("textDocument/didClose", { textDocument: { uri: this.uri(synthetic) } });
      this.lineCache.delete(synthetic);
      this.symbolCache.delete(synthetic);
    }
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

interface Candidate {
  file: string;
  symbol: DocumentSymbol;
}

/** One candidate: the only one, else the only one under the component, else the only one outside test folders; ambiguity is reported, never guessed. */
function choose(candidates: Candidate[], hint: ResolveHint): Candidate | undefined {
  if (candidates.length === 1) return candidates[0];
  const nonTest = candidates.filter((c) => !isTestPath(c.file, hint.testFolders));
  if (nonTest.length === 1) return nonTest[0];
  const pool = nonTest.length > 0 ? nonTest : candidates;
  const prefix = hint.component === "." ? "" : hint.component + "/";
  const under = pool.filter((c) => c.file.startsWith(prefix));
  if (under.length === 1) return under[0];
  return undefined;
}
