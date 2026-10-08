/**
 * tach as a checker the project runs: where a repository declares its Python
 * module boundaries in a tach.toml, tach itself refuses an import of a
 * module's internals from another module, and the Python adapter grades a
 * chokepoint checker-choked on that refusal instead of re-deriving the
 * boundary from Pyright's references.
 *
 * What tach 0.34 and 0.35 do, as read from the tool itself:
 *
 *   [[modules]]     path (or paths) is a dotted module path under one of
 *                   source_roots; a file belongs to the module with the
 *                   longest path that is it or a package above it
 *   [[interfaces]]  `from` and `expose` are regular expressions, each matched
 *                   against the whole text: `from` against a module path, and
 *                   `expose` against an import's path below that module. An
 *                   import from another module that no exposed pattern
 *                   matches is a PrivateDependency error; "store" covers
 *                   `import pkg.mod.store` but not `from pkg.mod.store import X`
 *   visibility      on an interface, the interface constrains only the
 *                   modules it lists, so every other module imports freely;
 *                   on a module, it is a dependency rule, not an interface
 *   utility         changes which modules must declare a dependency, never
 *                   what an interface exposes
 *   strict          deprecated; tach migrates it to an interface of its own,
 *                   so a module carrying it alone is not read as governed
 *   unchecked       a module whose own imports tach never checks
 *
 * A module is governed for a chokepoint when an interface without a
 * visibility list is declared from it, some interface exposes the
 * chokepoint (or a package above it), and none exposes the protected thing
 * or a package above it below the module, since an import of the package
 * reaches the thing as an attribute. The module's own code is free to use
 * its internals; that is tach's rule and the check honors it.
 *
 * tach reads files from disk only. Its refusal is witnessed in a throwaway
 * copy: a temporary folder holding tach.toml and, along the staged file's
 * path, real folders whose other entries are symbolic links to the project's
 * own. tach walks no symbolic link, so it checks only the staged file, and
 * resolves the import through the links; on PostHog that costs about 150 ms
 * against two seconds for the whole tree. The same copy checks the files an
 * edit wrote, so the check at an edit never runs tach over the whole tree.
 */

import { spawnSync } from "../lifecycle/work-meter.ts";
import { createHash, randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseToml, type TomlTable, type TomlValue } from "./toml.ts";

export const TACH_CONFIG = "tach.toml";
const TACH_BIN = "tach";
const COHERENCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TACH_TIMEOUT_MS = 120_000;

export interface TachModule {
  path: string;
  unchecked: boolean;
  strict: boolean;
}

export interface TachInterface {
  expose: string[];
  from: string[];
  visibility: string[] | undefined;
}

export interface TachConfig {
  /** The tach.toml's absolute path. */
  file: string;
  /** The folder holding it, where tach runs. */
  root: string;
  /** The text as read, so a cached witness is dropped when the configuration changes. */
  digest: string;
  sourceRoots: string[];
  exclude: string[];
  modules: TachModule[];
  interfaces: TachInterface[];
  rootModule: string;
  ignoreTypeChecking: boolean;
}

/** The nearest tach.toml at or above the project root: a nested project in a monorepo inherits the one above it. */
export function findTachConfig(projectRoot: string): string | undefined {
  let dir = resolve(projectRoot);
  for (;;) {
    const candidate = join(dir, TACH_CONFIG);
    if (existsSync(candidate)) return candidate;
    const up = dirname(dir);
    if (up === dir) return undefined;
    dir = up;
  }
}

