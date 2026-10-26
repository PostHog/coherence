/**
 * The Go adapter: the language server protocol over stdio to gopls, found on
 * the machine (COHERENCE_GOPLS, else the PATH, else `go env GOPATH`/bin).
 *
 * Names resolve through workspace/symbol, kept to the project's own files
 * (gopls answers for the standard library too), or the hinted file's
 * document symbols (`Write in internal/store/store.go`). A module is one
 * file; a package folder resolves only when it holds one non-test file,
 * since a Definition names a single file. References come from
 * textDocument/references, which gopls answers from disk for the whole
 * module; a site in a `_test.go` file is test code by the manifest's
 * testFiles.
 *
 * Visibility is Go's one rule: an identifier whose first letter is not
 * upper case is unexported, and the compiler refuses a reference to it from
 * any other package. Such a thing is visibility-choked, and its refutation
 * is the compiler's refusal, read back from gopls's pulled diagnostics on an
 * unsaved file in a new package, with a control use from inside the
 * package that must not be refused. An exported thing is reference-choked,
 * and its refutation stages unsaved uses gopls must report: one in a new
 * file beside the protected thing, one appended to the chokepoint's own file
 * past the chokepoint, and, when the chokepoint governs only references from
 * outside a folder, one from a new package outside it. Nothing touches disk:
 * every staged document is an overlay, closed or restored when the
 * refutation ends.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { delimiter, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import {
  JsonRpcClient,
  hintedFiles,
  keepProjectFiles,
  outsideOfFolder,
  parseName,
  rangeContains,
  spawnSync,
  walkBounds,
  walkedProjectFiles,
  withinFolder,
  isTestPath,
  type Definition,
  type Ladder,
  type LanguageAdapter,
  type ServerSymbol,
  type Position,
  type Range,
  type ReferenceSite,
  type Refutation,
  type ResolveHint,
  type Resolved,
  type Rung,
  type ServerLocation,
  type StagedSite,
  type Visibility,
} from "../../src/plugins/api.ts";
import { exported, importPathOf, packageClause } from "./go-source.ts";
import manifest from "./plugin.json" with { type: "json" };

const LADDER: Ladder = manifest.ladder as Ladder;
const COMPILER = "the compiler (go build)";
const COHERENCE_ENFORCER = "Coherence's check at the edit and in CI";
/** Past this many files a forget with no files named stops telling gopls about each one. */
const WATCH_LIMIT = 5000;
/** Kinds that name a type rather than a value: class, interface, struct, type parameter. */
const TYPE_KINDS = new Set([5, 11, 23, 26]);

