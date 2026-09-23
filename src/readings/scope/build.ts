/**
 * Build the Scope reading: one self-contained HTML file.
 *
 * The builder loads Coherence's glossary (and the project's domain glossary
 * of the same shape, when it has one), the spec model, the run records, and
 * the journal records into the model once, embeds that state in the page as
 * JSON, and inlines the styles and the browser script. It renders nothing
 * itself: the browser turns the crank on the embedded state. The same files
 * in produce a byte-identical page out.
 *
 *   npm run scope -- [--root <project>] [--glossary docs/glossary.json] [--domain path.json]
 *                    [--domain-title "Domain glossary"] [--project <name>] [--out public/_scope.html]
 *
 * With --root the page is built over another project: its spec tree, its
 * .coherence/runs, .coherence/journal and .coherence/work, and its glossary
 * (named in coherence.config.json under `glossary`, else glossary.json at
 * its root) as the domain layer beneath Coherence's own.
 */

import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { adapterFor } from "../../adapters/index.ts";
import { readEnforcementConfig } from "../../enforcement/config.ts";
import { loadRuns } from "../../enforcement/record.ts";
import { loadJournal } from "../../journal/store.ts";
import { WORK_DIR, foldOrders, loadWork as loadWorkRecords, workDir } from "../../journal/work.ts";
import { glossaryCoverage } from "../../lifecycle/glossary-coverage.ts";
import { COHERENCE_GLOSSARY, projectGlossaryPath } from "../../lifecycle/project.ts";
import { loadSpecModel } from "../../spec/model.ts";
import { projectGlossaryCoverage } from "./glossary-projection.ts";
import { windowJournal, windowRuns } from "./derive.ts";
import { escapeHtml } from "./html.ts";
import { readComponentInterfaces } from "./component-interfaces.ts";
import { parseGlossary, type Glossary, type InterfaceReading, type Ladder, type LadderRung, type Layer, type ShellState, type SpecData, type StructurePreview, type WorkData } from "./model.ts";
import { VIEWS } from "./shell.ts";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The browser bundle, in dependency order. Each file may import the ones
 * before it; the relative imports are removed when the files are joined into
 * one inline module, and types are stripped by Node's own stripper.
 */
const BROWSER_SOURCES = [
  "html.ts",
  "model.ts",
  "derive.ts",
  "structure-flow.ts",
  "glossary-view.ts",
  "components-view.ts",
  "structure-measure.ts",
  "structure-flow-view.ts",
  "structure-view.ts",
  "invariants-view.ts",
  "runs-view.ts",
  "journal-view.ts",
  "shell.ts",
  "page.ts",
];

export interface BuildOptions {
  /** The project root whose specs, runs, journal and work are read. The working directory when absent. */
  root?: string;
  /** Path to Coherence's own glossary. */
  glossaryPath: string;
  /** Path to a project domain glossary of the same shape. Located from the root's config when absent. */
  domainPath?: string;
  /** Heading for the domain layer. Derived from the file's project name when not given. */
  domainTitle?: string;
  /** Project name shown in the masthead. */
  project: string;
  /** Ephemeral proposed crossings embedded only in this generated page. */
  structurePreview?: readonly StructurePreview[];
  /** False keeps every run and journal record in the state; the agent query reads them all. A page embeds a bounded window (default). */
  window?: boolean;
  /** The component interfaces as the language adapter read them (readComponentInterfaces); unread when absent. */
  componentInterfaces?: InterfaceReading;
}

export const DEFAULTS = {
  glossaryPath: "docs/glossary.json",
  outPath: "public/_scope.html",
  domainTitle: "Domain glossary",
  project: "Coherence",
} as const;

async function readGlossary(path: string): Promise<Glossary> {
  const text = await readFile(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${path}: not valid JSON (${(error as Error).message})`);
  }
  return parseGlossary(parsed, path);
}

function capitalize(text: string): string {
  return text.length === 0 ? text : text[0]!.toUpperCase() + text.slice(1);
}

/** The domain layer's heading: as given, else from the file's project name, else the default. */
function domainTitle(options: BuildOptions, glossary: Glossary | undefined): string {
  if (options.domainTitle !== undefined) return options.domainTitle;
  if (glossary?.project !== undefined) return `${capitalize(glossary.project)} glossary`;
  return DEFAULTS.domainTitle;
}

/**
 * The grade ladder as the project's adapter defines it, each rung naming who
 * enforces it. The top rung and its because are the adapter's; the rungs
 * below are Coherence's own and the same for every language.
 */
export function ladderFor(root: string): Ladder {
  const language = readEnforcementConfig(root).language;
  const adapter = adapterFor(language, root).ladder;
  const rungs: LadderRung[] = [];
  if (adapter.top === "visibility-choked") {
    rungs.push({ grade: "visibility-choked", enforcedBy: `the language itself: ${adapter.because}` });
    rungs.push({
      grade: "reference-choked",
      enforcedBy: "Coherence's chokepoint check, at the edit and in the run: the protected thing is visible outside its module, and every resolved reference in the project is inside the chokepoint; a consumer outside the repository could still bypass",
    });
  } else {
    rungs.push({
      grade: "reference-choked",
      enforcedBy: `Coherence's chokepoint check, at the edit and in the run; the top rung for ${language} because ${adapter.because}`,
    });
  }
  rungs.push({
    grade: "broken",
    enforcedBy: "nobody: a reference outside the chokepoint stands, or the chokepoint cannot be resolved; a structural defect until every reference is routed through the chokepoint or a human acknowledges a retirement",
  });
  rungs.push({
    grade: "not chokeable",
    enforcedBy: "no structure: the protected thing cannot be resolved as a symbol or a module, so no reference can be counted; a totality oracle is the compromise and the bullet must say why structure was unavailable",
  });
  return { language, rungs };
}

