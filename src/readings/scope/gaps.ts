/**
 * Spec gaps at hook time (d-a1095ef2): the entrances whose trust comes from
 * outside the system's control, or is unknown, with no traced control on
 * their structural route and no control: none, as orient and regulate name
 * them, and what the scaffold closes.
 *
 * Structure needs the component interfaces, a language-server pass that takes
 * a minute on Coherence and three on a large adopter, so no hook ever runs
 * one. What a hook reads instead is the last complete reading, recorded
 * under .coherence/structure (transient, like the warm server's socket)
 * whenever a reader took one (query structure, a Scope snapshot, the scaffold)
 * with the fingerprint of what it read: every source file and the config
 * inside the config's bounds, by content, and the part of the specs the
 * reading depends on (components, each entrance's handler and guard, each
 * chokepoint). The reading stands for the tree
 * only while that fingerprint holds; the gaps are then derived from it with
 * the current spec and the current runs, so a verified run or a new
 * control: none shows at once. A reading whose fingerprint no longer holds
 * is stale, and a hook says nothing rather than guess: orient then starts one
 * reading in the background (one at a time, never twice for the same tree)
 * so a later session has it, and returns at once.
 *
 * Regulate names the gaps this session touched: a handler file it changed,
 * as the current reading has the gaps or, when the session's own edits made
 * that stale, as the reading at its start had them; and an entrance it
 * declared that carries untrusted work in and names neither guard: nor
 * control: none, read from the spec against its committed text. Advisory:
 * a stop is refused only for what the tool can prove is owed, and a gap is
 * not proven (no traced control is not a demonstrated bypass).
 *
 * The adoption baseline is the lexicon baseline's convention: a journal
 * decision whose chose is "structure baseline" and its JSON, the entrances
 * that lacked a control when the project adopted Coherence; later records only
 * shrink it. Orient names only gaps outside it; regulate names every gap the
 * session touched.
 *
 * Node-only; the browser bundle never imports it.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { configIgnore, projectFiles } from "../../adapters/project-files.ts";
import { readEnforcementConfig } from "../../enforcement/config.ts";
import { loadRuns } from "../../enforcement/record.ts";
import { isSourceFile } from "../../economy/source.ts";
import { loadJournal } from "../../journal/store.ts";
import { decide } from "../../journal/verbs.ts";
import { parseSpec } from "../../spec/grammar.ts";
import { loadSpecModel } from "../../spec/model.ts";
import { loadSpec } from "./build.ts";
import { boundsOf, withinBounds } from "./component-interfaces.ts";
import type { InterfaceReading, ShellState } from "./model.ts";
import { flowOf, flowUntrusted, type FlowModel } from "./structure-flow.ts";

/** Where the recorded reading, the refresh marker and the per-session snapshots live: transient, never committed. */
export const STRUCTURE_DIR = join(".coherence", "structure");

const RECORD_VERSION = 1;

/** The three ways a gap closes, in the words orient, regulate and the scaffold share. */
export const CLOSE_WAYS = "declare guard: <chokepoint> where a verified chokepoint wraps it, add an invariant whose crossing enters from its trust, or record control: none — <reason>";

/** An entrance with outside or unknown trust whose route has no traced control, and which declares no control: none. */
export interface Gap {
  /** The folder of the component whose spec declares it. */
  component: string;
  name: string;
  specPath: string;
  handler: string | undefined;
  /** The file holding its handler, as the reading resolved it. */
  file: string | undefined;
  trust: string[];
  route: { id: string; first: string; entrances: number; stops: string[] };
}

export interface GapState {
  gaps: Gap[];
  /** Every declared entrance, by component and name: what regulate compares a new entrance against. */
  entrances: [string, string][];
  /** How many entrances declare control: none. */
  noControl: number;
}

function key(component: string, name: string): string {
  return `${component}\u0000${name}`;
}

/* ------------------------------------------------------------ the gaps */

/** The gaps a Structure model shows: every entrance on a route marked no traced control. Pure. */
export function gapsOf(state: Pick<ShellState, "spec">, model: FlowModel): GapState {
  const gaps: Gap[] = [];
  for (const route of model.routes) {
    if (!route.noTracedControl) continue;
    for (const id of route.entrances) {
      const entrance = model.entrances.find((e) => e.id === id);
      if (entrance === undefined) continue;
      const component = entrance.owners[0] ?? entrance.declaredBy;
      const declared = state.spec.components.find((c) => c.folder === component)?.entrances.find((e) => e.name === entrance.name);
      gaps.push({
        component,
        name: entrance.name,
        specPath: state.spec.components.find((c) => c.folder === component)?.specPath ?? "",
        handler: entrance.handler,
        file: declared?.file,
        trust: entrance.trust,
        route: { id: route.id, first: route.names[0] ?? entrance.name, entrances: route.entrances.length, stops: route.stops },
      });
    }
  }
  // An entrance with no drawn route (unresolved, unreachable) is no gap here: the spec check already names it.
  return {
    gaps,
    entrances: state.spec.components.flatMap((c) => c.entrances.map((e): [string, string] => [c.folder, e.name])),
    noControl: model.entrances.filter((e) => e.noControl !== undefined).length,
  };
}

