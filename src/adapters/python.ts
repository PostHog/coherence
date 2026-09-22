/**
 * The Python adapter: the language server protocol over stdio to Pyright
 * (`pyright-langserver`), found in the adopter's node_modules first, then
 * Coherence's own (it is an optional dependency), then on PATH.
 *
 * Pyright enumerates the whole workspace at start and says so in a log
 * message ("Found N source files"); every question waits for it, since an
 * answer before it is silently partial. The workspace is never narrowed: a
 * Python reference to anything can sit in any file, so a narrower root or
 * an include list can only prove the absence of a bypass inside the scope,
 * and Pyright ignores a settings-level include when the project carries a
 * pyrightconfig.json or a pyproject [tool.pyright] anyway. Enumerating
 * PostHog (19,693 files) costs about two seconds and 350 MB; a references
 * query about half a second warm. workspace/symbol is never used: it parses
 * every file (30 s and 3.5 GB on PostHog), so a bare name resolves by a text
 * scan for its definition, the component folder first, then
 * textDocument/documentSymbol on the candidate files.
 *
 * The ladder has four rungs, each a fact the adapter verifies, each naming
 * who enforces it:
 *
 *   closure-choked    the interpreter: the thing is never a module attribute
 *                     (defined inside the chokepoint function's body)
 *   checker-choked    a checker the project runs: the name is underscore-
 *                     prefixed and Pyright's reportPrivateUsage is an error,
 *                     or an import-linter rule names the protected module
 *   reference-choked  Coherence's check at the edit and in CI: no bypass among
 *                     resolved references; the top rung when neither holds
 *   convention        the underscore prefix or __all__ exclusion alone, which
 *                     nobody enforces: reported as evidence, and the rung a
 *                     chokepoint drops to when the refutation is vacuous
 *
 * Every site Pyright reports is a reference, and the adapter reports the
 * syntactic form it read at the site without exempting one: `from x import y`
 * and `import x` are imports, an import whose name the module's `__all__`
 * lists is a re-export, and so is a bare `from x import *`. Pyright reports
 * no site for a star import, since it spells no name, so the adapter scans
 * its own source files for one, once per forget. The refutation stages a
 * re-export through `__all__` beside the protected thing and a use in the
 * chokepoint's own module past its body; for a function-local, which no
 * import can reach, it opens the synthetic import instead and reads the
 * interpreter's refusal back from the published diagnostics.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import {
  isTestPath,
  parseName,
  rangeContains,
  statementStartLine,
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
  type SiteForm,
  type StagedSite,
  type Visibility,
} from "./adapter.ts";
import { JsonRpcClient } from "./jsonrpc.ts";
import { keepProjectFiles, nestedCheckouts, projectFiles } from "./project-files.ts";

/** The small JSON-RPC surface the adapter needs, exposed so a test can control server ordering. */
export interface PythonLanguageClient {
  onNotification: ((method: string, params: unknown) => void) | undefined;
  onRequest: ((method: string, params: unknown) => unknown | Promise<unknown>) | undefined;
  readonly alive: boolean;
  request<T>(method: string, params: unknown, timeoutMs?: number): Promise<T>;
  notify(method: string, params: unknown): void;
  kill(): void;
}

export type PythonClientFactory = (command: string, args: string[], cwd: string) => PythonLanguageClient;

const here = dirname(fileURLToPath(import.meta.url));
const COHERENCE_ROOT = resolve(here, "..", "..");
const SERVER_BIN = "pyright-langserver";
const SKIPPED_FOLDERS = new Set(["node_modules", ".git", "__pycache__", "site-packages", ".coherence", ".claude", ".codex", "dist", "build"]);
const ENUMERATION_TIMEOUT_MS = 10 * 60 * 1000;
const COHERENCE_ENFORCER = "Coherence's check at the edit and in CI";

