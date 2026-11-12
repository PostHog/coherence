/**
 * Which tsserver the TypeScript language server drives, and the one line a
 * session start says when it is not the project's own: the project's
 * typescript/lib/tsserver.js while it ships one (TypeScript below 7), else
 * Coherence's own. Packages are found through installed.ts, by the resolver.
 */

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { COHERENCE_FROM, exclusionOf, installedPackage, keepProjectFiles, packageFile, projectFrom, typescriptCompiler, walkBounds } from "../../src/plugins/api.ts";

/** The first number of a version. */
function major(version: string): number {
  return Number.parseInt(version, 10);
}

/** The tsserver the TypeScript language server drives, whose it is, and, when it is Coherence's, the project's TypeScript it stands in for. */
export interface TsserverChoice {
  path: string;
  version: string;
  whose: "project" | "coherence";
  /** The project's own TypeScript when it is installed but ships no tsserver (TypeScript 7 and later). */
  passedOver: string | undefined;
}

/**
 * The tsserver to drive: the project's own typescript/lib/tsserver.js when
 * that file exists and is a tsserver (TypeScript below 7: from 7 the language
 * service is native and ships none), otherwise Coherence's own, resolved from
 * its module; undefined when neither holds one.
 */
export function locateTsserver(root: string, coherenceFrom: string = COHERENCE_FROM): TsserverChoice | undefined {
  const project = installedPackage("typescript", projectFrom(root));
  const own = project === undefined ? undefined : packageFile(project, "lib/tsserver.js");
  if (project !== undefined && own !== undefined && major(project.version) < 7) return { path: own, version: project.version, whose: "project", passedOver: undefined };
  const passedOver = project === undefined ? undefined : project.version;
  const coherence = installedPackage("typescript", coherenceFrom);
  const theirs = coherence === undefined ? undefined : packageFile(coherence, "lib/tsserver.js");
  if (coherence !== undefined && theirs !== undefined && major(coherence.version) < 7) return { path: theirs, version: coherence.version, whose: "coherence", passedOver };
  return undefined;
}

/** TypeScript's native language server (tsgo) and whose it is. */
export interface TsgoChoice {
  path: string;
  version: string;
  whose: "project" | "coherence";
}

/** The package holding TypeScript 7's native binary for this machine, which Coherence lists per platform rather than through a typescript@7 alias, whose tsc bin would shadow the 5.x one. */
const NATIVE_PACKAGE = `@typescript/typescript-${process.platform}-${process.arch}`;

/**
 * The tsgo to drive: the native binary beside the project's own TypeScript 7
 * or later, else Coherence's own; undefined under COHERENCE_TSGO=0 or when
 * neither holds one for this platform, and the reading falls back to tsserver.
 */
export function locateTsgo(root: string, coherenceFrom: string = COHERENCE_FROM): TsgoChoice | undefined {
  if (process.env["COHERENCE_TSGO"] === "0") return undefined;
  if (installedPackage("typescript", coherenceFrom) === undefined) return undefined;
  const project = installedPackage("typescript", projectFrom(root));
  const projectNative = project === undefined || major(project.version) < 7 ? undefined : nativeBinary(join(project.dir, "package.json"));
  if (projectNative !== undefined) return { ...projectNative, whose: "project" };
  const coherenceNative = nativeBinary(coherenceFrom);
  if (coherenceNative !== undefined) return { ...coherenceNative, whose: "coherence" };
  return undefined;
}

function nativeBinary(from: string): { path: string; version: string } | undefined {
  const found = installedPackage(NATIVE_PACKAGE, from);
  if (found === undefined) return undefined;
  const path = packageFile(found, process.platform === "win32" ? "lib/tsc.exe" : "lib/tsc");
  return path === undefined ? undefined : { path, version: found.version };
}

