/**
 * Map what a pass captured onto the spec tree and build the observation
 * record. Executed code maps to the component whose folder is its nearest
 * ancestor (test files never count toward a component); a component interface
 * `from -> to` is crossed in a test when one of its reference sites (an
 * import or re-export specifier is how a module reaches a symbol, not a use,
 * and is never evidence) sat in code of `from` that executed in the test, and
 * the referenced symbol's body in `to` executed in the same test. Both ran;
 * whether one called the other, coverage cannot say, and the record says
 * co-executed.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { componentOf, declarationsOf, isTest } from "../economy/source.ts";
import type { EnforcementConfig } from "../enforcement/config.ts";
import type { SpecModel } from "../spec/model.ts";
import { belongsTo } from "../enforcement/totality.ts";
import type { Capture, CapturedTest } from "./capture.ts";
import { projectPath } from "./capture.ts";
import { interfaceId, type InterfaceMap, type InterfaceSymbol } from "./interfaces.ts";
import { anyFunctionExecuted, bodyExecuted, framesOf, siteExecuted, type ExecutedFile, type Span } from "./map.ts";
import { RELATION, type LikelySite, type ObservationRecord, type ObservedInterface, type ObservedTest } from "./record.ts";

/** A totality oracle the pass ran: which invariant, and the test filter its via became. */
export interface TotalityVia {
  component: string;
  name: string;
  filter: string;
}

export interface Region {
  components: string[];
  interfaces: string[];
  entrances: string[];
}

function byFile(executed: readonly ExecutedFile[]): Map<string, Span[]> {
  const out = new Map<string, Span[]>();
  for (const { file, spans } of executed) out.set(file, [...(out.get(file) ?? []), ...spans]);
  return out;
}

/** Whether one interface symbol co-executed: its body ran, and some non-import site of it in `from` sat in code that ran. */
export function symbolCrossed(symbol: InterfaceSymbol, files: ReadonlyMap<string, readonly Span[]>): boolean {
  const target = files.get(symbol.file);
  if (target === undefined || !bodyExecuted(target, symbol.range)) return false;
  return symbol.sites.some((site) => {
    if (site.form !== undefined) return false;
    const spans = files.get(site.file);
    return spans !== undefined && siteExecuted(spans, { line: site.line, character: site.character }) === "executed";
  });
}

/** The region one test (or one run) touched. */
export function regionOf(executed: readonly ExecutedFile[], map: InterfaceMap, model: SpecModel, testFolders: readonly string[]): Region {
  const files = byFile(executed);
  const components = new Set<string>();
  for (const [file, spans] of files) {
    if (isTest(file, testFolders) || !anyFunctionExecuted(spans)) continue;
    const owner = componentOf(model, file)?.folder;
    if (owner !== undefined) components.add(owner);
  }
  const interfaces = new Set<string>();
  for (const symbol of map.symbols) if (symbolCrossed(symbol, files)) interfaces.add(interfaceId(symbol.from, symbol.to));
  const entrances = map.entrances.filter((e) => e.file !== undefined && e.range !== undefined && bodyExecuted(files.get(e.file) ?? [], e.range)).map((e) => `${e.component}/${e.name}`);
  return { components: [...components].sort(), interfaces: [...interfaces].sort(), entrances: entrances.sort() };
}

/** The first frame of a failure outside test files and inside the project, mapped to its symbol, component, and interfaces. */
export function likelySiteOf(failure: string, realRoot: string, root: string, map: InterfaceMap, model: SpecModel, config: EnforcementConfig): LikelySite | undefined {
  for (const frame of framesOf(failure)) {
    const file = projectPath(realRoot, frame.path);
    if (file === undefined || file.includes("node_modules/") || isTest(file, config.testFolders)) continue;
    let symbol: string | undefined;
    const carrying = map.symbols.find((s) => s.file === file && s.range.start.line <= frame.line - 1 && frame.line - 1 <= s.range.end.line);
    if (carrying !== undefined) symbol = carrying.symbol;
    else {
      try {
        const above = declarationsOf(readFileSync(join(root, file), "utf8"), config.language).filter((d) => d.line <= frame.line);
        symbol = above[above.length - 1]?.name;
      } catch {
        symbol = undefined;
      }
    }
    const component = componentOf(model, file)?.folder;
    const interfaces = symbol === undefined ? [] : [...new Set(map.symbols.filter((s) => s.file === file && s.symbol === symbol).map((s) => interfaceId(s.from, s.to)))].sort();
    return { label: "likely site", file, line: frame.line, ...(symbol === undefined ? {} : { symbol }), ...(component === undefined ? {} : { component }), interfaces };
  }
  return undefined;
}

