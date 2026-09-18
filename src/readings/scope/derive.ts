/**
 * Derivations the views share: everything computed from the state on every
 * render and stored nowhere. The latest verdict per enforcement, which
 * enforcements a run kept from an earlier one, reliance, open escalations,
 * the statuses later journal records confer, card ids, and how a hash finds
 * its view.
 */

import { slug } from "./html.ts";
import type {
  Grade,
  JournalKind,
  JournalRecord,
  LatestEntry,
  RunRecord,
  ShellState,
  RecordedSite,
  SpecComponent,
  SpecInvariant,
  StructurePreview,
  TrustLevel,
} from "./model.ts";

export type { StructurePreview } from "./model.ts";

/* ------------------------------------------------------------- matching */

/** Whether the lower-cased query appears in any of the fields. */
export function textMatches(query: string, ...fields: (string | number | string[] | undefined | null)[]): boolean {
  if (query === "") return true;
  return fields
    .flat()
    .filter((f): f is string | number => f !== undefined && f !== null)
    .map(String)
    .join("\n")
    .toLowerCase()
    .includes(query);
}

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** A date and minute from an ISO time, for a margin. */
export function stamp(at: string): string {
  return `${at.slice(0, 10)} ${at.slice(11, 16)}`;
}

/** The first eight characters of a session id, enough to tell sessions apart on a page. */
export function shortSession(session: string): string {
  return session.length > 8 ? session.slice(0, 8) : session;
}

/* ------------------------------------------------------------------ ids */

export function componentId(folder: string): string {
  return `component-${folder === "." ? "root" : slug(folder)}`;
}

export function invariantId(component: string, name: string): string {
  return `invariant-${component === "." ? "root" : slug(component)}-${slug(name)}`;
}

export function relianceId(component: string, name: string): string {
  return `reliance-${component === "." ? "root" : slug(component)}-${slug(name)}`;
}

/** The id shared by a drawn crossing and its expandable Structure reading. */
export function structureId(component: string, name: string): string {
  return `structure-${component === "." ? "root" : slug(component)}-${slug(name)}`;
}

export function runId(record: RunRecord): string {
  return `run-${slug(record.at)}-${slug(shortSession(record.session))}`;
}

export function journalId(record: JournalRecord): string {
  return `journal-${slug(record.id)}`;
}

export function workId(id: string): string {
  return `work-${slug(id)}`;
}

/** The prefixes each view's card ids carry; a hash resolves to its view by them. */
const ID_PREFIXES: [string, string][] = [
  ["structure-", "structure"],
  ["component-", "components"],
  ["invariant-", "invariants"],
  ["reliance-", "reliance"],
  ["run-", "runs"],
  ["journal-", "journal"],
  ["work-", "journal"],
  ["coherence-", "glossary"],
  ["domain-", "glossary"],
  ["layer-", "glossary"],
];

export interface HashTarget {
  view: string;
  /** The element to scroll to, or undefined when the hash names a view alone. */
  id: string | undefined;
}

/** Which view a hash lands in, and which element within it. Undefined for a hash no view claims. */
export function resolveHash(state: ShellState, hash: string): HashTarget | undefined {
  const text = hash.startsWith("#") ? hash.slice(1) : hash;
  if (text === "") return undefined;
  if (state.views.some((v) => v.id === text)) return { view: text, id: undefined };
  for (const [prefix, view] of ID_PREFIXES) {
    if (text.startsWith(prefix)) return { view, id: text };
  }
  return undefined;
}

/** The component a hash names, when it names one. */
export function componentOfHash(state: ShellState, id: string): SpecComponent | undefined {
  return state.spec.components.find((c) => componentId(c.folder) === id);
}

/* ---------------------------------------------------------------- runs */

export function entryKey(component: string, name: string, form: string): string {
  return `${component} ${name} ${form}`;
}

/** The latest entry per enforcement across every run, oldest record first so the last write wins. */
export function latestByEnforcement(records: readonly RunRecord[]): Map<string, LatestEntry> {
  const latest = new Map<string, LatestEntry>();
  for (const record of records) {
    for (const entry of record.invariants) {
      latest.set(entryKey(entry.component, entry.name, entry.form), { ...entry, at: record.at, commit: record.commit, session: record.session });
    }
  }
  return latest;
}

