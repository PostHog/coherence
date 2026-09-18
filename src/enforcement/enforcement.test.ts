/**
 * Enforcement over a small TypeScript project written into a temporary
 * folder: a protected symbol, a chokepoint, one clean reference inside it,
 * one bypass outside it, one test reference. The classification, each
 * grade, the automatic refutation, the run record being append-only, the
 * status view deriving the latest verdict, the state derivation with and
 * without a run, and the PostToolUse alarm. The TypeScript adapter runs
 * in-process here; the warm server has its own test.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { TypeScriptAdapter, locateServer } from "../adapters/typescript.ts";
import { runHook, specStopText } from "../lifecycle/hook.ts";
import { loadSpecModel } from "../spec/model.ts";
import { deriveState } from "../spec/state.ts";
import { checkChokepoint, classifySite } from "./check.ts";
import { formatRun, formatStatus } from "./cli.ts";
import { readEnforcementConfig } from "./config.ts";
import { appendRun, latestByEnforcement, latestFor, loadRuns, type RunRecord } from "./record.ts";
import { mayTouch, performRun } from "./run.ts";
import { runTotalityOracle } from "./totality.ts";

const TSCONFIG = `{ "compilerOptions": { "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext", "strict": true, "noEmit": true, "allowImportingTsExtensions": true }, "include": ["src/**/*.ts"] }\n`;

const SECRETS = `/** The protected thing. */
export const SECRET_COLUMNS: Record<string, string[]> = { tokens: ["token"] };

const HIDDEN = new Set(["x"]);

export function seal(pattern: string, row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row };
  for (const column of SECRET_COLUMNS[pattern] ?? []) delete out[column];
  return out;
}

export function peek(pattern: string): number {
  return HIDDEN.size + pattern.length;
}
`;

const RENDER_CLEAN = `import { seal } from "../store/secrets.ts";

export function render(pattern: string, row: Record<string, unknown>): string {
  return JSON.stringify(seal(pattern, row));
}
`;

const RENDER_BYPASS = `import { SECRET_COLUMNS, seal } from "../store/secrets.ts";

export function render(pattern: string, row: Record<string, unknown>): string {
  const sealed = seal(pattern, row);
  const leaked = SECRET_COLUMNS[pattern];
  return JSON.stringify({ sealed, leaked });
}
`;

const TEST_FILE = `import { SECRET_COLUMNS } from "../store/secrets.ts";
export const t = SECRET_COLUMNS;
`;

const SPEC = `# Fixture

A store with one door out.

## trust levels
- storage: the rows beneath everything
- public-egress: what leaves in the clear

## invariants
- digest-only egress: A secret leaves storage only as its digest.
  protects: SECRET_COLUMNS
  chokepoint: seal
  because: a read of a leaked row must disclose no usable bearer
  crossing: storage -> public-egress
  kinds: none
- hidden set: The hidden set is read only through peek.
  protects: HIDDEN
  chokepoint: peek
  because: the set is an implementation detail
  kinds: none
- prose thing: Something described in prose.
  protects: the rows every pattern keeps
  chokepoint: seal
  because: prose does not resolve
  kinds: none
- missing door: A thing whose chokepoint does not exist.
  protects: SECRET_COLUMNS
  chokepoint: noSuchFunction
  because: the chokepoint is gone
  kinds: none
- egress totality: Every secret column is stripped.
  over: every column in SECRET_COLUMNS
  via: egress totality
  because: a spot check is not enforcement
  refuted: removed the seal call -> egress totality went red (2026-09-17)
  kinds: none
`;

const CONFIG = JSON.stringify({ language: "typescript", testDir: "__tests__", test: "sh -c 'echo ran {filter}; exit 0'", testMatch: "ran egress" });

let root: string;
let adapter: TypeScriptAdapter;
const hint = { component: ".", testFolders: readEnforcementConfig("/nowhere").testFolders };
const serverPresent = locateServer(process.cwd()) !== undefined;

function write(path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text, "utf8");
}

