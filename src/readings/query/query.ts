/**
 * The agent query: CLI access for the agent to what Scope shows a human, as
 * a small fixed set of questions with plain-text answers. Every answer is a
 * pure function of the same `ShellState` the page renders; nothing here
 * reads a file.
 *
 *   invariants <path...>   which invariants touch these files
 *   relies-on <chokepoint> who references this chokepoint
 *   status                 structural defects, open requirements, escalations
 *   component <folder>     one component and its bullets
 *   order                  the session's active work order, as the journal folds it
 *
 * Fixed questions first; no query language.
 */

import {
  allInvariants,
  chokepointNames,
  componentByFolder,
  componentOfFile,
  openEscalations,
  relianceOf,
  shortSession,
  stamp,
} from "../scope/derive.ts";
import { renderOrder } from "../../journal/workVerbs.ts";
import type { ShellState, SpecComponent, SpecInvariant } from "../scope/model.ts";

export const QUESTIONS = ["invariants", "relies-on", "status", "component", "order"] as const;
export type Question = (typeof QUESTIONS)[number];

export function isQuestion(value: string): value is Question {
  return (QUESTIONS as readonly string[]).includes(value);
}

export const QUERY_USAGE = [
  "  query invariants <path...>     which invariants touch these files, by component and by reference site",
  "  query relies-on <chokepoint>   who references this chokepoint, from the latest run",
  "  query status                   structural defects, open requirements, escalations awaiting a human",
  "  query component <folder>       one component: intent, counts, bullets",
  "  query order [--session <id>]   the active work order the session owns, folded from its records, with what binds to it",
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
function touchedPath(invariant: SpecInvariant, path: string): boolean {
  return invariant.latest.some((l) => l.files.some((f) => f === path || f.startsWith(`${path}/`)) || l.bypasses.some((b) => b.file === path || b.file.startsWith(`${path}/`)));
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
    const bySite = all.filter((i) => !seen.has(`${i.component}/${i.name}`) && (touchedPath(i, path) || namesPath(i, path)));
    if (bySite.length > 0) {
      lines.push("  by protected thing, chokepoint, or reference site:");
      lines.push(...capped(bySite, (i) => invariantLine(i, touchedPath(i, path) ? "(a reference site in the latest run)" : "(named on the bullet)")));
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
    for (const reliance of relianceOf(invariant, state.spec.components)) {
      lines.push(`${reliance.chokepoint} protects ${reliance.protects}  (${invariant.component}/${invariant.name}, ${invariant.state})`);
      if (reliance.entry === undefined) {
        lines.push("  no run has checked this chokepoint; run: run");
        continue;
      }
      const others = reliance.entries.filter((e) => !e.owner);
      lines.push(`  from the check at ${stamp(reliance.entry.at)}${reliance.entry.grade === undefined ? "" : `, ${reliance.entry.grade}`}: ${others.length === 0 ? "no component outside the owner references the protected thing" : `${others.length} relying component${others.length === 1 ? "" : "s"}`}`);
      for (const entry of reliance.entries) {
        const who = entry.component === undefined ? "in no component" : `${entry.component.folder === "." ? "(root)" : entry.component.folder} (${entry.component.name})`;
        lines.push(`  ${entry.owner ? "owner " : ""}${who}: ${entry.files.join(", ")}`);
      }
      if (reliance.entry.bypasses.length > 0) lines.push(...capped(reliance.entry.bypasses, (b) => `  bypass ${b.file}:${b.line} in ${b.symbol}`));
    }
  }
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
      const sites = i.defects.flatMap((d) => d.bypasses).map((b) => `${b.file}:${b.line} in ${b.symbol}`);
      const reason = i.defects.map((d) => d.reason).join("; ");
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

/** Answer one question from the state. */
export function answer(state: ShellState, question: string, args: string[], options: QueryOptions = {}): Answer {
  switch (question) {
    case "invariants":
      return answerInvariants(state, args);
    case "relies-on":
      return answerReliesOn(state, args);
    case "status":
      return answerStatus(state);
    case "component":
      return answerComponent(state, args);
    case "order":
      return answerOrder(state, options.session);
    default:
      return { text: `query: unknown question "${question}"\n${QUERY_USAGE}`, code: 64 };
  }
}
