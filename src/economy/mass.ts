/**
 * Mass: two numbers side by side for each component and the project.
 *
 *   total      lines, files, and symbols (top-level declarations by a plain
 *              scan; the seam offers no declaration listing)
 *   unreached  code in no component (no spec file above it), and code inside
 *              a component that no invariant's chokepoint or protected thing
 *              reaches
 *
 * Reach is at file level. An invariant reaches the files the latest run's
 * chokepoint check touched (its definitions and every reference site) when
 * a run exists; without one, the files that declare the spec's named
 * symbols or are the named modules. Test files are the detectors and not
 * the load: excluded and counted aside. Unreached prints first: a large
 * object with no definition is a wobbly load. Never a threshold, never a
 * baseline, never a failure on growth.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseName } from "../adapters/adapter.ts";
import type { Language } from "../adapters/index.ts";
import { readEnforcementConfig } from "../enforcement/config.ts";
import { loadSpecModel, type ModelInvariant, type SpecModel } from "../spec/model.ts";
import { componentOf, declarationsOf, isTest, sourceFiles } from "./source.ts";

export interface Numbers {
  lines: number;
  files: number;
  symbols: number;
}

export interface FileMass extends Numbers {
  file: string;
  /** Which invariants reach it, as component/name; empty when none. */
  reachedBy: string[];
}

export interface ComponentMass {
  folder: string;
  total: Numbers;
  unreached: Numbers;
  unreachedFiles: string[];
}

export interface MassReport {
  language: string;
  total: Numbers;
  unreached: Numbers;
  /** Code in no component. */
  outside: { total: Numbers; files: string[] };
  components: ComponentMass[];
  files: FileMass[];
  /** How reach was decided: the latest run's files, the spec's names, or both across invariants. */
  reachFrom: ("run" | "spec")[];
  testsExcluded: number;
}

export interface MassOptions {
  model?: SpecModel | undefined;
}

const ZERO: Numbers = { lines: 0, files: 0, symbols: 0 };

function add(a: Numbers, b: Numbers): Numbers {
  return { lines: a.lines + b.lines, files: a.files + b.files, symbols: a.symbols + b.symbols };
}

function sum(files: readonly FileMass[]): Numbers {
  return files.reduce((acc, f) => add(acc, f), ZERO);
}

function chokepointNames(invariant: ModelInvariant): string[] {
  return invariant.enforcements.flatMap((e) => (e.form === "chokepoint" ? [e.protects, e.chokepoint] : []));
}

/** The files one invariant reaches, and where the answer came from. */
function reachOf(invariant: ModelInvariant, files: readonly { file: string; names: Set<string> }[]): { files: string[]; from: "run" | "spec" | undefined } {
  const latest = invariant.latest.find((l) => l.form === "chokepoint");
  if (latest !== undefined && latest.files.length > 0) return { files: latest.files, from: "run" };
  const names = chokepointNames(invariant);
  if (names.length === 0) return { files: [], from: undefined };
  const reached = new Set<string>();
  for (const value of names) {
    const parsed = parseName(value);
    if (parsed.form === "module") {
      for (const f of files) if (f.file === parsed.path || f.file.endsWith("/" + parsed.path)) reached.add(f.file);
    } else if (parsed.form === "symbol") {
      for (const f of files) {
        if (!f.names.has(parsed.name)) continue;
        if (parsed.fileHint !== undefined && f.file !== parsed.fileHint && !f.file.endsWith("/" + parsed.fileHint)) continue;
        // A bare name is looked for under the invariant's component first; elsewhere only when nothing there declares it.
        reached.add(f.file);
      }
    }
  }
  return { files: [...reached], from: "spec" };
}