before(async () => {
  root = mkdtempSync(join(tmpdir(), "coherence-enforcement-"));
  write("tsconfig.json", TSCONFIG);
  write("coherence.config.json", CONFIG);
  write("Fixture.spec.md", SPEC);
  write("src/store/secrets.ts", SECRETS);
  write("src/api/render.ts", RENDER_BYPASS);
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

test("classification: inside the chokepoint, an import, a test reference, a bypass", async () => {
  const protectedThing = (await adapter.resolve("SECRET_COLUMNS", hint)) as { ok: true; definition: import("../adapters/adapter.ts").Definition };
  const chokepoint = (await adapter.resolve("seal", hint)) as { ok: true; definition: import("../adapters/adapter.ts").Definition };
  assert.ok(protectedThing.ok && chokepoint.ok);
  const sites = await adapter.references(protectedThing.definition);
  const classes = sites.map((s) => `${s.file}:${s.line} ${classifySite(s, protectedThing.definition, chokepoint.definition, hint.testFolders)}`);
  assert.deepEqual(classes, [
    "src/__tests__/secrets.test.ts:1 import",
    "src/__tests__/secrets.test.ts:2 test",
    "src/api/render.ts:1 import",
    "src/api/render.ts:5 bypass",
    "src/store/secrets.ts:8 inside",
  ]);
  const bypass = sites.find((s) => s.file === "src/api/render.ts" && s.line === 5)!;
  assert.equal(bypass.symbol, "render.leaked", "a bypass names its referencing symbol");
});

test("grades: broken with a bypass, reference-choked when clean and exported, visibility-choked when not exported, broken when the chokepoint is missing, not chokeable for prose", async () => {
  const broken = await checkChokepoint(adapter, { protects: "SECRET_COLUMNS", chokepoint: "seal", ...hint });
  assert.equal(broken.grade, "broken");
  assert.equal(broken.verdict, "fail");
  assert.deepEqual(broken.bypasses, [{ file: "src/api/render.ts", line: 5, symbol: "render.leaked" }]);
  assert.equal(broken.counts.test, 1, "a test reference is reported, never a bypass");
  assert.equal(broken.refutation, "automatic");

  write("src/api/render.ts", RENDER_CLEAN);
  await adapter.forget();
  const clean = await checkChokepoint(adapter, { protects: "SECRET_COLUMNS", chokepoint: "seal", ...hint });
  assert.equal(clean.grade, "reference-choked", clean.reason);
  assert.equal(clean.verdict, "pass");
  assert.match(clean.reason, /visible outside its module/);
  assert.match(clean.reason, /1 test reference/);

  const hidden = await checkChokepoint(adapter, { protects: "HIDDEN", chokepoint: "peek", ...hint });
  assert.equal(hidden.grade, "visibility-choked", hidden.reason);
  assert.equal(hidden.verdict, "pass");

  const missing = await checkChokepoint(adapter, { protects: "SECRET_COLUMNS", chokepoint: "noSuchFunction", ...hint });
  assert.equal(missing.grade, "broken");
  assert.equal(missing.verdict, "fail");
  assert.match(missing.reason, /no symbol named noSuchFunction/);

  const prose = await checkChokepoint(adapter, { protects: "the rows every pattern keeps", chokepoint: "seal", ...hint });
  assert.equal(prose.grade, "not chokeable");
  assert.equal(prose.verdict, "not run");
  assert.match(prose.reason, /totality oracle form .* is the compromise/);

  write("src/api/render.ts", RENDER_BYPASS);
  await adapter.forget();
});

test("the automatic refutation opens a synthetic reference and sees it; nothing is written to disk", async () => {
  const protectedThing = (await adapter.resolve("SECRET_COLUMNS", hint)) as { ok: true; definition: import("../adapters/adapter.ts").Definition };
  const before = readFileSync(join(root, "src/store/secrets.ts"), "utf8");
  const refutation = await adapter.refute(protectedThing.definition, undefined);
  assert.equal(refutation.seen, true, refutation.account);
  assert.match(refutation.account, /unsaved document .*coherence-refutation-.*reported as a reference/);
  assert.equal(readFileSync(join(root, "src/store/secrets.ts"), "utf8"), before);
  const { readdirSync } = await import("node:fs");
  assert.ok(readdirSync(join(root, "src/store")).every((n) => !n.includes("refutation")), "no synthetic file lands on disk");

  const hidden = (await adapter.resolve("HIDDEN", hint)) as { ok: true; definition: import("../adapters/adapter.ts").Definition };
  const inside = await adapter.refute(hidden.definition, undefined);
  assert.equal(inside.seen, true, inside.account);
  assert.match(inside.account, /unsaved edit of src\/store\/secrets\.ts/);
  assert.equal(readFileSync(join(root, "src/store/secrets.ts"), "utf8"), before);
});

test("the totality oracle pass: configured command with a filter and a match; not configured is reported, never passing", async () => {
  const config = readEnforcementConfig(root);
  const pass = await runTotalityOracle(root, config, "egress totality");
  assert.equal(pass.verdict, "pass", pass.reason);
  const noMatch = await runTotalityOracle(root, config, "other thing");
  assert.equal(noMatch.verdict, "fail");
  assert.match(noMatch.reason, /did not match/);
  const none = await runTotalityOracle(root, { ...config, test: undefined }, "egress totality");
  assert.equal(none.verdict, "not run");
  assert.match(none.reason, /no test command configured/);
  const argv = await runTotalityOracle(root, { ...config, test: ["sh", "-c", "exit 3"], testMatch: undefined }, "x");
  assert.equal(argv.verdict, "fail");
  assert.match(argv.reason, /exited 3/);
});

test("the batched totality oracle pass: every test the bullets name in one invocation, mapped back by name; the record says which mode ran", async () => {
  const { combinedFilter, runTotalityBatch, verdictsFromReport } = await import("./totality.ts");
  assert.equal(combinedFilter(["a (b)", "c|d", "a (b)"]), "a \\(b\\)|c\\|d");
  const report = {
    testResults: [
      { assertionResults: [
        { ancestorTitles: ["egress totality"], title: "strips", status: "passed", fullName: "egress totality strips" },
        { ancestorTitles: ["egress totality"], title: "hashes", status: "passed", fullName: "egress totality hashes" },
        { ancestorTitles: ["door totality"], title: "closes", status: "failed", fullName: "door totality closes" },
        { ancestorTitles: [], title: "lone test", status: "passed", fullName: "lone test" },
      ] },
    ],
  };
  const verdicts = verdictsFromReport(report, ["egress totality", "door totality", "lone test", "absent"], "runner");
  assert.equal(verdicts.get("egress totality")!.verdict, "pass");
  assert.match(verdicts.get("egress totality")!.reason, /2 tests under "egress totality" passed in one invocation/);
  assert.equal(verdicts.get("door totality")!.verdict, "fail");
  assert.equal(verdicts.get("lone test")!.verdict, "pass", "a test's own title matches too");
  assert.equal(verdicts.get("absent")!.verdict, "fail");
  assert.match(verdicts.get("absent")!.reason, /no test ran under the name "absent"/);

  // A fake runner that writes the report it is asked for, recording the filter it received.
  const script = `const [out, filter] = process.argv.slice(1); require("node:fs").writeFileSync(out, JSON.stringify({ testResults: [{ assertionResults: [{ ancestorTitles: ["egress totality"], title: "strips " + filter, status: "passed" }] }] }));`;
  const config = { ...readEnforcementConfig(root), testJson: ["node", "-e", script, "{out}", "{filter}"] };
  const batch = await runTotalityBatch(root, config, ["egress totality"]);
  assert.ok(batch !== undefined);
  assert.equal(batch.get("egress totality")!.verdict, "pass");
  assert.equal(await runTotalityBatch(root, readEnforcementConfig(root), ["egress totality"]), undefined, "no testJson: the caller falls back to one at a time");

  write("coherence.config.json", JSON.stringify({ language: "typescript", testDir: "__tests__", testJson: ["node", "-e", script, "{out}", "{filter}"] }));
  const outcome = await performRun(root, { session: "batched", agent: "enforcement", adapter, form: "totality oracle" });
  const entry = outcome.record.invariants[0]!;
  assert.equal(entry.mode, "batched");
  assert.equal(entry.verdict, "pass");
  assert.match(formatRun(outcome), /totality oracle: pass \(.*one invocation for every test the bullets name\)/);
  write("coherence.config.json", CONFIG);
  const single = await performRun(root, { session: "batched", agent: "enforcement", adapter, form: "totality oracle" });
  assert.equal(single.record.invariants[0]!.mode, "one-at-a-time");
  rmSync(join(root, ".coherence", "runs"), { recursive: true, force: true });
});

test("the state derivation without a run: a chokepoint bullet lacks refutation; with a run: automatic refutation satisfies it, a fail is a structural defect", () => {
  const model = loadSpecModel(root, { runs: false });
  const bullet = model.components[0]!.invariants.find((i) => i.name === "hidden set")!;
  assert.deepEqual(deriveState(bullet, []).lacks, ["refutation"]);
  assert.equal(deriveState(bullet, []).state, "requirement");
  const base = { component: ".", name: "hidden set", form: "chokepoint" as const, bypasses: [], testReferences: 0, files: [], latency: 1, at: "2026-09-17T00:00:00.000Z", commit: null, session: "s" };
  const passing = deriveState(bullet, [], { chokepoint: { ...base, verdict: "pass", grade: "visibility-choked", refutation: "automatic", reason: "" }, totality: undefined });
  assert.equal(passing.state, "invariant");
  assert.deepEqual(passing.lacks, []);
  assert.equal(passing.verified.length, 1);
  const failing = deriveState(bullet, [], { chokepoint: { ...base, verdict: "fail", grade: "broken", refutation: "automatic", reason: "bypass" }, totality: undefined });
  assert.equal(failing.state, "structural defect");
  assert.equal(failing.defects.length, 1);
  const vacuous = deriveState(bullet, [], { chokepoint: { ...base, verdict: "not run", grade: "reference-choked", refutation: "missing", reason: "" }, totality: undefined });
  assert.deepEqual(vacuous.lacks, ["refutation"], "a refutation the instrument could not see does not satisfy the requirement");
});

test("a run appends one record, never rewrites; spec --check reads the run; the status view derives the latest verdict and keeps a skipped one dated", async () => {
  rmSync(join(root, ".coherence", "runs"), { recursive: true, force: true });
  const first = await performRun(root, { session: "s1", agent: "enforcement", adapter, now: () => new Date("2026-09-17T10:00:00Z") });
  assert.equal(first.record.invariants.length, 5, "four chokepoint enforcements and one totality oracle");
  const byName = new Map(first.record.invariants.map((e) => [`${e.name}/${e.form}`, e]));
  assert.equal(byName.get("digest-only egress/chokepoint")!.verdict, "fail");
  assert.equal(byName.get("hidden set/chokepoint")!.grade, "visibility-choked");
  assert.equal(byName.get("prose thing/chokepoint")!.grade, "not chokeable");
  assert.equal(byName.get("missing door/chokepoint")!.verdict, "fail");
  assert.equal(byName.get("egress totality/totality oracle")!.verdict, "pass");
  assert.equal(byName.get("egress totality/totality oracle")!.refutation, "witnessed");
  assert.ok(byName.get("digest-only egress/chokepoint")!.files.includes("src/api/render.ts"), "the entry lists the files it touched");
  const printed = formatRun(first);
  assert.match(printed, /digest-only egress\n  chokepoint seal protects SECRET_COLUMNS: broken — fail/);
  assert.match(printed, /run recorded in \.coherence\/runs\/s1\.jsonl: 5 enforcements, 2 pass, 2 fail, 1 not run/);

  const lines = () => readFileSync(join(root, ".coherence", "runs", "s1.jsonl"), "utf8").trimEnd().split("\n");
  assert.equal(lines().length, 1);
  const second = await performRun(root, { session: "s1", agent: "enforcement", adapter, form: "chokepoint", invariants: ["hidden set"], now: () => new Date("2026-09-17T11:00:00Z") });
  assert.equal(second.record.invariants.length, 1);
  assert.equal(lines().length, 2, "append only");
  assert.deepEqual(JSON.parse(lines()[0]!) as RunRecord, first.record, "the first line is untouched");

  const model = loadSpecModel(root);
  assert.equal(model.runs?.count, 2);
  const states = Object.fromEntries(model.components[0]!.invariants.map((i) => [i.name, i.state]));
  assert.deepEqual(states, { "digest-only egress": "structural defect", "hidden set": "invariant", "prose thing": "requirement", "missing door": "structural defect", "egress totality": "invariant" });
  assert.equal(model.counts.structuralDefects, 2);

  const status = formatStatus(root, model);
  assert.match(status, /✓ \.\/hidden set  chokepoint peek: verified 2026-09-17 visibility-choked\n/);
  assert.match(status, /✕ \.\/digest-only egress  chokepoint seal: structural defect 2026-09-17 broken: 1 reference .* — kept from the run at 2026-09-17T10:00:00\.000Z; the latest run skipped it/);
  assert.match(status, /✓ \.\/egress totality  totality oracle "egress totality": verified 2026-09-17 — kept from/);
  assert.match(status, /2 runs; 2 structural defects$/);
  const latest = latestFor(latestByEnforcement(loadRuns(root).records), ".", "hidden set");
  assert.equal(latest.chokepoint?.at, "2026-09-17T11:00:00.000Z");

  const noRuns = loadSpecModel(root, { runs: false });
  assert.equal(noRuns.runs, undefined);
  assert.equal(noRuns.components[0]!.invariants.find((i) => i.name === "hidden set")!.state, "requirement");
});

test("appendRun refuses a session that cannot name a file", () => {
  assert.throws(() => appendRun(root, { at: "2026-09-17T00:00:00Z", session: "../x", agent: "a", commit: null, dirty: false, instrument: { language: "typescript", server: "none" }, latency: 0, invariants: [] }), /cannot name a file/);
});

test("mayTouch: a run's files, or a name token in the edited file, make an invariant relevant to an edit", () => {
  const model = loadSpecModel(root);
  const egress = model.components[0]!.invariants.find((i) => i.name === "digest-only egress")!;
  const hidden = model.components[0]!.invariants.find((i) => i.name === "hidden set")!;
  assert.equal(mayTouch(egress, "src/api/render.ts", undefined), true, "the latest run touched render.ts");
  assert.equal(mayTouch(hidden, "src/api/render.ts", "nothing here"), false);
  assert.equal(mayTouch(hidden, "src/new.ts", "const y = HIDDEN;"), true, "the token is in the text");
  assert.equal(mayTouch(hidden, "src/new.ts", "const y = HIDDENx;"), false, "whole tokens only");
});

test("PostToolUse on a file-writing tool re-checks the invariants that may involve the file and prints the bypass with the two options; Stop carries the defects", async () => {
  const input = { cwd: root, session_id: "s2", tool_name: "Edit", tool_input: { file_path: join(root, "src/api/render.ts") } };
  const result = await runHook("PostToolUse", input, root, { adapter });
  assert.equal(result.exit, 0, result.stderr);
  const context = (JSON.parse(result.stdout) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } }).hookSpecificOutput;
  assert.equal(context.hookEventName, "PostToolUse");
  assert.match(context.additionalContext, /^Structural defect revealed at this edit \(src\/api\/render\.ts\)/);
  assert.match(context.additionalContext, /✕ \.\/digest-only egress — chokepoint seal protects SECRET_COLUMNS: broken\n    bypass src\/api\/render\.ts:5 in render\.leaked \(this edit\)/);
  assert.match(context.additionalContext, /✕ \.\/missing door/);
  assert.doesNotMatch(context.additionalContext, /hidden set/, "an invariant the file cannot involve is not re-checked");
  assert.match(context.additionalContext, /route the reference through the chokepoint, or escalate a retirement for a human/);
  assert.match(context.additionalContext, /escalate "retire <invariant>" .* --session s2 --agent main/);
  assert.ok(readFileSync(join(root, ".coherence", "runs", "s2.jsonl"), "utf8").trimEnd().split("\n").length === 1, "the edit-time pass is recorded as a run");

  const reading = await runHook("PostToolUse", { cwd: root, session_id: "s2", tool_name: "Read", tool_input: { file_path: join(root, "src/api/render.ts") } }, root);
  assert.deepEqual(reading, { stdout: "", stderr: "", exit: 0 }, "a reading tool changes nothing");
  const unrelated = await runHook("PostToolUse", { cwd: root, session_id: "s2", tool_name: "Write", tool_input: { file_path: join(root, "tsconfig.json") } }, root);
  assert.deepEqual(unrelated, { stdout: "", stderr: "", exit: 0 }, "a file no invariant can involve is not checked");

  const stop = specStopText(root);
  assert.equal(stop.defects, 2);
  assert.match(stop.text, /✕ \.\/digest-only egress — structural defect \(chokepoint, run \d{4}-\d{2}-\d{2}\): 1 reference to SECRET_COLUMNS outside seal: src\/api\/render\.ts:5 in render\.leaked/);
  assert.match(stop.text, /stands until the reference is routed through the chokepoint or a human acknowledges a retirement/);
});

