/**
 * coherence plugin check <plugin>: the abstract plugin spec
 * (plugins/Plugin.abstract.md) held against any plugin, bundled or by path,
 * over the small project its own check.json carries (the plugin's tests,
 * which an eject copies with it). Each bullet that holds for the plugin's
 * shape is a duty; one the plugin's own spec overrides, with why, is said
 * as overridden. A duty read from a slot is graded again with the plugin's
 * slot emptied (withSlotEmptied), and one that still holds over every check
 * project proves nothing of the plugin, and fails.
 *
 * Each duty passes, fails with why, is not run with why (the plugin's
 * language server is absent), or is overridden with why; only every one
 * passing or overridden is a pass. The plugin is held as a project would
 * run it: swapped in for its language over a scratch copy of the check
 * project.
 */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { LanguageAdapter } from "../adapters/adapter.ts";
import { detectEntranceCandidates } from "../adapters/entrance-candidates.ts";
import { declarationsOf, importsOf } from "../economy/source.ts";
import { DEFAULT_TEST_FOLDERS } from "../enforcement/config.ts";
import { parseLexicon } from "../lifecycle/lexicon.ts";
import { COHERENCE_LEXICON } from "../lifecycle/project.ts";
import { declares as declaresOf } from "../observation/interfaces.ts";
import { isTypeDeclaration } from "../readings/scope/component-interfaces.ts";
import { abstractBullets, holdsFor, overridesOf, type AbstractBullet } from "./abstract.ts";
import { clashText, composeStack, pluginLayers } from "./lexicon.ts";
import { performRun } from "../enforcement/run.ts";
import { bundledAdapter, bundledPlugins, forProject, languageOfFile, registerProjectPlugins, repeatedAnswers, syntaxOf, withSlotEmptied } from "./languages.ts";
import type { LoadedPlugin, SyntaxSlot } from "./plugin.ts";
import { BUNDLED_DIR, moduleSyncOf, readManifest } from "./registry.ts";
import { proveVia, viaForm } from "./verify.ts";

/** What a plugin's check.json holds: the project, and what the plugin must answer over it. */
export interface CheckProject {
  /** The project's files, by path from its root. */
  files: Record<string, string>;
  /** Files the language's file rule takes, and files it leaves to no language. */
  language: { files: string[]; not: string[] };
  /** Names a file's top level declares, and names it does not. */
  declarations: { file: string; name: string; declared: boolean }[];
  protects: string;
  chokepoint: string;
  /** Every reference to the protected thing, as file:line. */
  references: string[];
  /** The grade the check gives, and its bypasses as file:line. */
  grade: string;
  bypasses: string[];
  /** The source slot's reading: names a file declares at its top level, exported or not, and the file an import leads to. */
  source?: { declarations: { file: string; name: string; exported: boolean }[]; imports: { from: string; to: string }[] };
  /** The interfaces slot's reading: whether a declaration line is a type only, and the modules a file glob-imports. */
  interfaces?: { types: { line: string; type: boolean }[]; wildcards: { file: string; modules: string[] }[] };
  /** The declares slot's reading: what a declaration line can run. */
  declares?: { line: string; declares: string }[];
  /** The entrances the language's rules find, by file and symbol ("" for a file-grain entrance), and none besides. */
  entrances?: { file: string; symbol: string }[];
}

/** One duty's outcome. */
export interface Duty {
  /** An abstract bullet's name, or a verifier's one per form it declares, as a bullet writes it ("[quint run]"). */
  name: string;
  verdict: "pass" | "fail" | "not run" | "overridden";
  reason: string;
}

/** What plugin check found of a plugin. */
export interface PluginCheck {
  plugin: LoadedPlugin;
  language: string;
  duties: Duty[];
}

export const CHECK_FILE = "check.json";

/** The spec plugin check writes into its scratch project: the one chokepoint the project's check.json names. */
const CHECK_SPEC = "Check.spec.md";

function checkSpec(project: CheckProject): string {
  return `# Check\n\nThe project plugin check holds a language plugin to.\n\n## invariants\n- one way out: Every use of ${project.protects} goes through ${project.chokepoint}.\n  protects: ${project.protects}\n  chokepoint: ${project.chokepoint}\n  kinds: none\n`;
}