export const PYTHON_LADDER: Ladder = {
  top: "reference-choked",
  because: "Python enforces no visibility: an underscore prefix and a module's __all__ list are conventions the interpreter does not enforce, so a module attribute can be imported from anywhere and only a name that never becomes a module attribute is refused",
  rungs: [
    { grade: "closure-choked", enforcer: "the interpreter", fact: "the protected thing is never a module attribute: defined inside the chokepoint function's body, so nothing outside can import or name it" },
    { grade: "checker-choked", enforcer: "a checker the project runs", fact: "the name is underscore-prefixed and the project's Pyright configuration makes reportPrivateUsage an error, or an import-linter rule names the protected module" },
    { grade: "reference-choked", enforcer: COHERENCE_ENFORCER, fact: "no bypass among resolved references; the top rung when neither the interpreter nor a checker refuses one" },
    { grade: "convention", enforcer: "nobody", fact: "an underscore prefix or __all__ exclusion alone" },
  ],
  whenVacuous: "convention",
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

/** Protocol symbol kinds this adapter tells apart. */
const KIND_METHOD = 6;
const KIND_CLASS = 5;
const KIND_FUNCTION = 12;

interface Flat {
  path: string[];
  symbol: DocumentSymbol;
  /** The kinds of the enclosing symbols, outermost first. */
  parents: number[];
  /** The innermost enclosing symbol. */
  parent: DocumentSymbol | undefined;
}

function flatten(symbols: DocumentSymbol[], prefix: string[] = [], parents: number[] = [], parent?: DocumentSymbol): Flat[] {
  const out: Flat[] = [];
  for (const symbol of symbols) {
    const path = [...prefix, symbol.name];
    out.push({ path, symbol, parents, parent });
    if (symbol.children !== undefined) out.push(...flatten(symbol.children, path, [...parents, symbol.kind], symbol));
  }
  return out;
}

/** Pyright lists a function's parameters as child variables on the def's signature lines; a spec never names one. */
function isParameter(entry: Flat, lines: readonly string[]): boolean {
  const parent = entry.parent;
  if (parent === undefined || (parent.kind !== KIND_FUNCTION && parent.kind !== KIND_METHOD)) return false;
  let headerEnd = parent.range.start.line;
  while (headerEnd < parent.range.end.line && !/:\s*(#.*)?$/.test(lines[headerEnd] ?? "")) headerEnd++;
  return entry.symbol.range.start.line <= headerEnd;
}

/**
 * The line indexes that belong to an import statement: its first line and,
 * while a bracket it opened stays open or a line ends with a backslash, the
 * lines that continue it. Used to find where a re-exported name enters a
 * package's __init__, never to exempt a site: every site Pyright reports is
 * a reference.
 */
function importStatementLines(lines: readonly string[]): Set<number> {
  const found = new Set<number>();
  let open = 0;
  let chained = false;
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]!;
    const starts = open === 0 && !chained && /^\s*(from\s+\S+\s+import\b|import\s)/.test(text);
    if (!starts && open === 0 && !chained) continue;
    found.add(i);
    open += (text.match(/[([]/g) ?? []).length - (text.match(/[)\]]/g) ?? []).length;
    if (open < 0) open = 0;
    chained = /\\\s*$/.test(text);
  }
  return found;
}

/** A bare star import: `from pkg.store import *`, which re-exports whatever the module holds. */
const STAR_IMPORT = /^from\s+(\.*)([A-Za-z0-9_.]*)\s+import\s+\*/;

/**
 * Whether a Pyright diagnostic is the interpreter's own refusal: the name is
 * not a module attribute, so no import can reach it. That refusal is the
 * refutation for the rung the interpreter enforces (ruling rs-e93ecdd6).
 */
export function refusesImport(diagnostic: { message: string; severity?: number }): boolean {
  if (diagnostic.severity !== undefined && diagnostic.severity !== 1) return false;
  return /unknown import symbol|is not a known attribute of module|could not be resolved|is unknown/.test(diagnostic.message);
}

/** The identifier the character sits in, or undefined. */
export function identifierAt(line: string, character: number): string | undefined {
  if (!/[A-Za-z0-9_]/.test(line[character] ?? "")) return undefined;
  let start = character;
  while (start > 0 && /[A-Za-z0-9_]/.test(line[start - 1] ?? "")) start--;
  let end = character;
  while (end < line.length && /[A-Za-z0-9_]/.test(line[end] ?? "")) end++;
  return line.slice(start, end);
}

/**
 * The syntactic form of a Python reference site, read forward from the
 * top-level statement it sits in (ruling d-7abd1ba8). `from x import y` and
 * `import x` are imports; a bare `from x import *` is a re-export, and so is
 * an import whose name the module's `__all__` lists, because `__all__` is how
 * a Python module hands a name it imported on to everyone else.
 */
export function pythonSiteForm(lines: readonly string[], line: number, character: number, exported: readonly string[] | undefined): SiteForm | undefined {
  const head = lines[statementStartLine(lines, line)] ?? "";
  if (STAR_IMPORT.test(head)) return "re-export";
  if (!/^(from\s+[A-Za-z0-9_.]+\s+import\b|import\s)/.test(head)) return undefined;
  const name = identifierAt(lines[line] ?? "", character);
  return name !== undefined && (exported ?? []).includes(name) ? "re-export" : "import";
}

/** The module path a dotted name points at, project-relative and without an extension; a relative name resolves against `from`. */
export function resolveDotted(from: string, dots: string, dotted: string): string | undefined {
  let base: string[] = [];
  if (dots !== "") {
    base = dirname(from).split("/").filter((segment) => segment !== ".");
    for (let i = 1; i < dots.length; i++) base.pop();
  }
  const parts = [...base, ...dotted.split(".").filter((segment) => segment !== "")];
  return parts.length === 0 ? undefined : parts.join("/");
}

/** Whether a folder is a virtual environment (never source). */
function isVenv(dir: string): boolean {
  return existsSync(join(dir, "pyvenv.cfg"));
}

/**
 * The exclude list Pyright's workspace gets so it never indexes a nested
 * checkout, or nothing when the root holds none. A list given replaces
 * Pyright's defaults and turns off its own virtual-environment exclusion, so
 * the defaults and every virtual environment outside the nested checkouts are
 * named again. A pyrightconfig.json or [tool.pyright] section outranks
 * workspace settings; there the reference results' own filter is what keeps
 * a nested checkout out of the evidence.
 */
export function workspaceExclusions(root: string): string[] | undefined {
  const nested = nestedCheckouts(root);
  if (nested.length === 0) return undefined;
  const venvs: string[] = [];
  const walk = (folder: string): void => {
    let entries;
    try {
      entries = readdirSync(join(root, folder), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || SKIPPED_FOLDERS.has(entry.name)) continue;
      const rel = folder === "" ? entry.name : `${folder}/${entry.name}`;
      if (nested.includes(rel)) continue;
      if (isVenv(join(root, rel))) venvs.push(rel);
      else walk(rel);
    }
  };
  walk("");
  return ["**/node_modules", "**/__pycache__", "**/.*", ...venvs, ...nested];
}

/** Every Python file of the project under `start` (project-relative paths), skipping venvs, caches, and dot folders. */
export function pythonFiles(root: string, start = "."): string[] {
  const prefix = start === "." ? "" : start.replace(/^\.\//, "").replace(/\/+$/, "") + "/";
  const venv = new Map<string, boolean>();
  const inVenv = (rel: string): boolean => {
    const parts = rel.split("/");
    for (let i = 1; i < parts.length; i++) {
      const folder = parts.slice(0, i).join("/");
      let answer = venv.get(folder);
      if (answer === undefined) venv.set(folder, (answer = isVenv(join(root, folder))));
      if (answer) return true;
    }
    return false;
  };
  return projectFiles(root).filter(
    (rel) => rel.endsWith(".py") && rel.startsWith(prefix) && rel.split("/").every((part) => !part.startsWith(".") && !SKIPPED_FOLDERS.has(part)) && !inVenv(rel),
  );
}

/** Every Python file whose project-relative path is the hint or ends with `/<hint>`. */
export function filesEndingWith(root: string, hint: string): string[] {
  const suffix = hint.replace(/^\.\//, "");
  return pythonFiles(root).filter((rel) => rel === suffix || rel.endsWith("/" + suffix));
}

/** Whether a file's text can declare `name`: a def, a class, an assignment, or an attribute assignment. */
function declares(text: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\n)\\s*(async\\s+)?(def|class)\\s+${escaped}\\b|(^|\\n)\\s*${escaped}\\s*(:|=(?!=))|\\bself\\.${escaped}\\s*(:|=(?!=))`).test(text);
}

/* ---------------------------------------------------- the project's checkers */

/** What the project's own configuration says about the checkers a chokepoint could lean on. */
export interface CheckerFacts {
  /** Where Pyright's rule was read from, when a configuration exists. */
  pyrightConfig: string | undefined;
  /** Whether reportPrivateUsage is an error there (explicitly, or through strict mode). */
  privateUsageIsError: boolean;
  /** Where a mypy configuration was found; mypy has no private-usage rule. */
  mypyConfig: string | undefined;
  /** Where an import-linter configuration was found. */
  importLinterConfig: string | undefined;
  /** The import-linter rule blocks: name and raw text. */
  importRules: { name: string; text: string }[];
}

/** A TOML table's lines up to the next table that is not one of its sub-tables. */
function sectionOf(toml: string, header: string): string | undefined {
  const lines = toml.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === `[${header}]`);
  if (start === -1) return undefined;
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (trimmed.startsWith("[") && !trimmed.startsWith(`[${header}.`) && !trimmed.startsWith(`[[${header}.`)) break;
    out.push(line);
  }
  return out.join("\n");
}

/** Whether a TOML or JSON body sets a diagnostic rule to error (a rule set to true is an error in Pyright). */
function ruleIsError(body: string, rule: string): boolean {
  const value = new RegExp(`"?${rule}"?\\s*[:=]\\s*("?)(error|true)\\1`).exec(body);
  return value !== null;
}

export function readCheckerFacts(root: string): CheckerFacts {
  const facts: CheckerFacts = { pyrightConfig: undefined, privateUsageIsError: false, mypyConfig: undefined, importLinterConfig: undefined, importRules: [] };
  const pyproject = join(root, "pyproject.toml");
  const toml = existsSync(pyproject) ? readFileSync(pyproject, "utf8") : "";
  const pyrightJson = join(root, "pyrightconfig.json");
  if (existsSync(pyrightJson)) {
    const body = readFileSync(pyrightJson, "utf8");
    facts.pyrightConfig = "pyrightconfig.json";
    facts.privateUsageIsError = ruleIsError(body, "reportPrivateUsage") || /"typeCheckingMode"\s*:\s*"strict"/.test(body);
  } else if (toml !== "") {
    const section = sectionOf(toml, "tool.pyright");
    if (section !== undefined) {
      facts.pyrightConfig = "pyproject.toml [tool.pyright]";
      facts.privateUsageIsError = ruleIsError(section, "reportPrivateUsage") || /typeCheckingMode\s*=\s*"strict"/.test(section);
    }
  }
  for (const [file, marker] of [["mypy.ini", ""], [".mypy.ini", ""], ["setup.cfg", "[mypy]"]] as const) {
    const path = join(root, file);
    if (existsSync(path) && (marker === "" || readFileSync(path, "utf8").includes(marker))) facts.mypyConfig = file;
  }
  if (facts.mypyConfig === undefined && /^\s*\[tool\.mypy\]/m.test(toml)) facts.mypyConfig = "pyproject.toml [tool.mypy]";
  const importLinter = join(root, ".importlinter");
  if (existsSync(importLinter)) {
    facts.importLinterConfig = ".importlinter";
    const body = readFileSync(importLinter, "utf8");
    for (const block of body.split(/^\[importlinter:[a-z]+:/m).slice(1)) {
      const name = /^\s*name\s*=\s*(.+)$/m.exec(block)?.[1]?.trim() ?? block.split("]")[0]!.trim();
      facts.importRules.push({ name, text: block });
    }
  } else if (/^\s*\[tool\.importlinter\]/m.test(toml)) {
    facts.importLinterConfig = "pyproject.toml [tool.importlinter]";
    for (const block of toml.split(/^\s*\[\[tool\.importlinter\.[a-z]+\]\]\s*$/m).slice(1)) {
      const end = block.search(/^\s*\[(?!\[tool\.importlinter\.[a-z]+)/m);
      const text = end === -1 ? block : block.slice(0, end);
      const name = /^\s*name\s*=\s*"([^"]*)"/m.exec(text)?.[1] ?? "(unnamed)";
      facts.importRules.push({ name, text });
    }
  }
  return facts;
}

/** Whether an import-linter module pattern (`a.b`, `a.*.c`, `a.**`) covers a dotted module or one of its parents. */
export function ruleCovers(pattern: string, dottedModule: string): boolean {
  const regex = new RegExp("^" + pattern.split(".").map((seg) => (seg === "**" ? ".+" : seg === "*" ? "[^.]+" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("\\.") + "$");
  const parts = dottedModule.split(".");
  for (let n = parts.length; n >= 1; n--) if (regex.test(parts.slice(0, n).join("."))) return true;
  return false;
}

/** The importRules whose module lists name the module (or a package above it). */
export function rulesNaming(facts: CheckerFacts, dottedModule: string): string[] {
  const names: string[] = [];
  for (const rule of facts.importRules) {
    const patterns = [...rule.text.matchAll(/"([A-Za-z_][A-Za-z0-9_.*]*)"|^\s*([A-Za-z_][A-Za-z0-9_.*]*)\s*$/gm)].map((m) => m[1] ?? m[2]!).filter((p) => p.includes("."));
    if (patterns.some((p) => ruleCovers(p, dottedModule))) names.push(rule.name);
  }
  return names;
}

/* ---------------------------------------------------------------- adapter */

export class PythonAdapter implements LanguageAdapter {
  readonly language = "python";
  readonly ladder = PYTHON_LADDER;
  readonly root: string;
  private client: PythonLanguageClient | undefined;
  private readonly clientFactory: PythonClientFactory;
  private starting: Promise<{ ok: true } | { ok: false; reason: string }> | undefined;
  /** Resolves with the source file count when Pyright reports its enumeration done. */
  private enumerated: Promise<number> | undefined;
  /** What the last enumeration reported, for the server's log and the measurement. */
  enumeration: { sourceFiles: number; latency: number } | undefined;
  private readonly opened = new Set<string>();
  private readonly symbolCache = new Map<string, DocumentSymbol[]>();
  private readonly lineCache = new Map<string, string[]>();
  /** The document version last sent per open file; a change carries the next one. */
  private readonly versions = new Map<string, number>();
  private readonly touched = new Set<string>();
  /** The unsaved documents a refutation has open right now: the adapter's own probe, never a file, and the one site outside the project's files it accepts. */
  private readonly probes = new Set<string>();
  private checkerFacts: CheckerFacts | undefined;
  /** Star-import sites by the module path they re-export; Pyright reports no site for a name the statement never spells. Scanned once per forget. */
  private wildcards: Map<string, ReferenceSite[]> | undefined;
  /** The last diagnostics Pyright published, by project-relative file. */
  private readonly diagnostics = new Map<string, { message: string; severity?: number }[]>();
  /** When the workspace was last reported to Pyright as possibly changed. */
  private lastForget = Date.now();

  constructor(root: string, clientFactory: PythonClientFactory = JsonRpcClient.spawn) {
    this.root = resolve(root);
    this.clientFactory = clientFactory;
  }

  ready(): Promise<{ ok: true } | { ok: false; reason: string }> {
    this.starting ??= this.start();
    return this.starting;
  }

  private async start(): Promise<{ ok: true } | { ok: false; reason: string }> {
    const server = locateServer(this.root);
    if (server === undefined) {
      return { ok: false, reason: `${SERVER_BIN} not found; looked in the project's node_modules, Coherence's, and PATH. Install it: npm install --save-dev pyright (or pip install pyright)` };
    }
    const client = this.clientFactory(server.path, ["--stdio"], this.root);
    this.client = client;
    const started = Date.now();
    let found: (count: number) => void = () => {};
    this.enumerated = new Promise<number>((r) => (found = r));
    client.onNotification = (method, params) => {
      if (method === "textDocument/publishDiagnostics") {
        const published = params as { uri?: string; diagnostics?: { message: string; severity?: number }[] };
        if (published.uri !== undefined) this.diagnostics.set(this.relative(published.uri), published.diagnostics ?? []);
        return;
      }
      if (method !== "window/logMessage") return;
      const message = (params as { message?: string }).message ?? "";
      const match = /Found (\d+) source files?/.exec(message);
      if (match !== null) {
        this.enumeration = { sourceFiles: Number(match[1]), latency: Date.now() - started };
        found(Number(match[1]));
      }
    };
    const exclude = workspaceExclusions(this.root);
    client.onRequest = (method, params) => {
      if (method !== "workspace/configuration") return null;
      const items = (params as { items?: { section?: string }[] }).items ?? [];
      // Diagnostics for open files only: the check asks for references and symbols, never for a workspace-wide type check.
      return items.map((item) => (item.section === "python" ? { analysis: { diagnosticMode: "openFilesOnly", ...(exclude === undefined ? {} : { exclude }) } } : null));
    };
    try {
      await client.request("initialize", {
        processId: process.pid,
        rootUri: pathToFileURL(this.root).href,
        workspaceFolders: [{ uri: pathToFileURL(this.root).href, name: "project" }],
        capabilities: {
          textDocument: { documentSymbol: { hierarchicalDocumentSymbolSupport: true }, publishDiagnostics: {} },
          workspace: { workspaceFolders: true, configuration: true },
        },
        initializationOptions: {},
      });
      client.notify("initialized", {});
      return { ok: true };
    } catch (error) {
      client.kill();
      this.client = undefined;
      return { ok: false, reason: `${SERVER_BIN} at ${server.path} failed to initialize: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  private async live(): Promise<PythonLanguageClient> {
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

  /** The live client once Pyright has enumerated the workspace; an answer before that is silently partial. */
  private async indexed(): Promise<PythonLanguageClient> {
    const client = await this.live();
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${SERVER_BIN} did not finish enumerating the workspace in ${ENUMERATION_TIMEOUT_MS / 60000} minutes`)), ENUMERATION_TIMEOUT_MS).unref());
    await Promise.race([this.enumerated!, timeout]);
    return client;
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

  private linesOf(file: string): string[] {
    try {
      return this.lines(file);
    } catch {
      return [];
    }
  }

  private open(file: string, text?: string): void {
    if (this.opened.has(file)) return;
    const content = text ?? readFileSync(join(this.root, file), "utf8");
    this.client!.notify("textDocument/didOpen", { textDocument: { uri: this.uri(file), languageId: "python", version: 1, text: content } });
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
    const symbols: DocumentSymbol[] = (result ?? []).map((s) => ("location" in s ? { name: s.name, kind: s.kind, range: s.location.range, selectionRange: s.location.range } : s));
    this.symbolCache.set(file, symbols);
    return symbols;
  }

  /**
   * Cached facts about files are dropped when their text may have changed (the
   * edit hook re-runs a check), and Pyright is made to see the current disk
   * text before any question is asked. Every open document and every file the
   * caller names gets its whole current text (didChange for an open document,
   * didOpen for one not yet open, and it stays open), and the forget waits for
   * a documentSymbol answer per file, which Pyright cannot give before the
   * change is applied. Pyright also keeps the text of every file it has
   * scanned without opening, until told the file changed, and this client
   * registers no watcher, so every file a site landed in and every Python file
   * whose modification time moved since the last forget is reported as
   * changed: Pyright may have scanned a file this adapter never touched.
   */
  async forget(files: readonly string[] = []): Promise<void> {
    this.symbolCache.clear();
    this.lineCache.clear();
    this.checkerFacts = undefined;
    this.wildcards = undefined;
    this.diagnostics.clear();
    const since = this.lastForget - 1000;
    this.lastForget = Date.now();
    if (this.client === undefined) return;
    // A named file that is not the project's (a nested checkout's copy, an ignored file) is never opened.
    const named = keepProjectFiles(this.root, files);
    const sync = new Set([...files.filter((f) => named.has(f)), ...this.opened]);
    const report = new Set(this.touched);
    this.touched.clear();
    for (const file of pythonFiles(this.root)) {
      try {
        if (statSync(join(this.root, file)).mtimeMs >= since) report.add(file);
      } catch {
        // Gone between the walk and the stat: reported below as deleted if it was known.
      }
    }
    const synced: string[] = [];
    for (const file of sync) {
      const path = join(this.root, file);
      if (!existsSync(path) || !statSync(path).isFile()) {
        this.closeDocument(file);
        report.add(file);
        continue;
      }
      const text = readFileSync(path, "utf8");
      if (this.opened.has(file)) this.change(file, text);
      else this.open(file, text);
      synced.push(file);
    }
    const changes = [...report].filter((file) => !sync.has(file)).map((file) => ({ uri: this.uri(file), type: existsSync(join(this.root, file)) ? 2 : 3 }));
    if (changes.length > 0) this.client.notify("workspace/didChangeWatchedFiles", { changes });
    // The acknowledgment: one answer per changed document, each ordered after its change.
    for (const file of synced) await this.documentSymbols(file);
  }

  async resolve(name: string, hint: ResolveHint): Promise<Resolved> {
    const parsed = parseName(name);
    if (parsed.form === "prose") {
      return { ok: false, reason: `"${name}" is prose, not a symbol or a module; write the symbol (\`replace_value\`), the symbol in its file (\`_read_blob in storage.py\`), the module path (\`posthog/query_cache/storage.py\`), or the package folder (\`posthog/query_cache/\`)` };
    }
    if (parsed.form === "module") {
      const file = this.moduleFile(parsed.path);
      if (file === undefined) return { ok: false, reason: `module ${parsed.path} is not a Python file or a package folder under the project` };
      const lines = this.lines(file);
      const first = (await this.moduleMembers(file))[0];
      return {
        ok: true,
        definition: {
          name,
          kind: "module",
          file,
          range: { start: { line: 0, character: 0 }, end: { line: Math.max(0, lines.length - 1), character: (lines[lines.length - 1] ?? "").length } },
          selection: first?.position ?? { line: 0, character: 0 },
        },
      };
    }
    await this.indexed();
    const candidates = parsed.fileHint === undefined ? await this.searchByText(parsed.name, hint) : await this.searchFiles(parsed.name, parsed.fileHint);
    if (candidates.length === 0) {
      return { ok: false, reason: parsed.fileHint === undefined ? `no symbol named ${parsed.name} in the project` : `no symbol named ${parsed.name} in a file ending with ${parsed.fileHint}` };
    }
    const chosen = choose(candidates, hint);
    if (chosen === undefined) {
      const where = candidates.map((c) => `${c.file}:${c.symbol.selectionRange.start.line + 1} (${c.path.join(".")})`);
      return { ok: false, reason: `${parsed.name} is declared in ${candidates.length} places; write \`${parsed.name} in <file>\``, candidates: where };
    }
    return { ok: true, definition: { name, kind: "symbol", file: chosen.file, range: chosen.symbol.range, selection: chosen.symbol.selectionRange.start } };
  }

  /** A module path is a file, or a package folder whose module is its __init__.py. */
  private moduleFile(path: string): string | undefined {
    const full = join(this.root, path);
    const file = existsSync(full) && statSync(full).isFile()
      ? path
      : existsSync(full) && statSync(full).isDirectory() && existsSync(join(full, "__init__.py")) ? `${path.replace(/\/+$/, "")}/__init__.py` : undefined;
    // A module in a nested checkout or an ignored file is not the project's, whatever the spec names.
    return file !== undefined && keepProjectFiles(this.root, [file]).has(file) ? file : undefined;
  }

  /** A bare name: files whose text can declare it, the component's first (a unique non-test hit there settles it), then the whole tree. */
  private async searchByText(name: string, hint: ResolveHint): Promise<Candidate[]> {
    const under = hint.component === "." ? undefined : hint.component;
    const inComponent = under === undefined ? [] : await this.candidatesIn(pythonFiles(this.root, under), name);
    const nonTest = inComponent.filter((c) => !isTestPath(c.file, hint.testFolders));
    if (nonTest.length === 1 && inComponent.length === 1) return inComponent;
    const prefix = under === undefined ? undefined : under + "/";
    const elsewhere = pythonFiles(this.root).filter((f) => prefix === undefined || !f.startsWith(prefix));
    return [...inComponent, ...(await this.candidatesIn(elsewhere, name))];
  }

  private async candidatesIn(files: readonly string[], name: string): Promise<Candidate[]> {
    const out: Candidate[] = [];
    for (const file of files) {
      let text: string;
      try {
        text = readFileSync(join(this.root, file), "utf8");
      } catch {
        continue;
      }
      if (!declares(text, name)) continue;
      out.push(...(await this.declarationsIn(file, name)));
    }
    return out;
  }

  private async searchFiles(name: string, fileHint: string): Promise<Candidate[]> {
    const candidates: Candidate[] = [];
    for (const file of filesEndingWith(this.root, fileHint)) candidates.push(...(await this.declarationsIn(file, name)));
    return candidates;
  }

  /** Declarations named `name` in a file: module members first; a class member or a function-local counts when no module member has the name. */
  private async declarationsIn(file: string, name: string): Promise<Candidate[]> {
    const lines = this.linesOf(file);
    const flat = flatten(await this.documentSymbols(file)).filter((f) => f.symbol.name === name && !isParameter(f, lines));
    const top = flat.filter((f) => f.path.length === 1);
    const pool = top.length > 0 ? top : flat;
    return pool.map((f) => ({ file, symbol: f.symbol, path: f.path, parents: f.parents }));
  }

  async references(definition: Definition): Promise<ReferenceSite[]> {
    const client = await this.indexed();
    this.open(definition.file);
    this.touched.add(definition.file);
    const starts: Position[] = [];
    if (definition.kind === "module") {
      for (const member of await this.moduleMembers(definition.file)) starts.push(member.position);
    } else {
      starts.push(definition.selection);
    }
    const reported: Location[] = [];
    for (const position of starts) {
      const locations = await client.request<Location[] | null>("textDocument/references", {
        textDocument: { uri: this.uri(definition.file) },
        position,
        context: { includeDeclaration: false },
      }, ENUMERATION_TIMEOUT_MS);
      reported.push(...(locations ?? []));
    }
    // Only the project's own files are evidence, and a site outside them is dropped before it is read or opened.
    const own = keepProjectFiles(this.root, reported.map((location) => this.relative(location.uri)));
    const seen = new Set<string>();
    const sites: ReferenceSite[] = [];
    for (const location of reported) {
      const file = this.relative(location.uri);
      if (!(own.has(file) || this.probes.has(file)) || file.startsWith("node_modules/") || file.includes("/site-packages/")) continue;
      const start = location.range.start;
      if (file === definition.file && rangeContains({ start: definition.selection, end: definition.selection }, start)) continue;
      const key = `${file}:${start.line}:${start.character}`;
      if (seen.has(key)) continue;
      seen.add(key);
      this.touched.add(file);
      const form = pythonSiteForm(this.linesOf(file), start.line, start.character, this.exportList(file));
      sites.push({ file, line: start.line + 1, character: start.character, symbol: await this.enclosingSymbol(file, start), ...(form === undefined ? {} : { form }) });
    }
    // A bare star import spells no name, so Pyright reports no site for it; it still hands the module's names on.
    for (const site of this.starImports(definition.file)) {
      const key = `${site.file}:${site.line - 1}:${site.character}`;
      if (seen.has(key)) continue;
      seen.add(key);
      this.touched.add(site.file);
      sites.push(site);
    }
    sites.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.character - b.character);
    return sites;
  }

  /** The sites where another module star-imports this file, scanned once per forget because Pyright reports none of them. */
  private starImports(file: string): ReferenceSite[] {
    if (this.wildcards === undefined) {
      const found = new Map<string, ReferenceSite[]>();
      for (const source of pythonFiles(this.root)) {
        let lines: string[];
        try {
          lines = readFileSync(join(this.root, source), "utf8").split(/\r?\n/);
        } catch {
          continue;
        }
        for (let i = 0; i < lines.length; i++) {
          const match = STAR_IMPORT.exec(lines[i] ?? "");
          if (match === null) continue;
          const target = resolveDotted(source, match[1]!, match[2]!);
          if (target === undefined) continue;
          for (const candidate of [`${target}.py`, `${target}/__init__.py`]) {
            const list = found.get(candidate) ?? [];
            list.push({ file: source, line: i + 1, character: (lines[i] ?? "").lastIndexOf("*"), symbol: undefined, form: "re-export" });
            found.set(candidate, list);
          }
        }
      }
      this.wildcards = found;
    }
    return this.wildcards.get(file) ?? [];
  }

  private async enclosingSymbol(file: string, position: Position): Promise<string | undefined> {
    let symbols: DocumentSymbol[];
    try {
      symbols = await this.documentSymbols(file);
    } catch {
      return undefined;
    }
    let best: Flat | undefined;
    for (const entry of flatten(symbols)) {
      if (!rangeContains(entry.symbol.range, position)) continue;
      if (best === undefined || entry.path.length > best.path.length) best = entry;
    }
    return best?.path.join(".");
  }

  /** The flattened entry at a definition's selection, which the spec may have named with a file hint. */
  private async entryAt(definition: Definition): Promise<Flat | undefined> {
    const flat = flatten(await this.documentSymbols(definition.file));
    return flat.find((f) => f.symbol.selectionRange.start.line === definition.selection.line && f.symbol.selectionRange.start.character === definition.selection.character);
  }

  private facts(): CheckerFacts {
    this.checkerFacts ??= readCheckerFacts(this.root);
    return this.checkerFacts;
  }

  /** The dotted module name of a file, as an import spells it: `posthog/query_cache/storage.py` -> `posthog.query_cache.storage`. */
  dottedModule(file: string): string {
    const parts = file.replace(/\.py$/, "").split("/");
    if (parts[parts.length - 1] === "__init__") parts.pop();
    return parts.join(".");
  }

  /** The `__all__` list of a module, when it declares one on a single or wrapped assignment. */
  exportList(file: string): string[] | undefined {
    const text = this.linesOf(file).join("\n");
    const match = /^__all__\s*(?::\s*[^=]+)?=\s*[\[(]([\s\S]*?)[\])]/m.exec(text);
    if (match === null) return undefined;
    return [...match[1]!.matchAll(/["']([^"']+)["']/g)].map((m) => m[1]!);
  }

  /**
   * A module's members, where a references query starts: every declared
   * symbol but the dunders, plus each `__all__` name that is only imported
   * (a package's __init__.py re-exports through its import lines, which
   * Pyright's documentSymbol does not list).
   */
  private async moduleMembers(file: string): Promise<{ name: string; position: Position }[]> {
    const members = (await this.documentSymbols(file)).filter((s) => !s.name.startsWith("__")).map((s) => ({ name: s.name, position: s.selectionRange.start }));
    const declared = new Set(members.map((m) => m.name));
    const lines = this.linesOf(file);
    const importLines = importStatementLines(lines);
    for (const name of this.exportList(file) ?? []) {
      if (declared.has(name)) continue;
      for (let i = 0; i < lines.length; i++) {
        if (!importLines.has(i)) continue;
        const at = new RegExp(`(?:^|[\\s,(])(?:\\S+\\s+as\\s+)?(${name})(?=[\\s,)]|$)`).exec(lines[i]!);
        if (at === null) continue;
        members.push({ name, position: { line: i, character: at.index + at[0].length - name.length } });
        break;
      }
    }
    return members;
  }

  async visibility(definition: Definition, chokepoint?: Definition): Promise<Visibility> {
    const facts = this.facts();
    const checkerNote = facts.pyrightConfig !== undefined
      ? `reportPrivateUsage is ${facts.privateUsageIsError ? "an error" : "not an error"} in ${facts.pyrightConfig}`
      : facts.mypyConfig !== undefined
        ? `no Pyright configuration; the project runs mypy (${facts.mypyConfig}), which has no private-usage rule`
        : "no Pyright configuration";
    if (definition.kind === "module") {
      const dotted = this.dottedModule(definition.file);
      const exports = this.exportList(definition.file);
      const importRules = rulesNaming(facts, dotted);
      const convention = exports === undefined ? `${definition.file} declares no __all__` : `${definition.file} declares __all__ with ${exports.length} names`;
      if (importRules.length > 0) {
        return {
          enforced: false,
          visible: true,
          evidence: `${convention}; import-linter rule${importRules.length === 1 ? "" : "s"} ${importRules.map((c) => `"${c}"`).join(", ")} in ${facts.importLinterConfig} name${importRules.length === 1 ? "s" : ""} ${dotted}`,
          rung: { grade: "checker-choked", enforcer: `import-linter (${facts.importLinterConfig})`, fact: `rule ${importRules.map((c) => `"${c}"`).join(", ")} names ${dotted}, so an import the rule forbids fails the project's lint` },
        };
      }
      return {
        enforced: false,
        visible: true,
        evidence: `${convention}; any file may import it${facts.importLinterConfig === undefined ? "" : `; no rule in ${facts.importLinterConfig} names ${dotted}`}`,
        rung: { grade: "reference-choked", enforcer: COHERENCE_ENFORCER, fact: `any file may import ${dotted}; every reference to its members in the project is inside the chokepoint` },
      };
    }
    const entry = await this.entryAt(definition);
    const name = entry?.symbol.name ?? definition.name;
    const underscore = name.startsWith("_") && !name.startsWith("__");
    const exports = this.exportList(definition.file);
    const conventions: string[] = [];
    conventions.push(underscore ? `${name} is underscore-prefixed` : `${name} carries no underscore prefix`);
    if (exports !== undefined) conventions.push(exports.includes(name) ? `__all__ in ${definition.file} lists it` : `__all__ in ${definition.file} excludes it`);
    else conventions.push(`${definition.file} declares no __all__`);
    const convention = conventions.join("; ");

    // Rung 1: never a module attribute, so the interpreter refuses any name for it from outside.
    const closure = entry !== undefined ? this.closureFact(entry, definition, chokepoint) : undefined;
    if (closure !== undefined) {
      return { enforced: true, visible: false, evidence: `${closure}; ${convention}`, rung: { grade: "closure-choked", enforcer: "the interpreter", fact: closure } };
    }
    // Rung 2: the convention plus a checker that makes ignoring it an error.
    if (underscore && facts.privateUsageIsError) {
      return {
        enforced: false,
        visible: true,
        evidence: `${convention}; ${checkerNote}`,
        rung: { grade: "checker-choked", enforcer: `Pyright (reportPrivateUsage: error in ${facts.pyrightConfig})`, fact: `${name} is underscore-prefixed and ${facts.pyrightConfig} makes reportPrivateUsage an error, so a use outside its module fails the project's type check` },
      };
    }
    // Rung 3: Coherence's own check.
    const reach = entry !== undefined && entry.parents.includes(KIND_CLASS) ? `${name} is a member of ${entry.path.slice(0, -1).join(".")}, reachable through the class from any file` : `${name} is a module attribute any file may import`;
    return {
      enforced: false,
      visible: true,
      evidence: `${convention}; ${checkerNote}`,
      rung: { grade: "reference-choked", enforcer: COHERENCE_ENFORCER, fact: `${reach} (${convention}; ${checkerNote}); every reference in the project is inside the chokepoint` },
    };
  }

  /** The closure fact when the definition is a function-local inside the chokepoint and nothing exposes it as a module attribute, else undefined. */
  private closureFact(entry: Flat, definition: Definition, chokepoint: Definition | undefined): string | undefined {
    const inFunction = entry.parents.length > 0 && entry.parents.some((k) => k === KIND_FUNCTION || k === KIND_METHOD);
    if (!inFunction) return undefined;
    // The innermost function's path prefix: the parent path up to the last function/method.
    const lastFunction = entry.parents.lastIndexOf(KIND_FUNCTION) > entry.parents.lastIndexOf(KIND_METHOD) ? entry.parents.lastIndexOf(KIND_FUNCTION) : entry.parents.lastIndexOf(KIND_METHOD);
    const functionPath = entry.path.slice(0, lastFunction + 1).join(".");
    if (chokepoint === undefined || chokepoint.kind !== "symbol" || chokepoint.file !== definition.file || !rangeContains(chokepoint.range, definition.range.start)) return undefined;
    const lines = this.linesOf(definition.file);
    const name = entry.symbol.name;
    const body = lines.slice(chokepoint.range.start.line, chokepoint.range.end.line + 1).join("\n");
    if (new RegExp(`^\\s*(global|nonlocal)\\s+[^\\n]*\\b${name}\\b`, "m").test(body)) return undefined;
    if (lines.some((l) => new RegExp(`^${name}\\s*(:|=(?!=))`).test(l))) return undefined;
    return `${name} is defined inside ${functionPath}'s body and is not a module attribute: nothing outside the function can import or name it`;
  }

  /** pytest selects by `-k <expression>`; a `via` value, a test's name, is that expression. */
  testFilter(via: string): string {
    return via;
  }

  /**
   * A function-local is never a module attribute, so the interpreter refuses
   * every import of it and that refusal is the refutation for the closure rung
   * (ruling rs-e93ecdd6). Everything else stages the two sites the import
   * ruling could otherwise swallow (d-7abd1ba8): a use in the chokepoint's own
   * module past the chokepoint's body, and a re-export through `__all__`.
   */
  async refute(protectedThing: Definition, outsideOf: Definition | undefined): Promise<Refutation> {
    const client = await this.indexed();
    let importName: string;
    let access: string;
    if (protectedThing.kind === "module") {
      const first = (await this.moduleMembers(protectedThing.file))[0];
      if (first === undefined) return { seen: false, staged: [], account: `${protectedThing.file} declares and re-exports nothing, so no document can reference it` };
      importName = first.name;
      access = importName;
    } else {
      const entry = await this.entryAt(protectedThing);
      if (entry === undefined) return { seen: false, staged: [], account: `no declaration at ${protectedThing.file}:${protectedThing.selection.line + 1}` };
      importName = entry.path[0]!;
      access = entry.path.join(".");
      if (entry.parents.some((k) => k === KIND_FUNCTION || k === KIND_METHOD)) return this.refusedByInterpreter(client, protectedThing, entry.symbol.name);
    }
    return this.stage(client, protectedThing, outsideOf, importName, access);
  }

  /** Where a synthetic document beside the protected thing stands, and how it names the module to import from. */
  private syntheticFrom(protectedThing: Definition): { where: string; from: string } {
    const dir = dirname(protectedThing.file);
    if (basename(protectedThing.file) === "__init__.py") {
      const parent = dirname(dir);
      return { where: parent === "." ? "" : parent + "/", from: basename(dir) };
    }
    const stem = basename(protectedThing.file, ".py");
    return { where: dir === "." ? "" : dir + "/", from: existsSync(join(this.root, dir, "__init__.py")) ? `.${stem}` : stem };
  }

  /** Open a synthetic document that imports the name and read Pyright's refusal back. */
  private async refusedByInterpreter(client: PythonLanguageClient, protectedThing: Definition, name: string): Promise<Refutation> {
    const { where, from } = this.syntheticFrom(protectedThing);
    const synthetic = `${where}coherence_refutation_${randomBytes(4).toString("hex")}.py`;
    const text = `from ${from} import ${name}\ncoherence_refutation = ${name}\n`;
    this.diagnostics.delete(synthetic);
    client.notify("textDocument/didOpen", { textDocument: { uri: this.uri(synthetic), languageId: "python", version: 1, text } });
    this.lineCache.set(synthetic, text.split("\n"));
    this.symbolCache.set(synthetic, []);
    try {
      const refusal = await this.awaitRefusal(synthetic);
      if (refusal !== undefined) {
        return { seen: true, staged: [], refused: refusal, account: `an unsaved document ${synthetic} importing ${name} was refused by the interpreter's own rule: ${refusal}` };
      }
      return { seen: false, staged: [], account: `an unsaved document ${synthetic} importing ${name} drew no diagnostic, so nothing proves the import is refused` };
    } finally {
      client.notify("textDocument/didClose", { textDocument: { uri: this.uri(synthetic) } });
      this.lineCache.delete(synthetic);
      this.symbolCache.delete(synthetic);
      this.diagnostics.delete(synthetic);
    }
  }

  /** The first published diagnostic on a file that refuses the import, within the window; Pyright publishes an empty set first. */
  private async awaitRefusal(file: string, timeoutMs = 20_000): Promise<string | undefined> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const refusal = (this.diagnostics.get(file) ?? []).find((d) => refusesImport(d));
      if (refusal !== undefined) return refusal.message;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return undefined;
  }

  /** Stage the two synthetic sites in one references query, and restore. */
  private async stage(client: PythonLanguageClient, protectedThing: Definition, chokepoint: Definition | undefined, importName: string, access: string): Promise<Refutation> {
    const { where, from } = this.syntheticFrom(protectedThing);
    const synthetic = `${where}coherence_refutation_${randomBytes(4).toString("hex")}.py`;
    // A class member is reached through its class, and `__all__` cannot name it: there the outside document uses it instead.
    const direct = access === importName;
    const text = direct ? `from ${from} import ${importName}\n__all__ = ["${importName}"]\n` : `from ${from} import ${importName}\ncoherence_refutation = ${access}\n`;
    const outside = {
      what: direct ? `a re-export of ${importName} through __all__ in the unsaved document ${synthetic}` : `a use of ${access} in the unsaved document ${synthetic}`,
      file: synthetic,
      line: direct ? 1 : 2,
    };
    client.notify("textDocument/didOpen", { textDocument: { uri: this.uri(synthetic), languageId: "python", version: 1, text } });
    this.lineCache.set(synthetic, text.split("\n"));
    this.symbolCache.set(synthetic, []);
    this.probes.add(synthetic);

    // A module chokepoint has no inside that is outside its own range, so there is no same-module site to stage.
    const sameModule = chokepoint !== undefined && chokepoint.kind === "symbol" ? this.editChokepointModule(chokepoint, protectedThing, importName, access) : undefined;
    const expected: { what: string; file: string; line: number }[] = [];
    if (sameModule !== undefined) expected.push({ what: `a use of ${access} in ${chokepoint!.file} outside ${chokepoint!.name}`, file: chokepoint!.file, line: sameModule.line });
    expected.push(outside);

    try {
      const sites = await this.references(protectedThing);
      const staged: StagedSite[] = expected.map((want) => {
        const hit = sites.find((s) => s.file === want.file && s.line === want.line);
        return { what: want.what, ...(hit === undefined ? {} : { site: hit }) };
      });
      const unseen = staged.filter((s) => s.site === undefined);
      return {
        seen: unseen.length === 0,
        staged,
        account:
          unseen.length === 0
            ? `the instrument reported ${staged.map((s) => s.what).join(" and ")}`
            : `the instrument did not report ${unseen.map((s) => s.what).join(" or ")} among ${sites.length} references; the check is vacuous`,
      };
    } finally {
      sameModule?.restore();
      client.notify("textDocument/didClose", { textDocument: { uri: this.uri(synthetic) } });
      this.lineCache.delete(synthetic);
      this.symbolCache.delete(synthetic);
      this.probes.delete(synthetic);
    }
  }

  /** Append a use of the protected thing to the chokepoint's own module, past the chokepoint's body: the one place the import ruling makes an import inside. */
  private editChokepointModule(chokepoint: Definition, protectedThing: Definition, importName: string, access: string): { line: number; restore: () => void } | undefined {
    let original: string;
    try {
      original = readFileSync(join(this.root, chokepoint.file), "utf8");
    } catch {
      return undefined;
    }
    const body = original.endsWith("\n") ? original : `${original}\n`;
    const start = body.split("\n").length - 1;
    const sameFile = chokepoint.file === protectedThing.file;
    // Re-importing a name Python already bound is harmless, so the added lines need no alias.
    const added = sameFile ? `coherence_refutation_use = ${access}\n` : `from ${this.dottedModule(protectedThing.file)} import ${importName}\ncoherence_refutation_use = ${access}\n`;
    const line = start + (sameFile ? 1 : 2);
    this.open(chokepoint.file);
    this.change(chokepoint.file, body + added);
    this.symbolCache.delete(chokepoint.file);
    this.lineCache.set(chokepoint.file, (body + added).split("\n"));
    return {
      line,
      restore: () => {
        this.change(chokepoint.file, original);
        this.symbolCache.delete(chokepoint.file);
        this.lineCache.delete(chokepoint.file);
      },
    };
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
  path: string[];
  parents: number[];
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
