/**
 * The model: every spec under a root, read into components, trust levels,
 * and invariants with their lifecycle state.
 *
 * A component is any folder with a spec file; nesting follows the folders,
 * with folders that hold no spec transparent. The entry component (the
 * config's entryDir, else the root) declares the trust levels crossings
 * name. Cross-spec facts are checked here: crossings against trust levels,
 * declared-as names against the invariants that exist, names unique within
 * a component, an entrance's declared trust against the declared levels and
 * against the crossings on its handler. State is derived from what the
 * bullet carries and, when runs exist under .coherence/runs, from the latest
 * run that checked each enforcement; with no run every enforcement reports as
 * declared, unverified.
 */

import { existsSync, statSync } from "node:fs";
import { countWork, readProjectText } from "../lifecycle/work-meter.ts";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { isModuleHandler, parseSpec, type Entrance, type Invariant, type Problem, type TrustLevel } from "./grammar.ts";
import { applicableShapes, loadSeed, type Seed } from "./seed.ts";
import { entryKey, latestByEnforcement, latestFor, loadRuns, parseLine as parseRunLine, witnessedRefutations, type Latest } from "../enforcement/record.ts";
import { latestSeeing } from "../enforcement/run-index.ts";
import { keptParses, listedContent, readContent } from "../lifecycle/kept-parse.ts";
import { deriveState, type Lack, type State } from "./state.ts";
import { underIgnored, walkBounds, walkedProjectFiles } from "../adapters/project-files.ts";
import { effectiveConfig } from "../adapters/project-config.ts";
import { PRACTICE_SUFFIX, parsePractices } from "./practice.ts";
import { kernelPractices, enactmentsIn, isCoherenceTree, journalRecords, modelPractice, practiceProblems, stemOf, type ModelPractice } from "./practices.ts";

export const SPEC_SUFFIX = ".spec.md";
export const CONFIG_FILE = "coherence.config.json";

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
  /** Who owns it, as the spec's owners: line declares; absent when it declares none. Declared, never routed on. */
  owners?: string[];
  trustLevels: TrustLevel[] | undefined;
  /** Where work enters through this component, as its spec declares; each handler was found declared in the code. */
  entrances: ModelEntrance[];
  invariants: ModelInvariant[];
  /** The practice file paired with the spec, when there is one. */
  practicePath: string | undefined;
  /** The component's practices, from its practice file. */
  practices: ModelPractice[];
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
  const config: Config = { ignore: [], entryDir: "." };
  // The project's own config over its registry's keys (project-config.ts); a malformed file is refused with its path.
  const found = effectiveConfig(root);
  if (found === undefined) return config;
  const record = found.record;
  if (Array.isArray(record["ignore"])) config.ignore = record["ignore"].filter((v): v is string => typeof v === "string");
  if (typeof record["entryDir"] === "string") config.entryDir = record["entryDir"];
  return config;
}

/** Every spec file under the root, sorted by path. */
export function findSpecs(root: string, ignore: readonly string[] = []): string[] {
  return walkedFiles(root, ".", ignore).filter((rel) => rel.endsWith(SPEC_SUFFIX)).map((rel) => join(root, rel)).sort();
}

/**
 * The project's own files under a folder that the walk reads
 * (walkedProjectFiles), project-relative: a spec in a nested checkout is
 * another tree's component, and its source is not this project's.
 */