/** The plugin a name or path names: a bundled plugin by its name, else a folder from the root (or its plugin.json). */
export function pluginAt(root: string, given: string): LoadedPlugin {
  const bundled = join(BUNDLED_DIR, given);
  const asPath = isAbsolute(given) ? given : resolve(root, given);
  const dir = !given.includes("/") && existsSync(join(bundled, "plugin.json")) ? bundled : asPath.endsWith("plugin.json") ? dirname(asPath) : asPath;
  let name: unknown;
  try {
    name = (JSON.parse(readFileSync(join(dir, "plugin.json"), "utf8")) as { name?: unknown }).name;
  } catch {
    throw new Error(`plugin check: no plugin.json at ${dir}; name a bundled plugin or a plugin's folder`);
  }
  const read = readManifest(String(name), dir, `plugin check ${given}`);
  if (read.manifest === undefined) throw new Error(read.problems.join("; "));
  return { name: read.manifest.name, version: read.manifest.version, dir, source: dir === bundled ? "bundled" : given, manifest: read.manifest };
}

/** Why a check.json is no check project, or undefined when it is one: each field it lacks or has in another shape, named. */
export function checkProjectProblem(value: unknown): string | undefined {
  const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
  const strings = (v: unknown): boolean => Array.isArray(v) && v.every((x) => typeof x === "string");
  if (!record(value)) return "it is not an object";
  const wrong: string[] = [];
  if (!record(value["files"]) || !Object.values(value["files"]).every((t) => typeof t === "string")) wrong.push("files, an object of file texts by path");
  const language = value["language"];
  if (!record(language) || !strings(language["files"]) || !strings(language["not"])) wrong.push('language, { "files": [...], "not": [...] }');
  if (!Array.isArray(value["declarations"]) || !value["declarations"].every((d) => record(d) && typeof d["file"] === "string" && typeof d["name"] === "string" && typeof d["declared"] === "boolean")) wrong.push('declarations, a list of { "file", "name", "declared" }');
  for (const key of ["protects", "chokepoint", "grade"] as const) if (typeof value[key] !== "string" || value[key] === "") wrong.push(`${key}, a name`);
  for (const key of ["references", "bypasses"] as const) if (!strings(value[key])) wrong.push(`${key}, a list of file:line`);
  const list = (v: unknown, keys: Record<string, string>): boolean => Array.isArray(v) && v.every((x) => record(x) && Object.entries(keys).every(([k, t]) => (t === "strings" ? strings(x[k]) : typeof x[k] === t)));
  const source = value["source"];
  if (source !== undefined && (!record(source) || !list(source["declarations"], { file: "string", name: "string", exported: "boolean" }) || !list(source["imports"], { from: "string", to: "string" })))
    wrong.push('source, { "declarations": [{ "file", "name", "exported" }], "imports": [{ "from", "to" }] }');
  const interfaces = value["interfaces"];
  if (interfaces !== undefined && (!record(interfaces) || !list(interfaces["types"], { line: "string", type: "boolean" }) || !list(interfaces["wildcards"], { file: "string", modules: "strings" })))
    wrong.push('interfaces, { "types": [{ "line", "type" }], "wildcards": [{ "file", "modules" }] }');
  if (value["declares"] !== undefined && !list(value["declares"], { line: "string", declares: "string" })) wrong.push('declares, a list of { "line", "declares" }');
  if (value["entrances"] !== undefined && !list(value["entrances"], { file: "string", symbol: "string" })) wrong.push('entrances, a list of { "file", "symbol" }');
  return wrong.length === 0 ? undefined : `it lacks ${wrong.join("; ")}`;
}

/** The abstract bullets graded over a language's check projects, in the order they run there. */
export const LANGUAGE_DUTIES = ["file rule", "declarations", "source", "interfaces", "declares", "entrances", "references", "chokepoint"] as const;
type LanguageDuty = (typeof LANGUAGE_DUTIES)[number];

/** The bullets graded again with a slot emptied: each one's slot, or the file rule's own empty answer. */
export const EMPTIED: Partial<Record<LanguageDuty, SyntaxSlot | "files">> = { "file rule": "files", declarations: "topLevel", source: "source", interfaces: "interfaces", declares: "declares", entrances: "entrances" };

/** Every duty plugin check runs, by the abstract bullet it grades: what the abstract spec's own test holds its bullets to. */
export const DUTY_NAMES: readonly string[] = [...LANGUAGE_DUTIES, "one answer each", "verifier forms", "lexicon"];

