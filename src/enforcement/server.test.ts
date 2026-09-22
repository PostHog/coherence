/**
 * The warm server: started for a temporary project, queried twice over the
 * socket, and the second answer arrives from a server that was already warm.
 */

import assert from "node:assert/strict";
import { execFile, execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { CODE_SALT_ENV, codeFingerprint, connectAdapter, serve, serverPaths, type Serving } from "./server.ts";
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

/* ------------------------------------------- one server per root, current code */

const SERVER_TS = new URL("./server.ts", import.meta.url).href;

/** A throwaway TypeScript project the warm server can load. */
function project(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "tsconfig.json"), `{ "compilerOptions": { "strict": true, "noEmit": true, "module": "NodeNext", "moduleResolution": "NodeNext", "allowImportingTsExtensions": true }, "include": ["src/**/*.ts"] }\n`, "utf8");
  writeFileSync(join(dir, "src/door.ts"), "const KEY = 1;\nexport function open(): number {\n  return KEY;\n}\n", "utf8");
  return dir;
}

/** The pids of every `serve` process started for this root, read from the process table. */
function servePids(dir: string): number[] {
  const marker = `--root ${realpathSync(dir)}`;
  const table = execFileSync("ps", ["-axww", "-o", "pid=,command="], { encoding: "utf8" });
  return table
    .split("\n")
    .filter((line) => line.includes("cli.ts serve") && (line.endsWith(marker) || line.includes(`${marker} `)))
    .map((line) => Number(line.trim().split(/\s+/)[0]));
}

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function until(condition: () => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return condition();
}

/** Stop every server this test started for the root, politely and then by signal. */
async function stopAll(dir: string): Promise<void> {
  try {
    const connected = await connectAdapter(dir, { spawn: false });
    await connected.adapter.stopServer();
    await connected.adapter.close();
  } catch {
    // Nothing listening.
  }
  const pids = servePids(dir);
  await until(() => pids.every((pid) => !running(pid)), 5_000);
  for (const pid of servePids(dir)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
}

/** One client in its own process: connects (spawning when nothing listens) and prints the pid that answered. */
function clientProcess(dir: string): Promise<{ pid: number; server: string }> {
  const script = `import { connectAdapter } from ${JSON.stringify(SERVER_TS)};\nconst c = await connectAdapter(process.argv[1], { idleMs: 60_000 });\nconst s = await c.adapter.status();\nconsole.log(JSON.stringify({ pid: s.pid, server: c.server }));\nawait c.adapter.close();\n`;
  return new Promise((answered, reject) => {
    execFile(process.execPath, ["--disable-warning=ExperimentalWarning", "--input-type=module", "-e", script, dir], { timeout: 60_000 }, (error, stdout, stderr) => {
      if (error !== null) reject(new Error(`${error.message}\n${stderr}`));
      else answered(JSON.parse(stdout.trim()) as { pid: number; server: string });
    });
  });
}

test("ten concurrent clients for one root are served by exactly one server process", async () => {
  const dir = project("coherence-race-");
  try {
    const answers = await Promise.all(Array.from({ length: 10 }, () => clientProcess(dir)));
    const pids = new Set(answers.map((a) => a.pid));
    assert.equal(pids.size, 1, `every client is answered by one server: ${[...pids].join(", ")}`);
    // A client that lost the race waited for the winner; none spawned a second server that lingers.
    await new Promise((r) => setTimeout(r, 500));
    assert.deepEqual(servePids(dir), [...pids], "exactly one serve process runs for the root");
  } finally {
    await stopAll(dir);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a lock whose owner is dead is reclaimed by the next client", async () => {
  const dir = project("coherence-deadowner-");
  try {
    const dead = spawnSync(process.execPath, ["-e", ""]).pid!;
    assert.equal(running(dead), false);
    const paths = serverPaths(dir);
    mkdirSync(paths.dir, { recursive: true });
    writeFileSync(paths.lock, JSON.stringify({ pid: dead, at: new Date().toISOString() }) + "\n", "utf8");
    const connected = await connectAdapter(dir, { idleMs: 60_000 });
    const status = await connected.adapter.status();
    await connected.adapter.close();
    assert.notEqual(status.pid, dead);
    assert.equal((JSON.parse(readFileSync(paths.lock, "utf8")) as { pid: number }).pid, status.pid, "the lock names the new owner");
  } finally {
    await stopAll(dir);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("serve refuses a root a live server holds and never unlinks that server's socket", async () => {
  const dir = project("coherence-owner-");
  const first = await serve(dir, { idleMs: 60_000 });
  try {
    await assert.rejects(serve(dir, { idleMs: 60_000 }), /holds this root/);
    // A serve process of its own is refused the same way, and exits rather than lingering.
    const cli = new URL("../cli.ts", import.meta.url).pathname;
    const other = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", cli, "serve", "--root", dir], { encoding: "utf8", timeout: 30_000 });
    assert.equal(other.status, 1, other.stderr);
    assert.match(other.stderr, /holds this root/);
    assert.ok(existsSync(first.paths.socket), "the owner's socket is still there");
    const connected = await connectAdapter(dir, { spawn: false });
    assert.equal((await connected.adapter.status()).pid, process.pid);
    await connected.adapter.close();
  } finally {
    await first.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a server running other code is replaced by a fresh process", async () => {
  const dir = project("coherence-stale-");
  const saved = process.env[CODE_SALT_ENV];
  try {
    process.env[CODE_SALT_ENV] = "before the edit";
    const old = await connectAdapter(dir, { idleMs: 60_000 });
    const oldStatus = await old.adapter.status();
    await old.adapter.close();
    assert.equal(oldStatus.fingerprint, codeFingerprint());

    process.env[CODE_SALT_ENV] = "after the edit";
    const fresh = await connectAdapter(dir, { idleMs: 60_000 });
    const freshStatus = await fresh.adapter.status();
    await fresh.adapter.close();
    assert.notEqual(freshStatus.pid, oldStatus.pid, "a new process answers");
    assert.equal(freshStatus.fingerprint, codeFingerprint(), "the new process runs the client's code");
    assert.equal(fresh.server, "cold");
    assert.ok(await until(() => !running(oldStatus.pid), 5_000), "the stale server exited");
  } finally {
    if (saved === undefined) delete process.env[CODE_SALT_ENV];
    else process.env[CODE_SALT_ENV] = saved;
    await stopAll(dir);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a server whose root is deleted exits", async () => {
  const dir = project("coherence-gone-");
  const serving = await serve(dir, { idleMs: 60_000, checkMs: 100 });
  let exited = false;
  void serving.done.then(() => (exited = true));
  rmSync(dir, { recursive: true, force: true });
  const gone = await until(() => exited, 5_000);
  if (!gone) await serving.stop();
  assert.ok(gone, "the server shut down once its root was removed");
});