function walkedFiles(root: string, folder: string, ignore: readonly string[]): string[] {
  const prefix = folder === "." || folder === "" ? "" : folder.replace(/\/+$/, "") + "/";
  return walkedProjectFiles(walkBounds(root, ignore)).files.filter((rel) => rel.startsWith(prefix));
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

/** One chokepoint invariant as the check at an edit reads it: its component, its enforcements, and the files its latest run saw. */
export interface ChokepointEntry {
  component: string;
  name: string;
  enforcements: Invariant["enforcements"];
  latest: { form: "chokepoint"; files: string[] }[];
}

/** The shape of a kept spec parse for the chokepoint index; a store of another shape, or one other code made, is read again. */
const CHOKEPOINT_PARSE_SHAPE = "chokepoints-1";

/**
 * Every chokepoint invariant in the project, the light way an edit can
 * afford: the specs the spec model would read, named by content and each
 * parsed once and kept while its content stands (kept-parse.ts), with no
 * state derived and no practice, handler or journal read; and, for each of
 * `written`, whether an invariant's latest run saw it, from the run index
 * (run-index.ts), never from the run history. An edit to no spec reads no
 * spec; one that touches an invariant runs the check, which loads the model.
 */
export function chokepointIndex(rootGiven: string, written: readonly string[] = []): ChokepointEntry[] {
  const root = resolve(rootGiven);
  const config = readConfig(root);
  const skip = new Set(config.ignore);
  // git names each spec by its content; outside git every spec is read and hashed.
  const listed =
    listedContent(root, [`:(glob)**/*${SPEC_SUFFIX}`], "spec")?.filter((f) => !underIgnored(f.rel, skip)) ??
    readContent(root, findSpecs(root, config.ignore).map((path) => relative(root, path).split(sep).join("/")), "spec");
  const parsed = keptParses(root, "chokepoint-index", CHOKEPOINT_PARSE_SHAPE, listed, "spec", (text, rel) =>
    parseSpec(text, rel).invariants.filter((i) => i.enforcements.some((e) => e.form === "chokepoint")).map((i) => ({ name: i.name, enforcements: i.enforcements })),
  );
  const seeing = written.length === 0 ? new Map<string, Set<string>>() : latestSeeing(root, written, parseRunLine);
  const out: ChokepointEntry[] = [];
  const seen = new Set<string>();
  for (const { rel } of listed) {
    const folder = folderOf(root, join(root, rel));
    // A folder holds one spec, as the model reads it: a second is a problem there, and nothing here.
    if (seen.has(folder)) continue;
    seen.add(folder);
    for (const invariant of parsed.get(rel) ?? []) {
      const key = entryKey(folder, invariant.name, "chokepoint");
      const files = written.filter((file) => seeing.get(file)?.has(key) === true);
      out.push({ component: folder, name: invariant.name, enforcements: invariant.enforcements, latest: files.length === 0 ? [] : [{ form: "chokepoint", files }] });
    }
  }
  return out;
}

export interface LoadOptions {
  seed?: Seed | undefined;
  /** Read .coherence/runs and derive run-informed state (default true). */
  runs?: boolean | undefined;
}

export function loadSpecModel(rootGiven: string, options: LoadOptions = {}): SpecModel {
  countWork("spec model");
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
    const parsed = parseSpec(readProjectText(specPath, "spec"), rel, { seed });
    problems.push(...parsed.problems);
    byFolder.set(folder, { folder, specPath: rel, parsed });
  }

  // A practice file stands beside its folder's spec, with the spec's stem (d-861e8319).
  const practiceFiles = new Map<string, { file: string; parsed: ReturnType<typeof parsePractices> }>();
  for (const rel of walkedFiles(root, ".", config.ignore).filter((f) => f.endsWith(PRACTICE_SUFFIX)).sort()) {
    const folder = folderOf(root, join(root, rel));
    const spec = byFolder.get(folder);
    if (spec === undefined) {
      problems.push({ file: rel, line: 1, message: `a practice file is paired with a spec; ${folder === "." ? "the root" : folder} has none (a spec and its practice file are always paired)` });
      continue;
    }
    if (stemOf(rel) !== stemOf(spec.specPath)) {
      problems.push({ file: rel, line: 1, message: `a practice file takes its spec's stem: ${stemOf(spec.specPath)}${PRACTICE_SUFFIX} beside ${spec.specPath}` });
      continue;
    }
    if (practiceFiles.has(folder)) {
      problems.push({ file: rel, line: 1, message: `a folder holds one practice file; ${practiceFiles.get(folder)!.file} is already this component's` });
      continue;
    }
    const parsed = parsePractices(readProjectText(join(root, rel), "practice"), rel);
    problems.push(...parsed.problems);
    practiceFiles.set(folder, { file: rel, parsed });
  }
  const records = practiceFiles.size === 0 ? [] : journalRecords(root);
  const enactments = enactmentsIn(records);

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
    const paired = practiceFiles.get(folder);
    const practices = (paired?.parsed.practices ?? []).map((practice) => modelPractice(practice, `${folder}/${practice.name}`, folder, paired!.file, enactments));
    components.push({
      folder,
      name: parsed.title ?? basename(folder === "." ? root : folder),
      specPath,
      intent: parsed.intent ?? "",
      ...(parsed.owners === undefined ? {} : { owners: parsed.owners }),
      trustLevels: parsed.trustLevels,
      entrances,
      invariants,
      practicePath: paired?.file,
      practices,
      parent: parentOf(folder, folders),
      children: [],
    });
  }
  components.sort((a, b) => a.folder.localeCompare(b.folder));
  problems.push(...entranceTrustProblems(components, trustLevels));
  problems.push(...entranceGuardProblems(root, components));
  problems.push(
    ...practiceProblems({
      root,
      practices: components.flatMap((c) => c.practices),
      invariantsByFolder: new Map(components.map((c) => [c.folder, new Set(c.invariants.map((i) => i.name))])),
      coherenceTree: practiceFiles.size === 0 ? true : isCoherenceTree(root),
      records,
    }),
  );
  const byName = new Map(components.map((c) => [c.folder, c]));
  for (const component of components) {
    if (component.parent !== undefined) byName.get(component.parent)!.children.push(component.folder);
  }
  problems.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

  const counts = countModel(components, problems);
  return { root, entry: entry === undefined ? undefined : entryFolder, trustLevels, components, problems, counts, runs };
}