/* ------------------------------------------------ the recorded reading */

/**
 * What of the specs a reading depends on: which folders are components, each
 * entrance's handler and guard (the reading resolves and confirms them), and
 * each chokepoint with what it protects (the reading traces a handler past
 * them). Nothing else a spec says reaches the reading, so a control: none,
 * a trust: line, a crossing or a totality oracle leaves it standing, and the
 * gaps derived from it show the change at once.
 */
function specShape(root: string): string {
  const model = loadSpecModel(root, { runs: false });
  return JSON.stringify(
    model.components.map((c) => [
      c.folder,
      c.entrances.map((e) => [e.name, e.handler ?? "", e.guard ?? "", e.file ?? ""]),
      c.invariants.flatMap((i) => i.enforcements.flatMap((e) => (e.form === "chokepoint" ? [[i.name, e.chokepoint, e.protects]] : []))),
    ]),
  );
}

/**
 * The fingerprint of what a reading reads: every source file of the
 * project's language and the config, inside the config's bounds, by path
 * and content, and the specs' shape as the reading depends on it. Equal
 * fingerprints mean the reading still describes the tree.
 */
export function structureFingerprint(root: string): string {
  const language = readEnforcementConfig(root).language;
  const skip = boundsOf(configIgnore(root));
  const hash = createHash("sha256");
  hash.update(specShape(root)).update("\u0000");
  for (const file of projectFiles(root)) {
    const counted = file === "coherence.config.json" || (withinBounds(file, skip) && isSourceFile(file, language));
    if (!counted) continue;
    let text: Buffer;
    try {
      text = readFileSync(join(root, file));
    } catch {
      continue;
    }
    hash.update(file).update("\u0000").update(createHash("sha256").update(text).digest()).update("\u0000");
  }
  return hash.digest("hex");
}

interface Recorded {
  version: number;
  at: string;
  fingerprint: string;
  reading: InterfaceReading;
}

function readingPath(root: string): string {
  return join(root, STRUCTURE_DIR, "reading.json");
}

function writeAtomically(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, text, "utf8");
  renameSync(temporary, path);
}

/**
 * Keep a reading for the hooks: only a complete one (read through the
 * adapter, no budget spent), and only when the tree it read is still the tree
 * (`before`, the fingerprint taken as it started, holds now). True when kept.
 */
export function recordReading(root: string, reading: InterfaceReading, before: string): boolean {
  if (reading.kind !== "read" || reading.partial !== undefined) return false;
  try {
    if (structureFingerprint(root) !== before) return false;
    writeAtomically(readingPath(root), JSON.stringify({ version: RECORD_VERSION, at: new Date().toISOString(), fingerprint: before, reading } satisfies Recorded));
    return true;
  } catch {
    return false;
  }
}

/** The recorded reading when it still describes the tree, with when it was taken; undefined when there is none or it is stale. */
export function freshReading(root: string, fingerprint: string = structureFingerprint(root)): { reading: InterfaceReading; at: string } | undefined {
  const path = readingPath(root);
  if (!existsSync(path)) return undefined;
  try {
    const recorded = JSON.parse(readFileSync(path, "utf8")) as Recorded;
    if (recorded.version !== RECORD_VERSION || recorded.fingerprint !== fingerprint) return undefined;
    return { reading: recorded.reading, at: recorded.at };
  } catch {
    return undefined;
  }
}

/**
 * The state Structure is derived from, for a reading: the spec and the runs
 * as they stand now. flowOf reads the spec, the runs, the reading, the zoom
 * and the journal's escalations; the views' own fields are left at rest.
 */
export function structureState(root: string, reading: InterfaceReading): ShellState {
  const runs = loadRuns(root);
  const state = {
    spec: loadSpec(root),
    runs: { records: runs.records, damaged: runs.damaged },
    // Escalations only color the health strip; the gaps never read them.
    journal: { records: [], damaged: [], work: { kind: "absent", because: "not read for the gaps" } },
    componentInterfaces: reading,
    structure: { preview: [] },
  };
  return state as unknown as ShellState;
}

