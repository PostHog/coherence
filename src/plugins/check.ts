/**
 * coherence plugin check <plugin>: the behaviour every language plugin owes,
 * held against any plugin, bundled or by path, over the small project its
 * own check.json carries (the plugin's tests, which an eject copies with it).
 *
 *   file rule      the files check.json names as the language's are, and
 *                  those it names as not are not
 *   declarations   the topLevel slot says which names a file's top level
 *                  declares
 *   references     the adapter reports every reference to the protected
 *                  thing, and none else; a plugin that reports none fails
 *                  here, by name
 *   reference reading  the readings recover, over the check project, every
 *                  relation of the reference project (REFERENCE) its map
 *                  places there, as every language's plugin must
 *   server agrees  every name the text reading finds a file declaring is a
 *                  top-level symbol the language server reports for it
 *   chokepoint     the check grades the protected thing through the
 *                  chokepoint as check.json expects, bypasses named, its
 *                  refutation seen or refused, never missing
 *   answers agree  where two of its slots answer one question of the same
 *                  text (a declaration, a renamed import), their answers
 *                  agree over every file of the check project
 *   one answer each  no two of its slots answer with one function, or two
 *                  spelled alike: a question asked of the language belongs
 *                  to one slot, or its answers drift apart
 *
 * and the readings that scan the language's text, each run as a project's
 * reading runs, through the core, and held to the answers check.json's
 * readings name, exactly (d-6569dec0: no plugin waives a reading):
 *
 *   mass           mass reads the language, counts every file, and finds
 *                  in each the names it declares
 *   imports        the source scan reads every import that resolves to a
 *                  project file, the economy's closure walks
 *   interfaces     the component interface reading finds the symbols one
 *                  component uses of another
 *   entrances      entrance detection finds every entrance, and none else
 *
 * A slot whose answer is only its type (a scan that reads nothing) fails
 * these, as does a plugin that leaves the slot empty: success for a slot is
 * what the readings that consume it recover.
 *
 * Each duty passes, fails with why, or is not run with why (the
 * plugin's language server is absent); only every one passing is a pass.
 * The plugin is held as a project would run it: swapped in for its language
 * over a scratch copy of the check project.
 */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { LanguageAdapter } from "../adapters/adapter.ts";
import { computeMass } from "../economy/mass.ts";
import { declarationsOf, importsOf, isSourceFile } from "../economy/source.ts";
import { DEFAULT_TEST_FOLDERS } from "../enforcement/config.ts";
import { performRun } from "../enforcement/run.ts";
import { detectedEntrances, readComponentInterfaces } from "../readings/scope/component-interfaces.ts";
import { bundledAdapter, bundledPlugins, forProject, languageOfFile, registerProjectPlugins, repeatedAnswers, syntaxOf } from "./languages.ts";
import { DUTY_SINCE, PLUGIN_API_CHANGES, type LoadedPlugin } from "./plugin.ts";
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
  /** What each reading that scans the language's text must recover over the project; the bundled minimum for a language carries it. */
  readings?: Readings;
  /** Which of the project's files and names play each part of the reference project every language plugin is held to read alike (REFERENCE). */
  reference?: ReferenceMap;
}

/** A check project's map onto the reference project: the file playing each role, and the language's spelling of each name. */
export interface ReferenceMap {
  files: Record<ReferenceRole, string>;
  names: Record<ReferenceName, string>;
}

/**
 * The reference project, the same in every language: a store module of two
 * files (secrets declaring SECRET_COLUMNS and seal, rows declaring Row), a
 * render that uses all three, and an entry (main) that uses render. Every
 * language plugin's check project maps its files and names onto these, and
 * its readings must recover the same relations, so two plugins cannot read
 * the same shape of project two ways: four plugins picked the file a module
 * import reaches four ways, and each missed one of a two-file module's files
 * (d-cb7829df).
 */