/** The component whose folder holds a project-relative file: the deepest component folder above it. */
export function componentHolding<C extends Pick<Component, "folder">>(components: readonly C[], file: string): C | undefined {
  let best: C | undefined;
  for (const component of components) {
    const inside = component.folder === "." || file.startsWith(`${component.folder}/`);
    if (inside && (best === undefined || component.folder.length > best.folder.length || best.folder === ".")) best = component;
  }
  return best;
}

/**
 * An entrance's declared trust, checked (decision d-ba18b0fd): it names a
 * trust level the entry spec declares, and every crossing whose chokepoint is
 * its handler, in the component holding the handler, enters from that level.
 * The crossing's entering side is the trust the handler receives; a
 * declaration that disagrees is two statements of one fact, one of them wrong,
 * so it is a problem and never a warning.
 */
function entranceTrustProblems(components: readonly Component[], trustLevels: readonly TrustLevel[]): Problem[] {
  const problems: Problem[] = [];
  const names = new Set(trustLevels.map((level) => level.name));
  for (const component of components) {
    for (const entrance of component.entrances) {
      if (entrance.trust === undefined) continue;
      const line = entrance.trustLine ?? entrance.line;
      if (!names.has(entrance.trust)) {
        const declared = trustLevels.length === 0 ? "no entry spec declares trust levels" : `declared: ${[...names].join(", ")}`;
        problems.push({ file: component.specPath, line, message: `entrance ${entrance.name} declares trust ${entrance.trust}, which is no trust level; ${declared}` });
        continue;
      }
      const handler = entrance.handler === undefined ? undefined : HANDLER.exec(entrance.handler.trim())?.[1];
      const holder = entrance.file === undefined ? undefined : componentHolding(components, entrance.file);
      if (handler === undefined || holder === undefined) continue;
      for (const invariant of holder.invariants) {
        if (invariant.crossing === undefined || invariant.crossing.from === entrance.trust) continue;
        if (!invariant.enforcements.some((e) => e.form === "chokepoint" && HANDLER.exec(e.chokepoint.trim())?.[1] === handler)) continue;
        problems.push({
          file: component.specPath,
          line,
          message: `entrance ${entrance.name} declares trust ${entrance.trust}, but its handler ${handler} is the chokepoint of ${invariant.name} in ${holder.specPath}, whose crossing enters from ${invariant.crossing.from}`,
        });
      }
    }
  }
  return problems;
}

const HANDLER = /^([A-Za-z_$][\w$]*)(?:\s+in\s+(\S+))?$/;

/**
 * An entrance's declared guard, checked (d-127ab8e4): it names a chokepoint
 * some invariant declares, by its symbol, or a symbol declared at the top
 * level of a chokepoint that is a module. That its handler really is
 * registered through it is the reading's to confirm, where references resolve.
 */
function entranceGuardProblems(root: string, components: readonly Component[]): Problem[] {
  const problems: Problem[] = [];
  const chokepoints = components.flatMap((c) => c.invariants.flatMap((invariant) => invariant.enforcements.flatMap((e) => (e.form === "chokepoint" ? [{ component: c, value: e.chokepoint.trim() }] : []))));
  for (const component of components) {
    for (const entrance of component.entrances) {
      if (entrance.guard === undefined) continue;
      const guard = HANDLER.exec(entrance.guard.trim());
      const line = entrance.guardLine ?? entrance.line;
      if (guard === null) {
        problems.push({ file: component.specPath, line, message: `entrance ${entrance.name}: guard "${entrance.guard}" reads <chokepoint symbol> or <symbol> in <file>` });
        continue;
      }
      const name = guard[1]!;
      const named = chokepoints.some(({ component: owner, value }) => {
        const symbol = HANDLER.exec(value)?.[1];
        if (symbol !== undefined) return symbol === name;
        if (!SOURCE.test(value)) return false;
        return [owner.folder === "." ? value : `${owner.folder}/${value}`, value].some((path) => {
          const at = resolve(root, path);
          return existsSync(at) && statSync(at).isFile() && declaresAtTop(readProjectText(at, "source"), name);
        });
      });
      if (!named) {
        const listed = chokepoints.length === 0 ? "no invariant declares a chokepoint" : `declared chokepoints: ${[...new Set(chokepoints.map((c) => c.value))].join(", ")}`;
        problems.push({ file: component.specPath, line, message: `entrance ${entrance.name}: guard ${name} is no chokepoint an invariant declares, nor a symbol of a chokepoint module; ${listed}` });
      }
    }
  }
  return problems;
}
const SOURCE = /\.(?:[cm]?[jt]sx?|py)$/;

