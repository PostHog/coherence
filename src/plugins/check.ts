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
import { declarationsOf, importsOf } from "../economy/source.ts";
import { DEFAULT_TEST_FOLDERS } from "../enforcement/config.ts";
import { performRun } from "../enforcement/run.ts";
import { detectedEntrances, readComponentInterfaces } from "../readings/scope/component-interfaces.ts";
import { bundledAdapter, bundledPlugins, forProject, languageOfFile, registerProjectPlugins, repeatedAnswers, syntaxOf } from "./languages.ts";
import type { LoadedPlugin } from "./plugin.ts";
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
  name: "file rule" | "declarations" | "answers agree" | "references" | "chokepoint" | "one answer each" | ReadingDuty | `[${string}]`;
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
  return wrong.length === 0 ? undefined : `it lacks ${wrong.join("; ")}`;
}

const DUTIES = ["file rule", "declarations", "answers agree", "references", "chokepoint"] as const;

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
  return [
    ...DUTIES.map((name) => worstOf(name, each.map((duties) => duties.find((d) => d.name === name)!))),
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
      return [await guarded("file rule", () => fileRule(project, language)), await guarded("declarations", () => declarations(project, language)), await guarded("answers agree", () => answersAgree(project, language)), ...scans, ...(await instrument(scratch, project, plugin, language))];
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
    return [{ name: "references", verdict: "fail", reason }, { name: "chokepoint", verdict: "fail", reason }, ...(project.readings === undefined ? [] : [{ name: "interfaces" as const, verdict: "fail" as const, reason }])];
  }
  try {
    const ready = await adapter.ready().catch((error: unknown) => ({ ok: false as const, reason: `ready() threw: ${error instanceof Error ? error.message : String(error)}` }));
    if (!ready.ok) return [{ name: "references", verdict: "not run", reason: ready.reason }, { name: "chokepoint", verdict: "not run", reason: ready.reason }, ...(project.readings === undefined ? [] : [{ name: "interfaces" as const, verdict: "not run" as const, reason: ready.reason }])];
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
    return [references, ...interfaces, chokepoint];
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