/** The check projects a plugin is held over: the minimum (the bundled plugin's check.json for its language, as the installed package ships it, which no copy edits) and, when it adds to that, the plugin's own. */
function checkProjects(plugin: LoadedPlugin, language: string): { label: string; project: CheckProject }[] | { refusal: string } {
  const read = (file: string, label: string): CheckProject | string => {
    let value: unknown;
    try {
      value = JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
      return `${label} ${file} will not read: ${error instanceof Error ? error.message : String(error)}`;
    }
    const problem = checkProjectProblem(value);
    return problem === undefined ? (value as CheckProject) : `${label} ${file} is no check project: ${problem}`;
  };
  const projects: { label: string; project: CheckProject; text: string }[] = [];
  const bundled = bundledProviderOf(language);
  const minimum = bundled === undefined ? undefined : join(bundled.dir, CHECK_FILE);
  if (minimum !== undefined && existsSync(minimum)) {
    const project = read(minimum, "the bundled minimum");
    if (typeof project === "string") return { refusal: project };
    projects.push({ label: "the bundled minimum", project, text: JSON.stringify(project) });
  }
  const own = join(plugin.dir, CHECK_FILE);
  if (existsSync(own)) {
    const project = read(own, `plugin ${plugin.name}'s`);
    if (typeof project === "string") return { refusal: project };
    // A copy's check.json that is still the bundled one adds nothing; one that differs is held besides the minimum, never in its place.
    if (!projects.some((p) => p.text === JSON.stringify(project))) projects.push({ label: `plugin ${plugin.name}'s own`, project, text: JSON.stringify(project) });
  }
  if (projects.length === 0) return { refusal: `plugin ${plugin.name} carries no ${CHECK_FILE}, and no bundled plugin's check project stands for ${language}: nothing to check` };
  return projects;
}

/** The bundled plugin that provides a language, a default or one a project opts into (Go): its check.json is the minimum for the language. */
function bundledProviderOf(language: string): LoadedPlugin | undefined {
  const found = bundledPlugins().find((p) => p.manifest.provides?.language === language);
  if (found !== undefined) return found;
  for (const name of readdirSync(BUNDLED_DIR).sort()) {
    const dir = join(BUNDLED_DIR, name);
    if (!existsSync(join(dir, "plugin.json"))) continue;
    const { manifest } = readManifest(name, dir, `bundled plugin ${name}`);
    if (manifest?.provides?.language === language) return { name, version: manifest.version, dir, source: "bundled", manifest };
  }
  return undefined;
}

const CONFIG = "coherence.config.json";

/** The scratch project's config: its check.json's own, if it carries one, naming the language and, unless it is a bundled default, the plugin. */
function checkConfig(project: CheckProject, plugin: LoadedPlugin, language: string): Record<string, unknown> {
  const own = project.files[CONFIG];
  const config = own === undefined ? {} : (JSON.parse(own) as Record<string, unknown>);
  const plugins = { ...((config["plugins"] as Record<string, string> | undefined) ?? {}), ...(isDefault(plugin) ? {} : { [plugin.name]: plugin.source === "bundled" ? "bundled" : plugin.dir }) };
  return { ...config, language: config["language"] ?? language, ...(Object.keys(plugins).length === 0 ? {} : { plugins }) };
}

/** Whether a plugin is one of the bundled defaults every project runs, rather than one a project names (an opt-in bundled plugin, or one by path). */
function isDefault(plugin: LoadedPlugin): boolean {
  return plugin.source === "bundled" && bundledPlugins().some((p) => p.name === plugin.name);
}

/**
 * Hold a plugin to every bullet of the abstract spec its shape calls for:
 * a language's, when it provides or extends one (Convex over TypeScript),
 * over each check project; a verifier's, one per via form it declares, over
 * its check.json's proofs; its lexicon layer's against Coherence's. A bullet
 * the plugin's own spec overrides is said with why, never graded. A plugin
 * no bullet holds for is refused.
 */
export async function checkPlugin(root: string, given: string, options: { only?: readonly string[] } = {}): Promise<PluginCheck> {
  const plugin = pluginAt(root, given);
  // A plugin that extends a language without providing it is held to that language's duties, as the adapter it wraps is.
  const language = plugin.manifest.provides?.language ?? plugin.manifest.extends;
  const verifies = (plugin.manifest.verifiers ?? []).length > 0;
  // `only` narrows the check to the bullets named (the text readings, which need no language server), never widens it.
  const held = abstractBullets().filter((b) => holdsFor(b, plugin) && (options.only === undefined || options.only.includes(b.name)));
  if (language === undefined && !verifies) throw new Error(`plugin check: plugin ${plugin.name} neither provides nor extends a language nor proves a via form, so it owes no duty plugin check holds`);
  const overrides = overridesOf(plugin);
  const graded = new Set(held.filter((b) => !overrides.has(b.name)).map((b) => b.name));
  const duties = new Map<string, Duty[]>();
  for (const bullet of held) {
    const override = overrides.get(bullet.name);
    if (override !== undefined) duties.set(bullet.name, [{ name: bullet.name, verdict: "overridden", reason: `${override.instead}; because ${override.because}` }]);
  }
  const wanted = LANGUAGE_DUTIES.filter((name) => graded.has(name));
  if (language !== undefined && wanted.length > 0) for (const duty of await languageDutiesOf(plugin, language, wanted)) duties.set(duty.name, [duty]);
  if (graded.has("one answer each")) duties.set("one answer each", [await guarded("one answer each", () => oneAnswerEach(plugin))]);
  if (graded.has("verifier forms")) duties.set("verifier forms", await verifierDutiesOf(plugin));
  if (graded.has("lexicon")) duties.set("lexicon", [await guarded("lexicon", () => lexiconLayer(plugin))]);
  // In the abstract spec's order, so every plugin's report reads alike.
  const ordered = held.flatMap((b: AbstractBullet) => duties.get(b.name) ?? []);
  return { plugin, language: language === undefined ? "verifier" : verifies ? `${language} + verifier` : language, duties: ordered };
}

