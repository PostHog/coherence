/**
 * The model: every spec under a root, read into components, trust levels,
 * and invariants with their lifecycle state.
 *
 * A component is any folder with a spec file; nesting follows the folders,
 * with folders that hold no spec transparent. The entry component (the
 * config's entryDir, else the root) declares the trust levels crossings
 * name. Cross-spec facts are checked here: crossings against trust levels,
 * declared-as names against the invariants that exist, names unique within
 * a component. State is derived from what the bullet carries and, when runs
 * exist under .coherence/runs, from the latest run that checked each
 * enforcement; with no run every enforcement reports as declared, unverified.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { parseSpec, type Entrance, type Invariant, type Problem, type TrustLevel } from "./grammar.ts";
import { applicableShapes, loadSeed, type Seed } from "./seed.ts";
import { entryKey, latestByEnforcement, latestFor, loadRuns, witnessedRefutations, type Latest } from "../enforcement/record.ts";
import { deriveState, type Lack, type State } from "./state.ts";
import { projectFiles } from "../adapters/project-files.ts";

export const SPEC_SUFFIX = ".spec.md";
export const CONFIG_FILE = "coherence.config.json";

/** Folders never walked, whatever the config says. */
const EXCLUDED_FOLDERS: ReadonlySet<string> = new Set(["node_modules", ".git", "dist", ".coherence", ".claude", ".codex", "public"]);

export interface ModelInvariant extends Invariant {
  /** The folder of the component the bullet lives in. */
  component: string;
  /** The checklist shapes the bullet's kinds make applicable. */
  applicable: string[];
  /** Applicable shapes with no declared or dismissed line. */
  missingShapes: string[];
  state: State;
  lacks: Lack[];
  /** The latest run entry per form that checked this bullet; empty when no run has. */
  latest: Latest[];
  /** Enforcements the latest run found passing. */
  verified: Latest[];
  /** Enforcements the latest run found failing: the structural defects. */
  defects: Latest[];
}

export interface Component {
  /** Relative to the root, with "." for the root itself. */
  folder: string;
  name: string;
  specPath: string;
  intent: string;
  trustLevels: TrustLevel[] | undefined;
  /** Where work enters through this component, as its spec declares; each handler was found declared in the code. */
  entrances: ModelEntrance[];
  invariants: ModelInvariant[];
  parent: string | undefined;
  children: string[];
}

export interface ModelEntrance extends Entrance {
  /** The folder of the component whose spec declares it. */
  component: string;
  /** The project-relative file whose top level declares the handler, when one was found. */
  file: string | undefined;
}

export interface Counts {
  components: number;
  bullets: number;
  invariants: number;
  requirements: number;
  structuralDefects: number;
  lacking: Record<Lack, number>;
  unfilled: number;
  problems: number;
}

export interface SpecModel {
  root: string;
  /** The entry component's folder, when a spec is there. */
  entry: string | undefined;
  trustLevels: TrustLevel[];
  components: Component[];
  problems: Problem[];
  counts: Counts;
  /** When runs exist: the time of the latest, and how many run lines were unreadable. */
  runs: { latest: string; count: number; damaged: number } | undefined;
}

interface Config {
  ignore: string[];
  entryDir: string;
}

