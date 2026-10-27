/**
 * The registry: which plugins a project runs, read from its config's
 * `plugins` key, and what each provides. Every consumer that needs a
 * language's adapter, a via form's verifier, or the lexicon stack asks here.
 *
 *   "plugins": { "typescript": "bundled", "convex": "./coherence/convex" }
 *
 * The key is the plugin's name, which its manifest must carry; the value is
 * "bundled" (the package's own plugins/<name>) or a path from the project
 * root to the plugin's folder. The key is the project's own, never inherited
 * from a registry: a path is read from the project that wrote it.
 *
 * Refused, with what to change: a manifest that will not read, a name that is
 * not the key, a pluginApi this core does not run, two plugins that provide
 * one language or prove one via form, a new language without extensions or
 * with one another language owns. A project without the key reads nothing
 * here and does exactly the work it did before plugins.
 */

import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { createRequire, registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { landsWithin } from "./within.ts";
import { DERIVED_SLOTS, MANIFEST, OLDEST_PLUGIN_API, PLUGIN_API, SYNTAX_SLOTS, type LoadedPlugin, type PluginManifest, type PluginModule, type PluginTag, type VerifierForm, tagOf } from "./plugin.ts";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The package's own plugins: in a checkout, the plugins folder beside src;
 * in the published package, the JavaScript the build compiles from it into
 * dist/bundled, since Node strips no types under node_modules.
 */
export const BUNDLED_DIR = existsSync(resolve(here, "..", "bundled")) ? resolve(here, "..", "bundled") : resolve(here, "..", "..", "plugins");

/** A refusal the registry found, as one sentence naming what to change. */
export class PluginRefused extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string" && v !== "");
}

/** Whether a value compiles as a regular expression. */
function compiles(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    new RegExp(value);
    return true;
  } catch {
    return false;
  }
}

/** Whether a value is a regular expression read with Unicode's character classes (\p{Lu}), as a treeSitter privateName is. */
function compilesUnicode(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    new RegExp(value, "u");
    return true;
  } catch {
    return false;
  }
}

/** Whether a value is one CI step: an action pinned to a full commit, or one command, never both, each value one line. */
function ciStep(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const line = (v: unknown): boolean => typeof v === "string" && v !== "" && !/[\r\n]/.test(v);
  const { name, uses, version, run } = value;
  if ((uses === undefined) === (run === undefined)) return false;
  // An action is pinned to a commit, and the release that commit is says so in the workflow's comment beside it.
  if (uses !== undefined && !(typeof uses === "string" && /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/.test(uses) && line(version))) return false;
  if (run !== undefined && !line(run)) return false;
  if (run !== undefined && (version !== undefined || value["with"] !== undefined)) return false;
  if (name !== undefined && !line(name)) return false;
  if (version !== undefined && !line(version)) return false;
  const inputs = value["with"];
  return inputs === undefined || (isRecord(inputs) && Object.entries(inputs).every(([k, v]) => /^[A-Za-z][\w-]*$/.test(k) && line(v)));
}