/** Whether the plugin's lexicon layer reads and takes no name Coherence's own lexicon holds. */
function lexiconLayer(plugin: LoadedPlugin): Duty {
  const own = parseLexicon(JSON.parse(readFileSync(COHERENCE_LEXICON, "utf8")), COHERENCE_LEXICON);
  const layers = pluginLayers([plugin]);
  const concepts = layers[0]?.lexicon.concepts.length ?? 0;
  const { clashes } = composeStack(own, layers);
  return clashes.length === 0 ? { name: "lexicon", verdict: "pass", reason: `${concepts} concepts, none taking a name Coherence's lexicon holds` } : { name: "lexicon", verdict: "fail", reason: clashes.map(clashText).join("; ") };
}

/** One duty over one check project, and its verdict with the plugin's slot emptied, when it was graded again. */
type Graded = Duty & { emptied?: Duty };

/**
 * A language plugin's duties over each check project, the worst outcome of
 * each standing; a duty graded again with the plugin's slot emptied that
 * holds that way over every project proves nothing of the plugin, and fails.
 */
async function languageDutiesOf(plugin: LoadedPlugin, language: string, wanted: readonly LanguageDuty[]): Promise<Duty[]> {
  const projects = checkProjects(plugin, language);
  if ("refusal" in projects) return wanted.map((name) => ({ name, verdict: "fail", reason: projects.refusal }));
  const each: Graded[][] = [];
  for (const { label, project } of projects) each.push((await overProject(project, plugin, language, wanted)).map((d) => ({ ...d, reason: `${label}: ${d.reason}` })));
  // A duty passes only where it passes over every project; the worst outcome stands, with each project's reason.
  const rank = { pass: 0, overridden: 0, "not run": 1, fail: 2 } as const;
  return wanted.map((name): Duty => {
    const found = each.map((duties) => duties.find((d) => d.name === name)!);
    const worst = found.reduce((a, b) => (rank[b.verdict] > rank[a.verdict] ? b : a));
    const reason = found.map((d) => d.reason).join("; ");
    if (worst.verdict !== "pass" || EMPTIED[name] === undefined) return { name, verdict: worst.verdict, reason };
    // The emptied reading must fail over some project: the plugin's own, where the bundled minimum asks nothing it alone answers.
    if (found.some((d) => d.emptied !== undefined && d.emptied.verdict !== "pass")) return { name, verdict: "pass", reason: `${reason}; with the plugin's ${EMPTIED[name]} emptied it fails` };
    return { name, verdict: "fail", reason: `holds with the plugin's ${EMPTIED[name]} emptied too, so check.json asks nothing the plugin alone answers: add to its ${name} what only the plugin's reading gets right (${reason})` };
  });
}

/** Whether each of the plugin's answers is given by one slot alone (repeatedAnswers). */
function oneAnswerEach(plugin: LoadedPlugin): Duty {
  const repeated = repeatedAnswers(plugin);
  return repeated.length === 0 ? { name: "one answer each", verdict: "pass", reason: "no two slots give one answer" } : { name: "one answer each", verdict: "fail", reason: `${repeated.join("; ")}: keep the answer in one slot (the kept answers read interfaces.wildcardModules, so a kept slot that repeats it goes)` };
}

