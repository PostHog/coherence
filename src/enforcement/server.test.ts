/**
 * The warm server: started for a temporary project, queried twice over the
 * socket, and the second answer arrives from a server that was already warm.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { connectAdapter, serve, serverPaths, type Serving } from "./server.ts";
import { performRun } from "./run.ts";

let root: string;
let started: Promise<Serving> | undefined;

function write(path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text, "utf8");
}

/** The server, started by the first test that needs it: a filtered run that selects no test here starts nothing and waits on nothing. */
function warm(): Promise<Serving> {
  started ??= serve(root, { idleMs: 60_000 });
  return started;
}

before(() => {
  root = mkdtempSync(join(tmpdir(), "coherence-server-"));
  write("tsconfig.json", `{ "compilerOptions": { "strict": true, "noEmit": true, "module": "NodeNext", "moduleResolution": "NodeNext", "allowImportingTsExtensions": true }, "include": ["src/**/*.ts"] }\n`);
  write("src/door.ts", "const KEY = 1;\nexport function open(): number {\n  return KEY;\n}\n");
  write("src/hall.ts", 'import { open } from "./door.ts";\nexport const hall = open();\n');
});

after(async () => {
  if (started !== undefined) await (await started).stop();
  rmSync(root, { recursive: true, force: true });
});

test("the server listens on the project's socket and records a pointer", async () => {
  const serving = await warm();
  const paths = serverPaths(root);
  assert.ok(existsSync(paths.pointer), "server.json is written");
  assert.ok(existsSync(serving.paths.socket), "the socket exists");
});

test("two clients ask the same questions; the second finds the server warm", async () => {
  await warm();
  const first = await connectAdapter(root, { spawn: false });
  const ready = await first.adapter.ready();
  assert.equal(ready.ok, true, JSON.stringify(ready));
  const hint = { component: ".", testFolders: ["__tests__"] };
  const key = await first.adapter.resolve("KEY", hint);
  assert.ok(key.ok, JSON.stringify(key));
  assert.equal(key.definition.file, "src/door.ts");
  const refs = await first.adapter.references(key.definition);
  assert.deepEqual(refs.map((r) => `${r.file}:${r.line} ${r.symbol}`), ["src/door.ts:3 open"]);
  const visibility = await first.adapter.visibility(key.definition);
  assert.equal(visibility.visible, false);
  await first.adapter.close();

  const second = await connectAdapter(root, { spawn: false });
  assert.equal(second.server, "warm");
  const status = await second.adapter.status();
  assert.equal(status.language, "typescript");
  assert.equal(status.ladder.top, "visibility-choked");
  const open = await second.adapter.resolve("open", hint);
  assert.ok(open.ok);
  const refutation = await second.adapter.refute(open.definition, undefined);
  assert.equal(refutation.seen, true, refutation.account);
  await second.adapter.close();
});

test("a client with spawning off fails plainly when nothing listens", async () => {
  const other = mkdtempSync(join(tmpdir(), "coherence-noserver-"));
  try {
    await assert.rejects(connectAdapter(other, { spawn: false }), /no warm server listening/);
  } finally {
    rmSync(other, { recursive: true, force: true });
  }
});

test("the run keeps the instrument alive across the test pass, and a run whose instrument died exits non-zero with the reason", async () => {
  // The totality pass runs the whole suite before the first question, and the warm server's idle timer only
  // resets on a request line. Reviewer A: a suite longer than the idle killed the instrument, every chokepoint
  // recorded not run, and the run exited 0.
  const other = mkdtempSync(join(tmpdir(), "coherence-idle-"));
  const put = (path: string, text: string): void => {
    mkdirSync(dirname(join(other, path)), { recursive: true });
    writeFileSync(join(other, path), text, "utf8");
  };
  put("tsconfig.json", `{ "compilerOptions": { "strict": true, "noEmit": true, "module": "NodeNext", "moduleResolution": "NodeNext", "allowImportingTsExtensions": true }, "include": ["src/**/*.ts"] }\n`);
  put("src/door.ts", "const KEY = 1;\nexport function open(): number {\n  return KEY;\n}\n");
  // A runner that holds the floor for longer than the server's idle timeout, then writes a passing report.
  const slow = 'setTimeout(() => require("node:fs").writeFileSync(process.argv[1], JSON.stringify({ testResults: [{ assertionResults: [{ ancestorTitles: [], title: "door holds", fullName: "door holds", status: "passed" }] }] })), 2500);';
  put("coherence.config.json", JSON.stringify({ language: "typescript", testDir: "__tests__", testJson: ["node", "-e", slow, "{out}", "{filter}"] }));
  put(
    "Idle.spec.md",
    ["# Idle", "", "One door.", "", "## invariants", "- key held: The key is read through open.", "  protects: KEY", "  chokepoint: open", "  over: every read of the key", "  via: door holds", "  because: one door", "  kinds: none", ""].join("\n"),
  );

  const idle = await serve(other, { idleMs: 1_200 });
  try {
    // No heartbeat: the instrument is gone by the time the first chokepoint is asked.
    const died = await performRun(other, { session: "idle-1", agent: "server", heartbeatMs: 10 * 60 * 1000 });
    const chokepoint = died.record.invariants.find((e) => e.form === "chokepoint")!;
    assert.equal(chokepoint.verdict, "not run");
    assert.equal(died.instrumentDied, true, "a run that proved nothing says so");
    assert.match(died.instrumentReason ?? "", /did not survive the test pass/);
    assert.match(chokepoint.reason, /instrument unavailable/);
  } finally {
    await idle.stop();
  }

  const alive = await serve(other, { idleMs: 1_200 });
  try {
    // The heartbeat keeps the instrument's idle timer awake while the runner holds the floor.
    const kept = await performRun(other, { session: "idle-2", agent: "server", heartbeatMs: 400 });
    const chokepoint = kept.record.invariants.find((e) => e.form === "chokepoint")!;
    assert.equal(kept.instrumentDied, false, kept.instrumentReason ?? "");
    assert.equal(chokepoint.verdict, "pass", chokepoint.reason);
    assert.equal(chokepoint.grade, "visibility-choked", chokepoint.reason);
    assert.equal(kept.record.invariants.find((e) => e.form === "totality oracle")!.verdict, "pass");
  } finally {
    await alive.stop();
    rmSync(other, { recursive: true, force: true });
  }
});
