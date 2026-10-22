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
 *
 * Each duty passes, fails with why, or is not run with why (the
 * plugin's language server is absent); only every one passing is a pass.
 * The plugin is held as a project would run it: swapped in for its language
 * over a scratch copy of the check project.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { LanguageAdapter } from "../adapters/adapter.ts";
import { DEFAULT_TEST_FOLDERS } from "../enforcement/config.ts";
import { performRun } from "../enforcement/run.ts";
import { bundledAdapter, forProject, languageOfFile, registerProjectPlugins, syntaxOf } from "./languages.ts";
import type { LoadedPlugin } from "./plugin.ts";
import { BUNDLED_DIR, moduleSyncOf, readManifest } from "./registry.ts";

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
  name: "file rule" | "declarations" | "references" | "chokepoint";
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

/** Run every duty against the plugin; a plugin that provides no language is refused, since the duties are a language's. */
export async function checkPlugin(root: string, given: string): Promise<PluginCheck> {
  const plugin = pluginAt(root, given);
  const language = plugin.manifest.provides?.language;
  if (language === undefined) throw new Error(`plugin check: plugin ${plugin.name} provides no language, and the duties are a language plugin's`);
  const file = join(plugin.dir, CHECK_FILE);
  if (!existsSync(file)) {
    const reason = `plugin ${plugin.name} carries no ${CHECK_FILE} (the project its duties are held over)`;
    return { plugin, language, duties: (["file rule", "declarations", "references", "chokepoint"] as const).map((name) => ({ name, verdict: "fail", reason })) };
  }
  const project = JSON.parse(readFileSync(file, "utf8")) as CheckProject;
  const scratch = mkdtempSync(join(tmpdir(), "coherence-plugin-check-"));
  try {
    for (const [path, text] of Object.entries(project.files)) {
      mkdirSync(dirname(join(scratch, path)), { recursive: true });
      writeFileSync(join(scratch, path), text);
    }
    // The plugin as a project runs it: in its language's place, for this project alone.
    registerProjectPlugins(scratch, plugin.source === "bundled" ? [] : [plugin]);
    return await forProject(scratch, async () => ({ plugin, language, duties: [fileRule(project, language), declarations(project, language), ...(await instrument(scratch, project, plugin, language))] }));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function fileRule(project: CheckProject, language: string): Duty {
  const wrong = [
    ...project.language.files.filter((f) => languageOfFile(f) !== language).map((f) => `${f} is not read as ${language}`),
    ...project.language.not.filter((f) => languageOfFile(f) === language).map((f) => `${f} is read as ${language}`),
  ];
  const all = project.language.files.length + project.language.not.length;
  return wrong.length === 0 ? { name: "file rule", verdict: "pass", reason: `${all} of ${all} files read as expected` } : { name: "file rule", verdict: "fail", reason: wrong.join("; ") };
}

function declarations(project: CheckProject, language: string): Duty {
  const topLevel = syntaxOf(language, "topLevel");
  if (topLevel === undefined) return { name: "declarations", verdict: "fail", reason: `no topLevel slot says what a ${language} file declares` };
  const wrong = project.declarations.filter((d) => topLevel(project.files[d.file] ?? "", d.name) !== d.declared).map((d) => `${d.name} in ${d.file} read as ${d.declared ? "not declared" : "declared"}`);
  return wrong.length === 0 ? { name: "declarations", verdict: "pass", reason: `${project.declarations.length} of ${project.declarations.length} read as expected` } : { name: "declarations", verdict: "fail", reason: wrong.join("; ") };
}

/** The plugin's adapter over the scratch project: its module's factory, handed the bundled adapter of the language it extends, which the check closes as the core does. */
function adapterOf(scratch: string, plugin: LoadedPlugin, language: string): { adapter: LanguageAdapter; base: LanguageAdapter | undefined } {
  if (plugin.source === "bundled") return { adapter: bundledAdapter(language, scratch)!, base: undefined };
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
    const ready = await adapter.ready();
    if (!ready.ok) return [{ name: "references", verdict: "not run", reason: ready.reason }, { name: "chokepoint", verdict: "not run", reason: ready.reason }];
    const hint = { component: ".", testFolders: [...DEFAULT_TEST_FOLDERS] };
    const resolved = await adapter.resolve(project.protects, hint);
    let references: Duty;
    if (!resolved.ok) references = { name: "references", verdict: "fail", reason: `${project.protects} does not resolve: ${resolved.reason}` };
    else {
      const sites = (await adapter.references(resolved.definition)).map((s) => `${s.file}:${s.line}`);
      const found = new Set(sites);
      const missed = project.references.filter((r) => !found.has(r));
      const extra = [...found].filter((s) => !project.references.includes(s));
      references =
        sites.length === 0
          ? { name: "references", verdict: "fail", reason: `reports no references to ${project.protects}; ${project.references.length} exist (${project.references.join(", ")})` }
          : missed.length > 0 || extra.length > 0
            ? { name: "references", verdict: "fail", reason: [missed.length > 0 ? `missed ${missed.join(", ")}` : "", extra.length > 0 ? `reported ${extra.join(", ")}, which is none` : ""].filter((s) => s !== "").join("; ") }
            : { name: "references", verdict: "pass", reason: `${sites.length} of ${project.references.length} references to ${project.protects}` };
    }
    // Graded as a project's run grades it, through performRun, the one door every chokepoint verdict takes (its refutation always attempted).
    writeFileSync(join(scratch, CHECK_SPEC), checkSpec(project));
    const run = await performRun(scratch, { session: "plugin-check", agent: "plugin-check", form: "chokepoint", adapter, server: false });
    const graded = run.record.invariants.find((e) => e.form === "chokepoint");
    if (graded === undefined) return [references, { name: "chokepoint", verdict: "fail", reason: `the run graded no chokepoint: ${run.instrumentReason ?? "no entry recorded"}` }];
    const bypasses = (graded.bypasses ?? []).map((b) => `${b.file}:${b.line}`).sort();
    const expected = [...project.bypasses].sort();
    const wrong = [
      graded.grade !== project.grade ? `graded ${graded.grade ?? "nothing"}, not ${project.grade} (${graded.reason})` : "",
      JSON.stringify(bypasses) !== JSON.stringify(expected) ? `bypasses ${bypasses.join(", ") || "none"}, not ${expected.join(", ") || "none"}` : "",
      graded.refutation === "missing" ? `its refutation is missing: ${graded.reason}` : "",
    ].filter((s) => s !== "");
    const chokepoint: Duty = wrong.length === 0 ? { name: "chokepoint", verdict: "pass", reason: `${project.protects} through ${project.chokepoint} graded ${graded.grade}, refutation ${graded.refutation}` } : { name: "chokepoint", verdict: "fail", reason: wrong.join("; ") };
    return [references, chokepoint];
  } finally {
    try {
      await adapter.close();
    } finally {
      await base?.close();
    }
  }
}

/** The report plugin check prints: the plugin, then one line per duty. */
export function checkText(check: PluginCheck): string {
  const passed = check.duties.every((o) => o.verdict === "pass");
  return [
    `plugin check ${check.plugin.name} (${check.plugin.source}, ${check.language}, ${check.plugin.version}): ${passed ? "pass" : "FAIL"}`,
    ...check.duties.map((o) => `  ${o.verdict.padEnd(7)} ${o.name}: ${o.reason}`),
  ].join("\n");
}