/** A config option TypeScript 7 removed, which tsgo refuses and tsserver still honors: baseUrl resolution, node10 resolution. */
const REMOVED_OPTION = /error TS5\d{3}: .*has been removed/;
const CONFIG_PATHSPECS = ["tsconfig*.json", "*/tsconfig*.json", "jsconfig*.json", "*/jsconfig*.json"];
const ROOT_CONFIG = /^[tj]sconfig.*\.json$/;
/** The last refusal probe's answer, kept with the configs and tsgo it was read from: the probe costs a program listing per config, seconds on a monorepo. */
const REFUSAL_RECORD = join(".coherence", "typescript-engine.json");
/**
 * The most a refusal probe takes over every config together, the time a
 * client grants a cold warm server to answer at all: past it the probe is
 * unanswered, so nothing is kept and tsgo reads. One listing runs at a time,
 * since each holds a whole program in memory.
 */
const PROBE_BUDGET_MS = 20_000;

/**
 * The configs that decide which engine reads: every tsconfig*.json and
 * jsconfig*.json git tracks that is the project's own (outside a nested
 * checkout or a plugin's folder) and that a walk bounded by the config's
 * ignore list reads. A fixture's, an example's or a vendored package's config
 * in a folder the adoption ignores never sends the whole project to tsserver.
 */
function trackedConfigs(root: string): string[] {
  const bounds = walkBounds(root);
  let listed: string[];
  try {
    listed = execFileSync("git", ["ls-files", "-z", "--", ...CONFIG_PATHSPECS], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\0").filter((file) => file !== "");
  } catch {
    listed = rootConfigs(root);
  }
  const own = keepProjectFiles(root, listed);
  return listed.filter((file) => own.has(file) && exclusionOf(file, bounds) === undefined);
}

function rootConfigs(root: string): string[] {
  try {
    return readdirSync(root).filter((name) => ROOT_CONFIG.test(name)).sort();
  } catch {
    return [];
  }
}

function textOrMissing(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "\0missing";
  }
}

/** The configs each config extends, at any depth and from any package, which tsgo reads with it. */
function inheritedConfigs(root: string, configs: readonly string[]): string[] {
  const ts = typescriptCompiler("the configs a tsconfig extends are found with its parser");
  const host = { ...ts.sys, readDirectory: () => [] };
  const inherited = new Set<string>();
  for (const config of configs) {
    const path = join(root, config);
    const text = host.readFile(path);
    if (text === undefined) continue;
    const source = ts.readJsonConfigFile(path, () => text);
    ts.parseJsonSourceFileConfigFileContent(source, host, dirname(path));
    for (const file of source.extendedSourceFiles ?? []) inherited.add(file);
  }
  return [...inherited].sort();
}

function refusalKey(root: string, tsgo: TsgoChoice, configs: readonly string[], inherited: readonly string[]): string {
  const hash = createHash("sha256").update(`${tsgo.path}\0${tsgo.version}`);
  for (const config of configs) hash.update(`\0${config}\0${textOrMissing(join(root, config))}`);
  for (const file of inherited) hash.update(`\0${file}\0${textOrMissing(file)}`);
  return hash.digest("hex");
}

