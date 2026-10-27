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
 * swap rule, src/plugins/registry.ts), or one that provides a language none
 * of them does (Go), which is read here as a bundled one is, for that
 * project alone; reading the config registers either here.
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
import type { BoundarySource } from "../scaffold/boundaries.ts";
import { DERIVED_SLOTS, type CiStep, type EntranceRule, type LoadedPlugin, type MarkedFolder, type ModuleResolution, type PluginManifest, type PluginModule, type SyntaxSlot, type SyntaxTables } from "./plugin.ts";
import type { SourceSyntax } from "../economy/source.ts";
import type { InterfaceSyntax } from "../readings/scope/component-interfaces.ts";
import { treeReaderOf, type TreeDeclaration, type TreeReader } from "./syntax-trees.ts";
import { BUNDLED_DIR, moduleSyncOf, readManifest, throughThisCore } from "./registry.ts";
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

/**
 * The project a question is asked for: the root forProject names around it,
 * else the project whose config was read last. Every per-project store here
 * (the swaps, the extending plugins, what is derived from them) is read
 * through this one door, so none can answer for a different project than
 * the others.
 */
function rootNow(): string | undefined {
  return scope.getStore() ?? lastRoot;
}

/** The swaps of the project a question is asked for. */
function swapsNow(): ReadonlyMap<string, LoadedPlugin> {
  const root = rootNow();
  return (root === undefined ? undefined : swapsByRoot.get(root)) ?? NO_SWAPS;
}

const NO_SWAPS: ReadonlyMap<string, LoadedPlugin> = new Map();

/**
 * Plugins each project's config names that extend one of the core's
 * languages without providing it (Convex over TypeScript), by project root,
 * in the config's order: each adds its entrance rules and wraps the syntax
 * slots it fills over the provider's, for that project alone. A project
 * that names none pays nothing for them.
 */
const extendersByRoot = new Map<string, readonly LoadedPlugin[]>();

/**
 * Plugins each project's config names that provide a language no bundled
 * plugin provides (Go), by project root, in the config's order: each is its
 * language's whole provider for that project, its manifest data and syntax
 * slots read as a bundled plugin's are.
 */
const addedByRoot = new Map<string, readonly LoadedPlugin[]>();

/** The plugins that add a language for the project a question is asked for. */
function addedNow(): readonly LoadedPlugin[] {
  const root = rootNow();
  return (root === undefined ? undefined : addedByRoot.get(root)) ?? [];
}

/** The plugins that extend the language for the project a question is asked for, in the config's order. */
function extendersOf(language: string): readonly LoadedPlugin[] {
  const root = rootNow();
  return ((root === undefined ? undefined : extendersByRoot.get(root)) ?? []).filter((p) => p.manifest.extends === language);
}

/** What is derived from the providers' data, per project root, kept until that project's plugins are registered again. */
const derivedCache = new Map<string, unknown>();

