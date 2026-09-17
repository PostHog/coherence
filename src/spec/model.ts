/**
 * The model: every spec under a root, read into components, trust levels,
 * and invariants with their lifecycle state.
 *
 * A component is any folder with a spec file; nesting follows the folders,
 * with folders that hold no spec transparent. The entry component (the
 * config's entryDir, else the root) declares the trust levels crossings
 * name. Cross-spec facts are checked here: crossings against trust levels,
 * declared-as names against the invariants that exist, names unique within
 * a component. State is derived statically from what the bullet carries;
 * whether an enforcement actually detects is the language server's question
 * (slice three), so every enforcement reports as declared, unverified.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { parseSpec, type Invariant, type Problem, type TrustLevel } from "./grammar.ts";
import { applicableShapes, loadSeed, type Seed } from "./seed.ts";
import { deriveState, type Lack, type State } from "./state.ts";

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
}

export interface Component {
  /** Relative to the root, with "." for the root itself. */
  folder: string;
  name: string;
  specPath: string;
  intent: string;
  trustLevels: TrustLevel[] | undefined;
  invariants: ModelInvariant[];
  parent: string | undefined;
  children: string[];
}

export interface Counts {
  components: number;
  bullets: number;
  invariants: number;
  requirements: number;
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
  const skip = new Set([...EXCLUDED_FOLDERS, ...ignore]);
  const found: string[] = [];
  const walk = (dir: string): void => {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (skip.has(entry.name) || skip.has(relative(root, path))) continue;
        walk(path);
      } else if (entry.isFile() && entry.name.endsWith(SPEC_SUFFIX)) {
        found.push(path);
      }
    }
  };
  walk(root);
  return found.sort();
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
}

export function loadSpecModel(rootGiven: string, options: LoadOptions = {}): SpecModel {
  const root = resolve(rootGiven);
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error(`${root}: not a folder`);
  const seed = options.seed ?? loadSeed();
  const config = readConfig(root);
  const problems: Problem[] = [];

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
      for (const line of invariant.checklist) {
        if (line.outcome !== "declared") continue;
        if (line.as === invariant.name) {
          problems.push({ file: specPath, line: line.line, message: `checklist on ${invariant.name}: ${line.shape} declared as itself` });
        } else if (!allNames.has(line.as)) {
          problems.push({ file: specPath, line: line.line, message: `checklist on ${invariant.name}: ${line.shape} declared as "${line.as}", which names no invariant` });
        }
      }
      const applicable = invariant.kinds === undefined || invariant.kinds === "none" ? [] : applicableShapes(seed, invariant.kinds).map((s) => s.shape);
      const { state, lacks, missingShapes } = deriveState(invariant, applicable);
      invariants.push({ ...invariant, component: folder, applicable, missingShapes, state, lacks });
    }
    components.push({
      folder,
      name: parsed.title ?? basename(folder === "." ? root : folder),
      specPath,
      intent: parsed.intent ?? "",
      trustLevels: parsed.trustLevels,
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
  return { root, entry: entry === undefined ? undefined : entryFolder, trustLevels, components, problems, counts };
}

function countModel(components: Component[], problems: Problem[]): Counts {
  const lacking: Record<Lack, number> = { enforcement: 0, refutation: 0, kinds: 0, checklist: 0, because: 0 };
  let bullets = 0;
  let invariants = 0;
  let unfilled = 0;
  for (const component of components) {
    for (const invariant of component.invariants) {
      bullets += 1;
      if (invariant.state === "invariant") invariants += 1;
      for (const lack of invariant.lacks) lacking[lack] += 1;
      unfilled += invariant.unfilled.length;
    }
  }
  return { components: components.length, bullets, invariants, requirements: bullets - invariants, lacking, unfilled, problems: problems.length };
}