/** A duty's outcome, or the duty failed with what it threw: one duty that throws never takes the others' outcomes with it. */
async function guarded(name: Duty["name"], run: () => Duty | Promise<Duty>): Promise<Duty> {
  try {
    return await run();
  } catch (error) {
    return { name, verdict: "fail", reason: `threw: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Every wanted duty over one check project, in a scratch copy, the plugin in its language's place for it alone. */
async function overProject(project: CheckProject, plugin: LoadedPlugin, language: string, wanted: readonly LanguageDuty[]): Promise<Graded[]> {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "coherence-plugin-check-")));
  try {
    for (const [path, text] of Object.entries(project.files)) {
      mkdirSync(dirname(join(scratch, path)), { recursive: true });
      writeFileSync(join(scratch, path), text);
    }
    // The config a project that runs the plugin writes, so every reading of the scratch project (the run's own read of it among them)
    // registers the plugin as the project's, never the bundled defaults alone.
    writeFileSync(join(scratch, CONFIG), JSON.stringify(checkConfig(project, plugin, language), null, 2) + "\n");
    registerProjectPlugins(scratch, isDefault(plugin) ? [] : [plugin]);
    return await forProject(scratch, async () => {
      const graded: Graded[] = [];
      for (const name of wanted) {
        const read = TEXT_DUTIES[name];
        if (read === undefined) continue;
        const duty = await guarded(name, () => read(project, scratch, language, languageOfFile));
        const slot = EMPTIED[name];
        if (duty.verdict !== "pass" || slot === undefined) {
          graded.push(duty);
          continue;
        }
        const emptied = await guarded(name, () => (slot === "files" ? read(project, scratch, language, () => undefined) : withSlotEmptied(plugin, slot, () => read(project, scratch, language, languageOfFile))));
        graded.push({ ...duty, emptied });
      }
      if (wanted.includes("references") || wanted.includes("chokepoint")) graded.push(...(await instrument(scratch, project, plugin, language)).filter((d) => wanted.includes(d.name as LanguageDuty)));
      return graded;
    });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Which language a project file is read as: the registry's answer, or none, for the file rule graded with its rule emptied. */
type LanguageOf = (file: string) => string | undefined;

/** The duties read from text alone, each a reading of the core asked over the check project, so the plugin is held to what the readings make of its answers. */
const TEXT_DUTIES: Partial<Record<LanguageDuty, (project: CheckProject, scratch: string, language: string, languageOf: LanguageOf) => Duty>> = {
  "file rule": (project, _scratch, language, languageOf) => fileRule(project, language, languageOf),
  declarations: (project, _scratch, language) => declarations(project, language),
  source: (project, scratch, language) => {
    const expected = project.source;
    if (expected === undefined || expected.declarations.length + expected.imports.length === 0) return { name: "source", verdict: "fail", reason: 'nothing to check: check.json names no source, { "declarations": [...], "imports": [...] }' };
    const wrong = [
      ...expected.declarations.flatMap((d) => {
        const found = declarationsOf(project.files[d.file] ?? "", language).find((f) => f.name === d.name);
        return found === undefined ? [`${d.name} in ${d.file} not read as declared`] : found.exported !== d.exported ? [`${d.name} in ${d.file} read as ${found.exported ? "exported" : "not exported"}`] : [];
      }),
      ...expected.imports.flatMap((i) => (importsOf(scratch, i.from, project.files[i.from] ?? "", language).some((found) => found.module === i.to) ? [] : [`${i.from}'s imports lead to no ${i.to}`])),
    ];
    return wrong.length === 0 ? { name: "source", verdict: "pass", reason: `${expected.declarations.length} declarations and ${expected.imports.length} imports read as expected` } : { name: "source", verdict: "fail", reason: wrong.join("; ") };
  },
  interfaces: (project, _scratch, language) => {
    const expected = project.interfaces;
    if (expected === undefined || expected.types.length + expected.wildcards.length === 0) return { name: "interfaces", verdict: "fail", reason: 'nothing to check: check.json names no interfaces, { "types": [...], "wildcards": [...] }' };
    const wildcard = syntaxOf(language, "interfaces")?.wildcardModules;
    const wrong = [
      ...expected.types.filter((t) => isTypeDeclaration(t.line, language) !== t.type).map((t) => `"${t.line}" read as ${t.type ? "no type" : "a type"}`),
      ...expected.wildcards.flatMap((w) => {
        const found = wildcard?.(w.file, project.files[w.file] ?? "") ?? [];
        const missed = w.modules.filter((m) => !found.includes(m));
        return missed.length === 0 ? [] : [`${w.file} glob-imports ${missed.join(", ")}, read as ${found.join(", ") || "none"}`];
      }),
    ];
    return wrong.length === 0 ? { name: "interfaces", verdict: "pass", reason: `${expected.types.length} declaration lines and ${expected.wildcards.length} glob imports read as expected` } : { name: "interfaces", verdict: "fail", reason: wrong.join("; ") };
  },
  declares: (project, _scratch, language) => {
    const expected = project.declares ?? [];
    if (expected.length === 0) return { name: "declares", verdict: "fail", reason: 'nothing to check: check.json names no declares, [{ "line", "declares" }]' };
    const wrong = expected.flatMap((d) => {
      const found = declaresOf(d.line, language);
      return found === d.declares ? [] : [`"${d.line}" read as ${found}, not ${d.declares}`];
    });
    return wrong.length === 0 ? { name: "declares", verdict: "pass", reason: `${expected.length} of ${expected.length} lines read as expected` } : { name: "declares", verdict: "fail", reason: wrong.join("; ") };
  },
  entrances: (project, scratch, language) => {
    const expected = project.entrances;
    if (expected === undefined) return { name: "entrances", verdict: "fail", reason: 'nothing to check: check.json names no entrances, [{ "file", "symbol" }]' };
    const found = detectEntranceCandidates(scratch, { language, files: Object.keys(project.files).filter((f) => f !== CONFIG), wrappers: [], testFolders: [...DEFAULT_TEST_FOLDERS] }).map((c) => `${c.file}#${c.symbol}`);
    const want = expected.map((e) => `${e.file}#${e.symbol}`);
    if (want.length === 0) return { name: "entrances", verdict: "fail", reason: "nothing to check: check.json expects no entrance" };
    const missed = want.filter((w) => !found.includes(w));
    const extra = found.filter((f) => !want.includes(f));
    return missed.length + extra.length === 0 ? { name: "entrances", verdict: "pass", reason: `${found.length} of ${want.length} entrances found` } : { name: "entrances", verdict: "fail", reason: [missed.length > 0 ? `missed ${missed.join(", ")}` : "", extra.length > 0 ? `found ${extra.join(", ")}, which check.json does not expect` : ""].filter((x) => x !== "").join("; ") };
  },
};

