/**
 * The Quint plugin (plugins/quint): opt-in, bundled, a verifier. A bullet
 * proves a property of a Quint model with via: [quint] or [quint run],
 * graded like a test with its own evidence label; what could not run (no
 * quint, no Java for Apalache, no time) reads not run, never a pass.
 *
 * A scripted quint stands in for the binary (COHERENCE_QUINT), answering as
 * quint 0.33 does, Java's absence in macOS's own words included; the last
 * test runs the real one when COHERENCE_QUINT names it.
 */

import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { performRun } from "../enforcement/run.ts";
import { checkPlugin, checkText } from "./check.ts";
import { BUNDLED_DIR } from "./registry.ts";
import { resolveTarget, verifierBudget, verify } from "../../plugins/quint/index.ts";
import { pluginAt } from "./check.ts";
import { proveVia } from "./verify.ts";
import { budget } from "../enforcement/test-budgets.ts";

const roots: string[] = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "coherence-quint-"));
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text, "utf8");
  }
  return root;
}

/** A quint that answers as 0.33 does: typecheck passes, run prints its trace length statistics, run breaks a property named "breaks" or "small" and refuses "unknown" or "missing", verify needs Java unless STUB_JAVA says it is there; every call logged. */
const STUB = `#!/usr/bin/env node
const fs = require("node:fs");
const argv = process.argv.slice(2);
if (process.env.STUB_LOG) fs.appendFileSync(process.env.STUB_LOG, argv.join(" ") + "\\n");
if (process.env.STUB_EXIT) process.exit(Number(process.env.STUB_EXIT));
if (process.env.STUB_SLEEP) { setTimeout(() => process.exit(0), 60000); return; }
const invariant = argv[argv.indexOf("--invariant") + 1];
if (argv[0] === "typecheck") process.exit(0);
if (invariant === "unknown" || invariant === "missing") { console.error("error: [QNT404] Name '" + invariant + "' not found"); process.exit(1); }
if (argv[0] === "run" && (invariant === "breaks" || invariant === "small")) { console.log("An example execution:\\n\\n[State 0] { count: 0 }\\n\\n[State 1] { count: 1 }\\n\\n[violation] Found an issue (3ms)."); console.error("error: Invariant violated"); process.exit(1); }
if (argv[0] === "run") {
  // Trace lengths count states, the initial one included: a model with no init reaches none, one whose step is never enabled reaches one.
  const file = argv[1];
  const max = file.endsWith("NoInit.qnt") ? 0 : file.endsWith("Stuck.qnt") ? 1 : Number(argv[argv.indexOf("--max-steps") + 1]) + 1;
  console.log("[ok] No violation found (5ms at 2000 traces/second).\\nTrace length statistics: max=" + max + ", min=" + max + ", average=" + max + ".00");
  process.exit(0);
}
if (argv[0] === "verify" && process.env.STUB_JAVA !== "present") { console.error("The operation couldn\\u2019t be completed. Unable to locate a Java Runtime.\\nPlease visit http://www.java.com for information on installing Java."); process.exit(1); }
process.exit(0);
`;

const stubDir = mkdtempSync(join(tmpdir(), "coherence-quint-stub-"));
roots.push(stubDir);
const STUB_BIN = join(stubDir, "quint");
writeFileSync(STUB_BIN, STUB);
chmodSync(STUB_BIN, 0o755);

