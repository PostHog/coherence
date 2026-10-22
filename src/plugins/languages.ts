/**
 * The languages the core reads, as the plugins that provide them say: every
 * question the core once answered with a table keyed by language name (which
 * files are a language's, its ladder, its entrance rules, the syntax a
 * reading scans by, the folders its tools make) is asked here, and answered
 * from the providing plugin's manifest or, for code, from the module its
 * manifest names. The core names no language itself.
 *
 * The bundled defaults (plugins/defaults.json) are the plugins every project
 * runs without naming them: TypeScript, Python, Rust, and the declared plugin
 * that reads the languages a config declares. A project's config may name a
 * plugin that provides one of their languages, which takes its place (the
 * swap rule, src/plugins/registry.ts); reading the config registers it here.
 *
 * The manifests are data, read once per process; a slot's module is loaded
 * synchronously, once, when a reading first asks for that slot of that
 * language, so a reading pays only for the syntax it scans by.
 */

import { readFileSync } from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import type { AdapterBounds, LanguageAdapter, Ladder } from "../adapters/adapter.ts";
import type { DeclaredLanguage } from "../adapters/declared-config.ts";
import type { EntranceRule, LoadedPlugin, MarkedFolder, PluginManifest, PluginModule, SyntaxSlot, SyntaxTables } from "./plugin.ts";
import { BUNDLED_DIR, moduleSyncOf, readManifest } from "./registry.ts";
import { setLanguageData } from "../readings/scope/language-data.ts";

/** The defaults file beside the bundled plugins. */
const DEFAULTS_FILE = "defaults.json";

interface Defaults {
  /** The primary language of a project whose config names none. */
  language: string;
  /** The bundled plugins every project runs, in order: the languages' order wherever the core lists them. */
  plugins: string[];
}

let defaults: Defaults | undefined;
let bundled: LoadedPlugin[] | undefined;

function readDefaults(): Defaults {
  if (defaults !== undefined) return defaults;
  const file = join(BUNDLED_DIR, DEFAULTS_FILE);
  const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<Defaults>;
  if (typeof raw.language !== "string" || !Array.isArray(raw.plugins) || !raw.plugins.every((p) => typeof p === "string")) throw new Error(`${file} names a default language and the bundled plugins every project runs`);
  defaults = { language: raw.language, plugins: [...raw.plugins] };
  return defaults;
}

/** The bundled plugins every project runs, read from their manifests once; a bundled manifest that will not read is the package's fault and says so. */
export function bundledPlugins(): readonly LoadedPlugin[] {
  if (bundled !== undefined) return bundled;
  const out: LoadedPlugin[] = [];
  for (const name of readDefaults().plugins) {
    const dir = join(BUNDLED_DIR, name);
    const read = readManifest(name, dir, `bundled plugin ${name}`);
    if (read.manifest === undefined) throw new Error(`Coherence's ${read.problems.join("; ")}`);
    out.push({ name, version: read.manifest.version, dir, source: "bundled", manifest: read.manifest });
  }
  bundled = out;
  return bundled;
}

/** The primary language of a project whose config names none. */
export function defaultLanguage(): string {
  return readDefaults().language;
}

/** The languages the bundled plugins provide, in their order: the languages every project reads without naming a plugin. */
function bundledLanguages(): string[] {
  return bundledPlugins().flatMap((p) => (p.manifest.provides?.language === undefined ? [] : [p.manifest.provides.language]));
}

/**
 * The languages the core reads by its own plugins, in order: the
 * languages the bundled defaults provide. Read once, when this module loads.
 */
export const LANGUAGES: readonly string[] = bundledLanguages();

/** A language the core reads by name. */
export type Language = string;

/**
 * Plugins each project's config names that provide one of the core's
 * languages, by project root, then by language: they take the bundled one's
 * place for that project alone.
 */
const swapsByRoot = new Map<string, Map<string, LoadedPlugin>>();

/** The project root a question is asked for: the one forProject names around it, else the project whose config was read last. */
const scope = new AsyncLocalStorage<string>();
let lastRoot: string | undefined;

