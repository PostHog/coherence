/**
 * Entrance coverage (entrance-coverage.ts, c-3760638e): every detected
 * entrance is covered individually, through a grouped entrance, or not at
 * all, by the three rules (names it, through its handler, in its module);
 * the query, the map and orient say the same counts from one derivation.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { EntranceCandidate } from "../../adapters/entrance-candidates.ts";
import { orientCoverageText, gapsOf } from "./gaps.ts";
import { coverageLine, coverageOf, groupLine } from "./entrance-coverage.ts";
import type { InterfaceReading, ShellState, SpecComponent, SpecEntrance } from "./model.ts";
import { answerStructure } from "../query/query.ts";
import { renderFlowSection } from "./structure-flow-view.ts";
import { flowOf } from "./structure-flow.ts";
import { makeFixture } from "./check-fixture.ts";
import { buildScopePage } from "./build.ts";
import { COHERENCE_LEXICON } from "../../lifecycle/project.ts";

function entrance(name: string, handler: string, file: string | undefined): SpecEntrance {
  return { name, meaning: name, handler, line: 1, handlerLine: 2, component: "src/server", file } as SpecEntrance;
}

const CANDIDATES: EntranceCandidate[] = [
  { file: "src/server/fns.ts", line: 3, symbol: "readA", rule: "server function", why: "createServerFn", through: ["rpc"] },
  { file: "src/server/fns.ts", line: 9, symbol: "readB", rule: "server function", why: "createServerFn", through: ["rpc"] },
  { file: "src/server/fns.ts", line: 15, symbol: "writeA", rule: "server function", why: "createServerFn", through: ["mutationRpc"] },
  { file: "src/server/fns.ts", line: 21, symbol: "writeB", rule: "server function", why: "createServerFn", through: ["mutationRpc"] },
  { file: "src/routes/api/health.ts", line: 4, symbol: "Route", rule: "server route", why: "createFileRoute with server handlers" },
  { file: "src/index.ts", line: 7, symbol: "authorize", rule: "route table", why: "/authorize", registered: true },
  { file: "app/urls.py", line: 4, symbol: "items", rule: "url pattern", why: "items/", registered: true },
  { file: "app/urls.py", line: 5, symbol: "things", rule: "url pattern", why: "things/", registered: true },
  { file: "scripts/backup.ts", line: 1, symbol: "", rule: "package script", why: "backup" },
  { file: "scripts/seed.ts", line: 1, symbol: "", rule: "script", why: "seed" },
];

function components(entrances: SpecEntrance[]): Pick<SpecComponent, "folder" | "entrances">[] {
  return [{ folder: "src/server", entrances }];
}

// The totality oracle the spec names: every test below runs under this one title.
describe("entrance coverage", () => {
  test("a detected entrance is covered by name, through the handler it is registered with, or in its handler's module; individually when its entrance covers nothing else, and by a grouped entrance otherwise", () => {
    const declared = [
      entrance("reads", "rpc in rpc.ts", "src/server/rpc.ts"),
      entrance("write A", "writeA in fns.ts", "src/server/fns.ts"),
      entrance("health", "Route in api/health.ts", "src/routes/api/health.ts"),
      entrance("authorize", "authorize in routes/auth.ts", "src/routes/auth.ts"),
      entrance("django", "urlpatterns in urls.py", "app/urls.py"),
      entrance("backup", "backupDatabase in scripts/backup.ts", "scripts/backup.ts"),
      entrance("worker", "work in worker.ts", "src/server/worker.ts"),
    ];
    const coverage = coverageOf(components(declared), CANDIDATES)!;
    assert.equal(coverage.detected, 10);
    assert.equal(coverage.declared, 7);
    assert.deepEqual(coverage.groups.map((g) => [g.name, g.covers]), [["django", 2], ["reads", 2]], "rpc stands for both reads; urlpatterns for its module's patterns");
    assert.equal(coverage.grouped, 4);
    assert.equal(coverage.individually, 4, "writeA by name, the route by name in its file, authorize registered elsewhere, the backup script by its file");
    assert.deepEqual(coverage.uncovered.map((c) => c.symbol || c.file), ["writeB", "scripts/seed.ts"], "a sibling of an individually declared function stays undeclared");
    assert.equal(coverage.beyond, 1, "the worker's handler covers nothing detected");
    assert.equal(coverageLine(coverage), "entrances: 7 declared, covering 8 of 10 detected entrances (4 individually, 4 through 2 grouped entrances); 2 undeclared");
    assert.equal(groupLine(coverage.groups[1]!), '"reads" (rpc in rpc.ts) stands for 2 server functions');
    assert.equal(coverageOf(components(declared), undefined), undefined, "a reading with nothing detected measures nothing");
  });

  test("a handler that names a detected entrance never groups by the wrapper it shares: declaring one server function covers that one", () => {
    const coverage = coverageOf(components([entrance("read A", "readA in fns.ts", "src/server/fns.ts")]), CANDIDATES)!;
    assert.equal(coverage.individually, 1);
    assert.equal(coverage.grouped, 0);
    assert.equal(coverage.uncovered.length, 9);
  });

  test("query structure, the map's health strip and orient carry one entrance coverage", async (t) => {
    const fixture = makeFixture();
    t.after(() => fixture.remove());
    const { state } = await buildScopePage({ root: fixture.root, lexiconPath: COHERENCE_LEXICON, project: "Coverage" });
    const reading = state.componentInterfaces as InterfaceReading;
    const base: InterfaceReading = reading.kind === "read" ? reading : { kind: "read", language: "typescript", declarations: 0, symbols: [], entrances: [], unowned: { files: 0, lines: 0 } };
    const handlers = state.spec.components.flatMap((c) => c.entrances.map((e) => ({ file: e.file ?? `${c.folder}/x.ts`, symbol: /^([A-Za-z_$][\w$]*)/.exec(e.handler ?? "")?.[1] ?? "" })));
    const candidates: EntranceCandidate[] = [
      ...handlers.filter((h) => h.symbol !== "").map((h, i) => ({ file: h.file, line: i + 1, symbol: h.symbol, rule: "server function", why: "detected" })),
      { file: "scripts/forgotten.ts", line: 1, symbol: "", rule: "script", why: "a script directly under scripts/ that no project file imports" },
    ];
    const withCoverage = { ...state, componentInterfaces: { ...base, candidates } } as ShellState;
    const model = flowOf(withCoverage);
    const coverage = model.coverage!;
    assert.ok(coverage.uncovered.some((c) => c.file === "scripts/forgotten.ts"));
    const line = coverageLine(coverage);
    const text = answerStructure(withCoverage).text;
    assert.ok(text.includes(`entrance coverage: ${line}`), "the query prints the summary");
    assert.ok(text.includes("scripts/forgotten.ts:1  (the file)  script: a script directly under scripts/"), "and every undeclared entrance with its rule and why");
    assert.match(text, /detected by \(typescript\): server function, /, "and the rules, with what they cannot see");
    const html = String(renderFlowSection(withCoverage));
    assert.match(html, new RegExp(`data-field="entrance-coverage" data-detected="${coverage.detected}" data-covered="${coverage.individually + coverage.grouped}" data-undeclared="${coverage.uncovered.length}"`), "the health strip carries the same counts");
    assert.ok(html.includes("scripts/forgotten.ts:1"), "and lists the undeclared, one click away");
    const orient = orientCoverageText(gapsOf(withCoverage, model), "coherence");
    assert.match(orient, new RegExp(`^Entrance coverage: ${coverage.declared} declared entrances cover ${coverage.individually + coverage.grouped} of ${coverage.detected} detected; ${coverage.uncovered.length} undeclared`), "orient says the same counts");
    assert.ok(orient.includes("scripts/forgotten.ts"));
    const nine = { ...withCoverage, componentInterfaces: { ...base, candidates: Array.from({ length: 9 }, (_, i): EntranceCandidate => ({ file: `scripts/s${i}.ts`, line: 1, symbol: "", rule: "script", why: "w" })) } } as ShellState;
    const many = gapsOf(nine, flowOf(nine));
    const bounded = orientCoverageText(many, "coherence");
    assert.equal((bounded.match(/scripts\/s\d\.ts/g) ?? []).length, 3, "orient names at most three");
    assert.match(bounded, /and 6 more/);
    assert.equal(orientCoverageText({ ...many, coverage: { ...many.coverage!, undeclared: 0, first: [] } }, "coherence"), "", "nothing when every detected entrance is declared");
  });
});