export const REFERENCE_ROLES = ["secrets", "rows", "render", "main"] as const;
export type ReferenceRole = (typeof REFERENCE_ROLES)[number];
export const REFERENCE_NAMES = ["SECRET_COLUMNS", "seal", "Row", "render"] as const;
export type ReferenceName = (typeof REFERENCE_NAMES)[number];
const REFERENCE: { declared: [ReferenceRole, ReferenceName[]][]; imports: [ReferenceRole, ReferenceRole, ReferenceName[]][] } = {
  declared: [
    ["secrets", ["SECRET_COLUMNS", "seal"]],
    ["rows", ["Row"]],
    ["render", ["render"]],
  ],
  imports: [
    ["render", "secrets", ["SECRET_COLUMNS", "seal"]],
    ["render", "rows", ["Row"]],
    ["main", "render", ["render"]],
  ],
};

/** Each relation of the reference project a language's readings recover over its check project, said as one line, and each it does not, with why. */
export function referenceRelations(scratch: string, project: CheckProject, map: ReferenceMap, language: string): { held: string[]; missed: string[] } {
  const held: string[] = [];
  const missed: string[] = [];
  const name = (n: ReferenceName): string => map.names[n];
  for (const [role, names] of REFERENCE.declared) {
    const file = map.files[role];
    const found = new Set(declarationsOf(project.files[file] ?? "", language).map((d) => d.name));
    const line = `${role} declares ${names.join(", ")}`;
    const lacking = names.filter((n) => !found.has(name(n)));
    (lacking.length === 0 ? held : missed).push(lacking.length === 0 ? line : `${line}: ${file} read declaring no ${lacking.map(name).join(", ")}`);
  }
  for (const [from, to, names] of REFERENCE.imports) {
    const imports = importsOf(scratch, map.files[from], project.files[map.files[from]] ?? "", language).filter((i) => i.module === map.files[to]);
    const reached = new Set(imports.map((i) => i.name ?? "*"));
    const line = `${from} imports ${names.join(", ")} from ${to}`;
    // A name is reached when an import names it, or when a whole-module import joins the file and the importer spells the name:
    // a whole-module import alone reaches no name the importer never uses.
    const text = project.files[map.files[from]] ?? "";
    const spelled = (n: string): boolean => new RegExp(`(?<![\\w$])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w$])`).test(text);
    const lacking = names.filter((n) => !reached.has(name(n)) && !(reached.has("*") && spelled(name(n))));
    if (imports.length === 0) missed.push(`${line}: ${map.files[from]} read importing nothing from ${map.files[to]}`);
    else if (lacking.length > 0) missed.push(`${line}: ${map.files[from]} read importing no ${lacking.map(name).join(", ")} from ${map.files[to]}`);
    else held.push(line);
  }
  return { held, missed };
}

const UNMAPPED = "nothing to check: the check project maps none of its files onto the reference project (reference), so nothing holds this plugin to read it as every language does";

/** One language plugin's reading of the reference project: each relation held or missed, or why it was not read. */
export type ReferenceReading = { plugin: string; language: string; held: string[]; missed: string[] } | { plugin: string; language: string; notRead: string };

/**
 * coherence plugin compare: every language plugin's reading of the
 * reference project side by side, the bundled ones (opt-in among them) and
 * any the project's config names, each over the check project that maps it,
 * so a plugin that reads the same shape of project another way stands out.
 */
export async function compareReference(configured: readonly LoadedPlugin[] = []): Promise<ReferenceReading[]> {
  const bundled = readdirSync(BUNDLED_DIR)
    .sort()
    .flatMap((name): LoadedPlugin[] => {
      const dir = join(BUNDLED_DIR, name);
      if (!existsSync(join(dir, "plugin.json"))) return [];
      const { manifest } = readManifest(name, dir, `bundled plugin ${name}`);
      return manifest?.provides?.language === undefined ? [] : [{ name, version: manifest.version, dir, source: "bundled", manifest }];
    });
  const plugins = [...bundled, ...configured.filter((p) => p.manifest.provides?.language !== undefined && !bundled.some((b) => b.dir === p.dir))];
  const out: ReferenceReading[] = [];
  for (const plugin of plugins) {
    const language = plugin.manifest.provides!.language!;
    const projects = checkProjects(plugin, language);
    const mapped = "refusal" in projects ? undefined : [...projects].reverse().find((p) => p.project.reference !== undefined);
    if (mapped === undefined) {
      out.push({ plugin: plugin.name, language, notRead: "refusal" in projects ? projects.refusal : "no check project of it maps the reference project" });
      continue;
    }
    out.push({ plugin: plugin.name, language, ...(await inScratch(mapped.project, plugin, language, (scratch) => referenceRelations(scratch, mapped.project, mapped.project.reference!, language))) });
  }
  return out;
}