/** The faults in a manifest's data fields: the readings read them in a hook, so each is checked as the reading will use it. */
function dataProblems(raw: Record<string, unknown>, who: string): string[] {
  const problems: string[] = [];
  const files = raw["files"];
  if (files !== undefined && (!isRecord(files) || !compiles(files["pattern"]) || (files["except"] !== undefined && !compiles(files["except"])))) problems.push(`${who}'s files is { "pattern": "<regular expression>", "except"?: "<regular expression>" }`);
  const source = raw["source"];
  if (source !== undefined && (!isRecord(source) || !compiles(source["except"]))) problems.push(`${who}'s source is { "except": "<regular expression>" }`);
  for (const key of ["serverExtensions", "environmentFolders", "testFolders", "wellKnown"] as const) if (raw[key] !== undefined && !strings(raw[key])) problems.push(`${who}'s ${key} is a list of names`);
  const tests = raw["testFiles"];
  if (tests !== undefined && !(Array.isArray(tests) && tests.every(compiles))) problems.push(`${who}'s testFiles is a list of regular expressions a test file's base name matches`);
  const basis = raw["basisFiles"];
  if (basis !== undefined && !(Array.isArray(basis) && basis.every(compiles))) problems.push(`${who}'s basisFiles is a list of regular expressions a configuration, manifest or lockfile's base name matches`);
  const owns = raw["moduleFolders"];
  if (owns !== undefined && !(Array.isArray(owns) && owns.every((o) => compiles(o) && new RegExp(`${o as string}|`).exec("")!.length > 1))) problems.push(`${who}'s moduleFolders is a list of regular expressions a module file's path matches, the first group the folder it owns`);
  const members = raw["members"];
  if (members !== undefined && (!isRecord(members) || !(["opens", "closes", "field"] as const).every((k) => compiles(members[k])))) problems.push(`${who}'s members is { "opens", "closes", "field" }, each a regular expression`);
  const entrances = raw["entrances"];
  const rule = (r: unknown): boolean => isRecord(r) && (["rule", "plural", "detects"] as const).every((k) => typeof r[k] === "string" && r[k] !== "");
  if (entrances !== undefined && (!isRecord(entrances) || !Array.isArray(entrances["rules"]) || !entrances["rules"].every(rule) || typeof entrances["notDetected"] !== "string")) problems.push(`${who}'s entrances is { "rules": [{ "rule", "plural", "detects" }], "notDetected": "<what the rules do not see>" }`);
  if (raw["notScanned"] !== undefined && (typeof raw["notScanned"] !== "string" || raw["notScanned"] === "")) problems.push(`${who}'s notScanned is the reason the text scans do not read the language`);
  const marked = raw["markedFolders"];
  const mark = (m: unknown): boolean => isRecord(m) && typeof m["reason"] === "string" && m["reason"] !== "" && (typeof m["marker"] === "string" || (typeof m["name"] === "string" && typeof m["beside"] === "string"));
  if (marked !== undefined && !(Array.isArray(marked) && marked.every(mark))) problems.push(`${who}'s markedFolders is a list of { "marker" } or { "name", "beside" }, each with its "reason"`);
  const ci = raw["ci"];
  if (ci !== undefined && (!isRecord(ci) || typeof ci["note"] !== "string" || ci["note"] === "" || (ci["steps"] !== undefined && !(Array.isArray(ci["steps"]) && ci["steps"].every(ciStep))))) problems.push(`${who}'s ci is { "note": "<what the workflow says>", "steps"?: [{ "name"?, "uses": "<owner/repo>@<40-hex commit>", "version": "<its release>", "with"?: { "<input>": "<value>" } } or { "name"?, "run": "<command>" }] }`);
  const syntax = raw["syntax"];
  if (syntax !== undefined) {
    if (!isRecord(syntax)) problems.push(`${who}'s syntax maps each slot to "<module>#<export>"`);
    else
      for (const [slot, at] of Object.entries(syntax)) {
        if ((DERIVED_SLOTS as readonly string[]).includes(slot)) problems.push(handReaderRefused(who, slot));
        else if (!(SYNTAX_SLOTS as readonly string[]).includes(slot)) problems.push(`${who}'s syntax names ${slot}, which is no slot (${SYNTAX_SLOTS.join(", ")})`);
        else if (typeof at !== "string" || !/^[^#/][^#]*#[A-Za-z_$][\w$]*$/.test(at) || isAbsolute(at)) problems.push(`${who}'s syntax.${slot} is "<module beside the manifest>#<export>"`);
      }
  }
  return problems;
}

/**
 * A manifest's syntax that names a slot the core derives from a language's
 * parser (DERIVED_SLOTS): a hand-written reader of the language's text,
 * which pluginApi 4 removed. Refused by name, whatever pluginApi the plugin
 * is written for and whether or not it names a parser, rather than ignored:
 * a second reader of a text is how two readings of it come to disagree, and
 * a plugin whose reader went unread would read as one that reads nothing.
 */
function handReaderRefused(who: string, slot: string): string {
  return `${who}'s syntax.${slot} is a hand-written reader of its language's text, which this Coherence does not read (pluginApi 4): read the language through treeSitter, a grammar's .wasm and queries, from which the core derives what ${slot} answered (docs/plugins.md, Reading through a parser)`;
}

/**
 * A manifest's treeSitter, checked: its parser and queries files beside the
 * manifest, its resolve "<module>#<export>", and only on a plugin that
 * provides a language.
 */
function treeSitterProblems(raw: Record<string, unknown>, dir: string, language: string | undefined, who: string): string[] {
  const declared = raw["treeSitter"];
  if (declared === undefined) return [];
  const shape = `${who}'s treeSitter is { "parser": "<.wasm beside the manifest>", "alternate"?: "<.wasm beside the manifest>", "queries": "<.scm beside the manifest>", "resolve": "<module>#<export>", "privateName"?: "<regular expression>", "separator"?: "<a path's separator>" }`;
  if (!isRecord(declared)) return [shape];
  const problems: string[] = [];
  for (const key of ["parser", "alternate", "queries"] as const) {
    if (key === "alternate" && declared[key] === undefined) continue;
    const path = declared[key];
    if (typeof path !== "string" || path === "" || isAbsolute(path)) problems.push(shape);
    else if (relative(dir, resolve(dir, path)).startsWith("..")) problems.push(`${who}'s treeSitter.${key} names ${path}, which leaves the plugin's folder`);
    else if (!existsSync(join(dir, path))) problems.push(`${who}'s treeSitter.${key} names ${path}, which is not beside its ${MANIFEST}`);
  }
  if (typeof declared["resolve"] !== "string" || !/^[^#/][^#]*#[A-Za-z_$][\w$]*$/.test(declared["resolve"])) problems.push(shape);
  if (declared["privateName"] !== undefined && !compilesUnicode(declared["privateName"])) problems.push(shape);
  if (declared["separator"] !== undefined && (typeof declared["separator"] !== "string" || declared["separator"] === "")) problems.push(shape);
  if (language === undefined) problems.push(`${who} names a treeSitter parser but provides no language for it to read`);
  return [...new Set(problems)];
}

/** The manifest at `dir`, checked against the interface; every fault named. */
export function readManifest(name: string, dir: string, where: string): { manifest?: PluginManifest; problems: string[] } {
  const file = join(dir, MANIFEST);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    return { problems: [`${where}: plugin ${name} has no readable ${MANIFEST} at ${file}${missing ? "" : ` (${(error as Error).message})`}`] };
  }
  if (!isRecord(raw)) return { problems: [`${where}: ${file} is not an object`] };
  const problems: string[] = [];
  if (raw["name"] !== name) problems.push(`${where}: the plugin keyed ${name} names itself ${JSON.stringify(raw["name"])} in ${file}; the key is the manifest's name`);
  if (typeof raw["version"] !== "string" || raw["version"] === "") problems.push(`${where}: plugin ${name} carries no version in ${file}`);
  const api = raw["pluginApi"];
  if (typeof api !== "number" || !Number.isInteger(api) || api < OLDEST_PLUGIN_API || api > PLUGIN_API) problems.push(`${where}: plugin ${name} was written for pluginApi ${JSON.stringify(api)}; this Coherence runs pluginApi ${PLUGIN_API} and reads plugins written for ${OLDEST_PLUGIN_API} to ${PLUGIN_API}`);
  const provides = raw["provides"];
  if (provides !== undefined && (!isRecord(provides) || (provides["language"] !== undefined && (typeof provides["language"] !== "string" || provides["language"] === "")) || (provides["declaredLanguages"] !== undefined && provides["declaredLanguages"] !== true))) problems.push(`${where}: plugin ${name}'s provides is { "language": "<name>" }`);
  problems.push(...dataProblems(raw, `${where}: plugin ${name}`));
  if (raw["extends"] !== undefined && (typeof raw["extends"] !== "string" || raw["extends"] === "")) problems.push(`${where}: plugin ${name}'s extends names one language`);
  if (raw["extensions"] !== undefined && (!strings(raw["extensions"]) || !(raw["extensions"] as string[]).every((e) => /^\.[A-Za-z0-9.+-]+$/.test(e)))) problems.push(`${where}: plugin ${name}'s extensions is a list like [".swift"]`);
  for (const key of ["module", "lexicon"] as const) if (raw[key] !== undefined && (typeof raw[key] !== "string" || raw[key] === "" || isAbsolute(raw[key] as string))) problems.push(`${where}: plugin ${name}'s ${key} is a path relative to its ${MANIFEST}`);
  const verifiers = raw["verifiers"];
  if (verifiers !== undefined) {
    const ok = Array.isArray(verifiers) && verifiers.every((v) => isRecord(v) && typeof v["form"] === "string" && /^[a-z][a-z0-9 -]*[a-z0-9]$/.test(v["form"]) && typeof v["evidence"] === "string" && v["evidence"] !== "" && (v["command"] === undefined || strings(v["command"])) && (v["match"] === undefined || typeof v["match"] === "string"));
    if (!ok) problems.push(`${where}: plugin ${name}'s verifiers is a list of { "form": "<lowercase words>", "evidence": "<label>", "command"?: [argv with {name}], "match"?: "<regular expression>" }`);
    else {
      for (const v of verifiers as VerifierForm[]) {
        // A command that never names what it proves passes whatever it is asked: an exit 0 would be evidence of nothing.
        if (v.command !== undefined && !v.command.some((arg) => arg.includes("{name}"))) problems.push(`${where}: plugin ${name}'s verifier [${v.form}] runs ${JSON.stringify(v.command)}, which never names {name}; a command must be told what to prove`);
        if (v.match !== undefined) {
          try {
            new RegExp(v.match);
          } catch (error) {
            problems.push(`${where}: plugin ${name}'s verifier [${v.form}] match is not a regular expression (${(error as Error).message})`);
          }
        }
      }
    }
  }
  const verifierForms = Array.isArray(verifiers) ? (verifiers as VerifierForm[]) : [];
  if (verifierForms.some((v) => v.command === undefined) && raw["module"] === undefined) problems.push(`${where}: plugin ${name} proves a via form with no command and has no module to verify it`);
  const language = isRecord(provides) && typeof provides["language"] === "string" ? provides["language"] : undefined;
  if ((language !== undefined || typeof raw["extends"] === "string" || isRecord(provides) && provides["declaredLanguages"] === true) && raw["module"] === undefined) problems.push(`${where}: plugin ${name} provides or extends a language adapter but names no module`);
  problems.push(...treeSitterProblems(raw, dir, language, `${where}: plugin ${name}`));
  if (problems.length > 0) return { problems };
  return { manifest: raw as unknown as PluginManifest, problems };
}


/** Where a config value puts a plugin's folder: the bundled one, or a path from the root. */
function dirOf(root: string, name: string, value: string): string {
  if (value === "bundled") return join(BUNDLED_DIR, name);
  const path = resolve(root, value);
  return basename(path) === MANIFEST ? dirname(path) : path;
}

/**
 * The plugins a config's `plugins` value names, in its order, and every
 * refusal: the plugins only when there are none. `builtIns` is every
 * language the core owns and the extensions each is written in is asked of
 * `ownedExtension`, so a plugin's new language never takes another's files.
 */
export function readPlugins(root: string, value: unknown, where: string, builtIns: readonly string[], ownedExtension: (extension: string) => string | undefined): { plugins: LoadedPlugin[]; problems: string[] } {
  if (value === undefined) return { plugins: [], problems: [] };
  if (!isRecord(value)) return { plugins: [], problems: [`${where}: plugins maps each plugin's name to "bundled" or a path to its folder`] };
  const plugins: LoadedPlugin[] = [];
  const problems: string[] = [];
  for (const [name, source] of Object.entries(value)) {
    if (typeof source !== "string" || source === "") {
      problems.push(`${where}: plugins.${name} is "bundled" or a path to the plugin's folder`);
      continue;
    }
    // Plugin code runs with the project's privileges; a relative path that climbs out of the project is refused, and running code from
    // elsewhere is said explicitly, by writing the absolute path out.
    // Followed through any symbolic link on the way: a folder inside the project that links outside it leaves it too.
    const lands = source === "bundled" || isAbsolute(source) ? true : landsWithin(root, resolve(root, source));
    if (lands === undefined) {
      problems.push(`${where}: plugins.${name} is ${JSON.stringify(source)}, which passes through a symbolic link that leads nowhere`);
      continue;
    }
    if (!lands) {
      problems.push(`${where}: plugins.${name} is ${JSON.stringify(source)}, which leaves the project; a plugin's code runs with the project's privileges, so write the absolute path out to run code from outside it`);
      continue;
    }
    const dir = dirOf(root, name, source);
    const read = readManifest(name, dir, where);
    problems.push(...read.problems);
    if (read.manifest !== undefined) plugins.push({ name, version: read.manifest.version, dir, source, manifest: read.manifest });
  }
  // Two providers of one language, or two provers of one via form, cannot both answer: the project keeps one.
  const byLanguage = new Map<string, string[]>();
  for (const p of plugins) if (p.manifest.provides?.language !== undefined) byLanguage.set(p.manifest.provides.language, [...(byLanguage.get(p.manifest.provides.language) ?? []), p.name]);
  for (const [language, names] of byLanguage) if (names.length > 1) problems.push(`${where}: plugins ${names.join(" and ")} both provide language ${language}; keep one`);
  const byForm = new Map<string, string[]>();
  for (const p of plugins) for (const v of p.manifest.verifiers ?? []) byForm.set(v.form, [...(byForm.get(v.form) ?? []), p.name]);
  for (const [form, names] of byForm) if (names.length > 1) problems.push(`${where}: plugins ${names.join(" and ")} both prove via form [${form}]; keep one`);
  // A language no built-in owns is the plugin's to name the files of; one a built-in owns keeps the built-in's files.
  const extensionOwner = new Map<string, string>();
  for (const p of plugins) {
    const language = p.manifest.provides?.language;
    if (language === undefined || builtIns.includes(language)) continue;
    const extensions = p.manifest.extensions ?? [];
    if (extensions.length === 0) problems.push(`${where}: plugin ${p.name} provides language ${language}, which no built-in owns, and names no extensions its files are written in`);
    for (const extension of extensions) {
      const owner = ownedExtension(extension) ?? extensionOwner.get(extension);
      if (owner !== undefined) problems.push(`${where}: plugin ${p.name} claims ${extension}, which ${owner} already reads`);
      else extensionOwner.set(extension, language);
    }
  }
  const known = new Set([...builtIns, ...byLanguage.keys()]);
  for (const p of plugins) if (p.manifest.extends !== undefined && !known.has(p.manifest.extends)) problems.push(`${where}: plugin ${p.name} extends ${p.manifest.extends}, which is neither a built-in language nor one a plugin provides`);
  return problems.length > 0 ? { plugins: [], problems } : { plugins, problems };
}

/** The plugin that provides a language's adapter, if one does. */
export function providerOf(plugins: readonly LoadedPlugin[], language: string): LoadedPlugin | undefined {
  return plugins.find((p) => p.manifest.provides?.language === language);
}

/** The plugins that wrap a language's adapter without providing it, in config order. */
export function extendersOf(plugins: readonly LoadedPlugin[], language: string): LoadedPlugin[] {
  return plugins.filter((p) => p.manifest.provides?.language === undefined && p.manifest.extends === language);
}

/** Every plugin whose adapter answers for a language: its provider, then its wrappers; empty for a language no plugin touches. */
export function answeringFor(plugins: readonly LoadedPlugin[], language: string): PluginTag[] {
  const provider = providerOf(plugins, language);
  return [...(provider === undefined ? [] : [provider]), ...extendersOf(plugins, language)].map(tagOf);
}

/** The languages plugins provide that no built-in owns, with the files each is written in. */
export function pluginLanguages(plugins: readonly LoadedPlugin[], builtIns: readonly string[]): { name: string; extensions: string[]; plugin: string }[] {
  return plugins.flatMap((p) => {
    const language = p.manifest.provides?.language;
    return language === undefined || builtIns.includes(language) ? [] : [{ name: language, extensions: p.manifest.extensions ?? [], plugin: p.name }];
  });
}

/** The plugin that proves a via form, and the form's declaration. */
export function verifierOf(plugins: readonly LoadedPlugin[], form: string): { plugin: LoadedPlugin; verifier: VerifierForm } | undefined {
  for (const plugin of plugins) {
    const verifier = plugin.manifest.verifiers?.find((v) => v.form === form);
    if (verifier !== undefined) return { plugin, verifier };
  }
  return undefined;
}

/** Every via form the loaded plugins prove, for the message that names them when a bullet writes another. */
export function verifierForms(plugins: readonly LoadedPlugin[]): string[] {
  return plugins.flatMap((p) => (p.manifest.verifiers ?? []).map((v) => `[${v.form}] (${p.name})`));
}

/** How a plugin names the core: the package's plugin export (src/plugins/api.ts, built to dist/plugins/api.js). */
export const PACKAGE_SPECIFIER = "@posthog/coherence/plugin";

/** Every name a plugin may write for the plugin interface: the export, and the built file the package's dist/* export reaches it by. */
const INTERFACE_SPECIFIERS: ReadonlySet<string> = new Set([PACKAGE_SPECIFIER, "@posthog/coherence/dist/plugins/api.js"]);

/** The plugin interface of the Coherence running this process: api.ts beside this module in a checkout, api.js beside it installed. */
const THIS_INTERFACE = new URL(`./api${extname(fileURLToPath(import.meta.url))}`, import.meta.url).href;

/** The folders of the project plugins loaded in this process, as file URL prefixes, each as written and as its real path. */
const pluginFolders = new Set<string>();
let redirecting = false;

/**
 * Before a project's plugin code loads, its folder joins those whose imports
 * of the plugin interface resolve to the interface of the Coherence that runs,
 * never to the copy the plugin's own folder would find (a project's
 * node_modules while a global install or a checkout runs): the interface's
 * helpers read the registry this process filled, and a second copy holds an
 * empty one, so languageOfFile and every helper like it would answer nothing,
 * silently. The resolve hook is registered once per process (and thread),
 * only when a plugin the project names loads; a file outside every plugin's
 * folder resolves as it always did. A bundled plugin imports the interface by
 * its path beside the core, so it needs none of this.
 */
export function throughThisCore(plugin: LoadedPlugin): void {
  if (plugin.source === "bundled") return;
  const folders = [plugin.dir];
  try {
    folders.push(realpathSync(plugin.dir));
  } catch {
    // A folder that is not there loads nothing; the load that follows says so.
  }
  for (const folder of folders) pluginFolders.add(`${pathToFileURL(folder).href.replace(/\/$/, "")}/`);
  if (redirecting) return;
  redirecting = true;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (!INTERFACE_SPECIFIERS.has(specifier)) return nextResolve(specifier, context);
      const importer = context.parentURL;
      if (importer === undefined || ![...pluginFolders].some((folder) => importer.startsWith(folder))) return nextResolve(specifier, context);
      return { url: THIS_INTERFACE, shortCircuit: true };
    },
  });
}