/** The swaps of the project a question is asked for. */
function swapsNow(): ReadonlyMap<string, LoadedPlugin> {
  const root = scope.getStore() ?? lastRoot;
  return (root === undefined ? undefined : swapsByRoot.get(root)) ?? NO_SWAPS;
}

const NO_SWAPS: ReadonlyMap<string, LoadedPlugin> = new Map();

/** What is derived from the providers' data, per project root, kept until that project's plugins are registered again. */
const derivedCache = new Map<string, unknown>();

function cached<T>(key: string, make: () => T): T {
  const scoped = `${scope.getStore() ?? lastRoot ?? ""}\u0000${key}`;
  if (!derivedCache.has(scoped)) derivedCache.set(scoped, make());
  return derivedCache.get(scoped) as T;
}

/**
 * Register the plugins a project's config names, under its root: one that
 * provides a language the bundled defaults provide takes its place for that
 * project. The project registered last is the one a question asked outside
 * forProject is answered for; a project that names none reads the bundled
 * ones.
 */
export function registerProjectPlugins(root: string, plugins: readonly LoadedPlugin[]): void {
  const key = resolve(root);
  for (const cachedKey of [...derivedCache.keys()]) if (cachedKey.startsWith(`${key}\u0000`)) derivedCache.delete(cachedKey);
  const swaps = new Map<string, LoadedPlugin>();
  for (const plugin of plugins) {
    const language = plugin.manifest.provides?.language;
    if (language !== undefined && LANGUAGES.includes(language) && plugin.source !== "bundled") swaps.set(language, plugin);
  }
  swapsByRoot.set(key, swaps);
  lastRoot = key;
  setLanguageData(languageDataTable());
}

/**
 * Run `work` with every question it asks here answered for the project at
 * `root`, however its awaits interleave with another project's: what a
 * process that serves several projects at once wraps each one's work in.
 */
export function forProject<T>(root: string, work: () => T): T {
  return scope.run(resolve(root), work);
}

/** The plugin that provides one of the core's languages: the project's swap when its config named one, else the bundled one; undefined for any other name. */
export function providerOf(language: string): LoadedPlugin | undefined {
  return swapsNow().get(language) ?? bundledProvider(language);
}

function bundledProvider(language: string): LoadedPlugin | undefined {
  return bundledPlugins().find((p) => p.manifest.provides?.language === language);
}

/**
 * One field of a language's manifest data: the swap's when it declares it,
 * else the bundled provider's, so a plugin that replaces only the adapter
 * keeps every reading of the language.
 */
function fieldOf<K extends keyof PluginManifest>(language: string, key: K): PluginManifest[K] | undefined {
  const swap = swapsNow().get(language);
  if (swap !== undefined && swap.manifest[key] !== undefined) return swap.manifest[key];
  return bundledProvider(language)?.manifest[key];
}

/** The bundled plugin that reads the languages a config declares. */
export function declaredProvider(): LoadedPlugin | undefined {
  return bundledPlugins().find((p) => p.manifest.provides?.declaredLanguages === true);
}

/** Every one of the core's languages with its provider, in the languages' order. */
function providers(): { language: string; plugin: LoadedPlugin }[] {
  return LANGUAGES.flatMap((language) => {
    const plugin = providerOf(language);
    return plugin === undefined ? [] : [{ language, plugin }];
  });
}

/* ------------------------------------------------------------ files */

const fileRules = new Map<string, { pattern: RegExp; except: RegExp | undefined }>();

function fileRule(language: string): { pattern: RegExp; except: RegExp | undefined } {
  // A file rule is one rule, never merged field by field: a swap that names its files either way (a pattern, or a list of
  // extensions) owns them whole, so a swap that adds .svelte by extensions is never left reading the bundled pattern alone.
  const swap = swapsNow().get(language);
  const owner = swap !== undefined && (swap.manifest.files !== undefined || swap.manifest.extensions !== undefined) ? swap : bundledProvider(language);
  const files = owner?.manifest.files;
  const extensions = owner?.manifest.extensions ?? [];
  const key = JSON.stringify([files, extensions]);
  let rule = fileRules.get(key);
  if (rule === undefined) {
    // A plugin that lists extensions instead of a pattern: a file ending in any of them.
    const pattern = files !== undefined ? new RegExp(files.pattern) : new RegExp(`(?:${extensions.map((e) => e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") || "(?!)"})$`);
    rule = { pattern, except: files?.except === undefined ? undefined : new RegExp(files.except) };
    fileRules.set(key, rule);
  }
  return rule;
}