test("the check reads the current disk text after a forget, with the instrument's watcher blind to the file: a loop of edit-then-check yields zero wrong verdicts", async () => {
  // tsserver reloads a closed document from disk only when it does not own the text; a didOpen with the text it
  // already loaded leaves it owning the text, and then only its file watcher notices an edit. Excluding the file
  // from the watcher (a setting an adopter may carry) makes the stale answer deterministic instead of a race.
  const other = mkdtempSync(join(tmpdir(), "coherence-stale-"));
  const put = (path: string, text: string): void => {
    mkdirSync(dirname(join(other, path)), { recursive: true });
    writeFileSync(join(other, path), text, "utf8");
  };
  put("tsconfig.json", TSCONFIG.replace('"include": ["src/**/*.ts"]', '"include": ["src/**/*.ts"], "watchOptions": { "excludeFiles": ["src/api/render.ts"] }'));
  put("src/store/secrets.ts", SECRETS);
  put("src/__tests__/secrets.test.ts", TEST_FILE);
  put("src/api/render.ts", RENDER_CLEAN);
  const fresh = new TypeScriptAdapter(other);
  const wrong: string[] = [];
  try {
    for (let i = 0; i < 6; i++) {
      const bypass = i % 2 === 1;
      put("src/api/render.ts", bypass ? RENDER_BYPASS : RENDER_CLEAN);
      await fresh.forget(["src/api/render.ts"]);
      const result = await checkChokepoint(fresh, { protects: "SECRET_COLUMNS", chokepoint: "seal", ...hint });
      const expected = bypass ? "fail" : "pass";
      if (result.verdict !== expected) wrong.push(`cycle ${i}: disk ${bypass ? "bypass" : "clean"}, verdict ${result.verdict} (${result.reason})`);
    }
  } finally {
    await fresh.close();
    rmSync(other, { recursive: true, force: true });
  }
  assert.deepEqual(wrong, [], "every verdict answers from the text on disk");
});

test("the one-at-a-time totality path escapes the title before the runner reads it as a regex", async () => {
  const { escapeRegExp, runTotalityOracle } = await import("./totality.ts");
  assert.equal(escapeRegExp("returns 503 (R2 absent)"), "returns 503 \\(R2 absent\\)");
  const config = { test: ["node", "-e", "console.log(process.argv[1])"], testMatch: /^returns 503 \\\(R2 absent\\\)$/m, testJson: undefined } as never;
  const result = await runTotalityOracle(process.cwd(), config, "returns 503 (R2 absent)");
  assert.equal(result.verdict, "pass", result.reason);
});