const modules = new Map<string, Promise<PluginModule>>();

/** The plugin's module, imported once per process and only when its code first runs. */
export function moduleOf(plugin: LoadedPlugin): Promise<PluginModule> {
  const module = plugin.manifest.module;
  if (module === undefined) return Promise.reject(new PluginRefused(`plugin ${plugin.name} has no module`));
  const path = resolve(plugin.dir, module);
  throughThisCore(plugin);
  // Keyed by the file as it is now: Node keeps a module it loaded under its URL for the process's life, so an edited module is a new URL.
  let version = "missing";
  try {
    const s = statSync(path);
    version = `${s.mtimeMs}-${s.size}`;
  } catch {
    // Missing: the import below fails and says so.
  }
  const key = `${path}?v=${version}`;
  let loading = modules.get(key);
  if (loading === undefined) {
    loading = import(`${pathToFileURL(path).href}?v=${version}`).then((m: { default?: unknown }) => {
      if (!isRecord(m.default)) throw new PluginRefused(`plugin ${plugin.name}'s module ${path} has no default export of its adapter or verify`);
      refuseModuleSyntax(plugin, m.default);
      return m.default as PluginModule;
    });
    // A failed import is never kept: the next ask tries again, so a fixed module is read once it is fixed.
    loading.catch(() => {
      if (modules.get(key) === loading) modules.delete(key);
    });
    modules.set(key, loading);
  }
  return loading;
}