function fileRule(project: CheckProject, language: string, languageOf: LanguageOf): Duty {
  const all = project.language.files.length + project.language.not.length;
  if (all === 0) return { name: "file rule", verdict: "fail", reason: "nothing to check: the check project names no file for the rule to take or leave" };
  const wrong = [
    ...project.language.files.filter((f) => languageOf(f) !== language).map((f) => `${f} is not read as ${language}`),
    ...project.language.not.filter((f) => languageOf(f) === language).map((f) => `${f} is read as ${language}`),
  ];
  return wrong.length === 0 ? { name: "file rule", verdict: "pass", reason: `${all} of ${all} files read as expected` } : { name: "file rule", verdict: "fail", reason: wrong.join("; ") };
}

function declarations(project: CheckProject, language: string): Duty {
  if (project.declarations.length === 0) return { name: "declarations", verdict: "fail", reason: "nothing to check: the check project names no declaration" };
  const topLevel = syntaxOf(language, "topLevel");
  if (topLevel === undefined) return { name: "declarations", verdict: "fail", reason: `no topLevel slot says what a ${language} file declares` };
  const wrong = project.declarations.filter((d) => topLevel(project.files[d.file] ?? "", d.name) !== d.declared).map((d) => `${d.name} in ${d.file} read as ${d.declared ? "not declared" : "declared"}`);
  return wrong.length === 0 ? { name: "declarations", verdict: "pass", reason: `${project.declarations.length} of ${project.declarations.length} read as expected` } : { name: "declarations", verdict: "fail", reason: wrong.join("; ") };
}

/** The plugin's adapter over the scratch project: its module's factory, handed the bundled adapter of the language it extends, which the check closes as the core does. */
function adapterOf(scratch: string, plugin: LoadedPlugin, language: string): { adapter: LanguageAdapter; base: LanguageAdapter | undefined } {
  if (isDefault(plugin)) return { adapter: bundledAdapter(language, scratch)!, base: undefined };
  const module = moduleSyncOf(plugin);
  if (typeof module.adapter !== "function") throw new Error(`plugin ${plugin.name}'s module exports no adapter factory`);
  const base = plugin.manifest.extends === undefined ? undefined : bundledAdapter(plugin.manifest.extends, scratch);
  return { adapter: module.adapter({ root: scratch, language, ...(base === undefined ? {} : { base }) }), base };
}

