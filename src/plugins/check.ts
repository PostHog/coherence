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
 *   one answer each  no two of its slots answer with one function, or two
 *                  spelled alike: a question asked of the language belongs
 *                  to one slot, or its answers drift apart
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
import { DEFAULT_TEST_FOLDERS } from "../enforcement/config.ts";
import { performRun } from "../enforcement/run.ts";
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
}

/** One duty's outcome. */
export interface Duty {
  /** A language plugin's four duties, or a verifier's one per form it declares, as a bullet writes it ("[quint run]"). */
  name: "file rule" | "declarations" | "references" | "chokepoint" | "one answer each" | `[${string}]`;
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
  return wrong.length === 0 ? undefined : `it lacks ${wrong.join("; ")}`;
}

const DUTIES = ["file rule", "declarations", "references", "chokepoint"] as const;

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

/** A language plugin's four duties over each check project, the worst outcome of each standing. */
async function languageDutiesOf(plugin: LoadedPlugin, language: string): Promise<Duty[]> {
  const projects = checkProjects(plugin, language);
  if ("refusal" in projects) return DUTIES.map((name) => ({ name, verdict: "fail", reason: projects.refusal }));
  const each: Duty[][] = [];
  for (const { label, project } of projects) each.push((await overProject(project, plugin, language)).map((d) => ({ ...d, reason: `${label}: ${d.reason}` })));
  // A duty passes only where it passes over every project; the worst outcome stands, with each project's reason.
  const rank = { pass: 0, "not run": 1, fail: 2 } as const;
  return [
    ...DUTIES.map((name) => {
      const found = each.map((duties) => duties.find((d) => d.name === name)!);
      const worst = found.reduce((a, b) => (rank[b.verdict] > rank[a.verdict] ? b : a));
      return { name, verdict: worst.verdict, reason: found.map((d) => d.reason).join("; ") };
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
    return await forProject(scratch, async () => [await guarded("file rule", () => fileRule(project, language)), await guarded("declarations", () => declarations(project, language)), ...(await instrument(scratch, project, plugin, language))]);
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
