/**
 * The readings of a project in two languages: one product component spanning
 * a Python backend/ and a TypeScript frontend/, a shared/ component written
 * in both, an entrance and a chokepoint in each language (mixed-fixture.ts).
 * The Structure reading reads each language's component code through its
 * own adapter and merges the two side by side over the components they
 * share; entrance detection, mass and scaffold control read both; the
 * observation, which reads the primary language alone, says so; and the same
 * tree configured in one language reads as it always did.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { LanguageAdapter } from "../../adapters/adapter.ts";
import { adapterFor, type Language } from "../../adapters/index.ts";
import { computeMass, formatMass } from "../../economy/mass.ts";
import { readEnforcementConfig } from "../../enforcement/config.ts";
import type { Io } from "../../journal/cli.ts";
import { formatObservationSummary } from "../../observation/observed.ts";
import { buildObservation } from "../../observation/observe.ts";
import { scaffoldCommand } from "../../scaffold/cli.ts";
import { proposeClosures } from "../../scaffold/control.ts";
import { loadSpecModel } from "../../spec/model.ts";
import { answerStructure } from "../query/query.ts";
import { readComponentInterfaces } from "./component-interfaces.ts";
import { structureState } from "./gaps.ts";
import { bothVerified, mixedProject } from "./mixed-fixture.ts";
import type { InterfaceReading } from "./model.ts";
import { flowOf } from "./structure-flow.ts";
import { undeclaredOf } from "./undeclared.ts";

const ONE_LANGUAGE = { "coherence.config.json": JSON.stringify({ name: "mixed", language: "python" }) };

function io(root: string): Io & { lines: string[]; errors: string[] } {
  const lines: string[] = [];
  const errors: string[] = [];
  return { cwd: root, out: (l) => void lines.push(l), err: (l) => void errors.push(l), lines, errors };
}

function read(reading: InterfaceReading): Extract<InterfaceReading, { kind: "read" }> {
  assert.equal(reading.kind, "read", reading.kind === "unread" ? reading.because : "");
  return reading as Extract<InterfaceReading, { kind: "read" }>;
}

test("the Structure reading of a two-language project reads each language's component code through its own adapter and merges them, drawing no reference across languages", { timeout: 180_000 }, async () => {
  const { root, remove } = mixedProject();
  try {
    const reading = read(await readComponentInterfaces(root));
    assert.deepEqual(reading.languages, { declared: ["python", "typescript"], read: ["python", "typescript"], unread: [] }, "both languages read, none left out");
    assert.equal(reading.bounds?.files, 8, "every component file of both languages is component code");
    // One interface per language into shared/, each in its own file: no edge is drawn across languages.
    assert.deepEqual(reading.symbols.map((s) => [s.from, s.to, s.symbol, s.file]), [[".", "shared", "label", "shared/fmt.py"], [".", "shared", "label", "shared/fmt.ts"]]);
    const rows = reading.entrances.find((e) => e.name === "rows view")!;
    const shown = reading.entrances.find((e) => e.name === "shown page")!;
    assert.equal(rows.file, "backend/views.py", "the Python handler resolved through Pyright");
    assert.equal(shown.file, "frontend/server.ts", "the TypeScript handler resolved through tsserver");
    assert.deepEqual(rows.reach?.map((r) => r.file), ["shared/fmt.py"], "the Python reach stays in Python");
    assert.deepEqual(shown.reach?.map((r) => r.file), ["shared/fmt.ts"], "the TypeScript reach stays in TypeScript");
    assert.deepEqual(rows.guards, [{ component: ".", name: "python egress", how: "wrapper" }], "the Python chokepoint traced on the Python route");
    assert.deepEqual(shown.guards, [{ component: ".", name: "typescript egress", how: "wrapper" }], "the TypeScript chokepoint traced on the TypeScript route");
    // The text the query prints says which languages were read.
    const answer = answerStructure(structureState(root, reading)).text;
    assert.match(answer, /languages read: python and typescript, each through its own files/);
  } finally {
    remove();
  }
});

test("a multi-language Structure reading starts no adapter for a language with no component code and no handler", { timeout: 180_000 }, async () => {
  // The frontend and shared TypeScript gone, and the TypeScript entrance with them: only Python is asked.
  const spec = (await import("./mixed-fixture.ts")).MIXED["Mixed.spec.md"]!.replace(/- shown page:[^]*?trust: public\n/, "");
  const { root, remove } = mixedProject({ "frontend/server.ts": undefined, "frontend/tokens.ts": undefined, "shared/fmt.ts": undefined, "Mixed.spec.md": spec });
  const asked: Language[] = [];
  const started: LanguageAdapter[] = [];
  try {
    const reading = read(
      await readComponentInterfaces(root, (language) => {
        asked.push(language);
        const adapter = adapterFor(language, root);
        started.push(adapter);
        return adapter;
      }),
    );
    assert.deepEqual(asked, ["python"], "no TypeScript server was started");
    assert.deepEqual(reading.languages?.read, ["python", "typescript"], "TypeScript was read and held nothing: no file of it is component code");
    assert.deepEqual(reading.languages?.unread, []);
  } finally {
    for (const adapter of started) await adapter.close();
    remove();
  }
});

test("entrance detection in a two-language project finds each language's entrances by its own rules", async () => {
  const { root, remove } = mixedProject();
  try {
    const measured = undeclaredOf(root, loadSpecModel(root, { runs: false }))!;
    assert.equal(measured.detected, 2, "a Python route decorator and a TypeScript route method");
    assert.equal(measured.covered, 2, "each covered by its declared entrance");
    assert.deepEqual(measured.languages.read, ["python", "typescript"]);
  } finally {
    remove();
  }
  // Nothing declared: scaffold entrances proposes a bullet for each language's entrance, and says which languages it read.
  const { root: bare, remove: removeBare } = mixedProject({ "Mixed.spec.md": "# Mixed\n\nA product.\n\n## invariants\n" });
  try {
    const proposed = io(bare);
    assert.equal(await scaffoldCommand(["entrances"], proposed), 0, proposed.errors.join("\n"));
    const text = proposed.lines.join("\n");
    assert.match(text, /^2 undeclared entrances/);
    assert.match(text, /handler: rows in backend\/views\.py/);
    assert.match(text, /- shown: [^\n]*\n  handler: shown\n/, "the TypeScript route method, registered in frontend/server.ts");
    assert.match(text, /\nlanguages read: python and typescript, each through its own files$/);
  } finally {
    removeBare();
  }
});

test("mass of a two-language project counts every language's files and says which languages it read", () => {
  const { root, remove } = mixedProject();
  try {
    const report = computeMass(root);
    assert.deepEqual(report.languages.read, ["python", "typescript"]);
    assert.equal(report.total.files, 8, "five Python files and three TypeScript files");
    assert.ok(report.files.some((f) => f.file === "backend/views.py") && report.files.some((f) => f.file === "frontend/server.ts"));
    assert.match(formatMass(report), /\nlanguages read: python and typescript, each through its own files(\n|$)/);
  } finally {
    remove();
  }
});

test("scaffold control on a two-language project reads both languages and proposes from each language's handlers", { timeout: 180_000 }, async () => {
  const { root, remove } = mixedProject();
  try {
    // The command reads the tree whole through each language's adapter and says so.
    const all = io(root);
    assert.equal(await scaffoldCommand(["control", "--all"], all), 0, all.errors.join("\n"));
    assert.match(all.lines.join("\n"), /languages read: python and typescript, each through its own files/);
    assert.match(all.lines.join("\n"), /rows view[^]*shown page|shown page[^]*rows view/, "an entrance of each language on an untraced route, neither chokepoint verified");
    // With both chokepoints verified and the reading's traces set aside, each handler is read in its own language for the chokepoint it calls.
    const reading = read(await readComponentInterfaces(root));
    const untraced: InterfaceReading = { ...reading, entrances: reading.entrances.map(({ guards: _guards, ...e }) => e) };
    const state = bothVerified(structureState(root, untraced));
    const proposals = proposeClosures(root, state, flowOf(state), readEnforcementConfig(root).languages);
    const guard = (name: string): string | undefined => {
      const first = proposals.find((p) => p.entrance.name === name)?.closures[0];
      return first?.kind === "guard" ? first.line : undefined;
    };
    assert.equal(guard("rows view"), "guard: seal", "the Python handler's declaration read as Python");
    assert.equal(guard("shown page"), "guard: redact", "the TypeScript handler's declaration read as TypeScript");
  } finally {
    remove();
  }
});

test("an observation of a multi-language project names the languages it did not read", () => {
  const { root, remove } = mixedProject();
  try {
    const config = readEnforcementConfig(root);
    const record = buildObservation({
      root,
      realRoot: root,
      capture: { runner: "pytest", attribution: "per test", note: "hand-made", tests: [] },
      map: { symbols: [], entrances: [] },
      model: loadSpecModel(root, { runs: false }),
      config,
      vias: [],
      at: new Date().toISOString(),
      session: "mixed",
      agent: "test",
      binding: {},
      commit: null,
      dirty: false,
      latency: { pass: 0, map: 0 },
    });
    assert.deepEqual(record.languages?.read, ["python"]);
    assert.deepEqual(record.languages?.unread.map((u) => u.language), ["typescript"]);
    assert.match(formatObservationSummary(record), /\n {2}languages read: python; NOT READ: typescript \(observation maps the first test setup's one invocation through the primary language's instrument alone\)$/);
  } finally {
    remove();
  }
});

test("a single-language project reads as it always did: one language read, no languages line printed", { timeout: 180_000 }, async () => {
  const { root, remove } = mixedProject(ONE_LANGUAGE);
  try {
    const reading = read(await readComponentInterfaces(root));
    assert.deepEqual(reading.languages, { declared: ["python"], read: ["python"], unread: [] });
    assert.deepEqual(reading.symbols.map((s) => s.file), ["shared/fmt.py"], "only the configured language's code is component code");
    assert.match(reading.entrances.find((e) => e.name === "shown page")?.reason ?? "", /./, "a handler in another language's file does not resolve, as before");
    assert.equal(reading.bounds?.files, 5, "the five Python files alone");
    assert.doesNotMatch(answerStructure(structureState(root, reading)).text, /languages read/);
    const report = computeMass(root);
    assert.equal(report.language, "python");
    assert.equal(report.total.files, 5, "the Python files alone");
    assert.doesNotMatch(formatMass(report), /languages read/);
    const measured = undeclaredOf(root, loadSpecModel(root, { runs: false }))!;
    assert.equal(measured.detected, 1, "the Python route alone");
    const control = io(root);
    assert.equal(await scaffoldCommand(["control", "--all"], control), 0, control.errors.join("\n"));
    assert.doesNotMatch(control.lines.join("\n"), /languages read/);
  } finally {
    remove();
  }
});