/** Run `work` with the stub as quint and the environment's named values set, every one restored after. */
async function withQuint<T>(env: Record<string, string | undefined>, work: () => Promise<T>): Promise<T> {
  const all: Record<string, string | undefined> = { COHERENCE_QUINT: STUB_BIN, STUB_JAVA: undefined, STUB_EXIT: undefined, STUB_SLEEP: undefined, STUB_LOG: undefined, ...env };
  const before = new Map(Object.keys(all).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(all)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await work();
  } finally {
    for (const [key, value] of before) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const MODEL = "module Journal {\n  var orders: int\n  action init = orders' = 0\n  action step = orders' = orders + 1\n  val holds = orders >= 0\n  val breaks = orders < 1\n}\n";

const SPEC = `# Journal

The work-order model.

## invariants
- an ended order never moves: The model never reopens an ended order.
  over: every state the model reaches within its bound
  via: [quint] holds
  because: the model states it once over every sequence of moves
  kinds: none
- the simulation holds: The model holds over sampled runs.
  over: every sampled run
  via: [quint run] holds in Journal.qnt
  because: simulation needs no Java
  kinds: none
- the model breaks: A property the model breaks.
  over: every sampled run
  via: [quint run] breaks
  because: a counterexample must fail the bullet
  kinds: none
`;

test("a Quint bullet is proved through the verifier role: graded like a test with its evidence label, the plugin named, a counterexample failing it, [quint run] never model-checking; its vocabulary is its own layer, carried only while a bullet proves by it", async () => {
  const root = project({ "coherence.config.json": JSON.stringify({ plugins: { quint: "bundled" } }), "src/journal/Journal.qnt": MODEL, "src/journal/Journal.spec.md": SPEC });
  const log = join(root, "quint.log");
  const record = await withQuint({ STUB_JAVA: "present", STUB_LOG: log }, async () => (await performRun(root, { session: "quint", agent: "test", form: "totality oracle", server: false })).record);
  const by = new Map(record.invariants.map((e) => [e.name, e]));
  const proved = by.get("an ended order never moves")!;
  assert.equal(proved.verdict, "pass", proved.reason);
  assert.equal(proved.evidence, "bounded-model-checked");
  assert.deepEqual(proved.plugins, [{ name: "quint", version: "0.1.0" }]);
  assert.match(proved.reason, /no violation of holds in 1000 sampled traces of src\/journal\/Journal\.qnt \(max depth 20; typescript backend\); and none in Apalache's bounded model check within 10 steps, a bound, not every reachable state$/, "the folder's one model, the depth reached and the bound said");
  const simulated = by.get("the simulation holds")!;
  assert.equal(simulated.verdict, "pass", simulated.reason);
  assert.equal(simulated.evidence, "simulated");
  const broken = by.get("the model breaks")!;
  assert.equal(broken.verdict, "fail");
  assert.match(broken.reason, /quint run found a state of src\/journal\/Journal\.qnt that breaks breaks: .*\[State 1\] \{ count: 1 \}/);
  const calls = readFileSync(log, "utf8").trim().split("\n");
  const verifies = calls.filter((c) => c.startsWith("verify "));
  assert.equal(verifies.length, 1, "only the [quint] bullet model-checks");
  const port = /--server-endpoint localhost:(\d+)$/.exec(verifies[0]!)?.[1];
  assert.ok(port !== undefined && port !== "8822", `its own Apalache server on a free port, never one already on the default: ${verifies[0]}`);

  const { startReading } = await import("../lifecycle/hook.ts");
  assert.match((await startReading(root)).text, /Plugin quint vocabulary/, "a bullet proved by its form puts its vocabulary in the way");
  const idle = project({ "coherence.config.json": JSON.stringify({ plugins: { quint: "bundled" } }), "Demo.spec.md": "# Demo\n\n## invariants\n" });
  assert.doesNotMatch((await startReading(idle)).text, /Plugin quint vocabulary/, "a project with no Quint bullet carries none of it");
  const coherence = JSON.parse(readFileSync(join(BUNDLED_DIR, "..", "docs", "lexicon.json"), "utf8")) as { concepts: { name: string }[] };
  assert.ok(!coherence.concepts.some((c) => /quint/i.test(c.name)), "no term joins Coherence's own lexicon");
});

test("Quint never passes what it could not run: no quint, a shell that found none, no Java for Apalache and a step out of time each read not run with why; [quint run] needs no Java", async () => {
  const root = project({ "Journal.qnt": MODEL });
  const ask = (form: string, timeoutMs = 60_000): Promise<{ verdict: string; reason: string }> => verify({ root, component: ".", form, name: "holds", timeoutMs });
  const missing = await withQuint({ COHERENCE_QUINT: join(root, "no-such-quint") }, () => ask("quint"));
  assert.deepEqual(missing.verdict, "not run");
  assert.match(missing.reason, /^quint typecheck could not run: quint could not start .*install @informalsystems\/quint@0\.33 or set COHERENCE_QUINT/);
  const shim = await withQuint({ STUB_EXIT: "127" }, () => ask("quint"));
  assert.equal(shim.verdict, "not run");
  assert.match(shim.reason, /could not run \(exit 127\)/);
  const noJava = await withQuint({}, () => ask("quint"));
  assert.equal(noJava.verdict, "not run");
  assert.match(noJava.reason, /^quint verify could not run: Java not found: Apalache, the model checker quint verify runs, needs a Java runtime \(The operation couldn’t be completed\. Unable to locate a Java Runtime\.\)$/);
  assert.equal((await withQuint({}, () => ask("quint run"))).verdict, "pass", "simulation alone needs no Java");
  const late = await withQuint({ STUB_SLEEP: "1" }, () => ask("quint run", 3000));
  assert.equal(late.verdict, "not run");
  assert.match(late.reason, /did not finish in 2 s; .*nothing it said counts/);
});

test("a Quint simulation reads how deep it went: a model with no initial state is not run, one that stops early passes with the depth it reached said as a limit; and every verifier's time out is not run, the Quint plugin's deadline inside the core's", async () => {
  const root = project({ "edge/NoInit.qnt": MODEL, "edge/Stuck.qnt": MODEL, "Journal.qnt": MODEL });
  const ask = (name: string): Promise<{ verdict: string; reason: string }> => withQuint({}, () => verify({ root, component: ".", form: "quint run", name, timeoutMs: 60_000 }));
  const empty = await ask("holds in edge/NoInit.qnt");
  assert.equal(empty.verdict, "not run");
  assert.match(empty.reason, /^no initial state: quint run found no state satisfying edge\/NoInit\.qnt's init, so holds was checked of nothing$/);
  const stuck = await ask("holds in edge/Stuck.qnt");
  assert.equal(stuck.verdict, "pass", stuck.reason);
  assert.match(stuck.reason, /\(max depth 0, short of the 20 steps asked: no trace went further, so nothing past step 0 was seen;/);
  assert.match((await ask("holds")).reason, /\(max depth 20; typescript backend\)$/, "a run that reached the bound says so without a limit");

  for (const timeoutMs of [1, 2, 3, 100, 2999, 3000, 7999, 8000, 600_000]) assert.ok(verifierBudget(timeoutMs) < timeoutMs && verifierBudget(timeoutMs) >= 0, `${timeoutMs} ms: the plugin's deadline falls inside the core's`);
  const hangs = project({ "plugins/hangs/plugin.json": JSON.stringify({ name: "hangs", version: "1.0.0", pluginApi: 2, module: "./index.ts", verifiers: [{ form: "hangs", evidence: "model-checked" }] }), "plugins/hangs/index.ts": "export default { verify: () => new Promise(() => {}) };\n" });
  const late = await proveVia(hangs, [pluginAt(hangs, "./plugins/hangs")], "[hangs] forever", 50);
  assert.equal(late.verdict, "not run", "a verifier the core gave up on proved nothing either way");
  assert.match(late.reason, /did not answer in 0 s; nothing it said counts$/);
});

test("a Quint bullet names its model from its own folder: the file it names, else the folder's one model; none, several or a missing file is said, never guessed", () => {
  const root = project({ "a/One.qnt": MODEL, "b/One.qnt": MODEL, "b/Two.qnt": MODEL, "c/README.md": "" });
  assert.deepEqual(resolveTarget(root, "a", "holds"), { property: "holds", model: "a/One.qnt" });
  assert.deepEqual(resolveTarget(root, "b", "holds in Two.qnt"), { property: "holds", model: "b/Two.qnt" });
  assert.deepEqual(resolveTarget(root, "b", "holds"), { reason: "b holds 2 models (One.qnt, Two.qnt); name one: holds in <file>.qnt" });
  assert.deepEqual(resolveTarget(root, "c", "holds"), { reason: "no .qnt model in c, the bullet's folder; name one: holds in <file>.qnt" });
  assert.deepEqual(resolveTarget(root, "a", "holds in Gone.qnt"), { reason: "no model a/Gone.qnt: Gone.qnt is named from the bullet's folder (a)" });
  assert.match((resolveTarget(root, "a", "holds or not") as { reason: string }).reason, /is not a Quint property/);
});

test("plugin check holds a verifier plugin to its own proofs, one duty per form: Quint's simulation passes, and its model check without Java reads not run with why, never pass", async () => {
  const without = await withQuint({}, () => checkPlugin(process.cwd(), "quint"));
  assert.deepEqual(without.duties.map((d) => [d.name, d.verdict]), [["[quint]", "not run"], ["[quint run]", "pass"]], JSON.stringify(without.duties));
  assert.match(without.duties[0]!.reason, /\[quint\] nonNegative in Counter\.qnt read not run: .*Java not found/);
  assert.match(checkText(without), /^plugin check quint \(bundled, verifier, 0\.1\.0\): NOT RUN$/m, "no fail, but not every duty passed");
  const withJava = await withQuint({ STUB_JAVA: "present" }, () => checkPlugin(process.cwd(), "quint"));
  assert.ok(withJava.duties.every((d) => d.verdict === "pass"), JSON.stringify(withJava.duties));
});

test("the real quint, when COHERENCE_QUINT names it: plugin check passes [quint run] and, with no Java here, reads [quint] not run naming Java", { skip: process.env["COHERENCE_QUINT"] === undefined ? "COHERENCE_QUINT names no quint binary here; set it to run quint 0.33 itself" : false }, async (t) => {
  budget(t, 120, "d-29601af5");
  // Its own QUINT_HOME, so quint fetches Apalache into a temporary folder and never writes ~/.quint.
  const home = mkdtempSync(join(tmpdir(), "coherence-quint-home-"));
  roots.push(home);
  const checked = await withQuint({ COHERENCE_QUINT: process.env["COHERENCE_QUINT"], QUINT_HOME: home }, () => checkPlugin(process.cwd(), "quint"));
  assert.equal(checked.duties.find((d) => d.name === "[quint run]")!.verdict, "pass", JSON.stringify(checked.duties));
  const model = checked.duties.find((d) => d.name === "[quint]")!;
  assert.notEqual(model.verdict, "fail", model.reason);
  if (model.verdict === "not run") assert.match(model.reason, /Java not found|Apalache could not be started or fetched/);
});