const load = createRequire(import.meta.url);

/**
 * The plugin's module, loaded synchronously: what a question that cannot
 * wait (an adapter's ladder or test filter, the core's own adapters) is
 * answered from. Node keeps a module it loaded for the process's life and
 * loads again one that failed, so a fixed module is read once it is fixed;
 * an edited one reaches a long-lived process through the warm server's
 * fingerprint, which replaces the server.
 */
export function moduleSyncOf(plugin: LoadedPlugin): PluginModule {
  const module = plugin.manifest.module;
  if (module === undefined) throw new PluginRefused(`plugin ${plugin.name} has no module`);
  const path = resolve(plugin.dir, module);
  throughThisCore(plugin);
  const loaded = load(path) as { default?: unknown };
  if (!isRecord(loaded.default)) throw new PluginRefused(`plugin ${plugin.name}'s module ${path} has no default export of its adapter or verify`);
  refuseModuleSyntax(plugin, loaded.default);
  return loaded.default as PluginModule;
}

/**
 * A module written for pluginApi 1 exported its syntax tables as `syntax`;
 * this core reads a syntax slot only where plugin.json names it, so such an
 * export is refused by name at load rather than ignored.
 */
function refuseModuleSyntax(plugin: LoadedPlugin, module: Record<string, unknown>): void {
  if (module["syntax"] === undefined) return;
  throw new PluginRefused(`plugin ${plugin.name}'s module exports syntax, which this Coherence does not read: name each slot in plugin.json as "syntax": { "<slot>": "<module>#<export>" } (pluginApi 2)`);
}