export function computeMass(rootGiven: string, options: MassOptions = {}): MassReport {
  const root = resolve(rootGiven);
  const config = readEnforcementConfig(root);
  const language: Language = config.language;
  const model = options.model ?? loadSpecModel(root);
  const ignore = readIgnore(root);
  const all = sourceFiles(root, language, ignore);
  const tests = all.filter((f) => isTest(f, config.testFolders));
  const code = all.filter((f) => !isTest(f, config.testFolders));

  const scanned = code.map((file) => {
    const text = readFileSync(resolve(root, file), "utf8");
    const declarations = declarationsOf(text, language);
    const lines = text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
    return { file, lines, symbols: declarations.length, names: new Set(declarations.map((d) => d.name)) };
  });

  const reachedBy = new Map<string, Set<string>>();
  const reachFrom = new Set<"run" | "spec">();
  for (const component of model.components) {
    for (const invariant of component.invariants) {
      const scoped = scanned.filter((f) => component.folder === "." || f.file.startsWith(component.folder + "/"));
      let reach = reachOf(invariant, scoped);
      if (reach.from === "spec" && reach.files.length === 0) reach = reachOf(invariant, scanned);
      if (reach.from !== undefined && reach.files.length > 0) reachFrom.add(reach.from);
      for (const file of reach.files) {
        const set = reachedBy.get(file) ?? new Set<string>();
        set.add(`${component.folder}/${invariant.name}`);
        reachedBy.set(file, set);
      }
    }
  }

  const files: FileMass[] = scanned.map((f) => ({ file: f.file, lines: f.lines, files: 1, symbols: f.symbols, reachedBy: [...(reachedBy.get(f.file) ?? [])].sort() }));
  const outsideFiles = files.filter((f) => componentOf(model, f.file) === undefined);
  const components: ComponentMass[] = model.components
    .map((component) => {
      const mine = files.filter((f) => componentOf(model, f.file)?.folder === component.folder);
      const unreached = mine.filter((f) => f.reachedBy.length === 0);
      return { folder: component.folder, total: sum(mine), unreached: sum(unreached), unreachedFiles: unreached.map((f) => f.file).sort() };
    })
    .sort((a, b) => a.folder.localeCompare(b.folder));

  const unreached = add(sum(outsideFiles), components.reduce((acc, c) => add(acc, c.unreached), ZERO));
  return {
    language,
    total: sum(files),
    unreached,
    outside: { total: sum(outsideFiles), files: outsideFiles.map((f) => f.file).sort() },
    components,
    files,
    reachFrom: [...reachFrom].sort(),
    testsExcluded: tests.length,
  };
}

function readIgnore(root: string): string[] {
  try {
    const parsed = JSON.parse(readFileSync(resolve(root, "coherence.config.json"), "utf8")) as Record<string, unknown>;
    return Array.isArray(parsed["ignore"]) ? parsed["ignore"].filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function numbers(n: Numbers): string {
  return `${n.lines} lines, ${n.files} file${n.files === 1 ? "" : "s"}, ${n.symbols} symbol${n.symbols === 1 ? "" : "s"}`;
}

function share(part: number, whole: number): string {
  return whole === 0 ? "0%" : `${Math.round((part / whole) * 100)}%`;
}

const SHOWN = 6;

export function formatMass(report: MassReport): string {
  const lines: string[] = [];
  lines.push(`unreached mass: ${numbers(report.unreached)} (${share(report.unreached.lines, report.total.lines)} of lines)`);
  lines.push(`  in no component: ${numbers(report.outside.total)}${report.outside.files.length === 0 ? "" : ` — ${report.outside.files.slice(0, SHOWN).join(", ")}${report.outside.files.length > SHOWN ? `, and ${report.outside.files.length - SHOWN} more` : ""}`}`);
  for (const c of report.components) {
    if (c.unreached.files === 0) continue;
    lines.push(`  ${c.folder}: ${numbers(c.unreached)} unreached of ${numbers(c.total)} — ${c.unreachedFiles.slice(0, SHOWN).join(", ")}${c.unreachedFiles.length > SHOWN ? `, and ${c.unreachedFiles.length - SHOWN} more` : ""}`);
  }
  lines.push(`total mass: ${numbers(report.total)}`);
  for (const c of report.components) lines.push(`  ${c.folder}: ${numbers(c.total)}; unreached ${numbers(c.unreached)}`);
  const from = report.reachFrom.length === 0 ? "no invariant reaches any file" : `reach from ${report.reachFrom.map((f) => (f === "run" ? "the latest run's files" : "the spec's named symbols")).join(" and ")}`;
  lines.push(`${from}; symbols are top-level declarations by a plain scan; ${report.testsExcluded} test file${report.testsExcluded === 1 ? "" : "s"} excluded`);
  return lines.join("\n");
}