function strings(value: TomlValue | undefined, what: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${what} must be an array`);
  return value.map((item) => {
    if (typeof item === "string") return item;
    // A dependency may be written { path = "x", deprecated = true }.
    if (typeof item === "object" && !Array.isArray(item) && typeof item["path"] === "string") return item["path"];
    throw new Error(`${what} holds ${JSON.stringify(item)}, not a string`);
  });
}

function tables(value: TomlValue | undefined, what: string): TomlTable[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "object" || Array.isArray(item))) throw new Error(`${what} must be an array of tables ([[${what}]])`);
  return value as TomlTable[];
}

/** tach.toml read into what the boundary check needs; throws with the line on what it cannot read. */
export function readTachConfig(file: string): TachConfig {
  const text = readFileSync(file, "utf8");
  const toml = parseToml(text, file);
  const modules: TachModule[] = [];
  for (const table of tables(toml["modules"], "modules")) {
    const paths = typeof table["path"] === "string" ? [table["path"]] : strings(table["paths"], "modules.paths");
    for (const path of paths) modules.push({ path, unchecked: table["unchecked"] === true, strict: table["strict"] === true });
  }
  const interfaces = tables(toml["interfaces"], "interfaces").map((table) => ({
    expose: strings(table["expose"], "interfaces.expose"),
    from: strings(table["from"], "interfaces.from"),
    visibility: table["visibility"] === undefined ? undefined : strings(table["visibility"], "interfaces.visibility"),
  }));
  const roots = strings(toml["source_roots"], "source_roots");
  return {
    file,
    root: dirname(file),
    digest: createHash("sha256").update(text).digest("hex").slice(0, 16),
    sourceRoots: roots.length === 0 ? ["."] : roots,
    exclude: strings(toml["exclude"], "exclude"),
    modules,
    interfaces,
    rootModule: typeof toml["root_module"] === "string" ? toml["root_module"] : "ignore",
    ignoreTypeChecking: toml["ignore_type_checking_imports"] !== false,
  };
}

/** Whether a tach pattern matches the whole text; a pattern that is no regular expression matches nothing. */
export function fullMatch(pattern: string, text: string): boolean {
  try {
    return new RegExp(`^(?:${pattern})$`).test(text);
  } catch {
    return false;
  }
}

/** Whether a tach exclude glob (`**`, `*`, `?`) names the path or a folder above it. */
export function excluded(config: TachConfig, rel: string): boolean {
  const parts = rel.split("/");
  return config.exclude.some((glob) => {
    const regex = new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*\/?/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]").replace(/\u0000/g, "(?:.*/)?")}$`);
    for (let n = parts.length; n >= 1; n--) if (regex.test(parts.slice(0, n).join("/"))) return true;
    return false;
  });
}

const posix = (path: string): string => path.split(sep).join("/");

/** A file's dotted module path under the source root that holds it most narrowly, or undefined outside every source root. */
export function dottedFor(config: TachConfig, absoluteFile: string): string | undefined {
  let best: string | undefined;
  for (const sourceRoot of config.sourceRoots) {
    const rel = posix(relative(resolve(config.root, sourceRoot), absoluteFile));
    if (rel.startsWith("..") || rel === "" || !rel.endsWith(".py")) continue;
    const parts = rel.replace(/\.py$/, "").split("/");
    if (parts[parts.length - 1] === "__init__") parts.pop();
    const dotted = parts.join(".");
    if (best === undefined || dotted.length < best.length) best = dotted;
  }
  return best;
}

/** The tach module a dotted path belongs to: the declared module with the longest path that is it or a package above it. */
export function moduleOf(config: TachConfig, dotted: string): TachModule | undefined {
  let best: TachModule | undefined;
  for (const module of config.modules) {
    if (module.path === "<root>") continue;
    if ((dotted === module.path || dotted.startsWith(`${module.path}.`)) && (best === undefined || module.path.length > best.path.length)) best = module;
  }
  return best;
}

/** Where a module's code lies under the tach root: a package folder (ending "/") or a module file, as existing on disk. */
export function moduleLocations(config: TachConfig, module: TachModule): string[] {
  const out: string[] = [];
  for (const sourceRoot of config.sourceRoots) {
    const base = join(resolve(config.root, sourceRoot), ...module.path.split("."));
    if (existsSync(base) && statSync(base).isDirectory()) out.push(`${posix(relative(config.root, base))}/`);
    else if (existsSync(`${base}.py`)) out.push(posix(relative(config.root, `${base}.py`)));
  }
  return out;
}

/** What tach.toml says about one chokepoint: governed, with the interface that is the fact, or why not. */
export type TachGovernance =
  | { governed: true; module: TachModule; interfaces: TachInterface[]; fact: string; gaps: string[] }
  | { governed: false; reason: string };