/**
 * The language a file is written in, by its name, among the languages given
 * (every one of the core's when none are); undefined for any other file. No
 * two of the languages share a file: the first whose rule takes it has it.
 */
export function languageOfFile(file: string, languages?: readonly string[]): string | undefined {
  const base = file.trim();
  for (const { language } of providers()) {
    const rule = fileRule(language);
    if (!rule.pattern.test(base) || rule.except?.test(base) === true) continue;
    return languages === undefined || languages.includes(language) ? language : undefined;
  }
  return undefined;
}

const compiled = new Map<string, RegExp>();

/** A pattern from manifest data, compiled once. */
function regex(pattern: string): RegExp {
  let found = compiled.get(pattern);
  if (found === undefined) {
    found = new RegExp(pattern);
    compiled.set(pattern, found);
  }
  return found;
}

/** Whether a file of the language is one the plain source scan leaves out (TypeScript's JavaScript, Python's stubs). */
export function leftOutOfSource(file: string, language: string): boolean {
  if (providerOf(language) === undefined) return true;
  const source = fieldOf(language, "source");
  return source !== undefined && regex(source.except).test(file);
}

/** The extensions a language server can report a site in or resolve a name to. */
export function serverExtensions(language: string): readonly string[] {
  return fieldOf(language, "serverExtensions") ?? [];
}

/** Whether a file's base name makes it a test by one of the languages' own naming (pytest's test_*.py, *_test.py). */
export function testByLanguageName(base: string): boolean {
  return cached("testFiles", () => providers().flatMap(({ language }) => (fieldOf(language, "testFiles") ?? []).map(regex))).some((pattern) => pattern.test(base));
}

/* ------------------------------------------------------------ the walk */

/**
 * Folder names no project authors its code in, wherever they sit: a package
 * manager's install and an interpreter's cache, as each language plugin
 * names them. Nothing else is left out by its name alone: a folder named
 * public, dist or build may hold the project's own code (billing's
 * api/public held five routes no walk read), and a generated one is already
 * left out by the project's git ignore rules.
 */
export function environmentFolders(): ReadonlySet<string> {
  return cached("environment", () => new Set(providers().flatMap(({ language }) => fieldOf(language, "environmentFolders") ?? [])));
}

/** The folders the languages' tools make, each left out by its marker, in the languages' order. */
export function markedFolders(): readonly MarkedFolder[] {
  return cached("marked", () => providers().flatMap(({ language }) => fieldOf(language, "markedFolders") ?? []));
}

/* ------------------------------------------------------------ what readings say */

/** The language's entrance rules, each with its plural and what it detects; none for a language whose plugin lists none. */
export function entranceRules(language: string): readonly EntranceRule[] {
  return fieldOf(language, "entrances")?.rules ?? [];
}

/** What the language's entrance rules do not see. */
export function notDetected(language: string): string | undefined {
  return fieldOf(language, "entrances")?.notDetected;
}

/** Why the text scans do not read the language yet, or undefined when they do. */
export function notScanned(language: string): string | undefined {
  return fieldOf(language, "notScanned");
}

/** What a reading says of each of the core's languages without its code: the rules, what they miss, and why a scan skips it; the page carries the same table. */
export function languageDataTable(): Record<string, { rules: EntranceRule[]; notDetected?: string; notScanned?: string }> {
  const table: Record<string, { rules: EntranceRule[]; notDetected?: string; notScanned?: string }> = {};
  for (const { language } of providers()) {
    const entrances = fieldOf(language, "entrances");
    const reason = fieldOf(language, "notScanned");
    table[language] = { rules: [...(entrances?.rules ?? [])], ...(entrances === undefined ? {} : { notDetected: entrances.notDetected }), ...(reason === undefined ? {} : { notScanned: reason }) };
  }
  return table;
}

