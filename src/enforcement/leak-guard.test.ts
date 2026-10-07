/**
 * The leak guard over a real node:test run: test files that leave a process
 * or a temp folder behind fail, each leak named, and the guard kills and
 * removes what it named; a file that cleans up after itself passes.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const GUARD = fileURLToPath(new URL("./leak-guard.ts", import.meta.url));

const HEAD = `import { test } from "node:test";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const note = (name, value) => writeFileSync(join(process.env.LEAK_NOTES, name), String(value));
const sleeper = "setTimeout(() => {}, 120000)";
`;

const FIXTURES: Record<string, string> = {
  // Detached, with a clean environment: only its command line names the file's temp folder.
  "named.test.mjs": `${HEAD}test("starts a server on a fixture and walks away", () => {
  const dir = mkdtempSync(join(tmpdir(), "coherence-named-"));
  const child = spawn(process.execPath, ["-e", sleeper, dir], { detached: true, stdio: "ignore", env: { PATH: process.env.PATH } });
  child.unref();
  note("named.pid", child.pid);
});
`,
  // Detached, its command line naming nothing: the environment it inherited carries the folder.
  "inherited.test.mjs": `${HEAD}test("starts a detached helper and walks away", () => {
  const child = spawn(process.execPath, ["-e", sleeper], { detached: true, stdio: "ignore" });
  child.unref();
  note("inherited.pid", child.pid);
});
`,
  "folder.test.mjs": `${HEAD}test("makes a temp folder and keeps it", () => {
  mkdtempSync(join(tmpdir(), "coherence-kept-"));
});
`,
  "clean.test.mjs": `${HEAD}test("spawns and waits, makes a temp folder and removes it", () => {
  const dir = mkdtempSync(join(tmpdir(), "coherence-tidy-"));
  spawnSync(process.execPath, ["-e", "0", dir]);
  rmSync(dir, { recursive: true, force: true });
});
`,
};

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test("the leak guard fails a test file that leaves a process or a temp folder behind, names each, and passes one that cleans up", { timeout: 120_000 }, () => {
  const root = mkdtempSync(join(tmpdir(), "coherence-leak-guard-"));
  const notes = join(root, "notes");
  const temp = join(root, "temp");
  const pids: number[] = [];
  try {
    for (const dir of [notes, temp]) mkdirSync(dir);
    for (const [name, text] of Object.entries(FIXTURES)) writeFileSync(join(root, name), text, "utf8");
    // The fixture's own runner: NODE_TEST_CONTEXT would make it think it runs inside this one.
    const env: Record<string, string | undefined> = { ...process.env, LEAK_NOTES: notes, TMPDIR: temp };
    delete env["NODE_TEST_CONTEXT"];
    const run = (file: string) => spawnSync(process.execPath, [`--import=${GUARD}`, "--test", file], { cwd: root, encoding: "utf8", env, timeout: 60_000 });

    const named = run("named.test.mjs");
    const namedPid = Number(readFileSync(join(notes, "named.pid"), "utf8"));
    pids.push(namedPid);
    assert.notEqual(named.status, 0, "a file that leaves a process running fails");
    assert.match(named.stdout, /leak guard: \S*named\.test\.mjs left 1 process\(es\) and 1 temp folder\(s\) behind/);
    assert.match(named.stdout, new RegExp(`process ${namedPid}: \\S*node -e setTimeout`), "the process is named with its command line");
    assert.match(named.stdout, /temp folder: \S*coherence-named-/, "the fixture folder is named");

    const inherited = run("inherited.test.mjs");
    const inheritedPid = Number(readFileSync(join(notes, "inherited.pid"), "utf8"));
    pids.push(inheritedPid);
    assert.notEqual(inherited.status, 0, "a detached process found through its environment fails the file");
    assert.match(inherited.stdout, new RegExp(`process ${inheritedPid}: `));

    const folder = run("folder.test.mjs");
    assert.notEqual(folder.status, 0, "a file that keeps a temp folder fails");
    assert.match(folder.stdout, /left 0 process\(es\) and 1 temp folder\(s\) behind/);
    assert.match(folder.stdout, /temp folder: \S*coherence-kept-/);

    const clean = run("clean.test.mjs");
    assert.equal(clean.status, 0, `a file that cleans up passes:\n${clean.stdout}\n${clean.stderr}`);
    assert.doesNotMatch(clean.stdout, /leak guard/);

    assert.deepEqual(pids.filter(alive), [], "every process the guard named is killed");
    assert.deepEqual(readdirSync(temp), [], "the guard removes each file's temp folder, and what was left in it");
  } finally {
    for (const pid of pids.filter((p) => Number.isInteger(p) && p > 0 && alive(p))) process.kill(pid, "SIGKILL");
    if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  }
});