interface DocumentSymbol {
  name: string;
  kind: number;
  range: Range;
  selectionRange: Range;
  children?: DocumentSymbol[];
  /** Set where the server answered a flat SymbolInformation list naming the symbol's container: no top-level symbol. */
  nested?: true;
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

interface Diagnostic {
  message: string;
  range: Range;
  severity?: number;
  code?: number | string;
  source?: string;
}

interface Candidate {
  file: string;
  symbol: DocumentSymbol;
}

/** Where gopls is, with every place looked. */
export function locateGopls(root: string, env: NodeJS.ProcessEnv = process.env): ServerLocation {
  const looked: string[] = [];
  const explicit = env["COHERENCE_GOPLS"];
  if (explicit !== undefined && explicit !== "") {
    if (existsSync(explicit)) return { found: true, command: explicit, args: [], path: explicit, looked: [...looked, `COHERENCE_GOPLS (${explicit})`] };
    looked.push(`COHERENCE_GOPLS (${explicit}): no such file`);
  } else looked.push("COHERENCE_GOPLS: unset");
  for (const dir of (env["PATH"] ?? "").split(delimiter).filter((d) => d !== "")) {
    const candidate = join(dir, "gopls");
    if (existsSync(candidate)) return { found: true, command: candidate, args: [], path: candidate, looked: [...looked, `gopls on PATH (${candidate})`] };
  }
  looked.push("gopls on PATH: none");
  const gopath = spawnSync("go", ["env", "GOPATH"], { cwd: root, encoding: "utf8", timeout: 30_000 });
  const bin = gopath.status === 0 ? join(String(gopath.stdout).trim().split(delimiter)[0] ?? "", "bin", "gopls") : undefined;
  if (bin !== undefined && existsSync(bin)) return { found: true, command: bin, args: [], path: bin, looked: [...looked, `go env GOPATH (${bin})`] };
  looked.push(gopath.status === 0 ? `go env GOPATH: no gopls at ${bin}` : "go env GOPATH: no go on PATH");
  return { found: false, looked };
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

/** The line, zero-based, of a file's package clause. */
function packageLine(lines: readonly string[]): number {
  const at = lines.findIndex((l) => /^package\s+/.test(l));
  return at === -1 ? 0 : at;
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** One candidate: the only one, else the only one outside tests, else the only one under the component; ambiguity is reported, never guessed. */
function choose(candidates: Candidate[], hint: ResolveHint): Candidate | undefined {
  if (candidates.length === 1) return candidates[0];
  const nonTest = candidates.filter((c) => !isTestPath(c.file, hint.testFolders));
  if (nonTest.length === 1) return nonTest[0];
  const pool = nonTest.length > 0 ? nonTest : candidates;
  const prefix = hint.component === "." ? "" : hint.component + "/";
  const under = pool.filter((c) => c.file.startsWith(prefix));
  return under.length === 1 ? under[0] : undefined;
}

export class GoAdapter implements LanguageAdapter {
  readonly language = "go";
  readonly ladder: Ladder = LADDER;
  private readonly root: string;
  private client: JsonRpcClient | undefined;
  private starting: Promise<{ ok: true } | { ok: false; reason: string }> | undefined;
  private instrument = "gopls";
  /** Overlays open now, by file, with their version: only a refutation opens one, and it closes or restores each. */
  private readonly opened = new Map<string, number>();
  private readonly symbolCache = new Map<string, DocumentSymbol[]>();
  /** The unsaved documents a refutation has open: their sites are evidence though no file holds them. */
  private readonly probes = new Set<string>();
  private walked: string[] | undefined;

  constructor(root: string) {
    this.root = resolve(root);
  }

  serverPid(): number | undefined {
    return this.client?.pid;
  }

  ready(): Promise<{ ok: true } | { ok: false; reason: string }> {
    this.starting ??= this.start();
    return this.starting;
  }

  private async start(): Promise<{ ok: true } | { ok: false; reason: string }> {
    const located = locateGopls(this.root);
    if (!located.found) return { ok: false, reason: `gopls was not found (install it with \`go install golang.org/x/tools/gopls@latest\`, or set COHERENCE_GOPLS); looked at: ${located.looked.join("; ")}` };
    const version = spawnSync(located.command, ["version"], { cwd: this.root, encoding: "utf8", timeout: 30_000 });
    const said = String(version.stdout ?? "").trim().split("\n")[0]?.replace(/^golang\.org\/x\/tools\/gopls\s+/, "");
    this.instrument = said === undefined || said === "" ? `gopls (${located.path})` : `gopls ${said}`;
    const client = JsonRpcClient.spawn(located.command, located.args, this.root);
    this.client = client;
    try {
      await client.request("initialize", {
        processId: process.pid,
        rootUri: pathToFileURL(this.root).href,
        workspaceFolders: [{ uri: pathToFileURL(this.root).href, name: "project" }],
        capabilities: {
          textDocument: { documentSymbol: { hierarchicalDocumentSymbolSupport: true }, diagnostic: {}, publishDiagnostics: {} },
          workspace: { symbol: {}, workspaceFolders: true, didChangeWatchedFiles: { dynamicRegistration: false } },
        },
      });
      client.notify("initialized", {});
      return { ok: true };
    } catch (error) {
      client.kill();
      this.client = undefined;
      return { ok: false, reason: `${this.instrument} failed to start or initialize: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  private async live(): Promise<JsonRpcClient> {
    const state = await this.ready();
    if (!state.ok) throw new Error(state.reason);
    if (this.client === undefined || !this.client.alive) {
      this.starting = undefined;
      this.opened.clear();
      this.symbolCache.clear();
      const again = await this.ready();
      if (!again.ok) throw new Error(again.reason);
    }
    return this.client!;
  }

  /** The project's Go files, as the walk reads them, taken once per forget. */
  private files(): string[] {
    return (this.walked ??= walkedProjectFiles(walkBounds(this.root, [])).files.filter((f) => f.endsWith(".go")));
  }

  private uri(file: string): string {
    return pathToFileURL(join(this.root, file)).href;
  }

  private relative(uri: string): string {
    return relative(this.root, fileURLToPath(uri)).split(sep).join("/");
  }

  private lines(file: string): string[] {
    return readFileSync(join(this.root, file), "utf8").split("\n");
  }

  /** Open an overlay of a file with new text, returning what restores it: closed again, so gopls reads the disk. */
  private overlay(file: string, text: string): () => void {
    const client = this.client!;
    const version = this.opened.get(file);
    if (version === undefined) {
      client.notify("textDocument/didOpen", { textDocument: { uri: this.uri(file), languageId: "go", version: 1, text } });
      this.opened.set(file, 1);
    } else {
      client.notify("textDocument/didChange", { textDocument: { uri: this.uri(file), version: version + 1 }, contentChanges: [{ text }] });
      this.opened.set(file, version + 1);
    }
    this.symbolCache.delete(file);
    return () => {
      if (!this.opened.has(file)) return;
      client.notify("textDocument/didClose", { textDocument: { uri: this.uri(file) } });
      this.opened.delete(file);
      this.symbolCache.delete(file);
    };
  }

  /** The file's top-level symbols as the server reports them: the independent account plugin check and plugin calibrate hold the text readings to. */
  async topLevelSymbols(file: string): Promise<ServerSymbol[]> {
    return (await this.documentSymbols(file)).filter((s) => s.nested !== true).map((s) => ({ name: s.name, line: s.selectionRange.start.line + 1, kind: s.kind }));
  }

  private async documentSymbols(file: string): Promise<DocumentSymbol[]> {
    const cached = this.symbolCache.get(file);
    if (cached !== undefined) return cached;
    if (!this.probes.has(file) && !existsSync(join(this.root, file))) {
      this.symbolCache.set(file, []);
      return [];
    }
    const client = await this.live();
    const result = await client.request<DocumentSymbol[] | SymbolInformation[] | null>("textDocument/documentSymbol", { textDocument: { uri: this.uri(file) } });
    const symbols: DocumentSymbol[] = (result ?? []).map((s) => ("location" in s ? { name: s.name, kind: s.kind, range: s.location.range, selectionRange: s.location.range, ...(s.containerName ? { nested: true as const } : {}) } : s));
    this.symbolCache.set(file, symbols);
    return symbols;
  }

  /**
   * gopls reads files it has not opened from disk, but learns that one
   * changed only when the client says so: every named file (every Go file
   * of the project when none is named) is reported changed, created or
   * deleted, and the forget waits for one answer after the notification,
   * which gopls gives only once it has applied it.
   */
  async forget(files: readonly string[] = []): Promise<void> {
    this.walked = undefined;
    this.symbolCache.clear();
    if (this.client === undefined) return;
    const named = files.filter((f) => f.endsWith(".go"));
    const all = named.length > 0 ? named : this.files().slice(0, WATCH_LIMIT);
    if (all.length === 0) return;
    const changes = all.map((file) => ({ uri: this.uri(file), type: existsSync(join(this.root, file)) ? 2 : 3 }));
    this.client.notify("workspace/didChangeWatchedFiles", { changes });
    const present = all.find((f) => existsSync(join(this.root, f)));
    if (present !== undefined) await this.documentSymbols(present);
  }

  async resolve(name: string, hint: ResolveHint): Promise<Resolved> {
    const parsed = parseName(name);
    if (parsed.form === "prose") {
      const qualified = /^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(name.trim());
      const advice = qualified === null ? "" : ` (Go's ${name.trim()} is written \`${qualified[2]} in <file>.go\` here)`;
      return { ok: false, reason: `"${name}" is prose, not a symbol or a module; write the symbol, the symbol in its file (\`Name in file.go\`), or the file's path${advice}` };
    }
    if (parsed.form === "module") return this.resolveModule(name, parsed.path);
    const candidates = parsed.fileHint === undefined ? await this.searchWorkspace(parsed.name) : await this.searchFiles(parsed.name, parsed.fileHint);
    if (candidates.length === 0) {
      return { ok: false, reason: parsed.fileHint === undefined ? `${this.instrument} knows no package-level symbol named ${parsed.name} in the project` : `no package-level symbol named ${parsed.name} in a Go file ending with ${parsed.fileHint}` };
    }
    const chosen = choose(candidates, hint);
    if (chosen === undefined) {
      return { ok: false, reason: `${parsed.name} is declared in ${candidates.length} places; write \`${parsed.name} in <file>.go\``, candidates: candidates.map((c) => `${c.file}:${c.symbol.selectionRange.start.line + 1}`) };
    }
    return { ok: true, definition: { name, kind: "symbol", file: chosen.file, range: chosen.symbol.range, selection: chosen.symbol.selectionRange.start } };
  }

  /** A module is one Go file; a package folder is its one non-test file, since a definition names a single file. */
  private async resolveModule(name: string, path: string): Promise<Resolved> {
    const full = join(this.root, path);
    if (!existsSync(full)) return { ok: false, reason: `module ${path} is neither a file nor a folder under the project` };
    let file = path;
    if (statSync(full).isDirectory()) {
      const sources = readdirSync(full).filter((f) => f.endsWith(".go") && !f.endsWith("_test.go")).sort();
      if (sources.length !== 1) return { ok: false, reason: `package ${path} holds ${sources.length} non-test Go files (${sources.join(", ") || "none"}); a chokepoint or protected module names one file here, so write its path`, candidates: sources.map((f) => `${path.replace(/\/$/, "")}/${f}`) };
      file = `${path.replace(/\/$/, "")}/${sources[0]}`;
    }
    if (!file.endsWith(".go")) return { ok: false, reason: `module ${file} is not a Go file` };
    if (!keepProjectFiles(this.root, [file]).has(file)) return { ok: false, reason: `module ${file} is not one of the project's files (ignored, or inside a nested checkout)` };
    const lines = this.lines(file);
    const first = (await this.documentSymbols(file))[0];
    return {
      ok: true,
      definition: {
        name,
        kind: "module",
        file,
        range: { start: { line: 0, character: 0 }, end: { line: Math.max(0, lines.length - 1), character: (lines[lines.length - 1] ?? "").length } },
        selection: first?.selectionRange.start ?? { line: 0, character: 0 },
      },
    };
  }

  private async searchWorkspace(name: string): Promise<Candidate[]> {
    const client = await this.live();
    const found = await client.request<SymbolInformation[] | null>("workspace/symbol", { query: name });
    const files = new Set<string>();
    for (const info of found ?? []) {
      if (info.name !== name) continue;
      const file = this.relative(info.location.uri);
      if (!file.startsWith("..") && file.endsWith(".go")) files.add(file);
    }
    const own = keepProjectFiles(this.root, [...files]);
    const candidates: Candidate[] = [];
    for (const file of [...files].filter((f) => own.has(f)).sort()) candidates.push(...(await this.declarationsIn(file, name)));
    if (candidates.length > 0) return candidates;
    // gopls answers workspace/symbol from what it has loaded: the files whose text spells the name are asked too.
    const spelled = new RegExp(`(^|[^\\w])${escape(name)}([^\\w]|$)`);
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
    for (const file of hintedFiles(this.files(), fileHint)) candidates.push(...(await this.declarationsIn(file, name)));
    return candidates;
  }

  /** Package-level declarations named `name` in a file: a method or a field is not one. */
  private async declarationsIn(file: string, name: string): Promise<Candidate[]> {
    return (await this.documentSymbols(file)).filter((s) => s.name === name).map((symbol) => ({ file, symbol }));
  }

  async references(definition: Definition): Promise<ReferenceSite[]> {
    const client = await this.live();
    // A module's references are its package-level symbols' (the protocol has no reference to a file).
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
      // A _test.go file is test code by the manifest's testFiles, which the check reads by the file's name.
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

  /** The identifier a definition protects: the symbol at its selection, or a module's package-level symbols. */
  private async namesOf(definition: Definition): Promise<DocumentSymbol[]> {
    const symbols = await this.documentSymbols(definition.file);
    if (definition.kind === "module") return symbols;
    const at = symbols.find((s) => s.selectionRange.start.line === definition.selection.line && s.selectionRange.start.character === definition.selection.character);
    return at === undefined ? [] : [at];
  }

  async visibility(definition: Definition, _chokepoint?: Definition): Promise<Visibility> {
    const names = await this.namesOf(definition);
    if (names.length === 0) {
      const evidence = `${this.instrument} reports no symbol at ${definition.file}:${definition.selection.line + 1}, so its visibility is not read`;
      return { enforced: false, visible: true, evidence, rung: { grade: "reference-choked", enforcer: COHERENCE_ENFORCER, fact: `${evidence}; every resolved reference is inside the chokepoint` } };
    }
    const pkg = packageClause(readFileSync(join(this.root, definition.file), "utf8")) ?? "?";
    const open = names.filter((s) => exported(s.name)).map((s) => s.name);
    const evidence = definition.kind === "module"
      ? `module ${definition.file} in package ${pkg}: ${open.length === 0 ? "every package-level name is unexported" : `exports ${open.join(", ")}`}`
      : `${names[0]!.name} in package ${pkg} is ${open.length === 0 ? "unexported" : "exported"}`;
    const choked = open.length === 0;
    const rung: Rung = choked
      ? { grade: "visibility-choked", enforcer: COMPILER, fact: `the Go compiler refuses any reference from outside package ${pkg} (${evidence}), and every reference inside it is inside the chokepoint` }
      : { grade: "reference-choked", enforcer: COHERENCE_ENFORCER, fact: `reachable from any package that imports ${pkg} (${evidence}); every reference gopls reports in the module is inside the chokepoint` };
    return { enforced: true, visible: !choked, evidence, rung };
  }

  testFilter(via: string): string {
    return via;
  }

  /** The import path of a project file's package: the nearest go.mod's module path joined with the folder below it. */
  private importPath(file: string): string | undefined {
    const folder = dirname(file);
    return importPathOf(this.root, folder === "." ? "" : folder);
  }

  /** A use of the thing, as one package-level line: a type is used as one, a value is named. */
  private useOf(symbol: DocumentSymbol, qualified: string): string {
    return TYPE_KINDS.has(symbol.kind) ? `var _ *${qualified}` : `var _ = ${qualified}`;
  }

  /**
   * For an unexported thing, the compiler's refusal of a use from another
   * package is the refutation, with a control use from inside the package
   * that must not be refused, so a wrong name is never read as privacy. For
   * an exported one, unsaved uses gopls must report as references; the check
   * classifies each. Every overlay is closed when the refutation ends.
   */
  async refute(protectedThing: Definition, outsideOf: Definition | undefined, exempt?: string): Promise<Refutation> {
    await this.live();
    const names = await this.namesOf(protectedThing);
    const symbol = protectedThing.kind === "module" ? names.find((s) => exported(s.name)) ?? names[0] : names[0];
    if (symbol === undefined) return { seen: false, staged: [], account: `${this.instrument} reports no symbol at ${protectedThing.file}:${protectedThing.selection.line + 1}, so nothing can be staged to reference it` };
    const text = readFileSync(join(this.root, protectedThing.file), "utf8");
    const pkg = packageClause(text);
    const path = this.importPath(protectedThing.file);
    if (pkg === undefined) return { seen: false, staged: [], account: `${protectedThing.file} has no package clause` };
    if (!exported(symbol.name)) return this.refusedByCompiler(protectedThing, symbol, pkg, path);
    return this.stage(protectedThing, symbol, pkg, path, outsideOf, exempt);
  }

  /** Every diagnostic on a document, pulled: gopls answers once it has type-checked the overlay. */
  private async diagnostics(file: string): Promise<Diagnostic[]> {
    const result = await this.client!.request<{ items?: Diagnostic[] } | null>("textDocument/diagnostic", { textDocument: { uri: this.uri(file) } });
    return (result?.items ?? []).filter((d) => d.severity === undefined || d.severity === 1);
  }

  /** A new package beside the protected thing's folder (inside the same internal/ tree, which may import it). */
  private newPackageFolder(protectedFile: string, outside?: string): string {
    const hex = randomBytes(4).toString("hex");
    if (outside !== undefined) return `${outside}coherencerefutation${hex}`;
    const parent = dirname(dirname(protectedFile));
    return `${parent === "." ? "" : `${parent}/`}coherencerefutation${hex}`;
  }

  private async refusedByCompiler(protectedThing: Definition, symbol: DocumentSymbol, pkg: string, path: string | undefined): Promise<Refutation> {
    if (path === undefined) return { seen: false, staged: [], account: `no go.mod above ${protectedThing.file} names its module, so no other package can import ${pkg} to be refused` };
    const folder = this.newPackageFolder(protectedThing.file);
    const outside = `${folder}/probe.go`;
    const use = this.useOf(symbol, `coherencerefutation.${symbol.name}`);
    const besideDir = dirname(protectedThing.file);
    const control = `${besideDir === "." ? "" : `${besideDir}/`}coherence_refutation_${randomBytes(4).toString("hex")}.go`;
    const restores: (() => void)[] = [];
    try {
      this.probes.add(outside);
      this.probes.add(control);
      restores.push(this.overlay(outside, `package coherencerefutation${folder.slice(-8)}\n\nimport coherencerefutation "${path}"\n\n${use}\n`));
      restores.push(this.overlay(control, `package ${pkg}\n\n${this.useOf(symbol, symbol.name)}\n`));
      const refusal = (await this.diagnostics(outside)).find((d) => d.range.start.line === 4);
      const accepted = (await this.diagnostics(control)).find((d) => d.range.start.line === 2);
      if (refusal === undefined) return { seen: false, staged: [], account: `an unsaved package ${folder} using ${pkg}.${symbol.name} drew no error from ${this.instrument}, so nothing proves the compiler refuses it` };
      if (accepted !== undefined) return { seen: false, staged: [], account: `${this.instrument} refused ${symbol.name} inside package ${pkg} too (${accepted.message}), so the name is wrong rather than unexported, and nothing is proved` };
      const refused = `${this.instrument} refused ${pkg}.${symbol.name} from the unsaved package ${folder}: ${refusal.code ?? ""} ${refusal.message} (go build refuses it the same way), and accepted it inside package ${pkg}`;
      return { seen: true, staged: [], refused, account: `an unsaved package ${folder} using ${pkg}.${symbol.name} was refused: ${refused}` };
    } finally {
      for (const restore of restores.reverse()) restore();
      this.probes.delete(outside);
      this.probes.delete(control);
    }
  }

  private async stage(protectedThing: Definition, symbol: DocumentSymbol, pkg: string, path: string | undefined, chokepoint: Definition | undefined, exempt?: string): Promise<Refutation> {
    const expected: { what: string; file: string; line: number }[] = [];
    const restores: (() => void)[] = [];
    const staged = new Set<string>();
    try {
      // A new file beside the protected thing, in its own package: a use the chokepoint does not hold.
      const besideDir = dirname(protectedThing.file);
      const beside = `${besideDir === "." ? "" : `${besideDir}/`}coherence_refutation_${randomBytes(4).toString("hex")}.go`;
      if (exempt === undefined || !withinFolder(beside, exempt)) {
        this.probes.add(beside);
        staged.add(beside);
        restores.push(this.overlay(beside, `package ${pkg}\n\n${this.useOf(symbol, symbol.name)}\n`));
        expected.push({ what: `a use of ${symbol.name} from the unsaved file ${beside} in package ${pkg}`, file: beside, line: 3 });
      }
      // The chokepoint's own file, past the chokepoint: a use beside the one allowed site is still a bypass.
      const exempted = exempt !== undefined && chokepoint !== undefined && withinFolder(chokepoint.file, exempt);
      if (chokepoint !== undefined && chokepoint.kind === "symbol" && !exempted) {
        const lines = this.lines(chokepoint.file);
        const body = lines[lines.length - 1] === "" ? lines.slice(0, -1) : lines;
        const samePackage = dirname(chokepoint.file) === besideDir;
        if (samePackage || path !== undefined) {
          const at = packageLine(body);
          const imported = samePackage ? body : [...body.slice(0, at + 1), `import coherencerefutation "${path}"`, ...body.slice(at + 1)];
          const qualified = samePackage ? symbol.name : `coherencerefutation.${symbol.name}`;
          const text = [...imported, "", this.useOf(symbol, qualified), ""].join("\n");
          restores.push(this.overlay(chokepoint.file, text));
          expected.unshift({ what: `a use of ${symbol.name} in ${chokepoint.file} outside ${chokepoint.name}`, file: chokepoint.file, line: imported.length + 2 });
        }
      }
      // Where the chokepoint governs only references from outside a folder, a use from a new package outside it.
      if (exempt !== undefined) {
        const outside = outsideOfFolder(exempt);
        if (outside === undefined) return { seen: false, staged: [], account: `the chokepoint exempts the project root, so there is no outside to stage a use from` };
        if (path === undefined) return { seen: false, staged: [], account: `no go.mod above ${protectedThing.file} names its module, so no package outside ${exempt} can import ${pkg}` };
        const folder = this.newPackageFolder(protectedThing.file, outside);
        const probe = `${folder}/probe.go`;
        this.probes.add(probe);
        staged.add(probe);
        restores.push(this.overlay(probe, `package coherencerefutation\n\nimport coherencerefutation "${path}"\n\n${this.useOf(symbol, `coherencerefutation.${symbol.name}`)}\n`));
        expected.push({ what: `a use of ${symbol.name} from the unsaved package ${folder}, outside ${exempt}`, file: probe, line: 5 });
        // A package gopls has not loaded yet is loaded by type-checking it: its diagnostics are pulled before references are asked.
        await this.diagnostics(probe);
      }
      if (expected.length === 0) return { seen: false, staged: [], account: `nothing could be staged outside ${exempt ?? "the chokepoint"}` };
      const sites = await this.references(protectedThing);
      const found: StagedSite[] = expected.map((want) => {
        const hit = sites.find((s) => s.file === want.file && s.line === want.line);
        return { what: want.what, ...(hit === undefined ? {} : { site: hit }) };
      });
      const unseen = found.filter((s) => s.site === undefined);
      return {
        seen: unseen.length === 0,
        staged: found,
        account: unseen.length === 0 ? `${this.instrument} reported ${found.map((s) => s.what).join(" and ")}` : `${this.instrument} did not report ${unseen.map((s) => s.what).join(" or ")} among ${sites.length} references; the check is vacuous`,
      };
    } finally {
      for (const restore of restores.reverse()) restore();
      for (const file of staged) this.probes.delete(file);
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

