/**
 * Economy, read traces, calibrate, and mass over a small TypeScript project
 * written into a temporary folder: a component with one chokepoint
 * invariant, a file that references the chokepoint from outside the
 * component, a file in no component, and a file in the component that no
 * invariant reaches. The TypeScript adapter runs in-process.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { TypeScriptAdapter, locateServer } from "../adapters/typescript.ts";
import { appendRun, type RunRecord } from "../enforcement/record.ts";
import type { Defect } from "../journal/record.ts";
import { appendRecord } from "../journal/store.ts";
import { calibrate, labelSnapshot, sampleOf } from "./calibrate.ts";
import { formatClosure, predictClosure } from "./closure.ts";
import { computeMass, formatMass } from "./mass.ts";
import { declarationsOf, importsOf } from "./source.ts";
import { loadTraces, recordReadTrace, snapshotTrace, type Snapshot } from "./trace.ts";

const TSCONFIG = `{ "compilerOptions": { "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext", "strict": true, "noEmit": true, "allowImportingTsExtensions": true }, "include": ["src/**/*.ts"] }\n`;

const SECRETS = `/** The protected thing. */
export const SECRET_COLUMNS: Record<string, string[]> = { tokens: ["token"] };

export function seal(pattern: string, row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row };
  for (const column of SECRET_COLUMNS[pattern] ?? []) delete out[column];
  return out;
}
`;

const EXTRA = `/** In the component, reached by no invariant. */
export function unused(): number {
  return 1;
}
`;

const RENDER = `import { seal } from "../store/secrets.ts";
import { pad } from "../util/format.ts";

export function render(pattern: string, row: Record<string, unknown>): string {
  return pad(JSON.stringify(seal(pattern, row)));
}
`;

const FORMAT = `/** In no component. */
export function pad(text: string): string {
  return " " + text;
}

export const WIDTH = 80;
`;

const TEST_FILE = `import { seal } from "../store/secrets.ts";
export const t = seal;
`;

const STORE_SPEC = `# Store

A store with one door out.

## invariants
- sealed egress: A secret leaves the store only through seal.
  protects: SECRET_COLUMNS
  chokepoint: seal
  because: a leaked row must disclose no usable bearer
  kinds: none
`;

const CONFIG = JSON.stringify({ language: "typescript", testDir: "__tests__" });

let root: string;
let adapter: TypeScriptAdapter;
const serverPresent = locateServer(process.cwd()) !== undefined;

function write(path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text, "utf8");
}

before(async () => {
  root = mkdtempSync(join(tmpdir(), "coherence-economy-"));
  write("tsconfig.json", TSCONFIG);
  write("coherence.config.json", CONFIG);
  write("src/store/Store.spec.md", STORE_SPEC);
  write("src/store/secrets.ts", SECRETS);
  write("src/store/extra.ts", EXTRA);
  write("src/api/render.ts", RENDER);
  write("src/util/format.ts", FORMAT);
  write("src/__tests__/secrets.test.ts", TEST_FILE);
  adapter = new TypeScriptAdapter(root);
});

after(async () => {
  await adapter.close();
  rmSync(root, { recursive: true, force: true });
});

test("the language server binary is found (the adapter's precondition)", () => {
  assert.ok(serverPresent, "typescript-language-server must be installed: npm install");
});

test("the plain scan finds top-level declarations and imports from files under the root", () => {
  assert.deepEqual(
    declarationsOf(FORMAT, "typescript").map((d) => `${d.name}:${d.line}:${d.exported}`),
    ["pad:2:true", "WIDTH:6:true"],
  );
  assert.deepEqual(importsOf(root, "src/api/render.ts", RENDER, "typescript"), [
    { name: "seal", module: "src/store/secrets.ts" },
    { name: "pad", module: "src/util/format.ts" },
  ]);
});