/**
 * Whether tach refuses an outside import of the protected thing while the
 * chokepoint stays importable: both lie in one module, an interface without
 * a visibility list is declared from it, some interface exposes the
 * chokepoint or a package above it, and none exposes the protected thing or
 * a package above it below the module.
 */
export function tachGovernance(config: TachConfig, protectedPath: string, chokepointPath: string): TachGovernance {
  const module = moduleOf(config, protectedPath);
  if (module === undefined) return { governed: false, reason: `${protectedPath} lies in no module ${TACH_CONFIG} declares` };
  const chokepointModule = moduleOf(config, chokepointPath);
  if (chokepointModule?.path !== module.path) return { governed: false, reason: `${protectedPath} lies in tach module ${module.path} and the chokepoint ${chokepointPath} ${chokepointModule === undefined ? "in none" : `in ${chokepointModule.path}`}, so no interface of one module stands between them` };
  const below = (path: string): string[] => {
    const rest = path.slice(module.path.length + 1);
    if (path === module.path || rest === "") return [];
    const parts = rest.split(".");
    return parts.map((_, i) => parts.slice(0, i + 1).join("."));
  };
  const protectedReaches = below(protectedPath);
  if (protectedReaches.length === 0) return { governed: false, reason: `${protectedPath} is tach module ${module.path} itself, which any module may import` };
  const declared = config.interfaces.filter((i) => i.from.some((pattern) => fullMatch(pattern, module.path)));
  if (declared.length === 0) return { governed: false, reason: `tach module ${module.path} declares no [[interfaces]], so tach lets any module import anything in it` };
  const unrestricted = declared.filter((i) => i.visibility === undefined);
  if (unrestricted.length === 0) return { governed: false, reason: `every interface of tach module ${module.path} carries a visibility list, and tach constrains only the modules it lists` };
  const exposing = declared.filter((i) => i.expose.some((pattern) => protectedReaches.some((path) => fullMatch(pattern, path))));
  if (exposing.length > 0) return { governed: false, reason: `an interface of tach module ${module.path} exposes ${exposing[0]!.expose.filter((pattern) => protectedReaches.some((path) => fullMatch(pattern, path))).map((p) => `"${p}"`).join(", ")}, which covers ${protectedPath}` };
  const chokepointReaches = below(chokepointPath);
  const door = declared.filter((i) => i.expose.some((pattern) => chokepointReaches.some((path) => fullMatch(pattern, path))));
  if (door.length === 0) return { governed: false, reason: `no interface of tach module ${module.path} exposes the chokepoint ${chokepointPath}, so tach refuses the door as it refuses the thing` };
  const named = door.map((i) => `expose ${JSON.stringify(i.expose)} from ${JSON.stringify(i.from)}`).join("; ");
  const gaps: string[] = [];
  const unchecked = config.modules.filter((m) => m.unchecked && m.path !== module.path).map((m) => m.path);
  if (unchecked.length > 0) gaps.push(`tach never checks the imports of unchecked module${unchecked.length === 1 ? "" : "s"} ${unchecked.join(", ")}`);
  if (config.rootModule === "ignore") gaps.push("a file in no module goes unchecked (root_module is ignore)");
  if (config.ignoreTypeChecking) gaps.push("an import under TYPE_CHECKING goes unchecked");
  gaps.push("a line marked # tach-ignore goes unchecked", "so does a name reached as an attribute of a package another file imported");
  return {
    governed: true,
    module,
    interfaces: door,
    fact: `${TACH_CONFIG} declares an interface for tach module ${module.path} (${named}) that exposes ${chokepointPath.slice(module.path.length + 1)} and not ${protectedPath.slice(module.path.length + 1)}, so tach check --interfaces refuses an import of ${protectedPath} from another module; the module's own code is free to use it`,
    gaps,
  };
}

/**
 * Where tach is: COHERENCE_TACH alone when it is set; else the project's
 * virtual environments first, then the tach root's, then PATH, then
 * Coherence's own test environment.
 */