async function instrument(scratch: string, project: CheckProject, plugin: LoadedPlugin, language: string): Promise<Duty[]> {
  let adapter: LanguageAdapter;
  let base: LanguageAdapter | undefined;
  try {
    ({ adapter, base } = adapterOf(scratch, plugin, language));
  } catch (error) {
    const reason = `the plugin's adapter could not be built: ${error instanceof Error ? error.message : String(error)}`;
    return [{ name: "references", verdict: "fail", reason }, { name: "chokepoint", verdict: "fail", reason }];
  }
  try {
    const ready = await adapter.ready().catch((error: unknown) => ({ ok: false as const, reason: `ready() threw: ${error instanceof Error ? error.message : String(error)}` }));
    if (!ready.ok) return [{ name: "references", verdict: "not run", reason: ready.reason }, { name: "chokepoint", verdict: "not run", reason: ready.reason }];
    const hint = { component: ".", testFolders: [...DEFAULT_TEST_FOLDERS] };
    const references = await guarded("references", async (): Promise<Duty> => {
      if (project.references.length === 0) return { name: "references", verdict: "fail", reason: `nothing to check: the check project names no reference to ${project.protects}` };
      const resolved = await adapter.resolve(project.protects, hint);
      if (!resolved.ok) return { name: "references", verdict: "fail", reason: `${project.protects} does not resolve: ${resolved.reason}` };
      const sites = (await adapter.references(resolved.definition)).map((s) => `${s.file}:${s.line}`);
      const found = new Set(sites);
      const missed = project.references.filter((r) => !found.has(r));
      const extra = [...found].filter((s) => !project.references.includes(s));
      if (sites.length === 0) return { name: "references", verdict: "fail", reason: `reports no references to ${project.protects}; ${project.references.length} exist (${project.references.join(", ")})` };
      if (missed.length > 0 || extra.length > 0) return { name: "references", verdict: "fail", reason: [missed.length > 0 ? `missed ${missed.join(", ")}` : "", extra.length > 0 ? `reported ${extra.join(", ")}, which is none` : ""].filter((s) => s !== "").join("; ") };
      return { name: "references", verdict: "pass", reason: `${sites.length} of ${project.references.length} references to ${project.protects}` };
    });
    const chokepoint = await guarded("chokepoint", async (): Promise<Duty> => {
      // Graded as a project's run grades it, through performRun, the one door every chokepoint verdict takes (its refutation always attempted).
      writeFileSync(join(scratch, CHECK_SPEC), checkSpec(project));
      const run = await performRun(scratch, { session: "plugin-check", agent: "plugin-check", form: "chokepoint", adapter, server: false });
      const graded = run.record.invariants.find((e) => e.form === "chokepoint");
      if (graded === undefined) return { name: "chokepoint", verdict: "fail", reason: `the run graded no chokepoint: ${run.instrumentReason ?? "no entry recorded"}` };
      const bypasses = (graded.bypasses ?? []).map((b) => `${b.file}:${b.line}`).sort();
      const expected = [...project.bypasses].sort();
      const wrong = [
        graded.grade !== project.grade ? `graded ${graded.grade ?? "nothing"}, not ${project.grade} (${graded.reason})` : "",
        JSON.stringify(bypasses) !== JSON.stringify(expected) ? `bypasses ${bypasses.join(", ") || "none"}, not ${expected.join(", ") || "none"}` : "",
        graded.refutation === "missing" ? `its refutation is missing: ${graded.reason}` : "",
      ].filter((s) => s !== "");
      return wrong.length === 0 ? { name: "chokepoint", verdict: "pass", reason: `${project.protects} through ${project.chokepoint} graded ${graded.grade}, refutation ${graded.refutation}` } : { name: "chokepoint", verdict: "fail", reason: wrong.join("; ") };
    });
    return [references, chokepoint];
  } finally {
    try {
      await adapter.close();
    } finally {
      await base?.close();
    }
  }
}

/** One proof a verifier's check.json expects: a via as a bullet writes it, from a folder of the check project, and the verdict it must read. */
export interface ExpectedProof {
  via: string;
  /** The bullet's folder, project-relative; "." when absent. */
  component?: string;
  verdict: Duty["verdict"];
  /** A regular expression the verdict's reason must match. */
  reason?: string;
  /** Environment set while this proof runs alone (a binary named away to show what its absence reads as). */
  env?: Record<string, string>;
}

/** What a verifier plugin's check.json holds: the project, and the proofs over it with the verdicts each must read. */
export interface VerifierCheckProject {
  files: Record<string, string>;
  proofs: ExpectedProof[];
}

function verifierProjectProblem(value: unknown): string | undefined {
  const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
  if (!record(value)) return "it is not an object";
  const wrong: string[] = [];
  if (!record(value["files"]) || !Object.values(value["files"]).every((t) => typeof t === "string")) wrong.push("files, an object of file texts by path");
  const proofs = value["proofs"];
  if (!Array.isArray(proofs) || !proofs.every((p) => record(p) && typeof p["via"] === "string" && ["pass", "fail", "not run"].includes(String(p["verdict"])) && (p["reason"] === undefined || typeof p["reason"] === "string") && (p["component"] === undefined || typeof p["component"] === "string") && (p["env"] === undefined || (record(p["env"]) && Object.values(p["env"]).every((v) => typeof v === "string")))))
    wrong.push('proofs, a list of { "via", "verdict": "pass" | "fail" | "not run", "reason"?, "component"?, "env"? }');
  return wrong.length === 0 ? undefined : `it lacks ${wrong.join("; ")}`;
}

