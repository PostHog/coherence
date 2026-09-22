/**
 * The agent query: CLI access for the agent to what Scope shows a human, as
 * a small fixed set of questions with plain-text answers. Every answer is a
 * pure function of the shared readings; nothing here reads a file. The
 * glossary CLI supplies full coverage, while a page supplies bounded evidence.
 *
 *   invariants <path...>   which invariants touch these files
 *   relies-on <chokepoint> who references this chokepoint
 *   status                 structural defects, open requirements, escalations
 *   component <folder>     one component and its bullets
 *   order                  the session's active work order, as the journal folds it
 *   economy <path...>      what must be loaded to change these files safely: the
 *                          economy prediction, which the command line answers through
 *                          the economy's own closure and the warm instrument
 *
 * Fixed questions first; no query language.
 */

import {
  allInvariants,
  chokepointNames,
  componentByFolder,
  componentOfFile,
  defectsOf,
  latestOf,
  openEscalations,
  relianceOf,
  shortSession,
  stamp,
  structureOf,
  type RelianceSite,
} from "../scope/derive.ts";
import { FLOW_BANDS, flowLabelLines, flowOf } from "../scope/structure-flow.ts";
import { renderOrder } from "../../journal/workVerbs.ts";
import { glossaryReviewCommand } from "../scope/model.ts";
import type { GlossaryCoverage, RunRecord, ShellState, SpecComponent, SpecInvariant } from "../scope/model.ts";

export const QUESTIONS = ["invariants", "relies-on", "spine", "structure", "status", "component", "order", "economy", "glossary", "observed"] as const;
export type Question = (typeof QUESTIONS)[number];

export function isQuestion(value: string): value is Question {
  return (QUESTIONS as readonly string[]).includes(value);
}

export const QUERY_USAGE = [
  "  query glossary <term>         full live definition, all contexts and uses behind Scope's evidence summary",
  "  query invariants <path...>     which invariants touch these files, by component and by reference site",
  "  query relies-on <chokepoint>   who references this chokepoint, from the latest run",
  "  query spine                    trust levels and every crossing-bearing invariant, in Structure order",
  "  query structure                the edges Structure draws (only invariant-carrying reliance), their invariants, and the ranks",
  "  query status                   structural defects, open requirements, escalations awaiting a human",
  "  query component <folder>       one component: intent, counts, bullets",
  "  query order [--session <id>]   the active work order the session owns, folded from its records, with what binds to it",
  "  query economy <path...>        what must be loaded to change these files safely: the economy prediction, through the instrument",
  "  query observed [<component>] [--failures [--since <commit>]]   each component interface exercised by N tests or never observed, from the latest observation, fresh or stale; failing tests with what broke, the likely site, and the region",
].join("\n");

export interface Answer {
  text: string;
  /** 0 when the question was answered, 64 when it could not be asked. */
  code: number;
}

/** How many lines a list may take before the rest is counted, so an answer stays under a few hundred tokens. */
const LIMIT = 12;