function viasOf(test: CapturedTest, vias: readonly TotalityVia[]): string[] {
  const shape = { title: test.name, fullName: test.fullName, ...(test.ancestors === undefined ? {} : { ancestorTitles: test.ancestors }) };
  return [...new Set(vias.filter((o) => belongsTo(shape, o.filter)).map((o) => `${o.component}/${o.name}`))].sort();
}

export interface BuildInput {
  root: string;
  realRoot: string;
  capture: Capture;
  map: InterfaceMap;
  model: SpecModel;
  config: EnforcementConfig;
  vias: readonly TotalityVia[];
  at: string;
  session: string;
  agent: string;
  binding: { work?: string; binding?: string };
  commit: string | null;
  dirty: boolean;
  latency: { pass: number; map: number };
}

/** The observation record for one captured pass. */
export function buildObservation(input: BuildInput): ObservationRecord {
  const { capture, map, model, config } = input;
  const perTest = capture.attribution === "per test";
  const tests: ObservedTest[] = capture.tests.map((t) => {
    const invariants = viasOf(t, input.vias);
    const region = perTest && t.executed !== undefined ? regionOf(t.executed, map, model, config.testFolders) : undefined;
    const site = t.verdict === "fail" && t.failure !== undefined ? likelySiteOf(t.failure, input.realRoot, input.root, map, model, config) : undefined;
    const firstLine = t.failure?.split("\n").find((l) => l.trim() !== "")?.trim();
    return {
      name: t.name,
      fullName: t.fullName,
      ...(t.file === undefined ? {} : { file: t.file }),
      verdict: t.verdict,
      ...(invariants.length === 0 ? {} : { invariants }),
      ...(t.verdict === "fail" && firstLine !== undefined ? { failure: firstLine.slice(0, 300) } : {}),
      ...(site === undefined ? {} : { likelySite: site }),
      ...(region === undefined ? {} : { components: region.components, interfaces: region.interfaces, entrances: region.entrances }),
    };
  });
  const run = capture.attribution === "per run" && capture.run !== undefined ? regionOf(capture.run, map, model, config.testFolders) : undefined;

  // Which symbols have no body a runtime can report is read from the declaration, never from coverage:
  // V8 omits a function that has not run since the last reset, so absence in coverage proves nothing.
  const grouped = new Map<string, InterfaceSymbol[]>();
  for (const s of map.symbols) grouped.set(interfaceId(s.from, s.to), [...(grouped.get(interfaceId(s.from, s.to)) ?? []), s]);
  const interfaces: ObservedInterface[] = [...grouped].map(([id, symbols]) => {
    const exercisedBy = perTest ? tests.filter((t) => (t.interfaces ?? []).includes(id)).length : run?.interfaces.includes(id) ? 1 : 0;
    const typeOnly = symbols.every((s) => s.declares === "type");
    const noBody = symbols.every((s) => s.declares === "type" || s.declares === "value");
    const files = [...new Set(symbols.flatMap((s) => [s.file, ...s.sites.map((x) => x.file)]))].sort();
    return { id, from: symbols[0]!.from, to: symbols[0]!.to, symbols: symbols.length, files, typeOnly, noBody, exercisedBy };
  });
  const entrances = map.entrances.map((e) => {
    const key = `${e.component}/${e.name}`;
    const exercisedBy = perTest ? tests.filter((t) => (t.entrances ?? []).includes(key)).length : run?.entrances.includes(key) ? 1 : 0;
    return { component: e.component, name: e.name, ...(e.handler === undefined ? {} : { handler: e.handler }), exercisedBy, ...(e.reason === undefined ? {} : { reason: e.reason }) };
  });
  const touched = new Set(perTest ? tests.flatMap((t) => t.components ?? []) : run?.components ?? []);
  return {
    kind: "observation",
    at: input.at,
    session: input.session,
    agent: input.agent,
    ...input.binding,
    commit: input.commit,
    dirty: input.dirty,
    source: { kind: "test pass", runner: capture.runner ?? "unknown", attribution: capture.attribution, note: capture.note },
    relation: RELATION,
    tests,
    ...(run === undefined ? {} : { run }),
    interfaces,
    entrances,
    totals: {
      tests: tests.length,
      failed: tests.filter((t) => t.verdict === "fail").length,
      components: touched.size,
      interfaces: interfaces.length,
      exercised: interfaces.filter((i) => i.exercisedBy > 0).length,
      neverObserved: interfaces.filter((i) => i.exercisedBy === 0 && !i.noBody).length,
      noBody: interfaces.filter((i) => i.exercisedBy === 0 && i.noBody).length,
      entrances: entrances.length,
      entrancesExercised: entrances.filter((e) => e.exercisedBy > 0).length,
    },
    latency: input.latency,
  };
}