function cached<T>(key: string, make: () => T): T {
  const scoped = `${rootNow() ?? ""}\u0000${key}`;
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
  const extenders: LoadedPlugin[] = [];
  const added: LoadedPlugin[] = [];
  for (const plugin of plugins) {
    const language = plugin.manifest.provides?.language;
    if (language !== undefined && LANGUAGES.includes(language)) {
      if (plugin.source !== "bundled") swaps.set(language, plugin);
    } else if (language !== undefined) added.push(plugin);
    // The registry has already refused one that extends a language neither the core nor a plugin here provides.
    else if (plugin.manifest.extends !== undefined) extenders.push(plugin);
  }
  swapsByRoot.set(key, swaps);
  extendersByRoot.set(key, extenders);
  addedByRoot.set(key, added);
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

/** The plugin that provides a language the project reads: the project's swap when its config named one, else the bundled one, else the project's plugin that adds it; undefined for any other name. */
export function providerOf(language: string): LoadedPlugin | undefined {
  return swapsNow().get(language) ?? baseProvider(language);
}

function bundledProvider(language: string): LoadedPlugin | undefined {
  return bundledPlugins().find((p) => p.manifest.provides?.language === language);
}

/** What a swap falls back to: the bundled provider of one of the core's languages, else the project's plugin that adds the language. */
function baseProvider(language: string): LoadedPlugin | undefined {
  return bundledProvider(language) ?? addedNow().find((p) => p.manifest.provides?.language === language);
}

/**
 * The core's language that reads files ending in an extension, whatever
 * plugin a project adds: what the registry asks before it lets a plugin's
 * new language claim the extension, so a plugin registered by an earlier
 * read of the same config is never taken for another owner of its own files.
 */
export function coreLanguageOfExtension(extension: string): string | undefined {
  return languageOfFile(`x${extension}`, LANGUAGES);
}

/**
 * One field of a language's manifest data: the swap's when it declares it,
 * else the bundled provider's, so a plugin that replaces only the adapter
 * keeps every reading of the language.
 */
function fieldOf<K extends keyof PluginManifest>(language: string, key: K): PluginManifest[K] | undefined {
  const swap = swapsNow().get(language);
  if (swap !== undefined && swap.manifest[key] !== undefined) return swap.manifest[key];
  return baseProvider(language)?.manifest[key];
}

/** The bundled plugin that reads the languages a config declares. */
export function declaredProvider(): LoadedPlugin | undefined {
  return bundledPlugins().find((p) => p.manifest.provides?.declaredLanguages === true);
}

/** Every language the project reads by a plugin with its provider: the core's, in their order, then each its plugins add, in the config's. */
function providers(): { language: string; plugin: LoadedPlugin }[] {
  return [...LANGUAGES, ...addedNow().map((p) => p.manifest.provides!.language!)].flatMap((language) => {
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
  const owner = swap !== undefined && (swap.manifest.files !== undefined || swap.manifest.extensions !== undefined) ? swap : baseProvider(language);
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

/** Whether a folder's name makes what it holds a test by one of the languages' own layouts (SwiftPM's Tests). */
export function testByLanguageFolder(name: string): boolean {
  return cached("testFolders", () => new Set(providers().flatMap(({ language }) => fieldOf(language, "testFolders") ?? []))).has(name);
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
  return [...(fieldOf(language, "entrances")?.rules ?? []), ...extendersOf(language).flatMap((p) => p.manifest.entrances?.rules ?? [])];
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
    // A plugin that fills no source slot reads no text of its language: said, never read as an empty project.
    const reason = fieldOf(language, "notScanned") ?? (fillsSlot(language, "source") ? undefined : `the ${language} plugin fills no source slot, so no text scan reads ${language}'s declarations or imports`);
    table[language] = { rules: [...entranceRules(language)], ...(entrances === undefined ? {} : { notDetected: entrances.notDetected }), ...(reason === undefined ? {} : { notScanned: reason }) };
  }
  return table;
}

/** Whether a base name is a file besides source some language's answers and entrances rest on: its configuration, a manifest or a lockfile, as each plugin names them (basisFiles). */
export function isBasisFile(name: string): boolean {
  return providers().some(({ language }) => (fieldOf(language, "basisFiles") ?? []).some((pattern) => regex(pattern).test(name)));
}

/** The folder a module file owns (a package's __init__.py, a Rust mod.rs, a crate root), as its language's plugin says (moduleFolders); undefined when the file owns none. */
export function moduleFolderOf(file: string): string | undefined {
  for (const { language } of providers()) {
    for (const pattern of fieldOf(language, "moduleFolders") ?? []) {
      const owned = regex(pattern).exec(file)?.[1];
      if (owned !== undefined) return owned;
    }
  }
  return undefined;
}

/** Whether any plugin answering for the language fills the slot, read from the manifests alone: the swap, the provider, or a plugin that extends it. */
export function fillsSlot(language: string, slot: SyntaxSlot): boolean {
  const filled = (p: LoadedPlugin | undefined): boolean => fills(p, slot);
  return filled(swapsNow().get(language)) || filled(baseProvider(language)) || extendersOf(language).some(filled);
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

/** The setup steps the CI workflow runs for the languages named, each plugin's in the languages' order, a step two name once. */
export function ciSteps(languages: readonly string[]): CiStep[] {
  const seen = new Set<string>();
  return providers().flatMap(({ language }) => (languages.includes(language) ? (fieldOf(language, "ci")?.steps ?? []) : [])).filter((step) => {
    const key = JSON.stringify(step);
    return !seen.has(key) && seen.add(key) !== undefined;
  });
}

/** The names the core's language plugins vouch for as well known. */
export function pluginWellKnown(): string[] {
  return providers().flatMap(({ language }) => [...(fieldOf(language, "wellKnown") ?? []), ...extendersOf(language).flatMap((p) => p.manifest.wellKnown ?? [])]);
}

/** The boundary sources the core's language plugins supply (tach's, the Python plugin's), each once, by name: what scaffold import and adoption draft specs from. */
export function boundarySources(): BoundarySource[] {
  const found = new Map<string, BoundarySource>();
  for (const { language } of providers()) {
    const source = syntaxOf(language, "boundaries");
    if (source !== undefined && !found.has(source.name)) found.set(source.name, source);
  }
  return [...found.values()];
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
  const plugin = fills(swap, slot) ? swap : baseProvider(language);
  const provided = plugin === undefined ? undefined : ((plugin.manifest.treeSitter !== undefined && (TREE_SLOTS as readonly string[]).includes(slot) ? treeSlot(plugin, slot) : slotExport(plugin, slot)) as SyntaxTables[S] | undefined);
  const extenders = extendersOf(language).filter((p) => p.manifest.syntax?.[slot] !== undefined);
  if (extenders.length === 0) return provided;
  // Each extending plugin's export for the slot wraps the one beneath it, in the config's order, as its adapter wraps the adapter.
  return cached(`syntax\u0000${language}\u0000${slot}`, () =>
    extenders.reduce<SyntaxTables[S] | undefined>((beneath, extender) => {
      const wrap = slotExport(extender, slot);
      if (typeof wrap !== "function") throw new Error(`plugin ${extender.name} extends ${language}, so its syntax.${slot} names a function of the table beneath it, not a table`);
      return (wrap as (beneath: SyntaxTables[S] | undefined) => SyntaxTables[S])(beneath);
    }, provided),
  );
}

/** The slots a plugin on the parser path has the core fill from its parser: the derived ones, and the interfaces slot whose import answers are the parser's. */
const TREE_SLOTS = [...DERIVED_SLOTS.filter((slot) => slot !== "kept"), "interfaces"] as const;

/** Whether a plugin fills a slot: its manifest names an export for it, or names a parser the core derives the slot from. */
function fills(plugin: LoadedPlugin | undefined, slot: SyntaxSlot): boolean {
  return plugin !== undefined && (plugin.manifest.syntax?.[slot] !== undefined || (plugin.manifest.treeSitter !== undefined && (TREE_SLOTS as readonly string[]).includes(slot)));
}

/** The export a plugin's manifest names for a slot, loaded synchronously and once; undefined when it leaves the slot empty. */
function slotExport(plugin: LoadedPlugin, slot: SyntaxSlot): unknown {
  const at = plugin.manifest.syntax?.[slot];
  if (at === undefined) return undefined;
  return exportAt(plugin, at, `syntax.${slot}`);
}

/** The export "<module>#<name>" of a plugin's, loaded synchronously and once. */
function exportAt(plugin: LoadedPlugin, at: string, field: string): unknown {
  const key = `${plugin.dir}\u0000${at}`;
  if (!slots.has(key)) {
    const [file, name] = at.split("#") as [string, string];
    throughThisCore(plugin);
    const module = load(resolve(plugin.dir, file)) as Record<string, unknown>;
    // Its own export only: a name the module inherits (constructor, toString) is no slot.
    if (!Object.hasOwn(module, name)) throw new Error(`plugin ${plugin.name}'s ${field} names ${at}, whose module exports no ${name}`);
    slots.set(key, module[name]);
  }
  return slots.get(key);
}

/** The plugin a language's source slot answers from: the project's swap when it fills the slot, else the provider beneath it. */
export function sourceProvider(language: string): LoadedPlugin | undefined {
  const swap = swapsNow().get(language);
  return fills(swap, "source") ? swap : baseProvider(language);
}

/**
 * The reader of a language's text through its parser: the source provider's,
 * when it names one; undefined otherwise, and undefined too when a plugin
 * extending the language wraps its source slot, so the readings answer
 * through the wrapped slot and the extending plugin is never passed over.
 */
export function treeReaderFor(language: string): TreeReader | undefined {
  const plugin = sourceProvider(language);
  if (plugin === undefined || extendersOf(language).some((p) => p.manifest.syntax?.source !== undefined)) return undefined;
  return treeReaderOf(plugin, rootNow());
}

/**
 * A slot the core derives for a plugin on the parser path, built once: every
 * one reads the text through the same parse (syntax-trees.ts), and where an
 * import leads through the plugin's resolve.
 */
function treeSlot(plugin: LoadedPlugin, slot: SyntaxSlot): unknown {
  const key = `${plugin.dir}\u0000tree\u0000${slot}`;
  if (slots.has(key)) return slots.get(key);
  // The project asking, at each call: the table is built once, and a project's files are kept parses, a line alone is not.
  const reader = (): TreeReader => treeReaderOf(plugin, rootNow())!;
  // A question about one line (what it declares) parses the line alone: no project's store keeps it, since no file is that line.
  // A line that opens a bracket it does not close (export default function Page({) is read again with them closed, as its statement goes on.
  const lineDeclaration = (line: string): TreeDeclaration | undefined => {
    const reader = treeReaderOf(plugin)!;
    const declared = reader.declarations(line)[0];
    if (declared !== undefined) return declared;
    const closers = unclosed(line);
    return closers === "" ? undefined : reader.declarations(line + closers)[0];
  };
  const resolution = (): ModuleResolution => {
    const value = exportAt(plugin, plugin.manifest.treeSitter!.resolve, "treeSitter.resolve") as ModuleResolution;
    if (typeof value?.resolveModule !== "function" || typeof value.modulePaths !== "function") throw new Error(`plugin ${plugin.name}'s treeSitter.resolve names ${plugin.manifest.treeSitter!.resolve}, which is no { resolveModule, modulePaths }`);
    return value;
  };
  const boundName = (specifier: string): string => resolution().boundName?.(specifier) ?? specifier.split("/").pop() ?? specifier;
  let table: unknown;
  if (slot === "source") {
    table = {
      declarationOf: (line: string) => {
        const declared = lineDeclaration(line);
        return declared === undefined ? undefined : { name: declared.name, exported: declared.exported };
      },
      resolveModule: (root: string, from: string, specifier: string, vanished: ReadonlySet<string>) => resolution().resolveModule(root, from, specifier, vanished),
      // A glob brings in no name of its own: the kept answers and the word index read it, through wildcardModules.
      // A whole module whose names the text uses through the name the import binds (st.Seal, where the queries capture uses) brings in those names, each joined to the module's file that declares it; one the text uses no name of stays whole.
      importsOf: (text: string, add: (name: string | undefined, specifier: string) => void) => {
        const uses = reader().uses(text);
        for (const imported of reader().imports(text)) {
          if (imported.glob === true) continue;
          const used = imported.name === undefined && uses.size > 0 ? uses.get(imported.alias ?? boundName(imported.specifier)) : undefined;
          if (used === undefined) add(imported.name, imported.specifier);
          else for (const name of [...used].sort()) add(name, imported.specifier);
        }
      },
    } satisfies SourceSyntax;
  } else if (slot === "declares") table = (line: string) => lineDeclaration(line)?.declares ?? "unknown";
  else if (slot === "topLevel") table = (text: string, name: string) => reader().topLevel(text).has(name);
  else if (slot === "interfaces") {
    // The language's own facts the plugin's interfaces table states (whether its server narrows to bounds); the import answers are the parser's alone.
    const facts = slotExport(plugin, "interfaces") as Partial<InterfaceSyntax> | undefined;
    const twice = (["importLists", "wildcardModules"] as const).filter((answer) => facts?.[answer] !== undefined);
    if (twice.length > 0) throw new Error(`plugin ${plugin.name} reads its text through treeSitter, so its interfaces table's ${twice.join(" and ")} would read its imports a second time; the core derives them from the parser: remove them`);
    table = {
      isTypeDeclaration: (line: string) => lineDeclaration(line)?.declares === "type",
      // A module's default export, where the queries capture it (@default): the declaration that is it, and the names exported as it.
      isDefaultExport: (line: string) => lineDeclaration(line)?.isDefault === true,
      serverBounds: false,
      defaultNames: (text: string) => reader().defaults(text),
      ...facts,
      importLists: (text: string) => {
        const renamed = reader().imports(text).filter((i) => i.alias !== undefined);
        return renamed.length === 0 ? [] : [renamed.map((i) => `${i.name ?? i.specifier} as ${i.alias}`).join(", ")];
      },
      wildcardModules: (file: string, text: string) => reader().imports(text).filter((i) => i.glob === true).flatMap((i) => resolution().modulePaths(file, i.specifier)),
    } satisfies InterfaceSyntax;
  }
  slots.set(key, table);
  return table;
}

/** The closers of every bracket a line opens and leaves open, innermost first; brackets inside a quoted string are none. */
function unclosed(line: string): string {
  const open: string[] = [];
  let quote: string | undefined;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quote !== undefined) {
      if (c === "\\") i++;
      else if (c === quote) quote = undefined;
    } else if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "(" || c === "[" || c === "{") open.push(c === "(" ? ")" : c === "[" ? "]" : "}");
    else if ((c === ")" || c === "]" || c === "}") && open[open.length - 1] === c) open.pop();
  }
  return open.reverse().join("");
}

/**
 * The answers a plugin gives twice: each pair of its slots' functions (a slot
 * that is a function, or a function of a slot's table) that are one function,
 * or two spelled alike. Two slots answering one question in two places is
 * how a plugin's answers drift apart: the question belongs to one slot. A
 * function that answers a constant (`() => false`) is no answer to repeat.
 */
export function repeatedAnswers(plugin: LoadedPlugin): string[] {
  const answers: { at: string; fn: Function; text: string }[] = [];
  const add = (at: string, value: unknown): void => {
    if (typeof value !== "function") return;
    // The text past the function's own name, white space dropped: two functions spelled alike read alike under any name.
    const text = value.toString().replace(/^[^(]*/, "").replace(/\s+/g, "");
    if (/^\([\w,]*\)=>(?:false|true|undefined|\[\]|""|0|\{\})$/.test(text)) return;
    answers.push({ at, fn: value, text });
  };
  for (const slot of Object.keys(plugin.manifest.syntax ?? {}) as SyntaxSlot[]) {
    const value = slotExport(plugin, slot);
    if (typeof value === "function") add(slot, value);
    else if (value !== null && typeof value === "object") for (const [key, field] of Object.entries(value)) add(`${slot}.${key}`, field);
  }
  const repeated: string[] = [];
  for (let i = 0; i < answers.length; i++)
    for (let j = i + 1; j < answers.length; j++) {
      const [a, b] = [answers[i]!, answers[j]!];
      if (a.fn === b.fn) repeated.push(`${a.at} and ${b.at} are one function`);
      else if (a.text === b.text) repeated.push(`${a.at} and ${b.at} are spelled alike`);
    }
  return repeated;
}

/** Every module the core's language plugins answer from, by absolute path: their adapter modules and the modules their syntax slots name. */
export function languageCode(): string[] {
  return [...providers().map(({ plugin }) => plugin), ...[...swapsNow().keys()].flatMap((l) => bundledProvider(l) ?? [])].flatMap((plugin) => {
    const files = [plugin.manifest.module, ...[...Object.values(plugin.manifest.syntax ?? {}), plugin.manifest.treeSitter?.resolve].map((at) => at?.split("#")[0])].filter((f): f is string => f !== undefined);
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

/** The bundled plugin's own adapter for one of the core's languages, whatever a project swaps in: what a plugin extending that language wraps. */
export function bundledAdapter(language: string, root: string): LanguageAdapter | undefined {
  const plugin = bundledProvider(language);
  return plugin === undefined ? undefined : adapterModule(plugin).adapter!({ root, language });
}

/** The adapter of a language a config declares, built by the declared plugin. */
export function declaredAdapter(declared: DeclaredLanguage, root: string): LanguageAdapter {
  const plugin = declaredProvider();
  if (plugin === undefined) throw new Error(`no bundled plugin reads the languages a config declares, so ${declared.name} has no adapter`);
  return adapterModule(plugin).adapter!({ root, language: declared.name, declared });
}

// What the readings say of each language, set for every module that reads it (language-data.ts): the page sets its own from its state.
setLanguageData(languageDataTable());