function capped<T>(items: readonly T[], render: (item: T) => string): string[] {
  const lines = items.slice(0, LIMIT).map(render);
  if (items.length > LIMIT) lines.push(`  and ${items.length - LIMIT} more`);
  return lines;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

function within(file: string, folder: string): boolean {
  return folder === "." || file === folder || file.startsWith(`${folder}/`);
}

function enforcementText(invariant: SpecInvariant): string {
  const parts = invariant.enforcements.map((e) => (e.form === "chokepoint" ? `chokepoint ${e.chokepoint} protects ${e.protects}` : `totality oracle "${e.via}"`));
  return parts.length === 0 ? "no enforcement" : parts.join("; ");
}

function invariantLine(invariant: SpecInvariant, note?: string): string {
  const lacks = invariant.lacks.length === 0 ? "" : ` (lacks ${invariant.lacks.join(", ")})`;
  return `  ${invariant.component}/${invariant.name}  ${invariant.state}${lacks}  ${enforcementText(invariant)}${note === undefined ? "" : `  ${note}`}`;
}

/** The last path segment of a spec value like `KERNEL_WRITE_POLICY in policy.ts` or `entities/Hive/policy.ts`. */
function namedFile(value: string): string | undefined {
  const inFile = /\bin\s+(\S+\.[a-z]+)$/.exec(value.trim());
  if (inFile !== null) return inFile[1];
  if (/^[A-Za-z0-9_./@-]+\.[a-z]+$/.test(value.trim()) && value.includes("/")) return value.trim();
  return undefined;
}

/** Whether a path names or lies under a file the invariant's chokepoint enforcement mentions. */
function namesPath(invariant: SpecInvariant, path: string): boolean {
  return chokepointNames(invariant).some(({ chokepoint, protects }) =>
    [chokepoint, protects].some((value) => {
      const file = namedFile(value);
      return file !== undefined && (path === file || path.endsWith(`/${file}`) || file.startsWith(`${path}/`));
    }),
  );
}

/** Whether the latest chokepoint check of the invariant touched the path, as a file or as a folder. */
function touchedPath(invariant: SpecInvariant, path: string, runs: readonly RunRecord[]): boolean {
  return latestOf(invariant, runs).some((l) => l.files.some((f) => f === path || f.startsWith(`${path}/`)) || l.bypasses.some((b) => b.file === path || b.file.startsWith(`${path}/`)));
}

function answerInvariants(state: ShellState, args: string[]): Answer {
  if (args.length === 0) return { text: `query invariants: give at least one path\n${QUERY_USAGE}`, code: 64 };
  const lines: string[] = [];
  const all = allInvariants(state.spec.components);
  for (const raw of args) {
    const path = normalizePath(raw);
    lines.push(path);
    const component = componentOfFile(path, state.spec.components);
    const byComponent = component === undefined ? [] : all.filter((i) => i.component === component.folder);
    const seen = new Set(byComponent.map((i) => `${i.component}/${i.name}`));
    if (component === undefined) lines.push("  in no component: no folder above it holds a spec");
    else {
      lines.push(`  by component ${component.folder === "." ? "(root)" : component.folder} (${component.name}): ${byComponent.length === 0 ? "no bullets" : ""}`);
      lines.push(...capped(byComponent, (i) => invariantLine(i)));
    }
    const bySite = all.filter((i) => !seen.has(`${i.component}/${i.name}`) && (touchedPath(i, path, state.runs.records) || namesPath(i, path)));
    if (bySite.length > 0) {
      lines.push("  by protected thing, chokepoint, or reference site:");
      lines.push(...capped(bySite, (i) => invariantLine(i, touchedPath(i, path, state.runs.records) ? "(a reference site in the latest run)" : "(named on the bullet)")));
    }
    const others = all.filter((i) => !seen.has(`${i.component}/${i.name}`) && !bySite.includes(i) && i.component !== "." && within(path, i.component) === false && path.startsWith(`${i.component}/`) === false && i.component.startsWith(`${path}/`));
    if (others.length > 0) {
      lines.push(`  in components under ${path}:`);
      lines.push(...capped(others, (i) => invariantLine(i)));
    }
  }
  return { text: lines.join("\n"), code: 0 };
}

function answerReliesOn(state: ShellState, args: string[]): Answer {
  const name = args.join(" ").trim();
  if (name === "") return { text: `query relies-on: give a chokepoint name\n${QUERY_USAGE}`, code: 64 };
  const lower = name.toLowerCase();
  const matching = allInvariants(state.spec.components).filter((i) =>
    chokepointNames(i).some(({ chokepoint, protects }) => chokepoint.toLowerCase() === lower || protects.toLowerCase() === lower || chokepoint.toLowerCase().startsWith(`${lower} `) || protects.toLowerCase().startsWith(`${lower} `)) || i.name.toLowerCase() === lower,
  );
  if (matching.length === 0) return { text: `no bullet names chokepoint or protected thing "${name}"; run: query status`, code: 0 };
  const lines: string[] = [];
  for (const invariant of matching) {
    for (const reliance of relianceOf(invariant, state.spec.components, state.runs.records)) {
      lines.push(`${reliance.chokepoint} protects ${reliance.protects}  (${invariant.component}/${invariant.name}, ${invariant.state})`);
      if (reliance.entry === undefined) {
        lines.push(`  ${reliance.evidence.status === "unknown" ? reliance.evidence.reason : "reliance unknown"}; run: run`);
        continue;
      }
      if (reliance.evidence.status === "unknown") {
        lines.push(`  ${reliance.evidence.reason}`);
        continue;
      }
      lines.push(`  from the check at ${stamp(reliance.entry.at)}${reliance.entry.grade === undefined ? "" : `, ${reliance.entry.grade}`}: complete evidence, ${reliance.evidence.sites.length} reference${reliance.evidence.sites.length === 1 ? "" : "s"} to either endpoint`);
      if (reliance.evidence.sites.length === 0) lines.push("  both endpoint queries completed and returned zero references");
      for (const entry of reliance.entries) {
        const who = entry.component === undefined ? "in no component" : `${entry.component.folder === "." ? "(root)" : entry.component.folder} (${entry.component.name})`;
        lines.push(`  ${entry.owner ? "owner " : ""}${who}`);
        lines.push(...capped(entry.sites, (site) => `    ${site.file}:${site.line} in ${site.symbol} — ${relianceSiteText(site)}`));
      }
    }
  }
  return { text: lines.join("\n"), code: 0 };
}

function relianceSiteText(site: RelianceSite): string {
  const target = site.target === "protected" ? "protected thing" : "chokepoint";
  const classification = site.target === "protected" && site.siteClass === "bypass"
    ? "bypass, not a legal chokepoint reference"
    : site.target === "chokepoint" && site.siteClass === "chokepoint-reference"
      ? "reference; runtime call not established"
      : site.siteClass;
  return `${target}; ${classification}${site.form === undefined ? "" : `; ${site.form}`}${site.test ? "; test" : ""}`;
}

/** The text form of the exact ordered model the Structure view draws. */
export function answerSpine(state: ShellState): Answer {
  const model = structureOf(state);
  const lines = [`trust levels (${model.levels.length}):`];
  lines.push(...model.levels.map((level) => `  ${level.name} — ${level.meaning}`));
  lines.push(`crossings (${model.edges.length}):`);
  for (const edge of model.edges) {
    const chokepoints = edge.chokepoints.length === 0
      ? "chokepoint not declared"
      : edge.chokepoints.map((entry) => `${entry.chokepoint} protects ${entry.protects}`).join("; ");
    const grade = edge.grade === undefined ? "grade unknown, enforcer unknown" : `${edge.grade}, enforced by ${edge.enforcer ?? "unknown"}`;
    const bypasses = edge.state === "structural defect" ? `, ${edge.bypassCount} bypass${edge.bypassCount === 1 ? "" : "es"}` : "";
    lines.push(`  ${edge.component}/${edge.name}  ${edge.from} -> ${edge.to}  ${chokepoints}  ${grade}  ${edge.state}${bypasses}${edge.proposed ? "  proposed preview" : ""}`);
  }
  lines.push(`${model.invariantsWithoutCrossing} invariant${model.invariantsWithoutCrossing === 1 ? " has" : "s have"} no crossing`);
  return { text: lines.join("\n"), code: 0 };
}

/**
 * The Structure map as text: the same `flowOf` derivation the view draws, so
 * the component interfaces, their labels, the rows, and the entrances cannot
 * differ between the human reading and the agent's. One interface per line:
 * `caller -> callee  label`, the label lines joined by " · ".
 */
export function answerStructure(state: ShellState): Answer {
  const model = flowOf(state);
  const bearing = model.edges.filter((edge) => edge.loadBearing).length;
  const lines = [
    `evidence: static and computed; ${model.evidence === "language adapter" ? `resolved references through the ${model.language} language adapter` : `run sites only (${model.unread}); plain component interfaces unknown`}`,
    `component interfaces (${model.edges.length}, ${bearing} load-bearing), caller -> callee:`,
  ];
  for (const edge of model.edges) lines.push(`  ${edge.from} -> ${edge.to}  ${flowLabelLines(edge).map((line) => line.text).join(" · ")}`);
  lines.push(`entrances (${model.entrances.length}):`);
  for (const entrance of model.entrances) {
    lines.push(`  ${entrance.declaredBy}/${entrance.name}  ${entrance.handler ?? "no handler"}  ${entrance.reachable ? `starts in ${entrance.start}` : entrance.reason ?? "unreachable"}`);
  }
  lines.push("rows, entrances and callers first:");
  for (let band = 0; band < FLOW_BANDS; band++) {
    const folders = model.nodes.filter((node) => node.band === band).map((node) => node.folder);
    lines.push(`  ${band}  ${folders.length === 0 ? "-" : folders.join(", ")}`);
  }
  const unconnected = model.nodes.filter((node) => node.band === undefined).map((node) => node.folder);
  if (unconnected.length > 0) lines.push(`  no component interface  ${unconnected.join(", ")}`);
  if (model.unowned !== undefined && model.unowned.files > 0) lines.push(`  no component  ${model.unowned.files} files, ${model.unowned.lines} lines`);
  const broken = model.nodes.flatMap((node) => node.defects.filter((d) => d.internal > 0).map((d) => `  ${node.folder}/${d.name}  ${d.state}; ${d.internal} of ${d.bypasses} bypasses inside ${node.folder}, on no component interface`));
  if (broken.length > 0) lines.push("broken chokepoints no interface shows:", ...broken);
  return { text: lines.join("\n"), code: 0 };
}

function answerStatus(state: ShellState): Answer {
  const all = allInvariants(state.spec.components);
  const defects = all.filter((i) => i.state === "structural defect");
  const requirements = all.filter((i) => i.state === "requirement");
  const escalations = openEscalations(state.journal.records);
  const lines: string[] = [];
  lines.push(`structural defects (${defects.length})${defects.length === 0 ? ": none" : ":"}`);
  lines.push(
    ...capped(defects, (i) => {
      const failing = defectsOf(i, state.runs.records);
      const sites = failing.flatMap((d) => d.bypasses).map((b) => `${b.file}:${b.line} in ${b.symbol}`);
      const reason = failing.map((d) => d.reason).join("; ");
      return `  ✕ ${i.component}/${i.name}: ${sites.length > 0 ? `bypass ${sites.join(", ")}` : reason}`;
    }),
  );
  lines.push(`open requirements (${requirements.length})${requirements.length === 0 ? ": none" : ":"}`);
  lines.push(...capped(requirements, (i) => `  ○ ${i.component}/${i.name}  lacks ${i.lacks.length === 0 ? "nothing; the latest run is missing" : i.lacks.join(", ")}`));
  lines.push(`escalations awaiting a human (${escalations.length})${escalations.length === 0 ? ": none" : ":"}`);
  lines.push(...capped(escalations, (e) => `  ▲ ${e.id} ${e.agent} (${shortSession(e.session)}): ${e.what}`));
  const c = state.spec.counts;
  lines.push(`${c.components} components, ${c.bullets} bullets: ${c.invariants} invariants, ${c.requirements} requirements, ${c.structuralDefects} structural defects; ${state.runs.records.length} runs, ${state.journal.records.length} journal records`);
  return { text: lines.join("\n"), code: 0 };
}

function findComponent(state: ShellState, given: string): SpecComponent | undefined {
  const folder = normalizePath(given);
  const byFolder = componentByFolder(state.spec.components, folder === "" ? "." : folder);
  if (byFolder !== undefined) return byFolder;
  const lower = given.trim().toLowerCase();
  return state.spec.components.find((c) => c.name.toLowerCase() === lower);
}

function answerComponent(state: ShellState, args: string[]): Answer {
  const given = args.join(" ").trim();
  if (given === "") return { text: `query component: give a folder\n${QUERY_USAGE}`, code: 64 };
  const component = findComponent(state, given);
  if (component === undefined) {
    return { text: `no component at "${given}"; components: ${state.spec.components.map((c) => c.folder).join(", ")}`, code: 0 };
  }
  const invariants = component.invariants.filter((i) => i.state === "invariant").length;
  const defects = component.invariants.filter((i) => i.state === "structural defect").length;
  const requirements = component.invariants.length - invariants - defects;
  const lines = [
    `${component.name}  ${component.folder === "." ? "(root)" : component.folder}  ${component.specPath}`,
    `  ${component.intent === "" ? "no intent line" : component.intent}`,
    `  ${component.invariants.length} bullets: ${invariants} invariants, ${requirements} requirements, ${defects} structural defects; mass: not measured`,
  ];
  if (component.trustLevels !== undefined) lines.push(`  trust levels: ${component.trustLevels.map((l) => l.name).join(", ")}`);
  if (component.parent !== undefined) lines.push(`  within ${component.parent}`);
  if (component.children.length > 0) lines.push(`  contains ${component.children.join(", ")}`);
  lines.push(...capped(component.invariants, (i) => invariantLine(i)));
  return { text: lines.join("\n"), code: 0 };
}

function answerOrder(state: ShellState, session: string | undefined): Answer {
  const work = state.journal.work;
  if (work.kind === "absent") return { text: `no work orders: ${work.because}`, code: 0 };
  const active = work.orders.filter((o) => o.state === "active");
  const mine = session === undefined ? active : active.filter((o) => o.owner === session);
  if (mine.length === 0) {
    const who = session === undefined ? "" : ` for session ${session}`;
    return { text: `no active work order${who} (${work.orders.length} on record${active.length > 0 ? `, ${active.length} active` : ""})`, code: 0 };
  }
  return { text: mine.map((order) => renderOrder(order, state.journal.records, state.runs.records).join("\n")).join("\n"), code: 0 };
}

export interface QueryOptions {
  session?: string | undefined;
}

/** Render either the full authoritative reading or an explicitly labelled page selection. */
export function answerGlossary(report: GlossaryCoverage | undefined, args: string[]): Answer {
  if (args.length !== 1 || args[0]!.trim() === "") return { text: "query glossary needs one term", code: 64 };
  if (!report) return { text: "No vocabulary usage reading is available in this page state.", code: 64 };
  const term = args[0]!.trim().toLowerCase();
  const terms = report.terms.filter((t) =>
    t.term === term || t.concept?.toLowerCase() === term || t.meaningAlternatives?.some((meaning) => meaning.concept.toLowerCase() === term));
  const fullReading = glossaryReviewCommand(args[0]!.trim());
  const lines = report.projection ? [
    `Bounded page evidence: ${report.terms.length} of ${report.totals.terms} terms embedded; ${report.totals.terms - report.terms.length} terms omitted. Matching terms, contexts or uses may be omitted.`,
    `Full reading from the project's root: ${fullReading}`,
  ] : ["Full observed candidate reading (not exhaustive semantic coverage)."];
  if (terms.length === 0) {
    lines.push(report.projection
      ? "No matching term in the page selection; this does not establish absence from the full corpus."
      : "No observed uses matched in the full candidate reading; absence is not a semantic coverage claim.");
  }
  for (const t of terms) {
    const contexts = t.contextCount ?? t.contexts.length;
    const meaning = t.meaningAlternatives !== undefined && t.meaningAlternatives.length > 0
      ? [`${t.term} [${t.state}] — ${t.meaningAlternatives.length} applicable property meanings; spelling alone does not select an owner`,
          ...t.meaningAlternatives.map((item) => `  applicable property meaning: ${item.concept} (${item.layer}) — ${item.definition}; properties ${JSON.stringify(item.properties)}; confusables ${item.confusables.join("; ") || "none declared"}`)]
      : [`${t.term} [${t.state}] — ${t.definition ?? "No settled definition"}`,
          `Properties: ${JSON.stringify(t.properties)}; confusables: ${t.confusables.join("; ") || "none declared"}`];
    lines.push(
      ...meaning,
      `${t.contexts.length} of ${contexts} contexts shown; ${contexts - t.contexts.length} contexts omitted.`,
      ...t.contexts.map((c) => `  ${c.component}: ${c.disposition}${c.because ? " — " + c.because : ""} (${c.fingerprint})`),
      ...t.uses.map((u) => `  ${u.file}:${u.line} ${u.text}`),
      `${t.uses.length} of ${t.count} uses shown; ${t.count - t.uses.length} uses omitted.`,
      `Full JSON reading: ${glossaryReviewCommand(t.term)}`,
    );
  }
  return { text: lines.join("\n"), code: 0 };
}

/** Answer one question from the state. */
export function answer(state: ShellState, question: string, args: string[], options: QueryOptions = {}): Answer {
  switch (question) {
    case "glossary":
      return answerGlossary(state.glossary.coverage, args);
    case "invariants":
      return answerInvariants(state, args);
    case "relies-on":
      return answerReliesOn(state, args);
    case "spine":
      return args.length === 0 ? answerSpine(state) : { text: `query spine takes no arguments\n${QUERY_USAGE}`, code: 64 };
    case "structure":
      return args.length === 0 ? answerStructure(state) : { text: `query structure takes no arguments\n${QUERY_USAGE}`, code: 64 };
    case "status":
      return answerStatus(state);
    case "component":
      return answerComponent(state, args);
    case "order":
      return answerOrder(state, options.session);
    case "economy":
      return { text: `query economy is answered from the instrument, not from the page state; run it from the command line: query economy <path...>\n${QUERY_USAGE}`, code: 64 };
    default:
      return { text: `query: unknown question "${question}"\n${QUERY_USAGE}`, code: 64 };
  }
}