/** The gaps now, from the recorded reading when it still describes the tree; undefined when the state is stale or unknown. */
export function currentGaps(root: string, fingerprint?: string): (GapState & { at: string }) | undefined {
  const fresh = freshReading(root, fingerprint);
  if (fresh === undefined) return undefined;
  const state = structureState(root, fresh.reading);
  return { ...gapsOf(state, flowOf(state)), at: fresh.at };
}

/* ------------------------------------------------ background refresh */

interface RefreshMark {
  pid: number;
  at: string;
  fingerprint: string;
}

/** How long a refresh may run before another may start in its place. */
const REFRESH_STALE_MS = 30 * 60 * 1000;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Start one reading in the background so a later session has the gaps:
 * detached, its output discarded, never waited on. Nothing starts while
 * another refresh is alive, nor twice for the same tree (a reading that
 * could not finish is not retried until the tree changes). `command` is the
 * argv that records a reading (the CLI's query structure). Returns whether
 * one started.
 */
export function refreshInBackground(root: string, command: readonly string[], fingerprint: string, now: () => number = Date.now): boolean {
  const path = join(root, STRUCTURE_DIR, "refresh.json");
  try {
    if (existsSync(path)) {
      const mark = JSON.parse(readFileSync(path, "utf8")) as RefreshMark;
      const age = now() - Date.parse(mark.at);
      if (alive(mark.pid) && age < REFRESH_STALE_MS) return false;
      if (mark.fingerprint === fingerprint) return false;
    }
    const [program, ...args] = command;
    if (program === undefined) return false;
    const child = spawn(program, args, { cwd: root, detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
    if (child.pid === undefined) return false;
    writeAtomically(path, JSON.stringify({ pid: child.pid, at: new Date(now()).toISOString(), fingerprint } satisfies RefreshMark));
    return true;
  } catch {
    return false;
  }
}

/* --------------------------------------------- the session's snapshot */

function sessionPath(root: string, session: string): string {
  return join(root, STRUCTURE_DIR, "sessions", `${session.replace(/[^A-Za-z0-9_.-]/g, "_")}.json`);
}

/** Keep the gaps as the session found them, for regulate to compare against once the session's own edits make the reading stale. */
export function saveSessionGaps(root: string, session: string, state: GapState & { at: string }): void {
  try {
    writeAtomically(sessionPath(root, session), JSON.stringify(state));
  } catch {
    // A snapshot that cannot be kept only means regulate has less to compare against.
  }
}

export function sessionGaps(root: string, session: string): (GapState & { at: string }) | undefined {
  try {
    return JSON.parse(readFileSync(sessionPath(root, session), "utf8")) as GapState & { at: string };
  } catch {
    return undefined;
  }
}

/* ----------------------------------------------- the adoption baseline */

/** The chose of a structure baseline decision: the verb, then its JSON. */
export const GAP_BASELINE_CHOSE = /^structure baseline (\{.*\})$/s;

export interface GapBaseline {
  id: string;
  /** Entrances by component and name, keyed as key(). */
  entrances: Set<string>;
}

function parseBaseline(id: string, json: string): Set<string> {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error(`structure baseline ${id} is unreadable; retract it and take the baseline again`);
  }
  const listed = (value as Record<string, unknown> | null)?.["gaps"];
  const out = new Set<string>();
  if (Array.isArray(listed)) for (const pair of listed) if (Array.isArray(pair) && typeof pair[0] === "string" && typeof pair[1] === "string") out.add(key(pair[0], pair[1]));
  return out;
}

/** The project's gap baseline as the journal holds it: every record intersected with those before it, oldest first, so it only shrinks. */
export function readGapBaseline(root: string): GapBaseline | undefined {
  const { records } = loadJournal(root);
  const retracted = new Set(records.flatMap((r) => (r.kind === "retraction" ? [r.of] : [])));
  let effective: GapBaseline | undefined;
  for (const r of records) {
    if (r.kind !== "decision" || retracted.has(r.id)) continue;
    const match = GAP_BASELINE_CHOSE.exec(r.chose);
    if (match === null) continue;
    const next = parseBaseline(r.id, match[1]!);
    effective = { id: r.id, entrances: effective === undefined ? next : new Set([...effective.entrances].filter((k) => next.has(k))) };
  }
  return effective;
}

export interface Who {
  session: string;
  agent: string;
  work?: string;
  cite?: string[];
}

/**
 * Take the baseline: the first time, every gap the reading holds; after that,
 * only gaps both held now and already baselined. Nothing is written when
 * nothing changed.
 */
export function recordGapBaseline(root: string, state: GapState, who: Who, because?: string): string {
  const now = new Set(state.gaps.map((g) => key(g.component, g.name)));
  const prior = readGapBaseline(root);
  const next = prior === undefined ? now : new Set([...prior.entrances].filter((k) => now.has(k)));
  const count = `${next.size} entrance${next.size === 1 ? "" : "s"} with no traced control`;
  if (prior === undefined && next.size === 0) return "Nothing to baseline: no entrance lacks a traced control.";
  if (prior !== undefined && prior.entrances.size === next.size) return `Baseline unchanged (${prior.id}): ${count}.`;
  const gaps = [...next].sort().map((k) => k.split("\u0000"));
  const argv = [
    "structure baseline " + JSON.stringify({ gaps }),
    "--because",
    because?.trim() || (prior === undefined ? "these entrances lacked a traced control when the project adopted Coherence; orient names only new ones" : "entrances closed since the last baseline drop out of it"),
    "--over",
    prior === undefined ? "naming every gap the adoption found at every session start" : "keeping entrances that are no longer gaps",
    "--session",
    who.session,
    "--agent",
    who.agent,
    ...(who.work ? ["--work", who.work] : []),
    ...(who.cite ?? []).flatMap((c) => ["--cite", c]),
  ];
  const id = decide(argv, { cwd: root, now: () => new Date() }).record.id;
  return `${prior === undefined ? "Baseline taken" : "Baseline shrunk"} (${id}): ${count}; orient now names only gaps outside it.`;
}

/* ------------------------------------------------------ orient's line */

/** The most characters a quoted entrance or route name takes in orient's one line. */
const NAME_CHARS = 40;

function short(name: string): string {
  return name.length <= NAME_CHARS ? name : `${name.slice(0, NAME_CHARS - 1)}…`;
}

function quoted(name: string): string {
  return /\s/.test(name) ? JSON.stringify(name) : name;
}

/**
 * Orient's line: how many entrances outside the adoption baseline carry
 * untrusted work in with no traced control, the busiest route by entrance
 * count, and the three ways to close one. Nothing when there are none.
 * Bounded: one line, names cut at forty characters.
 */
export function orientGapText(state: GapState, baseline: GapBaseline | undefined, cli: string): string {
  const open = state.gaps.filter((g) => baseline === undefined || !baseline.entrances.has(key(g.component, g.name)));
  if (open.length === 0) return "";
  const routes = new Map<string, { gap: Gap; count: number }>();
  for (const g of open) {
    const known = routes.get(g.route.id);
    if (known === undefined) routes.set(g.route.id, { gap: g, count: 1 });
    else known.count += 1;
  }
  const busiest = [...routes.values()].sort((a, b) => b.count - a.count || a.gap.route.id.localeCompare(b.gap.route.id))[0]!;
  const others = busiest.count - 1;
  const where = `${short(busiest.gap.name)}${others > 0 ? ` and ${others} more` : ""} (${busiest.gap.route.stops.join(" -> ")})`;
  const scope = baseline === undefined ? "" : ", beyond the adoption baseline";
  const count = open.length === 1 ? "1 entrance carries" : `${open.length} entrances carry`;
  return `Spec gaps: ${count} outside or unknown trust in with no traced control on ${open.length === 1 ? "its" : "their"} route${scope}; busiest: ${where}. To close one, ${CLOSE_WAYS}; ${cli} scaffold control ${quoted(short(busiest.gap.name))} proposes it.`;
}

/* --------------------------------------------------- regulate's lines */

/** The most files and new entrances regulate names; the rest are counted. */
const REGULATE_LINES = 8;

function gitShow(root: string, path: string): string | undefined {
  try {
    return execFileSync("git", ["show", `HEAD:${path}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 16 * 1024 * 1024 });
  } catch {
    return undefined;
  }
}

/**
 * The entrances this session declared: in a spec it changed, absent from the
 * spec's committed text (or from a spec with none). Read from text, so it
 * needs no reading.
 */
export function declaredThisSession(root: string, changed: readonly string[], spec: Pick<ShellState, "spec">["spec"]): { component: string; name: string; trust: string | undefined; guard: string | undefined; noControl: string | undefined }[] {
  const out: { component: string; name: string; trust: string | undefined; guard: string | undefined; noControl: string | undefined }[] = [];
  const touched = new Set(changed.filter((f) => f.endsWith(".spec.md")));
  for (const component of spec.components) {
    if (!touched.has(component.specPath)) continue;
    const before = gitShow(root, component.specPath);
    const old = new Set(before === undefined ? [] : parseSpec(before, component.specPath).entrances.map((e) => e.name));
    for (const e of component.entrances) if (!old.has(e.name)) out.push({ component: component.folder, name: e.name, trust: e.trust, guard: e.guard, noControl: e.noControl });
  }
  return out;
}

/**
 * Regulate's gap lines for a session: the gaps whose handler file the
 * session changed, as the current reading has them (`now`) or, when that is
 * stale, as the session's start had them, less any the spec now closes by a
 * guard: or control: none; and the untrusted entrances it declared with
 * neither. Empty when nothing was touched. Advisory by construction: the
 * caller never counts it as owed.
 */
export function regulateGapText(input: {
  changed: readonly string[];
  now: GapState | undefined;
  start: (GapState & { at: string }) | undefined;
  declared: ReturnType<typeof declaredThisSession>;
  spec: Pick<ShellState, "spec">["spec"];
  cli: string;
}): string {
  const { changed, now, start, declared, spec, cli } = input;
  const files = new Set(changed);
  const state = now ?? start;
  const declares = (component: string, name: string): boolean => {
    const e = spec.components.find((c) => c.folder === component)?.entrances.find((x) => x.name === name);
    return e === undefined || e.guard !== undefined || e.noControl !== undefined;
  };
  const byFile = new Map<string, Gap[]>();
  for (const g of state?.gaps ?? []) {
    if (g.file === undefined || !files.has(g.file)) continue;
    // Read at the start, a gap the session has since answered in the spec is not named.
    if (now === undefined && declares(g.component, g.name)) continue;
    byFile.set(g.file, [...(byFile.get(g.file) ?? []), g]);
  }
  const gapKeys = new Set((now?.gaps ?? []).map((g) => key(g.component, g.name)));
  const levels = new Map(spec.trustLevels.map((l) => [l.name, l]));
  const outside = new Set(spec.trustLevels.filter((l) => l.outside === true).map((l) => l.name));
  const fresh = declared.filter((e) => {
    if (e.guard !== undefined || e.noControl !== undefined) return false;
    // With a current reading, its verdict; without one, the declared trust alone: unknown or outside is untrusted.
    if (now !== undefined && now.entrances.some(([c, n]) => c === e.component && n === e.name)) return gapKeys.has(key(e.component, e.name));
    return flowUntrusted(e.trust === undefined ? [] : [e.trust], levels, outside);
  });
  if (byFile.size === 0 && fresh.length === 0) return "";
  const when = now !== undefined || start === undefined ? "" : ` (as the reading at this session's start had it, taken ${start.at.slice(0, 16).replace("T", " ")} UTC)`;
  const lines = ["Spec gaps this session touched; advisory, never a reason to refuse the stop:"];
  const fileLines = [...byFile.entries()].map(([file, gaps]) => {
    const names = gaps.map((g) => g.name);
    const shown = names.slice(0, 3).join(", ") + (names.length > 3 ? ` and ${names.length - 3} more` : "");
    return `  you changed ${file}, the handler of ${plural(gaps.length, "entrance")} with no traced control on ${gaps.length === 1 ? "its route" : "their routes"}${when}: ${shown}`;
  });
  const newLines = fresh.map((e) => `  you declared entrance ${quoted(e.name)} (${e.component}), which carries ${e.trust ?? "unknown trust"} in and names neither guard: nor control: none${now !== undefined && now.entrances.some(([c, n]) => c === e.component && n === e.name) ? "; no control is traced on its route" : "; nothing is traced on its route yet"}`);
  const all = [...fileLines, ...newLines];
  lines.push(...all.slice(0, REGULATE_LINES));
  if (all.length > REGULATE_LINES) lines.push(`  and ${all.length - REGULATE_LINES} more`);
  const first = [...byFile.values()][0]?.[0]?.name ?? fresh[0]!.name;
  lines.push(`  To close one, ${CLOSE_WAYS}; ${cli} scaffold control ${quoted(first)} proposes it.`);
  return lines.join("\n");
}

function plural(n: number, one: string): string {
  return `${n} ${n === 1 ? one : `${one}s`}`;
}

/**
 * Take a reading and keep it for the hooks: the fingerprint is taken as the
 * reading starts, so an edit made while it ran leaves nothing recorded.
 */
export async function readAndRecord(root: string, read: () => Promise<InterfaceReading>): Promise<InterfaceReading> {
  let before: string | undefined;
  try {
    before = structureFingerprint(root);
  } catch {
    before = undefined;
  }
  const reading = await read();
  if (before !== undefined) recordReading(root, reading, before);
  return reading;
}