/**
 * A verifier plugin held to its own check project: one duty per form it
 * declares, each proof of that form proved as a run proves a bullet, over a
 * scratch copy. A proof that reads what check.json expects is kept; one that
 * reads otherwise fails the duty, except that a proof expected to pass or
 * fail which could not run leaves the duty not run, with why (the tool
 * absent here), never a pass. A form with no proof fails as nothing to check.
 */
async function verifierDutiesOf(plugin: LoadedPlugin): Promise<Duty[]> {
  const forms = (plugin.manifest.verifiers ?? []).map((v) => v.form);
  const file = join(plugin.dir, CHECK_FILE);
  const refuse = (reason: string): Duty[] => forms.map((form) => ({ name: `[${form}]` as const, verdict: "fail" as const, reason }));
  if (!existsSync(file)) return refuse(`plugin ${plugin.name} carries no ${CHECK_FILE}: nothing to check`);
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    return refuse(`plugin ${plugin.name}'s ${file} will not read: ${error instanceof Error ? error.message : String(error)}`);
  }
  const problem = verifierProjectProblem(value);
  if (problem !== undefined) return refuse(`plugin ${plugin.name}'s ${file} is no verifier's check project: ${problem}`);
  const project = value as VerifierCheckProject;
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "coherence-plugin-check-")));
  try {
    for (const [path, text] of Object.entries(project.files)) {
      mkdirSync(dirname(join(scratch, path)), { recursive: true });
      writeFileSync(join(scratch, path), text);
    }
    const duties: Duty[] = [];
    for (const form of forms) {
      const name = `[${form}]` as const;
      const proofs = project.proofs.filter((p) => viaForm(p.via)?.form === form);
      if (proofs.length === 0) {
        duties.push({ name, verdict: "fail", reason: `nothing to check: the check project proves nothing by [${form}]` });
        continue;
      }
      // A form proved only ever to pass would pass a verifier that never fails: its check project must refute a false name too.
      if (!proofs.some((p) => p.verdict === "pass") || !proofs.some((p) => p.verdict === "fail")) {
        duties.push({ name, verdict: "fail", reason: `the check project must prove a name by [${form}] that holds and one that does not; it expects ${[...new Set(proofs.map((p) => p.verdict))].join(" and ")} only` });
        continue;
      }
      const wrong: string[] = [];
      const unrun: string[] = [];
      for (const proof of proofs) {
        const read = await guarded(name, async () => {
          const outcome = await withEnv(proof.env, () => proveVia(scratch, [plugin], proof.via, CHECK_PROOF_MS, proof.component ?? "."));
          return { name, verdict: outcome.verdict, reason: outcome.reason };
        });
        const said = `${proof.via} read ${read.verdict}: ${read.reason}`;
        if (read.verdict === proof.verdict && (proof.reason === undefined || new RegExp(proof.reason).test(read.reason))) continue;
        if (read.verdict === "not run" && proof.verdict !== "not run") unrun.push(said);
        else wrong.push(`${said}; expected ${proof.verdict}${proof.reason === undefined ? "" : ` matching /${proof.reason}/`}`);
      }
      if (wrong.length > 0) duties.push({ name, verdict: "fail", reason: wrong.join("; ") });
      else if (unrun.length > 0) duties.push({ name, verdict: "not run", reason: unrun.join("; ") });
      else duties.push({ name, verdict: "pass", reason: `${proofs.length} of ${proofs.length} proofs read as expected` });
    }
    return duties;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** How long one proof of a verifier's check project may take. */
const CHECK_PROOF_MS = 120_000;

/** Run `work` with the environment's named values set, every one restored after. */
async function withEnv<T>(env: Record<string, string> | undefined, work: () => Promise<T>): Promise<T> {
  if (env === undefined) return work();
  const before = new Map(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  try {
    return await work();
  } finally {
    for (const [key, value] of before) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/** The report plugin check prints: the plugin, then one line per duty; a check with no fail but a duty not run says so rather than pass. */
export function checkText(check: PluginCheck): string {
  const passed = check.duties.every((o) => o.verdict === "pass" || o.verdict === "overridden");
  const failed = check.duties.some((o) => o.verdict === "fail");
  return [
    `plugin check ${check.plugin.name} (${check.plugin.source}, ${check.language}, ${check.plugin.version}): ${passed ? "pass" : failed ? "FAIL" : "NOT RUN"}`,
    ...check.duties.map((o) => `  ${o.verdict.padEnd(10)} ${o.name}: ${o.reason}`),
  ].join("\n");
}