/**
 * The spec model as the page carries it: the tool's own facts, minus the
 * machine's absolute root. The value is passed through JSON once so that a
 * field the model left undefined is absent, exactly as the page will embed
 * it: the state in memory and the state in the page are the same value.
 */
export function loadSpec(root: string): SpecData {
  const model = loadSpecModel(root);
  const data: SpecData = {
    entry: model.entry,
    trustLevels: model.trustLevels.map((level) => ({ name: level.name, meaning: level.meaning })),
    // The spec model carries each bullet's latest run entries; the page does not. They are the
    // run records, which the page already holds, read by enforcement: derive.ts reads them back
    // at render so no copy can disagree with the records it came from.
    components: model.components.map((component) => ({
      ...component,
      invariants: component.invariants.map(({ latest: _latest, verified: _verified, defects: _defects, ...invariant }) => invariant),
    })),
    problems: model.problems,
    counts: model.counts,
    ladder: ladderFor(root),
  };
  return JSON.parse(JSON.stringify(data)) as SpecData;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The work orders as the journal folds them: every record under
 * .coherence/work is read through the journal's own loader, and each order
 * is the fold of its records (content, owner now, current state, history).
 * Absent when the folder does not exist; a line that will not parse is
 * reported. The page never re-derives an order from the raw store.
 */
export function loadWork(root: string): WorkData {
  if (!existsSync(workDir(root))) return { kind: "absent", because: `${WORK_DIR} does not exist under this project; the journal keeps no work orders yet.` };
  const loaded = loadWorkRecords(root);
  return { kind: "present", orders: foldOrders(loaded), damaged: loaded.damaged };
}

/** The domain glossary path: as given, else the root's own when it is not Coherence's glossary itself. */
async function domainPathFor(options: BuildOptions, root: string): Promise<string | undefined> {
  if (options.domainPath !== undefined) return options.domainPath;
  const located = await projectGlossaryPath(root);
  if (located === undefined) return undefined;
  if (resolve(located) === resolve(options.glossaryPath) || resolve(located) === COHERENCE_GLOSSARY) return undefined;
  return located;
}

/** Load every truth into the shell's state. Absence of the domain layer is a rendered fact. */
export async function loadState(options: BuildOptions): Promise<ShellState> {
  const root = resolve(options.root ?? process.cwd());
  const coherence: Layer = {
    kind: "present",
    id: "coherence",
    title: `${options.project} glossary`,
    glossary: await readGlossary(options.glossaryPath),
  };
  const domainPath = await domainPathFor(options, root);
  const domainGlossary = domainPath === undefined ? undefined : await readGlossary(domainPath);
  const domain: Layer =
    domainGlossary === undefined
      ? {
          kind: "absent",
          id: "domain",
          title: domainTitle(options, undefined),
          because:
            "No domain glossary is present. Supply a second glossary file of the same shape to read the project's own vocabulary beneath Coherence's.",
        }
      : {
          kind: "present",
          id: "domain",
          title: domainTitle(options, domainGlossary),
          glossary: domainGlossary,
        };
  const runs = loadRuns(root);
  const journal = loadJournal(root);
  const spec = loadSpec(root);
  if (options.structurePreview !== undefined) {
    const levels = new Set(spec.trustLevels.map((level) => level.name));
    for (const preview of options.structurePreview) {
      if (!spec.components.some((component) => component.folder === preview.component)) throw new Error(`Structure preview: no component at ${preview.component}`);
      if (preview.name.trim() === "") throw new Error("Structure preview: invariant name is empty");
      if (spec.components.some((component) => component.folder === preview.component && component.invariants.some((invariant) => invariant.name === preview.name))) {
        throw new Error(`Structure preview: invariant ${preview.name} already exists in ${preview.component}`);
      }
      for (const end of [preview.crossing.from, preview.crossing.to]) {
        if (!levels.has(end)) throw new Error(`Structure preview: crossing names trust level ${end}; declared: ${[...levels].join(", ") || "none"}`);
      }
    }
  }
  return {
    project: options.project,
    views: VIEWS.map((v) => ({ id: v.id, label: v.label })),
    activeView: options.structurePreview === undefined || options.structurePreview.length === 0 ? "glossary" : "structure",
    glossary: { layers: [coherence, domain], query: "", coverage: projectGlossaryCoverage(await glossaryCoverage(root)) },
    spec,
    runs: { records: runs.records, damaged: runs.damaged },
    journal: { records: journal.records, damaged: journal.damaged, work: loadWork(root) },
    componentInterfaces: options.componentInterfaces ?? { kind: "unread", because: "no instrument was asked when this page was built" },
    components: { query: "" },
    structure: { preview: options.structurePreview === undefined ? [] : options.structurePreview.map((proposal) => ({ ...proposal, crossing: { ...proposal.crossing }, ...(proposal.chokepoints === undefined ? {} : { chokepoints: proposal.chokepoints.map((entry) => ({ ...entry })) }) })) },
    invariants: { query: "", state: "", component: "" },
    runsView: { query: "" },
    journalView: { query: "", kind: "", agent: "", session: "" },
  };
}

/**
 * The state a page embeds: every store whole except the two that grow with
 * every session, the run records and the journal, which are bounded windows
 * that keep every derivation the views make exact (see windowRuns and
 * windowJournal) and carry the count of what they leave out. The agent query
 * builds without the window, so its answers read every record.
 */
function windowed(state: ShellState): ShellState {
  const runs = windowRuns(state.runs.records);
  const journal = windowJournal(state.journal.records, undefined, state.journal.work.kind === "present" ? state.journal.work.orders : []);
  return {
    ...state,
    runs: { ...state.runs, records: runs.records, ...(runs.omitted === 0 ? {} : { omitted: runs.omitted }) },
    journal: { ...state.journal, records: journal.records, ...(journal.omitted === 0 ? {} : { omitted: journal.omitted }) },
  };
}

/** Strip one source file to JavaScript and drop its relative imports. */
function toBrowserModule(source: string, name: string): string {
  const stripped = stripTypeScriptTypes(source, { mode: "strip" });
  // A relative import may span several lines; `[^;]` crosses them.
  return stripped.replace(/^import\s[^;]*from\s+["']\.\/[^"']*["'];[^\S\n]*$/gm, "").concat(`\n// end of ${name}\n`);
}

/** The names a stripped module declares at its top level. */
function topLevelNames(module: string): string[] {
  return [...module.matchAll(/^(?:export )?(?:async )?(?:function|const|let|class) ([A-Za-z_$][A-Za-z0-9_$]*)/gm)].map((m) => m[1]!);
}

/**
 * The browser sources joined into one module. One module has one name space,
 * so a top-level name declared in two sources is refused here, by name, rather
 * than shipped as a page whose script fails to parse.
 */
async function browserScript(): Promise<string> {
  const parts: string[] = [];
  const declared = new Map<string, string>();
  for (const name of BROWSER_SOURCES) {
    const source = await readFile(resolve(here, name), "utf8");
    const module = toBrowserModule(source, name);
    for (const declaredName of topLevelNames(module)) {
      const earlier = declared.get(declaredName);
      if (earlier !== undefined) throw new Error(`Scope: ${name} declares ${declaredName} at top level, which ${earlier} already declares; the inline module has one name space`);
      declared.set(declaredName, name);
    }
    parts.push(module);
  }
  return parts.join("\n");
}

/** JSON that is safe inside a script element: no `<` can close it. */
function embedJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/** The Latin range of IBM Plex Mono's split build: every character a path, a symbol, or an identifier on the map uses. */
const PLEX_LATIN = "U+0020-007E, U+00A0-00FF, U+0131, U+0152-0153, U+02C6, U+02DA, U+02DC, U+2013-2014, U+2018-201A, U+201C-201E, U+2020-2022, U+2026, U+2030, U+2039-203A, U+2044, U+20AC, U+2122, U+2212, U+FB01-FB02";

/**
 * IBM Plex Mono for code-ish text (paths, symbols, identifiers), embedded as
 * base64 woff2 so the page stays self-contained: the regular weight of the
 * Latin subset the package ships (17.5 KB, 23.4 KB as base64), the only
 * weight the map and the page set mono text in; the medium weight would push
 * the page with a domain glossary past its 2 MB budget. Without the package
 * the page falls back to the monospace stack it names after Plex.
 */
async function plexMono(): Promise<string> {
  const faces: string[] = [];
  for (const [weight, file] of [[400, "Regular"]] as const) {
    try {
      const bytes = await readFile(resolve(here, `../../../node_modules/@ibm/plex-mono/fonts/split/woff2/IBMPlexMono-${file}-Latin1.woff2`));
      faces.push(`@font-face { font-family: "IBM Plex Mono"; font-style: normal; font-weight: ${weight}; font-display: swap; src: url(data:font/woff2;base64,${bytes.toString("base64")}) format("woff2"); unicode-range: ${PLEX_LATIN}; }`);
    } catch {
      return "";
    }
  }
  return `/* IBM Plex Mono 2.5.0, Copyright © 2017 IBM Corp. with Reserved Font Name "Plex", licensed under the SIL Open Font License, Version 1.1 (https://openfontlicense.org). Regular, Latin subset, embedded unmodified. */\n${faces.join("\n")}\n`;
}

/** Render the page document around the state. Deterministic for the same inputs. */
export async function buildScopePage(options: BuildOptions): Promise<{ html: string; state: ShellState }> {
  const loaded = await loadState(options);
  const state = options.window === false ? loaded : windowed(loaded);
  const css = (await plexMono()) + (await readFile(resolve(here, "styles.css"), "utf8"));
  const script = await browserScript();
  const title = `${options.project} Scope`;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(title)}</title>
<style>
${css}
</style>
</head>
<body>
<noscript><p style="padding:1.25rem;font-family:system-ui,sans-serif">This reading renders from the state embedded in this file and needs scripts enabled to show it.</p></noscript>
<div id="scope-root"></div>
<script type="application/json" id="scope-state">${embedJson(state)}</script>
<script type="module">
${script}
</script>
</body>
</html>
`;
  return { html, state };
}

export async function writeScopePage(options: BuildOptions, outPath: string): Promise<{ bytes: number; state: ShellState }> {
  const { html, state } = await buildScopePage(options);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, html, "utf8");
  return { bytes: Buffer.byteLength(html, "utf8"), state };
}

/**
 * Build a read-only project state with one ephemeral proposed crossing, select
 * Structure initially, and write only the requested generated page.
 */
export async function writeStructurePreview(root: string, preview: StructurePreview, outPath: string): Promise<{ bytes: number; state: ShellState }> {
  const projectRoot = resolve(root);
  const output = resolve(outPath);
  const withinRoot = relative(projectRoot, output);
  if (withinRoot === "" || (!withinRoot.startsWith(`..${sep}`) && withinRoot !== "..")) {
    throw new Error("Structure preview: write the generated page outside the project root so it cannot perturb the project's inputs");
  }
  return writeScopePage(
    { root: projectRoot, glossaryPath: COHERENCE_GLOSSARY, project: projectNameOf(projectRoot), structurePreview: [preview] },
    output,
  );
}

/** The project's name from its config, capitalized, else its folder name. */
function projectNameOf(root: string): string {
  const path = resolve(root, "coherence.config.json");
  if (existsSync(path)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
      if (isRecord(parsed) && typeof parsed["name"] === "string" && parsed["name"] !== "") return capitalize(parsed["name"]);
    } catch {
      // A config that will not parse is the spec model's to refuse, with its path.
    }
  }
  return capitalize(basename(root));
}

async function main(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      root: { type: "string" },
      glossary: { type: "string" },
      domain: { type: "string" },
      "domain-title": { type: "string" },
      project: { type: "string" },
      out: { type: "string", default: DEFAULTS.outPath },
      "no-interfaces": { type: "boolean", default: false },
    },
  });
  const root = values.root === undefined ? process.cwd() : resolve(values.root);
  const options: BuildOptions = {
    root,
    glossaryPath: values.glossary ?? (values.root === undefined ? DEFAULTS.glossaryPath : COHERENCE_GLOSSARY),
    project: values.project ?? (values.root === undefined ? DEFAULTS.project : projectNameOf(root)),
  };
  // Structure reads every component interface through the language adapter; --no-interfaces builds without the instrument.
  if (values["no-interfaces"] !== true) options.componentInterfaces = await readComponentInterfaces(root);
  if (values.domain !== undefined) options.domainPath = values.domain;
  if (values["domain-title"] !== undefined) options.domainTitle = values["domain-title"];
  const { bytes, state } = await writeScopePage(options, values.out);
  const first = state.glossary.layers[0];
  const count = first?.kind === "present" ? first.glossary.concepts.length : 0;
  const domain = state.glossary.layers[1]?.kind === "present" ? "with a domain glossary" : "no domain glossary";
  const c = state.spec.counts;
  console.log(
    `Scope: wrote ${values.out} (${bytes} bytes, ${count} concepts, ${domain}, ${c.components} components, ${c.bullets} bullets, ${state.runs.records.length} runs, ${state.journal.records.length} journal records).`,
  );
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