export function latestRun(records: readonly RunRecord[]): RunRecord | undefined {
  return records[records.length - 1];
}

/** Enforcements whose latest verdict the latest run did not produce: kept, dated, from an earlier run. */
export function keptFromEarlier(records: readonly RunRecord[]): LatestEntry[] {
  const last = latestRun(records);
  if (last === undefined) return [];
  const inLatest = new Set(last.invariants.map((e) => entryKey(e.component, e.name, e.form)));
  return [...latestByEnforcement(records).entries()].filter(([key]) => !inLatest.has(key)).map(([, entry]) => entry);
}

/** Whether a verdict shown for an invariant came from a run before the latest. */
export function isKept(entry: LatestEntry, records: readonly RunRecord[]): boolean {
  const last = latestRun(records);
  return last !== undefined && entry.at !== last.at;
}

export interface VerdictCounts {
  pass: number;
  fail: number;
  notRun: number;
}

export function verdictCounts(record: RunRecord): VerdictCounts {
  const counts: VerdictCounts = { pass: 0, fail: 0, notRun: 0 };
  for (const entry of record.invariants) {
    if (entry.verdict === "pass") counts.pass += 1;
    else if (entry.verdict === "fail") counts.fail += 1;
    else counts.notRun += 1;
  }
  return counts;
}

/* ------------------------------------------------------- latest verdicts */

/**
 * The latest run entry per enforcement of one bullet, derived from the run
 * records the state already holds. The rule is the run's own: the last run
 * that checked an enforcement owns its verdict, so an enforcement a later run
 * skipped keeps the one it was given, dated. Nothing is stored: a copy beside
 * the records would be a second truth that could disagree with them.
 */
export function latestOf(invariant: SpecInvariant, runs: readonly RunRecord[]): LatestEntry[] {
  const byForm = new Map<string, LatestEntry>();
  for (const run of runs) {
    for (const entry of run.invariants) {
      if (entry.component !== invariant.component || entry.name !== invariant.name) continue;
      byForm.set(entry.form, { ...entry, at: run.at, commit: run.commit, session: run.session });
    }
  }
  return [...byForm.values()].sort((a, b) => a.form.localeCompare(b.form));
}

/** The enforcements the latest run found passing. */
export function verifiedOf(invariant: SpecInvariant, runs: readonly RunRecord[]): LatestEntry[] {
  return latestOf(invariant, runs).filter((e) => e.verdict === "pass");
}

/** The enforcements the latest run found failing: the structural defects. */
export function defectsOf(invariant: SpecInvariant, runs: readonly RunRecord[]): LatestEntry[] {
  return latestOf(invariant, runs).filter((e) => e.verdict === "fail");
}

/* ------------------------------------------------------------ reliance */

/** One declared chokepoint on a crossing-bearing invariant. */
export interface StructureChokepoint {
  chokepoint: string;
  protects: string;
}

/** One classified reference to either endpoint of a chokepoint claim. */
export interface RelianceSite {
  file: string;
  line: number;
  symbol: string;
  target: RecordedSite["of"];
  siteClass: RecordedSite["class"];
  form: RecordedSite["form"] | undefined;
  /** The component containing the site, or undefined when no declared component contains it. */
  component: SpecComponent | undefined;
  /** Whether the site belongs to the component that owns the invariant. */
  owner: boolean;
  test: boolean;
}

/** Complete means both endpoint queries completed; unknown never means empty. */
export type RelianceEvidence =
  | { status: "complete"; sites: RelianceSite[] }
  | { status: "unknown"; reason: string };

/** The component whose folder is the longest prefix of the file, or undefined when no component holds it. */
export function componentOfFile(file: string, components: readonly SpecComponent[]): SpecComponent | undefined {
  let best: SpecComponent | undefined;
  for (const component of components) {
    if (component.folder === ".") {
      best ??= component;
      continue;
    }
    if (file === component.folder || file.startsWith(`${component.folder}/`)) {
      if (best === undefined || best.folder === "." || component.folder.length > best.folder.length) best = component;
    }
  }
  return best;
}