function readConfig(root: string): Config {
  const path = resolve(root, CONFIG_FILE);
  const config: Config = { ignore: [], entryDir: "." };
  if (!existsSync(path)) return config;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${path}: not valid JSON (${(error as Error).message})`);
  }
  if (typeof parsed !== "object" || parsed === null) return config;
  const record = parsed as Record<string, unknown>;
  if (Array.isArray(record["ignore"])) config.ignore = record["ignore"].filter((v): v is string => typeof v === "string");
  if (typeof record["entryDir"] === "string") config.entryDir = record["entryDir"];
  return config;
}

/** Every spec file under the root, sorted by path. */
export function findSpecs(root: string, ignore: readonly string[] = []): string[] {
  return walkedFiles(root, ".", ignore).filter((rel) => rel.endsWith(SPEC_SUFFIX)).map((rel) => join(root, rel)).sort();
}

/**
 * The project's own files under a folder (projectFiles), project-relative,
 * never inside a folder no walk enters: a spec in a nested checkout is
 * another tree's component, and its source is not this project's.
 */
function walkedFiles(root: string, folder: string, ignore: readonly string[]): string[] {
  const skip = new Set([...EXCLUDED_FOLDERS, ...ignore]);
  const prefix = folder === "." || folder === "" ? "" : folder.replace(/\/+$/, "") + "/";
  return projectFiles(root).filter((rel) => {
    if (!rel.startsWith(prefix)) return false;
    const folders = rel.split("/").slice(0, -1);
    return folders.every((name, i) => !skip.has(name) && !skip.has(folders.slice(0, i + 1).join("/")));
  });
}

function folderOf(root: string, specPath: string): string {
  const rel = relative(root, dirname(specPath));
  return rel === "" ? "." : rel.split(sep).join("/");
}

/** The nearest ancestor folder among the component folders, or undefined at the top. */
function parentOf(folder: string, folders: ReadonlySet<string>): string | undefined {
  if (folder === ".") return undefined;
  let current = folder;
  for (;;) {
    const up = dirname(current);
    const candidate = up === "." || up === "" ? "." : up;
    if (folders.has(candidate)) return candidate;
    if (candidate === ".") return undefined;
    current = candidate;
  }
}

export interface LoadOptions {
  seed?: Seed | undefined;
  /** Read .coherence/runs and derive run-informed state (default true). */
  runs?: boolean | undefined;
}

export function loadSpecModel(rootGiven: string, options: LoadOptions = {}): SpecModel {
  const root = resolve(rootGiven);
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error(`${root}: not a folder`);
  const seed = options.seed ?? loadSeed();
  const config = readConfig(root);
  const problems: Problem[] = [];
  const loadedRuns = options.runs === false ? { records: [], refutations: [], damaged: [] } : loadRuns(root);
  const latest = latestByEnforcement(loadedRuns.records);
  // A totality oracle's refutation is witnessed by the record, never by the bullet's own refuted: line.
  const witnessed = witnessedRefutations(loadedRuns.records, loadedRuns.refutations);
  const runs =
    loadedRuns.records.length === 0
      ? undefined
      : { latest: loadedRuns.records[loadedRuns.records.length - 1]!.at, count: loadedRuns.records.length, damaged: loadedRuns.damaged.length };

  const byFolder = new Map<string, { folder: string; specPath: string; parsed: ReturnType<typeof parseSpec> }>();
  for (const specPath of findSpecs(root, config.ignore)) {
    const folder = folderOf(root, specPath);
    const rel = relative(root, specPath).split(sep).join("/");
    const existing = byFolder.get(folder);
    if (existing !== undefined) {
      problems.push({ file: rel, line: 1, message: `a folder holds one spec; ${existing.specPath} is already this component's` });
      continue;
    }
    const parsed = parseSpec(readFileSync(specPath, "utf8"), rel, { seed });
    problems.push(...parsed.problems);
    byFolder.set(folder, { folder, specPath: rel, parsed });
  }

  const folders = new Set(byFolder.keys());
  const entryFolder = folderOf(root, join(resolve(root, config.entryDir), "x"));
  const entry = byFolder.get(entryFolder);
  const trustLevels = entry?.parsed.trustLevels ?? [];
  const levelNames = new Set(trustLevels.map((level) => level.name));

  // Every invariant name in the model, for declared-as lines to resolve against.
  const allNames = new Set<string>();
  for (const { parsed } of byFolder.values()) for (const invariant of parsed.invariants) allNames.add(invariant.name);

  const components: Component[] = [];
  for (const { folder, specPath, parsed } of byFolder.values()) {
    if (parsed.trustLevels !== undefined && folder !== entryFolder) {
      problems.push({
        file: specPath,
        line: parsed.trustLevelsLine ?? 1,
        message: `trust levels are declared in the entry spec only (${entry?.specPath ?? `the spec at ${entryFolder}`})`,
      });
    }
    const seen = new Set<string>();
    const invariants: ModelInvariant[] = [];
    for (const invariant of parsed.invariants) {
      if (seen.has(invariant.name)) {
        problems.push({ file: specPath, line: invariant.line, message: `invariant ${invariant.name} declared twice in this component` });
      }
      seen.add(invariant.name);
      if (invariant.crossing !== undefined) {
        for (const end of [invariant.crossing.from, invariant.crossing.to]) {
          if (levelNames.has(end)) continue;
          const declared = trustLevels.length === 0 ? "no entry spec declares trust levels" : `declared: ${[...levelNames].join(", ")}`;
          problems.push({ file: specPath, line: invariant.crossing.line, message: `crossing on ${invariant.name} names trust level ${end}; ${declared}` });
        }
      }
      // A shape may be declared as the bullet itself: the requirement often is the shape.
      for (const line of invariant.checklist) {
        if (line.outcome !== "declared") continue;
        if (!allNames.has(line.as)) {
          problems.push({ file: specPath, line: line.line, message: `checklist on ${invariant.name}: ${line.shape} declared as "${line.as}", which names no invariant` });
        }
      }
      const applicable = invariant.kinds === undefined || invariant.kinds === "none" ? [] : applicableShapes(seed, invariant.kinds).map((s) => s.shape);
      const mine = latestFor(latest, folder, invariant.name);
      const { state, lacks, missingShapes, verified, defects } = deriveState(invariant, applicable, mine, witnessed.has(entryKey(folder, invariant.name, "totality oracle")));
      const forms = new Set(invariant.enforcements.map((e) => e.form));
      const entries = [forms.has("chokepoint") ? mine.chokepoint : undefined, forms.has("totality oracle") ? mine.totality : undefined].filter(
        (e): e is Latest => e !== undefined,
      );
      invariants.push({ ...invariant, component: folder, applicable, missingShapes, state, lacks, latest: entries, verified, defects });
    }
    const entrances: ModelEntrance[] = parsed.entrances.map((entrance) => {
      if (entrance.handler === undefined || entrance.handler === "") return { ...entrance, component: folder, file: undefined };
      const found = handlerFile(root, folder, entrance.handler, config.ignore);
      if (typeof found !== "string") {
        problems.push({ file: specPath, line: entrance.handlerLine, message: `entrance ${entrance.name}: ${found.reason}` });
        return { ...entrance, component: folder, file: undefined };
      }
      return { ...entrance, component: folder, file: found };
    });
    components.push({
      folder,
      name: parsed.title ?? basename(folder === "." ? root : folder),
      specPath,
      intent: parsed.intent ?? "",
      trustLevels: parsed.trustLevels,
      entrances,
      invariants,
      parent: parentOf(folder, folders),
      children: [],
    });
  }
  components.sort((a, b) => a.folder.localeCompare(b.folder));
  const byName = new Map(components.map((c) => [c.folder, c]));
  for (const component of components) {
    if (component.parent !== undefined) byName.get(component.parent)!.children.push(component.folder);
  }
  problems.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

  const counts = countModel(components, problems);
  return { root, entry: entry === undefined ? undefined : entryFolder, trustLevels, components, problems, counts, runs };
}