/** The kept answer while tsgo, every tracked config and every config they extended when it was probed read as they did then. */
function keptRefusal(root: string, tsgo: TsgoChoice, configs: readonly string[]): { refused: string | null } | undefined {
  try {
    const kept = JSON.parse(readFileSync(join(root, REFUSAL_RECORD), "utf8")) as { key?: string; inherited?: string[]; refused?: string | null };
    if (kept.refused === undefined || !Array.isArray(kept.inherited)) return undefined;
    return kept.key === refusalKey(root, tsgo, configs, kept.inherited) ? { refused: kept.refused } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The first line tsgo refuses as a removed option in any tracked
 * tsconfig*.json or jsconfig*.json, kept until tsgo, a config or a config one
 * extends changes; undefined when it refuses none, or when the probe could
 * not finish within its budget. The listings run as child processes the
 * caller's event loop never waits on, so a warm server probing still answers.
 */
export async function tsgoRefusal(tsgo: TsgoChoice, root: string, budgetMs: number = PROBE_BUDGET_MS): Promise<string | undefined> {
  const configs = trackedConfigs(root);
  const kept = keptRefusal(root, tsgo, configs);
  if (kept !== undefined) return kept.refused ?? undefined;
  const inherited = inheritedConfigs(root, configs);
  const key = refusalKey(root, tsgo, configs, inherited);
  const probe = await probeRefusal(tsgo, root, configs, Date.now() + budgetMs);
  if (probe.answered) keepRefusal(root, JSON.stringify({ key, inherited, refused: probe.refused ?? null }));
  return probe.refused;
}

/** A root that is gone or read-only keeps no answer, and the next start probes again. */
function keepRefusal(root: string, record: string): void {
  const written = `${join(root, REFUSAL_RECORD)}.${process.pid}`;
  try {
    if (!existsSync(join(root, ".coherence"))) mkdirSync(join(root, ".coherence"));
    writeFileSync(written, record);
    renameSync(written, join(root, REFUSAL_RECORD));
  } catch {
    rmSync(written, { force: true });
  }
}

/** Each config's program listing until one is refused; unanswered when tsgo could not list one before the deadline, so nothing is kept from it. */
async function probeRefusal(tsgo: TsgoChoice, root: string, configs: readonly string[], deadline: number): Promise<{ refused: string | undefined; answered: boolean }> {
  for (const config of configs) {
    const listed = await listProgram(tsgo, root, config, deadline - Date.now());
    if (listed === undefined) return { refused: undefined, answered: false };
    const refused = listed.split("\n").find((line) => REMOVED_OPTION.test(line));
    if (refused !== undefined) return { refused: `${config}: ${refused.trim()}`, answered: true };
  }
  return { refused: undefined, answered: true };
}

/** What tsgo prints listing one config's program, its two streams together; undefined when it could not start, was killed, or outlived the time left. */
function listProgram(tsgo: TsgoChoice, root: string, config: string, leftMs: number): Promise<string | undefined> {
  if (leftMs <= 0) return Promise.resolve(undefined);
  return new Promise((done) => {
    const child = spawn(tsgo.path, ["-p", join(root, config), "--listFilesOnly"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
    const timer = setTimeout(() => child.kill("SIGKILL"), leftMs);
    child.on("error", () => {
      clearTimeout(timer);
      done(undefined);
    });
    child.on("close", (_code, signal) => {
      clearTimeout(timer);
      done(signal === null ? Buffer.concat(chunks).toString("utf8") : undefined);
    });
  });
}

/**
 * The line an agent reads when another compiler than the project's own
 * reads it: tsgo of another major version, or Coherence's own tsserver for
 * a TypeScript 7 project, with tsgo's refusal when one is kept; empty
 * otherwise. It reads the kept refusal and never probes, since it runs at
 * every session start: a project probed for the first time is told as if
 * tsgo reads it.
 */
export function tsserverNotice(root: string, coherenceFrom: string = COHERENCE_FROM): string {
  const project = installedPackage("typescript", projectFrom(root));
  if (project === undefined) return "";
  const tsgo = locateTsgo(root, coherenceFrom);
  const refused = tsgo === undefined ? undefined : (keptRefusal(root, tsgo, trackedConfigs(root))?.refused ?? undefined);
  if (tsgo !== undefined && refused === undefined) {
    if (major(tsgo.version) === major(project.version)) return "";
    return `TypeScript: Coherence reads this project with tsgo ${tsgo.version}, TypeScript's native compiler, not with its own TypeScript ${project.version}, so a reading can differ from what the project's own compiler says.`;
  }
  if (major(project.version) < 7) return "";
  const choice = locateTsserver(root, coherenceFrom);
  const refusalNote = refused === undefined ? "" : ` tsgo refused ${refused.replace(/\.$/, "")}.`;
  if (choice === undefined) return `TypeScript: this project's TypeScript ${project.version} ships no tsserver and Coherence has no TypeScript of its own installed, so no TypeScript reading can be made; install Coherence with its optional dependencies (its typescript is one).${refusalNote}`;
  return `TypeScript: this project's TypeScript ${project.version} ships no tsserver, so Coherence is using its own TypeScript ${choice.version} for readings (references, symbols and the compiler's refusals).${refusalNote}`;
}