export function isTestFile(file: string): boolean {
  const parts = file.split("/");
  if (parts.some((part) => part === "__tests__" || part === "test" || part === "tests")) return true;
  return /\.(test|spec)\.[a-z]+$/.test(parts[parts.length - 1] ?? "");
}

function relianceEvidenceOf(
  invariant: SpecInvariant,
  components: readonly SpecComponent[],
  entry: LatestEntry | undefined,
): RelianceEvidence {
  if (entry === undefined) return { status: "unknown", reason: "reliance unknown: no run has checked this chokepoint" };
  if (entry.sites === undefined) {
    return { status: "unknown", reason: "reliance unknown: run carries no sites; evidence is incomplete (legacy or unavailable)" };
  }
  const sites = entry.sites
    .map((site): RelianceSite => {
      const component = componentOfFile(site.file, components);
      return {
        file: site.file,
        line: site.line,
        symbol: site.symbol,
        target: site.of,
        siteClass: site.class,
        form: site.form,
        component,
        owner: component?.folder === invariant.component,
        test: site.test,
      };
    })
    .sort(
      (a, b) =>
        Number(b.owner) - Number(a.owner) ||
        (a.component?.folder ?? "~").localeCompare(b.component?.folder ?? "~") ||
        a.file.localeCompare(b.file) ||
        a.line - b.line ||
        a.target.localeCompare(b.target) ||
        a.siteClass.localeCompare(b.siteClass) ||
        a.symbol.localeCompare(b.symbol),
    );
  return { status: "complete", sites };
}

export interface RelianceEntry {
  component: SpecComponent | undefined;
  owner: boolean;
  sites: RelianceSite[];
}

export interface Reliance {
  invariant: SpecInvariant;
  chokepoint: string;
  protects: string;
  /** The latest chokepoint entry, when one exists. */
  entry: LatestEntry | undefined;
  evidence: RelianceEvidence;
  /** Complete sites grouped owner first, then by component folder. Empty while evidence is unknown. */
  entries: RelianceEntry[];
}

/**
 * Every chokepoint invariant with actual classified references to both the
 * chokepoint and protected thing. Site absence is incomplete evidence; a
 * present empty array alone confirms zero references.
 */
export function relianceOf(invariant: SpecInvariant, components: readonly SpecComponent[], runs: readonly RunRecord[]): Reliance[] {
  const entry = latestOf(invariant, runs).find((candidate) => candidate.form === "chokepoint");
  return invariant.enforcements.flatMap((enforcement) => {
    if (enforcement.form !== "chokepoint") return [];
    const evidence = relianceEvidenceOf(invariant, components, entry);
    const byFolder = new Map<string, RelianceEntry>();
    if (evidence.status === "complete") {
      for (const site of evidence.sites) {
        const key = site.component?.folder ?? "";
        const existing = byFolder.get(key);
        if (existing === undefined) byFolder.set(key, { component: site.component, owner: site.owner, sites: [site] });
        else existing.sites.push(site);
      }
    }
    const entries = [...byFolder.values()].sort(
      (a, b) => Number(b.owner) - Number(a.owner) || (a.component?.folder ?? "~").localeCompare(b.component?.folder ?? "~"),
    );
    return [{ invariant, chokepoint: enforcement.chokepoint, protects: enforcement.protects, entry, evidence, entries }];
  });
}

export function allReliance(components: readonly SpecComponent[], runs: readonly RunRecord[]): Reliance[] {
  return components.flatMap((component) => component.invariants.flatMap((invariant) => relianceOf(invariant, components, runs)));
}

/* ------------------------------------------------------------ structure */

/** One crossing-bearing invariant, ready for a renderer or the text query. */
export interface StructureEdge {
  id: string;
  component: string;
  name: string;
  from: string;
  to: string;
  chokepoints: StructureChokepoint[];
  grade: Grade | undefined;
  enforcer: string | undefined;
  verdict: "pass" | "fail" | "not run" | "unverified";
  state: SpecInvariant["state"];
  bypassCount: number;
  proposed: boolean;
  reliance: RelianceEvidence;
}