test("economy: one hop out, one hop in, the spec of each component, and the invariants whose protected thing or chokepoint lives in the given files; deterministic", async () => {
  const out = await predictClosure(root, ["src/api/render.ts"], { adapter });
  assert.deepEqual(out.given, ["src/api/render.ts"]);
  const outFiles = Object.fromEntries(out.entries.map((e) => [e.file, e.why]));
  assert.deepEqual(outFiles["src/api/render.ts"], ["given"]);
  assert.deepEqual(outFiles["src/store/secrets.ts"], ["defines seal, referenced by src/api/render.ts at lines 1, 5"]);
  assert.deepEqual(outFiles["src/util/format.ts"], ["defines pad, referenced by src/api/render.ts at lines 2, 5"]);
  assert.deepEqual(outFiles["src/store/Store.spec.md"], ["spec of src/store, which holds src/store/secrets.ts"]);
  assert.equal(out.entries.length, 4, Object.keys(outFiles).join(", "));
  assert.equal(out.hops, "references");
  assert.equal(out.tokens, Math.ceil(out.bytes / 4));
  assert.ok(out.bytes > 0);

  const inward = await predictClosure(root, ["src/store/secrets.ts"], { adapter });
  const inFiles = Object.fromEntries(inward.entries.map((e) => [e.file, e.why]));
  assert.deepEqual(inFiles["src/api/render.ts"], ["references seal (src/store/secrets.ts) at line 1", "references seal (src/store/secrets.ts) at line 5 in render"]);
  assert.deepEqual(inFiles["src/__tests__/secrets.test.ts"], ["test references seal (src/store/secrets.ts) at line 1", "test references seal (src/store/secrets.ts) at line 2 in t"]);
  assert.deepEqual(inFiles["src/store/secrets.ts"], ["chokepoint seal of src/store/sealed egress", "given", "protected thing SECRET_COLUMNS of src/store/sealed egress"]);
  assert.deepEqual(inFiles["src/store/Store.spec.md"], ["invariant src/store/sealed egress reaches a given file", "spec of src/store, which holds src/store/secrets.ts"]);
  assert.ok(!("src/store/extra.ts" in inFiles), "a sibling nothing references is not in the closure");
  assert.ok(!("src/util/format.ts" in inFiles), "two hops away is not in the closure");

  const again = await predictClosure(root, ["src/store/secrets.ts"], { adapter });
  assert.deepEqual(again, inward, "the same tree yields the same closure");

  const printed = formatClosure(inward, { limit: 2 });
  assert.match(printed, /^economy of a change to src\/store\/secrets\.ts: 4 files, ~\d+ tokens \(\d+ bytes \/ 4\)/);
  assert.match(printed, /and 2 more; --json for the whole closure/);
  assert.match(printed, /hops through references; instrument typescript \(cold\)/);

  const cold = await predictClosure(root, ["src/store/secrets.ts"], { instrumentReason: "no server" });
  assert.equal(cold.hops, "skipped");
  assert.deepEqual(cold.entries.map((e) => e.file), ["src/store/Store.spec.md", "src/store/secrets.ts"]);
  await assert.rejects(predictClosure(root, ["src/nowhere.ts"], { adapter }), /not a file under/);
});

function readEvent(file: string, tool = "Read"): { tool_name: string; tool_input: { file_path: string } } {
  return { tool_name: tool, tool_input: { file_path: join(root, file) } };
}

const clock = (iso: string): (() => Date) => () => new Date(iso);

test("read traces: a reading tool's file is appended, a writing tool's is not, and the snapshot carries the patch, what was read, and the prediction", async () => {
  const session = "session-a";
  assert.equal(recordReadTrace(root, session, readEvent("src/store/secrets.ts"), { now: clock("2026-09-17T09:00:00.000Z") }), "src/store/secrets.ts");
  assert.equal(recordReadTrace(root, session, readEvent("src/util/format.ts"), { now: clock("2026-09-17T09:01:00.000Z") }), "src/util/format.ts");
  assert.equal(recordReadTrace(root, session, readEvent("src/util/format.ts"), { now: clock("2026-09-17T09:02:00.000Z") }), "src/util/format.ts");
  assert.equal(recordReadTrace(root, session, readEvent("src/api/render.ts", "Write")), undefined, "a write is not a read");
  assert.equal(recordReadTrace(root, session, { tool_name: "Read", tool_input: { file_path: "/etc/hosts" } }), undefined, "outside the root");
  assert.equal(recordReadTrace(root, session, { tool_name: "Read", tool_input: { file_path: join(root, "src") } }), undefined, "a folder is not a file");
  const snapshot = await snapshotTrace(root, session, { adapter, changed: ["src/api/render.ts"], now: clock("2026-09-17T10:00:00.000Z") });
  assert.ok(snapshot !== undefined);
  assert.deepEqual(snapshot.changed, ["src/api/render.ts"]);
  assert.deepEqual(snapshot.read, ["src/store/secrets.ts", "src/util/format.ts"]);
  assert.deepEqual(snapshot.predicted, ["src/api/render.ts", "src/store/Store.spec.md", "src/store/secrets.ts", "src/util/format.ts"]);
  const lines = readFileSync(join(root, ".coherence/traces/session-a.jsonl"), "utf8").trim().split("\n");
  assert.equal(lines.length, 4, "three reads and one snapshot, appended");
  assert.equal(await snapshotTrace(root, "session-empty", { adapter, changed: [] }), undefined, "nothing read and nothing changed writes nothing");
  assert.throws(() => recordReadTrace(root, "../x", readEvent("src/store/secrets.ts")), /cannot name a file/);
});