export function locateTach(projectRoot: string, tachRoot: string): { path: string | undefined; looked: string[] } {
  const override = process.env["COHERENCE_TACH"];
  if (override !== undefined && override !== "") return { path: existsSync(override) ? override : undefined, looked: [`${override} (COHERENCE_TACH)`] };
  const looked: string[] = [];
  const venvs = [...new Set([resolve(projectRoot), resolve(tachRoot)])].flatMap((dir) => [join(dir, ".venv", "bin", TACH_BIN), join(dir, "venv", "bin", TACH_BIN)]);
  const path = (process.env["PATH"] ?? "").split(":").filter((d) => d !== "").map((d) => join(d, TACH_BIN));
  for (const candidate of [...venvs, ...path, join(COHERENCE_ROOT, ".venv", "bin", TACH_BIN)]) {
    looked.push(candidate);
    if (existsSync(candidate)) return { path: candidate, looked };
  }
  return { path: undefined, looked };
}

/** One import tach refused because the module's interface does not expose it. */
export interface TachViolation {
  /** Relative to the tach root. */
  file: string;
  line: number;
  dependency: string;
  definitionModule: string;
  usageModule: string;
}

export type TachRun = { ok: true; violations: TachViolation[]; ms: number } | { ok: false; reason: string; ms: number };