const HANDLER = /^([A-Za-z_$][\w$]*)(?:\s+in\s+(\S+))?$/;
const SOURCE = /\.(?:[cm]?[jt]sx?|py)$/;

/** Whether a source text declares the name at its top level (TypeScript, JavaScript, or Python). */
function declaresAtTop(text: string, name: string): boolean {
  const escaped = name.replace(/\$/g, "\\$");
  const typescript = new RegExp(`^(?:export\\s+)?(?:default\\s+)?(?:declare\\s+)?(?:abstract\\s+)?(?:async\\s+)?(?:function\\*?|const|let|var|class|interface|type|enum|namespace)\\s+${escaped}\\b`, "m");
  const python = new RegExp(`^(?:async\\s+)?(?:def|class)\\s+${escaped}\\b|^${escaped}\\s*(?::[^=\\n]+)?=`, "m");
  return typescript.test(text) || python.test(text);
}

/** Source files under a folder, sorted, never into the folders no walk enters. */
function sourcesUnder(root: string, folder: string, ignore: readonly string[]): string[] {
  return walkedFiles(root, folder, ignore).filter((rel) => SOURCE.test(rel));
}

/**
 * The file whose top level declares an entrance's handler, or why none does.
 * `name in file` reads the file relative to the component, then to the root;
 * a bare name searches the component's own source. This is the spec's own
 * check that the handler exists; the language adapter resolves it again at
 * the reading, where reachability is known.
 */
function handlerFile(root: string, folder: string, handler: string, ignore: readonly string[]): string | { reason: string } {
  const parsed = HANDLER.exec(handler.trim());
  if (parsed === null) return { reason: `handler "${handler}" reads <symbol> or <symbol> in <file>` };
  const [, name, file] = parsed as unknown as [string, string, string | undefined];
  const candidates =
    file === undefined
      ? sourcesUnder(root, folder, ignore)
      : [folder === "." ? file : `${folder}/${file}`, file].filter((path, index, all) => all.indexOf(path) === index && !path.split("/").includes(".."));
  for (const candidate of candidates) {
    const path = resolve(root, candidate);
    if (!existsSync(path) || !statSync(path).isFile()) continue;
    if (declaresAtTop(readFileSync(path, "utf8"), name)) return candidate;
  }
  return {
    reason:
      file === undefined
        ? `handler ${name} is declared at the top level of no source file under ${folder}`
        : `handler ${name} is not declared at the top level of ${file} (read under ${folder} and under the root)`,
  };
}

function countModel(components: Component[], problems: Problem[]): Counts {
  const lacking: Record<Lack, number> = { enforcement: 0, refutation: 0, kinds: 0, checklist: 0, because: 0 };
  let bullets = 0;
  let invariants = 0;
  let structuralDefects = 0;
  let unfilled = 0;
  for (const component of components) {
    for (const invariant of component.invariants) {
      bullets += 1;
      if (invariant.state === "invariant") invariants += 1;
      if (invariant.state === "structural defect") structuralDefects += 1;
      for (const lack of invariant.lacks) lacking[lack] += 1;
      unfilled += invariant.unfilled.length;
    }
  }
  return { components: components.length, bullets, invariants, requirements: bullets - invariants - structuralDefects, structuralDefects, lacking, unfilled, problems: problems.length };
}