test("calibrate: the outcome label is automatic; a later defect record labels defect, a later passing run labels clean, nothing later is unknown, and a label written into the trace is ignored", async () => {
  // This test owns the records: it may run alone under the totality oracle pass.
  for (const dir of ["traces", "journal", "runs"]) rmSync(join(root, ".coherence", dir), { recursive: true, force: true });
  // session-a: reads inside the prediction, changed render.ts; a later defect record names it.
  recordReadTrace(root, "session-a", readEvent("src/store/secrets.ts"), { now: clock("2026-09-17T09:00:00.000Z") });
  recordReadTrace(root, "session-a", readEvent("src/util/format.ts"), { now: clock("2026-09-17T09:01:00.000Z") });
  await snapshotTrace(root, "session-a", { adapter, changed: ["src/api/render.ts"], now: clock("2026-09-17T10:00:00.000Z") });
  // session-b: reads outside the prediction, changed secrets.ts; a later run passes over it.
  recordReadTrace(root, "session-b", readEvent("src/store/extra.ts"), { now: clock("2026-09-17T09:00:00.000Z") });
  recordReadTrace(root, "session-b", readEvent("src/api/render.ts"), { now: clock("2026-09-17T09:01:00.000Z") });
  const b = await snapshotTrace(root, "session-b", { adapter, changed: ["src/store/secrets.ts"], now: clock("2026-09-17T10:00:00.000Z") });
  assert.ok(b !== undefined);
  // session-c: nothing later.
  recordReadTrace(root, "session-c", readEvent("src/util/format.ts"), { now: clock("2026-09-17T09:00:00.000Z") });
  await snapshotTrace(root, "session-c", { adapter, changed: ["src/util/format.ts"], now: clock("2026-09-17T10:00:00.000Z") });

  const defect: Defect = { id: "df-00000001", kind: "defect", at: "2026-09-17T11:00:00.000Z", session: "later", agent: "tester", commit: null, dirty: false, what: "render leaks", evidence: "a row with a token", files: [join(root, "src/api/render.ts")] };
  appendRecord(root, defect);
  const run: RunRecord = {
    at: "2026-09-17T11:00:00.000Z",
    session: "later",
    agent: "tester",
    commit: null,
    dirty: false,
    instrument: { language: "typescript", server: "cold" },
    latency: 1,
    invariants: [{ component: "src/store", name: "sealed egress", form: "chokepoint", verdict: "pass", grade: "reference-choked", refutation: "automatic", bypasses: [], testReferences: 1, files: ["src/api/render.ts", "src/store/secrets.ts"], latency: 1, reason: "clean" }],
  };
  appendRun(root, run);

  const report = calibrate(root);
  const by = Object.fromEntries(report.samples.map((s) => [s.session, s]));
  assert.equal(by["session-a"]!.outcome, "defect", by["session-a"]!.labeledBy);
  assert.match(by["session-a"]!.labeledBy, /defect df-00000001 names src\/api\/render\.ts/);
  assert.equal(by["session-a"]!.covered, true);
  assert.deepEqual(by["session-a"]!.readOutside, []);
  assert.deepEqual(by["session-a"]!.predictedUnread, ["src/api/render.ts", "src/store/Store.spec.md"]);
  assert.equal(by["session-b"]!.outcome, "clean", by["session-b"]!.labeledBy);
  assert.match(by["session-b"]!.labeledBy, /run 2026-09-17T11:00:00.000Z passed src\/store\/sealed egress over src\/store\/secrets\.ts/);
  assert.equal(by["session-b"]!.covered, false);
  assert.deepEqual(by["session-b"]!.readOutside, ["src/store/extra.ts"]);
  assert.deepEqual(by["session-b"]!.overlap, ["src/api/render.ts"]);
  assert.equal(by["session-c"]!.outcome, "unknown");
  assert.equal(report.aggregate.all.sessions, 3);
  assert.equal(report.aggregate.defect.covered, 1);
  assert.equal(report.aggregate.clean.covered, 0);
  assert.equal(report.aggregate.unknown.sessions, 1);

  // A run before the snapshot labels nothing; a failing run after it labels defect over a passing one.
  const early = { ...run, at: "2026-09-17T08:00:00.000Z" };
  assert.equal(labelSnapshot(root, b, [], [early]).outcome, "unknown");
  const failing: RunRecord = { ...run, at: "2026-09-17T12:00:00.000Z", invariants: [{ ...run.invariants[0]!, verdict: "fail", grade: "broken", bypasses: [{ file: "src/store/secrets.ts", line: 1, symbol: "x" }] }] };
  assert.equal(labelSnapshot(root, b, [], [run, failing]).outcome, "defect");

  // A label somebody wrote into the snapshot is not read: the label is derived every time.
  const forged = { ...b, outcome: "clean", labeledBy: "by hand" } as Snapshot & { outcome: string };
  assert.equal(sampleOf(root, forged, [defect], []).outcome, "unknown", "no defect names secrets.ts and no run touches it");
  const traced = loadTraces(root);
  assert.deepEqual(traced.sessions.map((s) => s.session), ["session-a", "session-b", "session-c"]);
  assert.equal(traced.damaged.length, 0);
});