/** The complete pure input to the Structure render. No coordinates live here. */
export interface StructureModel {
  /** Declaration order from the entry spec; the order carries no semantic rank. */
  levels: TrustLevel[];
  /** Component order, then invariant declaration order; proposed edges follow in caller order. */
  edges: StructureEdge[];
  /** Existing project invariants omitted because they declare no crossing. */
  invariantsWithoutCrossing: number;
}

/** The enforcer name at the start of a ladder rung's longer explanatory sentence. */
function structureEnforcerName(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  return text.split(/[,:;]/, 1)[0]?.trim();
}

function structureEdgeOf(state: ShellState, invariant: SpecInvariant): StructureEdge | undefined {
  if (invariant.crossing === undefined) return undefined;
  const latest = latestOf(invariant, state.runs.records).find((entry) => entry.form === "chokepoint");
  const rung = latest?.grade === undefined ? undefined : state.spec.ladder.rungs.find((candidate) => candidate.grade === latest.grade);
  const hasChokepoint = invariant.enforcements.some((enforcement) => enforcement.form === "chokepoint");
  return {
    id: structureId(invariant.component, invariant.name),
    component: invariant.component,
    name: invariant.name,
    from: invariant.crossing.from,
    to: invariant.crossing.to,
    chokepoints: invariant.enforcements.flatMap((enforcement) =>
      enforcement.form === "chokepoint" ? [{ chokepoint: enforcement.chokepoint, protects: enforcement.protects }] : [],
    ),
    grade: latest?.grade,
    enforcer: latest?.enforcer ?? structureEnforcerName(rung?.enforcedBy),
    verdict: latest?.verdict ?? "unverified",
    state: invariant.state,
    bypassCount: latest?.bypasses.length ?? 0,
    proposed: false,
    reliance: hasChokepoint
      ? relianceEvidenceOf(invariant, state.spec.components, latest)
      : { status: "unknown", reason: "reliance unknown: invariant declares no chokepoint" },
  };
}

/**
 * Derive the security spine from crossings alone. Existing edges retain the
 * spec model's stable component/declaration order. Preview invariants are
 * ephemeral additions in caller order, with no invented verdict or reliance.
 */
export function structureOf(state: ShellState, preview: readonly StructurePreview[] = state.structure.preview): StructureModel {
  const invariants = allInvariants(state.spec.components);
  const edges = invariants.flatMap((invariant) => {
    const edge = structureEdgeOf(state, invariant);
    return edge === undefined ? [] : [edge];
  });
  for (const proposal of preview) {
    edges.push({
      id: structureId(proposal.component, proposal.name),
      component: proposal.component,
      name: proposal.name,
      from: proposal.crossing.from,
      to: proposal.crossing.to,
      chokepoints: proposal.chokepoints === undefined ? [] : [...proposal.chokepoints],
      grade: undefined,
      enforcer: undefined,
      verdict: "unverified",
      state: "requirement",
      bypassCount: 0,
      proposed: true,
      reliance: { status: "unknown", reason: "reliance unknown: proposed preview has no run evidence" },
    });
  }
  return {
    levels: state.spec.trustLevels,
    edges,
    invariantsWithoutCrossing: invariants.filter((invariant) => invariant.crossing === undefined).length,
  };
}

/* ------------------------------------------------------------- journal */

export const GLYPH: Record<JournalKind, string> = {
  decision: "◆",
  retraction: "↺",
  conjecture: "?",
  resolution: "✓",
  dismissal: "−",
  defect: "!",
  experiment: "▷",
  close: "▶",
  unable: "⊘",
  escalation: "▲",
  acknowledgement: "△",
};

export const JOURNAL_KINDS: readonly JournalKind[] = Object.keys(GLYPH) as JournalKind[];

/** Records that point at an earlier record carry its id in `of`. */
export function pointsAt(record: JournalRecord): string | null {
  switch (record.kind) {
    case "retraction":
    case "resolution":
    case "dismissal":
    case "close":
    case "acknowledgement":
      return record.of;
    default:
      return null;
  }
}