/** How the language's exported type bodies read, for the lexicon's member scan; undefined when its plugin says nothing. */
export function memberScanOf(language: string): { opens: RegExp; closes: RegExp; field: RegExp } | undefined {
  const members = fieldOf(language, "members");
  return members === undefined ? undefined : { opens: regex(members.opens), closes: regex(members.closes), field: regex(members.field) };
}

/** The notes the CI workflow carries for the languages named. */
export function ciNotes(languages: readonly string[]): string[] {
  return providers().flatMap(({ language }) => {
    const ci = fieldOf(language, "ci");
    return languages.includes(language) && ci !== undefined ? [ci.note] : [];
  });
}

/** The names the core's language plugins vouch for as well known. */
export function pluginWellKnown(): string[] {
  return providers().flatMap(({ language }) => fieldOf(language, "wellKnown") ?? []);
}

/** The ladder the language's adapter grades on, as its plugin's manifest declares it. */
export function ladderOf(language: string): Ladder | undefined {
  return fieldOf(language, "ladder");
}

/* ------------------------------------------------------------ code */

const load = createRequire(import.meta.url);
const slots = new Map<string, unknown>();

/**
 * One syntax slot of a language, loaded from the module its plugin's
 * manifest names, synchronously and once; undefined when the plugin leaves
 * the slot empty, which a reading reads as "not read for <language>".
 */
export function syntaxOf<S extends SyntaxSlot>(language: string, slot: S): SyntaxTables[S] | undefined {
  // The swap's slot when it fills it, else the bundled provider's: a plugin that replaces only the adapter keeps the readings.
  const swap = swapsNow().get(language);
  const plugin = swap?.manifest.syntax?.[slot] !== undefined ? swap : bundledProvider(language);
  const at = plugin?.manifest.syntax?.[slot];
  if (plugin === undefined || at === undefined) return undefined;
  const key = `${plugin.dir}\u0000${at}`;
  if (!slots.has(key)) {
    const [file, name] = at.split("#") as [string, string];
    const module = load(resolve(plugin.dir, file)) as Record<string, unknown>;
    if (!(name in module)) throw new Error(`plugin ${plugin.name}'s syntax.${slot} names ${at}, whose module exports no ${name}`);
    slots.set(key, module[name]);
  }
  return slots.get(key) as SyntaxTables[S];
}

/** Every module the core's language plugins answer from, by absolute path: their adapter modules and the modules their syntax slots name. */
export function languageCode(): string[] {
  return [...providers().map(({ plugin }) => plugin), ...[...swapsNow().keys()].flatMap((l) => bundledProvider(l) ?? [])].flatMap((plugin) => {
    const files = [plugin.manifest.module, ...Object.values(plugin.manifest.syntax ?? {}).map((at) => at.split("#")[0])].filter((f): f is string => f !== undefined);
    return [...new Set(files)].map((f) => resolve(plugin.dir, f));
  });
}

/** A plugin's module, loaded synchronously, holding an adapter factory: what the core builds its own languages' adapters from. */
function adapterModule(plugin: LoadedPlugin): PluginModule {
  const module = moduleSyncOf(plugin);
  if (typeof module.adapter !== "function") throw new Error(`plugin ${plugin.name}'s module exports no adapter factory`);
  return module;
}

/** The adapter of one of the core's languages, built by its provider's module; with bounds, one whose server leaves the bounded-away folders out. */
export function coreAdapter(language: string, root: string, bounds?: AdapterBounds): LanguageAdapter | undefined {
  const plugin = providerOf(language);
  if (plugin === undefined) return undefined;
  return adapterModule(plugin).adapter!({ root, language, ...(bounds === undefined ? {} : { bounds }) });
}

/** The adapter of a language a config declares, built by the declared plugin. */
export function declaredAdapter(declared: DeclaredLanguage, root: string): LanguageAdapter {
  const plugin = declaredProvider();
  if (plugin === undefined) throw new Error(`no bundled plugin reads the languages a config declares, so ${declared.name} has no adapter`);
  return adapterModule(plugin).adapter!({ root, language: declared.name, declared });
}

// What the readings say of each language, set for every module that reads it (language-data.ts): the page sets its own from its state.
setLanguageData(languageDataTable());