test("mass: a file in no component and a file in a component that no invariant reaches count as unreached; unreached prints first; deterministic", () => {
  // This test owns the runs: it may run alone under the totality oracle pass.
  rmSync(join(root, ".coherence/runs"), { recursive: true, force: true });
  appendRun(root, {
    at: "2026-09-17T11:00:00.000Z",
    session: "later",
    agent: "tester",
    commit: null,
    dirty: false,
    instrument: { language: "typescript", server: "cold" },
    latency: 1,
    invariants: [{ component: "src/store", name: "sealed egress", form: "chokepoint", verdict: "pass", grade: "reference-choked", refutation: "automatic", bypasses: [], testReferences: 1, files: ["src/api/render.ts", "src/store/secrets.ts"], latency: 1, reason: "clean" }],
  });
  const report = computeMass(root);
  assert.deepEqual(report.outside.files, ["src/api/render.ts", "src/util/format.ts"]);
  const store = report.components.find((c) => c.folder === "src/store");
  assert.ok(store !== undefined);
  assert.deepEqual(store.unreachedFiles, ["src/store/extra.ts"]);
  assert.deepEqual(store.total, { lines: 12, files: 2, symbols: 3 });
  assert.deepEqual(store.unreached, { lines: 4, files: 1, symbols: 1 });
  assert.deepEqual(report.reachFrom, ["run"], "the run written by the calibrate test reaches secrets.ts and render.ts");
  const secrets = report.files.find((f) => f.file === "src/store/secrets.ts");
  assert.deepEqual(secrets?.reachedBy, ["src/store/sealed egress"]);
  assert.equal(report.testsExcluded, 1);
  assert.deepEqual(report.total, { lines: 12 + 6 + 6, files: 4, symbols: 3 + 1 + 2 });
  assert.deepEqual(report.unreached, { lines: 4 + 6 + 6, files: 3, symbols: 1 + 1 + 2 });
  assert.deepEqual(computeMass(root), report, "the same tree yields the same mass");

  const printed = formatMass(report);
  const lines = printed.split("\n");
  assert.match(lines[0]!, /^unreached mass: 16 lines, 3 files, 4 symbols \(67% of lines\)/);
  assert.match(lines[1]!, /^  in no component: 12 lines, 2 files, 3 symbols — src\/api\/render\.ts, src\/util\/format\.ts/);
  assert.ok(lines.findIndex((l) => l.startsWith("unreached mass")) < lines.findIndex((l) => l.startsWith("total mass")), "unreached prints before total");
  assert.match(printed, /reach from the latest run's files/);

  // Without a run the spec's named symbols decide reach: the file declaring SECRET_COLUMNS and seal.
  rmSync(join(root, ".coherence/runs"), { recursive: true, force: true });
  const fromSpec = computeMass(root);
  assert.deepEqual(fromSpec.reachFrom, ["spec"]);
  assert.deepEqual(fromSpec.components.find((c) => c.folder === "src/store")?.unreachedFiles, ["src/store/extra.ts"]);
  assert.deepEqual(fromSpec.outside.files, ["src/api/render.ts", "src/util/format.ts"]);
});