/** Escalations with no acknowledgement pointing at them, oldest first. */
export function openEscalations(records: readonly JournalRecord[]): (JournalRecord & { kind: "escalation" })[] {
  const acknowledged = new Set(records.filter((r) => r.kind === "acknowledgement").map((r) => pointsAt(r)));
  return records.filter((r): r is JournalRecord & { kind: "escalation" } => r.kind === "escalation" && !acknowledged.has(r.id));
}

/** The status each record has acquired from later records that point at it, as "resolved by rs-…". */
export function journalStatuses(records: readonly JournalRecord[]): Map<string, string> {
  const status = new Map<string, string>();
  for (const record of records) {
    const of = pointsAt(record);
    if (of === null) continue;
    const label =
      record.kind === "close"
        ? `closed by ${record.id}: ${record.outcome}`
        : record.kind === "retraction"
          ? `retracted by ${record.id}`
          : record.kind === "resolution"
            ? `resolved by ${record.id}`
            : record.kind === "dismissal"
              ? `dismissed by ${record.id}`
              : `acknowledged by ${record.id}`;
    status.set(of, label);
  }
  return status;
}

/** The one line that stands for a record. */
export function subjectOf(record: JournalRecord): string {
  switch (record.kind) {
    case "decision":
      return record.chose;
    case "conjecture":
      return record.observation;
    case "defect":
    case "unable":
    case "escalation":
      return record.what;
    case "experiment":
      return record.expectation;
    case "retraction":
      return `retracted ${record.of}`;
    case "resolution":
      return `resolved ${record.of}`;
    case "dismissal":
      return `dismissed ${record.of}`;
    case "close":
      return `closed ${record.of}: ${record.outcome}`;
    case "acknowledgement":
      return `acknowledged ${record.of}`;
  }
}

/** Every text a record carries, for search. */
export function journalText(record: JournalRecord): string[] {
  const head = [record.id, record.kind, record.agent, record.session, record.commit ?? ""];
  switch (record.kind) {
    case "decision":
      return [...head, record.chose, record.because, ...(record.over === "none" ? [] : record.over)];
    case "conjecture":
      return [...head, record.observation, record.discriminatedBy, ...record.couldBe];
    case "defect":
      return [...head, record.what, record.evidence, ...record.files];
    case "experiment":
      return [...head, record.expectation, ...record.context, ...record.actions.map((s) => s.text), ...record.criteria.map((s) => s.text)];
    case "close":
      return [...head, record.of, record.outcome];
    case "resolution":
      return [...head, record.of, record.because, record.as ?? ""];
    case "unable":
    case "escalation":
      return [...head, record.what, record.because];
    case "retraction":
    case "dismissal":
    case "acknowledgement":
      return [...head, record.of, record.because];
  }
}

/** Distinct values of a field across records, in first-seen order. */
export function distinct(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/* -------------------------------------------------------------- model */

/** Every invariant in the model, in component order. */
export function allInvariants(components: readonly SpecComponent[]): SpecInvariant[] {
  return components.flatMap((c) => c.invariants);
}

export function componentByFolder(components: readonly SpecComponent[], folder: string): SpecComponent | undefined {
  return components.find((c) => c.folder === folder);
}

/** The components as a tree: each with its depth, parents before children, siblings in folder order. */
export function componentTree(components: readonly SpecComponent[]): { component: SpecComponent; depth: number }[] {
  const byFolder = new Map(components.map((c) => [c.folder, c]));
  const out: { component: SpecComponent; depth: number }[] = [];
  const visit = (component: SpecComponent, depth: number): void => {
    out.push({ component, depth });
    for (const child of [...component.children].sort()) {
      const c = byFolder.get(child);
      if (c !== undefined) visit(c, depth + 1);
    }
  };
  for (const component of components) if (component.parent === undefined) visit(component, 0);
  return out;
}

/** A chokepoint enforcement's names, for matching a query against a chokepoint. */
export function chokepointNames(invariant: SpecInvariant): { chokepoint: string; protects: string }[] {
  return invariant.enforcements.flatMap((e) => (e.form === "chokepoint" ? [{ chokepoint: e.chokepoint, protects: e.protects }] : []));
}