/**
 * Whether a source text declares the name at its top level (TypeScript,
 * JavaScript, or Python). A destructured binding counts, on one line or
 * across several and however deeply nested, as a factory's products are
 * exported (export const { handlers: { GET, POST }, auth } = NextAuth(...));
 * so does an export list, with or without a from, under the name it exports
 * (export { GET, POST } from "./auth", export { handle as GET }): the
 * re-exporting file is where a framework finds the name, and the source is
 * not followed (d-7155e46f).
 */
export function declaresAtTop(text: string, name: string): boolean {
  const escaped = name.replace(/\$/g, "\\$");
  const typescript = new RegExp(`^(?:export\\s+)?(?:default\\s+)?(?:declare\\s+)?(?:abstract\\s+)?(?:async\\s+)?(?:function\\*?|const|let|var|class|interface|type|enum|namespace)\\s+${escaped}\\b`, "m");
  if (destructuredAtTop(text).has(name) || exportListed(text).has(name)) return true;
  const python = new RegExp(`^(?:async\\s+)?(?:def|class)\\s+${escaped}\\b|^${escaped}\\s*(?::[^=\\n]+)?=`, "m");
  return typescript.test(text) || python.test(text);
}

/** The text of the braces opening at `open`, through its matching close, or undefined when it never closes. */
function braced(text: string, open: number): string | undefined {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}" && --depth === 0) return text.slice(open, i + 1);
  }
  return undefined;
}

/** The names a top-level object destructuring binds, on one line or several, nested or not: a name followed by , } or = (a key followed by : binds nothing). */
function destructuredAtTop(text: string): Set<string> {
  const names = new Set<string>();
  for (const m of text.matchAll(/^(?:export\s+)?(?:const|let|var)\s*(?=\{)/gm)) {
    const open = m.index + m[0].length;
    const pattern = braced(text, open);
    if (pattern === undefined || !/^\s*(?::[^=]+)?=/.test(text.slice(open + pattern.length))) continue;
    for (const b of pattern.matchAll(/(?<=[\s,{:])([A-Za-z_$][\w$]*)(?=\s*[,}=])/g)) names.add(b[1]!);
  }
  return names;
}

/** The names a top-level export list exports, with or without a from: export { a, b as c } from "x" exports a and c. */
function exportListed(text: string): Set<string> {
  const names = new Set<string>();
  for (const m of text.matchAll(/^export\s+(?:type\s+)?\{([^}]*)\}/gm)) {
    for (const item of m[1]!.split(",")) {
      const named = /^\s*(?:type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$/.exec(item.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ""));
      if (named !== null) names.add(named[2] ?? named[1]!);
    }
  }
  return names;
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
  if (isModuleHandler(handler)) {
    // A module file: its top-level script is the handler. It must be a source file that exists, under the component or the root.
    const file = handler.trim();
    if (!SOURCE.test(file)) return { reason: `handler ${file} names a file that is not source code` };
    const candidates = [folder === "." ? file : `${folder}/${file}`, file].filter((path, index, all) => all.indexOf(path) === index && !path.split("/").includes(".."));
    for (const candidate of candidates) {
      const path = resolve(root, candidate);
      if (existsSync(path) && statSync(path).isFile()) return candidate;
    }
    return { reason: `handler module ${file} does not exist (read under ${folder} and under the root)` };
  }
  const parsed = HANDLER.exec(handler.trim());
  if (parsed === null) return { reason: `handler "${handler}" reads <symbol>, <symbol> in <file>, or a module file` };
  const [, name, file] = parsed as unknown as [string, string, string | undefined];
  const candidates =
    file === undefined
      ? sourcesUnder(root, folder, ignore)
      : [folder === "." ? file : `${folder}/${file}`, file].filter((path, index, all) => all.indexOf(path) === index && !path.split("/").includes(".."));
  for (const candidate of candidates) {
    const path = resolve(root, candidate);
    if (!existsSync(path) || !statSync(path).isFile()) continue;
    if (declaresAtTop(readProjectText(path, "source"), name)) return candidate;
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

/**
 * Every practice a session at this root may enact: the project's own, from
 * its practice files, and in an adopter the practices of Coherence's own
 * kernel practices, read from where Coherence is installed, their ids led by coherence:.
 */
export function projectPractices(root: string, model: SpecModel = loadSpecModel(root, { runs: false })): ModelPractice[] {
  const own = model.components.flatMap((c) => c.practices);
  if (isCoherenceTree(root)) return own;
  return [...own, ...kernelPractices(enactmentsIn(journalRecords(root)))];
}