/** `tach check --dependencies --interfaces --output json` in a folder; the interface errors it printed, or why it gave none. */
export function runTach(bin: string, cwd: string): TachRun {
  const started = Date.now();
  const run = spawnSync(bin, ["check", "--dependencies", "--interfaces", "--output", "json"], { cwd, encoding: "utf8", timeout: TACH_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
  const ms = Date.now() - started;
  if (run.error !== undefined) return { ok: false, reason: `tach at ${bin} did not run: ${run.error.message}`, ms };
  let parsed: unknown;
  try {
    parsed = JSON.parse(run.stdout);
  } catch {
    return { ok: false, reason: `tach at ${bin} printed no JSON (exit ${run.status}): ${(run.stderr || run.stdout).trim().split("\n")[0] ?? ""}`, ms };
  }
  if (!Array.isArray(parsed)) {
    const error = (parsed as { error?: unknown } | null)?.error;
    return { ok: false, reason: `tach at ${bin} refused the configuration: ${typeof error === "string" ? error : JSON.stringify(parsed)}`, ms };
  }
  const violations: TachViolation[] = [];
  for (const item of parsed as Record<string, unknown>[]) {
    const located = item["Located"] as { file_path?: string; line_number?: number; severity?: string; details?: { Code?: Record<string, Record<string, string>> } } | undefined;
    const refused = located?.details?.Code?.["PrivateDependency"];
    if (located === undefined || refused === undefined || located.severity !== "Error") continue;
    violations.push({
      file: posix(located.file_path ?? ""),
      line: located.line_number ?? 0,
      dependency: refused["dependency"] ?? "",
      definitionModule: refused["definition_module"] ?? "",
      usageModule: refused["usage_module"] ?? "",
    });
  }
  return { ok: true, violations, ms };
}

/** Whether a refused import reaches the protected thing: the thing itself, a member of it, or a package above it below the module. */
export function reaches(violation: TachViolation, protectedPath: string, module: string): boolean {
  if (violation.definitionModule !== module) return false;
  const dep = violation.dependency;
  return dep === protectedPath || dep.startsWith(`${protectedPath}.`) || (protectedPath.startsWith(`${dep}.`) && dep.length > module.length);
}

/**
 * Run tach over a throwaway copy of the tach root holding the given files
 * (relative to the root) as real text, every other entry a symbolic link to
 * the original and tach.toml copied, then remove the copy. tach walks no
 * symbolic link, so it checks the given files alone and resolves their
 * imports through the links. `gone` confirms the copy was removed.
 */
export function tachOverCopy(bin: string, config: TachConfig, files: ReadonlyMap<string, string>): { run: TachRun; gone: boolean } {
  const copy = mkdtempSync(join(tmpdir(), "coherence-tach-"));
  const real = new Set<string>();
  for (const file of files.keys()) {
    const parts = file.split("/");
    for (let i = 1; i < parts.length; i++) real.add(parts.slice(0, i).join("/"));
  }
  const build = (from: string, to: string, prefix: string): void => {
    for (const entry of readdirSync(from)) {
      const rel = prefix === "" ? entry : `${prefix}/${entry}`;
      if (files.has(rel) || rel === TACH_CONFIG) continue;
      if (real.has(rel)) {
        mkdirSync(join(to, entry));
        build(join(from, entry), join(to, entry), rel);
      } else symlinkSync(join(from, entry), join(to, entry));
    }
  };
  let run: TachRun;
  try {
    copyFileSync(config.file, join(copy, TACH_CONFIG));
    build(config.root, copy, "");
    for (const [file, text] of files) {
      mkdirSync(dirname(join(copy, file)), { recursive: true });
      writeFileSync(join(copy, file), text);
    }
    run = runTach(bin, copy);
  } catch (error) {
    run = { ok: false, reason: `the throwaway copy for tach could not be built: ${error instanceof Error ? error.message : String(error)}`, ms: 0 };
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
  return { run, gone: !existsSync(copy) };
}

/** What staging an outside import in the throwaway copy showed. */
export interface TachWitness {
  /** tach's refusal of the staged import, when it refused it. */
  refused: string | undefined;
  account: string;
}

/**
 * Stage an outside import of the protected thing (`importLine`) in another
 * checked tach module of a throwaway copy, run tach over it, and read its
 * refusal back; then confirm the copy is gone and nothing was written into
 * the project. A package module gets a new file; a module that is one file
 * gets the import appended to its copy.
 */
export function witnessTach(bin: string, config: TachConfig, governed: TachModule, protectedPath: string, importLine: string): TachWitness {
  const located = (m: TachModule): string | undefined => moduleLocations(config, m).find((where) => !excluded(config, where.replace(/\/$/, "")));
  const outside = config.modules.find((m) => m.path !== "<root>" && !m.unchecked && m.path !== governed.path && !m.path.startsWith(`${governed.path}.`) && !governed.path.startsWith(`${m.path}.`) && located(m) !== undefined);
  if (outside === undefined) return { refused: undefined, account: `${TACH_CONFIG} declares no other checked module to stage an outside import of ${protectedPath} in, so tach's refusal cannot be witnessed` };
  const where = located(outside)!;
  const staged = where.endsWith("/") ? `${where}coherence_refutation_${randomBytes(4).toString("hex")}.py` : where;
  const original = where.endsWith("/") ? "" : readFileSync(join(config.root, where), "utf8");
  const body = original === "" || original.endsWith("\n") ? original : `${original}\n`;
  const line = body.split("\n").length;
  const { run, gone } = tachOverCopy(bin, config, new Map([[staged, `${body}${importLine}\n`]]));
  const left = where.endsWith("/") && existsSync(join(config.root, staged));
  const cleanup = `${gone ? "the throwaway copy is gone" : "the throwaway copy could not be removed"}${left ? `, and ${staged} stands in the project` : ""}`;
  const what = `\`${importLine}\` staged at ${staged}:${line} in tach module ${outside.path}, in a throwaway copy`;
  if (!run.ok) return { refused: undefined, account: `${what}: ${run.reason}; ${cleanup}` };
  const refusal = run.violations.find((v) => v.file === staged && v.line === line && reaches(v, protectedPath, governed.path));
  if (refusal === undefined) return { refused: undefined, account: `${what} drew no interface error from tach (${run.ms} ms), so nothing proves tach refuses it; ${cleanup}` };
  if (!gone || left) return { refused: undefined, account: `${what} was refused by tach, but ${cleanup}` };
  return {
    refused: `the path '${refusal.dependency}' is not part of the public interface for '${refusal.definitionModule}'`,
    account: `${what} was refused by tach (${run.ms} ms): the path '${refusal.dependency}' is not part of the public interface for '${refusal.definitionModule}'; ${cleanup}`,
  };
}