/** The comparison as the command prints it: each relation, and each plugin's mark for it. */
export function compareText(readings: readonly ReferenceReading[]): string {
  const read = readings.filter((r): r is Extract<ReferenceReading, { held: string[] }> => "held" in r);
  const relation = (line: string): string => line.split(": ")[0]!;
  const relations = [...new Set(read.flatMap((r) => [...r.held, ...r.missed].map(relation)))];
  const width = Math.max(...relations.map((r) => r.length), 10);
  const lines = [`the reference project, read by each language plugin over its check project`, `  ${"".padEnd(width)}  ${read.map((r) => r.plugin).join("  ")}`];
  for (const rel of relations) lines.push(`  ${rel.padEnd(width)}  ${read.map((r) => (r.held.includes(rel) ? "yes" : r.missed.some((m) => relation(m) === rel) ? "NO" : "-").padEnd(r.plugin.length)).join("  ")}`);
  for (const r of read) for (const m of r.missed) lines.push(`DIVERGES  ${r.plugin} (${r.language}): ${m}`);
  for (const r of readings) if ("notRead" in r) lines.push(`not read: ${r.plugin} (${r.language}): ${r.notRead}`);
  return lines.join("\n");
}

/** A scratch copy of a check project with the plugin in its language's place, the work run for it, and the copy gone after. */
export async function inScratch<T>(project: CheckProject, plugin: LoadedPlugin, language: string, work: (scratch: string) => T | Promise<T>): Promise<T> {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "coherence-plugin-check-")));
  try {
    for (const [path, text] of Object.entries(project.files)) {
      mkdirSync(dirname(join(scratch, path)), { recursive: true });
      writeFileSync(join(scratch, path), text);
    }
    writeFileSync(join(scratch, CONFIG), JSON.stringify(checkConfig(project, plugin, language), null, 2) + "\n");
    registerProjectPlugins(scratch, isDefault(plugin) ? [] : [plugin]);
    return await forProject(scratch, () => work(scratch));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * reference reading: the language's readings recover, over its check project,
 * every relation of the reference project its reference map places there.
 */
function referenceRead(scratch: string, project: CheckProject, plugin: LoadedPlugin, language: string): Duty {
  const older = notHeld("reference reading", plugin);
  if (older !== undefined) return older;
  const map = project.reference;
  if (map === undefined) return { name: "reference reading", verdict: "fail", reason: UNMAPPED };
  const { held, missed } = referenceRelations(scratch, project, map, language);
  return missed.length === 0 ? { name: "reference reading", verdict: "pass", reason: `${held.length} of ${held.length} relations of the reference project read` } : { name: "reference reading", verdict: "fail", reason: missed.join("; ") };
}

/** The answers the text readings must give over a check project, each compared exactly. */
export interface Readings {
  /** For each of the language's non-test files, the names the source scan finds it declaring at its top level. */
  declared: Record<string, string[]>;
  /** The imports the source scan reads that resolve to a project file: one per file and module, the names it imports, "*" for the module whole. */
  imports: { file: string; module: string; names: string[] }[];
  /** The component interfaces the reading finds, each folder named a component: the symbols of `to` that `from` uses. */
  interfaces: { from: string; to: string; symbols: string[] }[];
  /** The entrances detection finds: the file, the handler's name ("" when the file itself is the entrance), and the rule. */
  entrances: { file: string; symbol: string; rule: string }[];
}

/** The duties of the readings that scan a language's text. */
const READING_DUTIES = ["mass", "imports", "interfaces", "entrances"] as const;
type ReadingDuty = (typeof READING_DUTIES)[number];

/** One duty's outcome. */
export interface Duty {
  /** A language plugin's duties, or a verifier's one per form it declares, as a bullet writes it ("[quint run]"). */
  name: "file rule" | "declarations" | "answers agree" | "reference reading" | "references" | "server agrees" | "chokepoint" | "one answer each" | ReadingDuty | `[${string}]`;
  verdict: "pass" | "fail" | "not run";
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
  const readings = value["readings"];
  if (readings !== undefined) {
    const each = (v: unknown, keys: readonly string[], lists: readonly string[]): boolean => Array.isArray(v) && v.every((x) => record(x) && keys.every((k) => typeof x[k] === "string") && lists.every((k) => strings(x[k])));
    if (!record(readings)) wrong.push("readings, an object of what each text reading recovers");
    else {
      if (!record(readings["declared"]) || !Object.values(readings["declared"]).every(strings)) wrong.push('readings.declared, an object of the names each file declares, by file');
      if (!each(readings["imports"], ["file", "module"], ["names"])) wrong.push('readings.imports, a list of { "file", "module", "names" }');
      if (!each(readings["interfaces"], ["from", "to"], ["symbols"])) wrong.push('readings.interfaces, a list of { "from", "to", "symbols" }');
      if (!each(readings["entrances"], ["file", "symbol", "rule"], [])) wrong.push('readings.entrances, a list of { "file", "symbol", "rule" }');
    }
  }
  const reference = value["reference"];
  if (reference !== undefined && !(record(reference) && record(reference["files"]) && record(reference["names"]) && REFERENCE_ROLES.every((r) => typeof (reference["files"] as Record<string, unknown>)[r] === "string") && REFERENCE_NAMES.every((n) => typeof (reference["names"] as Record<string, unknown>)[n] === "string"))) wrong.push(`reference, { "files": { ${REFERENCE_ROLES.map((r) => `"${r}"`).join(", ")} }, "names": { ${REFERENCE_NAMES.map((n) => `"${n}"`).join(", ")} } }`);
  return wrong.length === 0 ? undefined : `it lacks ${wrong.join("; ")}`;
}

const DUTIES = ["file rule", "declarations", "answers agree", "reference reading", "references", "server agrees", "chokepoint"] as const;

/** Every duty plugin check holds a language plugin to, in the order it reports them: what docs/plugins.md's duty table must list. */
export const LANGUAGE_DUTIES = [...DUTIES, ...READING_DUTIES, "one answer each"] as const;

/** The check projects a plugin is held over: the minimum (the bundled plugin's check.json for its language, as the installed package ships it, which no copy edits) and, when it adds to that, the plugin's own. */
export function checkProjects(plugin: LoadedPlugin, language: string): { label: string; project: CheckProject }[] | { refusal: string } {
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
 * Run every duty the plugin owes: a language's, when it provides or extends
 * one (Convex over TypeScript), over each check project; a verifier's, one
 * per via form it declares, over its check.json's proofs; both, in that
 * order, for a plugin that does both. A plugin that does neither is refused.
 */
export async function checkPlugin(root: string, given: string): Promise<PluginCheck> {
  const plugin = pluginAt(root, given);
  // A plugin that extends a language without providing it is held to that language's duties, as the adapter it wraps is.
  const language = plugin.manifest.provides?.language ?? plugin.manifest.extends;
  const verifies = (plugin.manifest.verifiers ?? []).length > 0;
  if (language === undefined && !verifies) throw new Error(`plugin check: plugin ${plugin.name} neither provides nor extends a language nor proves a via form, so it owes no duty plugin check holds`);
  const languageDuties = language === undefined ? [] : await languageDutiesOf(plugin, language);
  const verifierDuties = verifies ? await verifierDutiesOf(plugin) : [];
  return { plugin, language: language === undefined ? "verifier" : verifies ? `${language} + verifier` : language, duties: [...languageDuties, ...verifierDuties] };
}

/** A language plugin's duties over each check project, the worst outcome of each standing. */
async function languageDutiesOf(plugin: LoadedPlugin, language: string): Promise<Duty[]> {
  const projects = checkProjects(plugin, language);
  if ("refusal" in projects) return [...DUTIES, ...READING_DUTIES].map((name) => ({ name, verdict: "fail", reason: projects.refusal }));
  const each: Duty[][] = [];
  for (const { label, project } of projects) each.push((await overProject(project, plugin, language)).map((d) => ({ ...d, reason: `${label}: ${d.reason}` })));
  // A duty passes only where it passes over every project; the worst outcome stands, with each project's reason.
  const rank = { pass: 0, "not run": 1, fail: 2 } as const;
  const worstOf = (name: Duty["name"], found: Duty[]): Duty => {
    const worst = found.reduce((a, b) => (rank[b.verdict] > rank[a.verdict] ? b : a));
    return { name, verdict: worst.verdict, reason: found.map((d) => d.reason).join("; ") };
  };
  // The reference project is held over the check projects that map it: one that maps none (an extending plugin's own, beside the bundled minimum that does) says nothing, unless none maps it.
  const unmapped = (d: Duty): boolean => d.name === "reference reading" && d.reason.includes(UNMAPPED);
  return [
    ...DUTIES.map((name) => {
      const found = each.map((duties) => duties.find((d) => d.name === name)!);
      const held = found.filter((d) => !unmapped(d));
      return worstOf(name, held.length > 0 ? held : found);
    }),
    // A reading duty is held over every project that names what the readings recover; a plugin over none of them reads, for all anyone can tell, nothing.
    ...READING_DUTIES.map((name) => {
      const found = each.flatMap((duties) => duties.filter((d) => d.name === name));
      return found.length > 0 ? worstOf(name, found) : { name, verdict: "fail" as const, reason: `nothing to check: no check project names what the ${name} reading recovers (its readings), so a scan that reads nothing would pass` };
    }),
    await guarded("one answer each", () => oneAnswerEach(plugin)),
  ];
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

/** Every duty over one check project, in a scratch copy, the plugin in its language's place for it alone. */
async function overProject(project: CheckProject, plugin: LoadedPlugin, language: string): Promise<Duty[]> {
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
      const readings = project.readings;
      // The plain scans read the scratch project before the adapter's duties write any spec into it.
      const scans = readings === undefined ? [] : [await guarded("mass", () => massRead(scratch, project, readings, language)), await guarded("imports", () => importsRead(scratch, project, readings, language)), await guarded("entrances", () => entrancesRead(scratch, readings, language))];
      return [await guarded("file rule", () => fileRule(project, language)), await guarded("declarations", () => declarations(project, language)), await guarded("answers agree", () => answersAgree(project, language)), await guarded("reference reading", () => referenceRead(scratch, project, plugin, language)), ...scans, ...(await instrument(scratch, project, plugin, language))];
    });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function fileRule(project: CheckProject, language: string): Duty {
  const all = project.language.files.length + project.language.not.length;
  if (all === 0) return { name: "file rule", verdict: "fail", reason: "nothing to check: the check project names no file for the rule to take or leave" };
  const wrong = [
    ...project.language.files.filter((f) => languageOfFile(f) !== language).map((f) => `${f} is not read as ${language}`),
    ...project.language.not.filter((f) => languageOfFile(f) === language).map((f) => `${f} is read as ${language}`),
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

/**
 * answers agree: where two of the language's slots answer one question of the
 * same text, their answers agree over every file of the check project. A
 * name the source scan finds declared is one the topLevel slot finds at the
 * top level, and a type declaration where the interfaces slot reads one exactly
 * where the declares slot reads a type; and every name an
 * interfaces import list renames is one the source scan reads imported. Two
 * readers of one text that disagree are how a reading misses what another
 * finds (df-7ac38ee4: Python's source scan read nothing of a from-import
 * split across lines, which its interfaces slot read whole).
 */
function answersAgree(project: CheckProject, language: string): Duty {
  const source = syntaxOf(language, "source");
  const topLevel = syntaxOf(language, "topLevel");
  const declares = syntaxOf(language, "declares");
  const interfaces = syntaxOf(language, "interfaces");
  const files = project.language.files.filter((f) => project.files[f] !== undefined);
  const wrong: string[] = [];
  let compared = 0;
  for (const file of files) {
    const text = project.files[file]!;
    const lines = text.split("\n");
    for (const d of declarationsOf(text, language)) {
      const line = (lines[d.line - 1] ?? "").replace(/\r$/, "");
      if (topLevel !== undefined) {
        compared++;
        if (!topLevel(text, d.name)) wrong.push(`${file}:${d.line}: source declares ${d.name}, which topLevel finds no top-level declaration of`);
      }
      // What it declares, where two slots say: unknown is no answer (a call's result may or may not execute), so only two answers are compared.
      const kind = d.declares ?? declares?.(line);
      if (interfaces !== undefined && kind !== undefined && kind !== "unknown") {
        compared++;
        if (interfaces.isTypeDeclaration(line) !== (kind === "type")) wrong.push(`${file}:${d.line}: interfaces reads ${d.name}'s line as ${interfaces.isTypeDeclaration(line) ? "" : "no "}type declaration, declares as ${kind}`);
      }
    }
    if (source !== undefined && interfaces !== undefined) {
      const imported = new Set<string>();
      source.importsOf(text, (name, specifier) => {
        if (name !== undefined) imported.add(name);
        imported.add(specifier);
        imported.add(specifier.split(/[./:\\]+/).filter((s) => s !== "").pop() ?? specifier);
      });
      for (const list of interfaces.importLists(text)) {
        for (const [, original] of list.matchAll(/([A-Za-z_$][\w$.:]*)\s+as\s+[A-Za-z_$][\w$]*/g)) {
          compared++;
          if (!imported.has(original!)) wrong.push(`${file}: interfaces.importLists renames ${original}, which source.importsOf reads no import of`);
        }
      }
    }
  }
  if (compared === 0) return { name: "answers agree", verdict: "fail", reason: "nothing to check: no file of the check project gives two slots one question to answer (a declaration, or a renamed import)" };
  return wrong.length === 0 ? { name: "answers agree", verdict: "pass", reason: `${compared} answers of two slots to one question agree` } : { name: "answers agree", verdict: "fail", reason: wrong.join("; ") };
}

/** Two sorted lists' difference, said: what the reading missed and what it found that the check project names none of. */
function compared(found: readonly string[], expected: readonly string[]): string | undefined {
  const missed = expected.filter((e) => !found.includes(e));
  const extra = found.filter((f) => !expected.includes(f));
  if (missed.length === 0 && extra.length === 0) return undefined;
  return [missed.length > 0 ? `missed ${missed.join(", ")}` : "", extra.length > 0 ? `found ${extra.join(", ")}, which the check project names none of` : ""].filter((s) => s !== "").join("; ");
}

const sortedUnique = (values: Iterable<string>): string[] => [...new Set(values)].sort();

/** mass: the reading reads the language, counts each of its files, and the source scan it counts by finds in each the names the check project says it declares. */
function massRead(scratch: string, project: CheckProject, readings: Readings, language: string): Duty {
  const files = Object.keys(readings.declared).sort();
  // Every file declaring nothing is what a scan that reads nothing finds, so at least one name must be found.
  if (files.every((f) => readings.declared[f]!.length === 0)) return { name: "mass", verdict: "fail", reason: "nothing to check: the check project's readings name no declaration of any file" };
  const report = computeMass(scratch);
  const unread = report.languages.unread.find((u) => u.language === language);
  if (unread !== undefined) return { name: "mass", verdict: "fail", reason: `mass reads no ${language}: ${unread.because}` };
  const counted = new Set(report.files.map((f) => f.file));
  const wrong = files.flatMap((file) => {
    if (!counted.has(file)) return [`${file} is not counted`];
    const why = compared(sortedUnique(declarationsOf(project.files[file] ?? "", language).map((d) => d.name)), sortedUnique(readings.declared[file]!));
    return why === undefined ? [] : [`${file}: ${why}`];
  });
  const names = files.reduce((n, f) => n + readings.declared[f]!.length, 0);
  return wrong.length === 0 ? { name: "mass", verdict: "pass", reason: `${files.length} files counted, ${names} declarations found as named` } : { name: "mass", verdict: "fail", reason: wrong.join("; ") };
}

/** imports: the source scan reads, from each file, every import that resolves to a project file, with the names it imports. */
function importsRead(scratch: string, project: CheckProject, readings: Readings, language: string): Duty {
  if (readings.imports.length === 0) return { name: "imports", verdict: "fail", reason: "nothing to check: the check project's readings name no import" };
  const key = (file: string, module: string, names: readonly string[]): string => `${file} -> ${module} (${sortedUnique(names).join(", ")})`;
  const found: string[] = [];
  for (const file of Object.keys(readings.declared).sort()) {
    const byModule = new Map<string, Set<string>>();
    for (const i of importsOf(scratch, file, project.files[file] ?? "", language)) {
      const names = byModule.get(i.module) ?? new Set<string>();
      names.add(i.name ?? "*");
      byModule.set(i.module, names);
    }
    for (const [module, names] of byModule) found.push(key(file, module, [...names]));
  }
  const why = compared(found.sort(), readings.imports.map((i) => key(i.file, i.module, i.names)).sort());
  return why === undefined ? { name: "imports", verdict: "pass", reason: `${readings.imports.length} imports read as named` } : { name: "imports", verdict: "fail", reason: why };
}

/** entrances: detection over the check project finds every entrance it names, by file, handler and rule, and none else. */
function entrancesRead(scratch: string, readings: Readings, language: string): Duty {
  if (readings.entrances.length === 0) return { name: "entrances", verdict: "fail", reason: "nothing to check: the check project's readings name no entrance" };
  const key = (e: { file: string; symbol: string; rule: string }): string => `${e.file}${e.symbol === "" ? "" : `#${e.symbol}`} by ${e.rule}`;
  const found = sortedUnique(detectedEntrances(scratch, { components: [] }, language, [...DEFAULT_TEST_FOLDERS]).map(key));
  const why = compared(found, sortedUnique(readings.entrances.map(key)));
  return why === undefined ? { name: "entrances", verdict: "pass", reason: `${readings.entrances.length} entrances detected as named` } : { name: "entrances", verdict: "fail", reason: why };
}

/** The title of the spec plugin check writes into a folder the interfaces reading names, so the folder is a component. */
function componentTitle(folder: string): string {
  return (folder.split("/").pop() ?? "part").replace(/^\w/, (c) => c.toUpperCase());
}

/** interfaces: with each folder the readings name a component, the component interface reading finds the symbols of one that another uses, and none else. */
async function interfacesRead(scratch: string, readings: Readings, adapter: LanguageAdapter): Promise<Duty> {
  if (readings.interfaces.length === 0) return { name: "interfaces", verdict: "fail", reason: "nothing to check: the check project's readings name no component interface" };
  const folders = sortedUnique(readings.interfaces.flatMap((i) => [i.from, i.to]));
  const written: string[] = [];
  try {
    for (const folder of folders) {
      if (existsSync(join(scratch, folder)) && readdirSync(join(scratch, folder)).some((f) => f.endsWith(".spec.md"))) continue;
      const title = componentTitle(folder);
      const spec = join(scratch, folder, `${title}.spec.md`);
      mkdirSync(dirname(spec), { recursive: true });
      writeFileSync(spec, `# ${title}\n\nA component of the check project.\n\n## invariants\n`);
      written.push(spec);
    }
    const reading = await readComponentInterfaces(scratch, adapter);
    if (reading.kind !== "read") return { name: "interfaces", verdict: "fail", reason: `the reading read nothing: ${reading.because}` };
    const key = (from: string, to: string, symbols: readonly string[]): string => `${from} -> ${to} (${sortedUnique(symbols).join(", ")})`;
    const byPair = new Map<string, Set<string>>();
    for (const s of reading.symbols) {
      const pair = `${s.from}\u0000${s.to}`;
      byPair.set(pair, (byPair.get(pair) ?? new Set<string>()).add(s.symbol));
    }
    const found = [...byPair].map(([pair, symbols]) => key(pair.split("\u0000")[0]!, pair.split("\u0000")[1]!, [...symbols])).sort();
    const why = compared(found, readings.interfaces.map((i) => key(i.from, i.to, i.symbols)).sort());
    return why === undefined ? { name: "interfaces", verdict: "pass", reason: `${readings.interfaces.length} component interfaces read as named` } : { name: "interfaces", verdict: "fail", reason: why };
  } finally {
    for (const spec of written) rmSync(spec, { force: true });
  }
}

/** A duty a plugin written for an older interface version is not held to, said as such and passed: it did not exist when the plugin was written. */
function notHeld(name: "reference reading" | "server agrees", plugin: LoadedPlugin): Duty | undefined {
  const since = DUTY_SINCE[name]!;
  const written = plugin.manifest.pluginApi;
  return written >= since ? undefined : { name, verdict: "pass", reason: `not held: plugin ${plugin.name} is written for pluginApi ${written}, and ${name} holds from pluginApi ${since} (${PLUGIN_API_CHANGES[since]!.split(";")[0]}...; docs/plugins.md)` };
}

/**
 * server agrees: every name the text readings find a file of the check
 * project declaring at its top level is a top-level symbol the language
 * server reports for that file. The server is the independent account: a
 * name the reading finds and the server does not is a misread (a name read
 * out of a string or a comment, as Python's line scan read 223 of PostHog's),
 * whatever the check project's readings say. A name the server reports that
 * the reading leaves out is no failure here, since a reading may leave names
 * out by design (Python's lowercase module variables); coherence plugin
 * calibrate counts those by kind over a real project.
 */
async function serverAgrees(project: CheckProject, language: string, adapter: LanguageAdapter, base: LanguageAdapter | undefined): Promise<Duty> {
  // An adapter that extends a language and does not ask the server itself answers through the one it wraps, which is the same server.
  const ask = adapter.topLevelSymbols?.bind(adapter) ?? base?.topLevelSymbols?.bind(base);
  if (ask === undefined) return { name: "server agrees", verdict: "fail", reason: "the plugin's adapter offers no topLevelSymbols, which pluginApi 3 asks of a language adapter, so the text reading's declarations cannot be held to the language server's" };
  const wrong: string[] = [];
  let compared = 0;
  for (const file of project.language.files) {
    const text = project.files[file];
    if (text === undefined || !isSourceFile(file, language)) continue;
    const declared = declarationsOf(text, language);
    if (declared.length === 0) continue;
    const symbols = new Set((await ask(file)).map((s) => s.name));
    for (const d of declared) {
      compared++;
      if (!symbols.has(d.name)) wrong.push(`${file}:${d.line}: the text reading declares ${d.name}, which the language server reports no top-level symbol of`);
    }
  }
  if (compared === 0) return { name: "server agrees", verdict: "fail", reason: "nothing to check: the text reading finds no declaration in any file of the check project" };
  return wrong.length === 0 ? { name: "server agrees", verdict: "pass", reason: `${compared} of ${compared} declarations the text reading finds are top-level symbols the server reports` } : { name: "server agrees", verdict: "fail", reason: wrong.join("; ") };
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
    return [{ name: "references", verdict: "fail", reason }, notHeld("server agrees", plugin) ?? { name: "server agrees", verdict: "fail", reason }, { name: "chokepoint", verdict: "fail", reason }, ...(project.readings === undefined ? [] : [{ name: "interfaces" as const, verdict: "fail" as const, reason }])];
  }
  try {
    const ready = await adapter.ready().catch((error: unknown) => ({ ok: false as const, reason: `ready() threw: ${error instanceof Error ? error.message : String(error)}` }));
    if (!ready.ok) return [{ name: "references", verdict: "not run", reason: ready.reason }, notHeld("server agrees", plugin) ?? { name: "server agrees", verdict: "not run", reason: ready.reason }, { name: "chokepoint", verdict: "not run", reason: ready.reason }, ...(project.readings === undefined ? [] : [{ name: "interfaces" as const, verdict: "not run" as const, reason: ready.reason }])];
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
    const server = await guarded("server agrees", () => notHeld("server agrees", plugin) ?? serverAgrees(project, language, adapter, base));
    // The interface reading asks the same adapter, before the chokepoint's run writes its spec.
    const readings = project.readings;
    const interfaces = readings === undefined ? [] : [await guarded("interfaces", () => interfacesRead(scratch, readings, adapter))];
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
    return [references, server, ...interfaces, chokepoint];
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
  const passed = check.duties.every((o) => o.verdict === "pass");
  const failed = check.duties.some((o) => o.verdict === "fail");
  return [
    `plugin check ${check.plugin.name} (${check.plugin.source}, ${check.language}, ${check.plugin.version}): ${passed ? "pass" : failed ? "FAIL" : "NOT RUN"}`,
    ...check.duties.map((o) => `  ${o.verdict.padEnd(7)} ${o.name}: ${o.reason}`),
  ].join("\n");
}
