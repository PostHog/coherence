import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { runHook } from "./hook.ts";
import { PACKAGE_NAME } from "./project.ts";
import type { Env } from "./telemetry.ts";
import {
  CHECK_INTERVAL_MS,
  isNewer,
  latestPath,
  packageManager,
  readLatest,
  refreshLatest,
  REGISTRY_LATEST,
  startUpdateCheck,
  versionBlock,
  versionText,
  type Spawner,
} from "./version.ts";

const CHECKOUT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = join(CHECKOUT, "src", "cli.ts");
const VERSION = (JSON.parse(readFileSync(join(CHECKOUT, "package.json"), "utf8")) as { version: string }).version;

/** `text` as a regular expression that matches it literally. */
function escaped(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

const made: string[] = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function temp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
}

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** A Coherence folder at `folder`, of `version`, with the cli an installed package or a checkout runs. */
function coherenceAt(folder: string, version: string, cli: string): string {
  write(join(folder, "package.json"), JSON.stringify({ name: PACKAGE_NAME, version }));
  write(join(folder, cli), "");
  return join(folder, cli);
}

/** A user's config folder of its own, so nothing reaches the real one; the check is on unless `extra` turns it off. */
function userEnv(extra: Record<string, string> = {}): Env {
  return { XDG_CONFIG_HOME: temp("coherence-version-home-"), ...extra };
}

function keepLatest(env: Env, cache: object): void {
  write(latestPath(env), JSON.stringify(cache));
}

function spawnRecorder(): { spawner: Spawner; spawned: { command: string; args: string[]; options: object; unref: boolean }[] } {
  const spawned: { command: string; args: string[]; options: object; unref: boolean }[] = [];
  const spawner: Spawner = (command, args, options) => {
    const entry = { command, args, options, unref: false };
    spawned.push(entry);
    return { on: () => undefined, unref: () => void (entry.unref = true) };
  };
  return { spawner, spawned };
}

test("the session start names the Coherence that runs and where it is, and warns when another copy the project reaches differs in version", async () => {
  const parent = temp("coherence-copies-");
  const project = join(parent, "project");
  mkdirSync(project);
  const installed = coherenceAt(join(project, "node_modules", PACKAGE_NAME), "1.5.2", join("dist", "cli.js"));
  const sibling = coherenceAt(join(parent, "coherence"), "0.0.0", join("src", "cli.ts"));
  const env = userEnv({ COHERENCE_NO_UPDATE_CHECK: "1" });

  // The adopter's case: the installed release runs, and the stale clone beside the project is named as the other copy.
  assert.equal(
    versionBlock(project, false, env, installed),
    `Coherence 1.5.2 runs this session: the installed package (node_modules/${PACKAGE_NAME}).\n` +
      "Another Coherence differs: a checkout at ../coherence is 0.0.0, so node ../coherence/src/cli.ts answers as 0.0.0, not as this session's 1.5.2; keep one, or update the other.\n",
  );

  // A checkout run through COHERENCE_HOME says so, and names the installed package it is not.
  assert.equal(
    versionBlock(project, false, { ...env, COHERENCE_HOME: join(parent, "coherence") }, sibling),
    `Coherence 0.0.0 runs this session: the checkout COHERENCE_HOME names (${join(parent, "coherence")}).\n` +
      `Another Coherence differs: the installed package (node_modules/${PACKAGE_NAME}) is 1.5.2, so npx --no -- coherence answers as 1.5.2, not as this session's 0.0.0; keep one, or update the other.\n`,
  );

  // A checkout beside a project with nothing installed: it says it was reached because nothing is.
  rmSync(join(project, "node_modules"), { recursive: true });
  assert.equal(versionBlock(project, false, env, sibling), "Coherence 0.0.0 runs this session: a checkout at ../coherence, reached because the project has no installed package.\n");

  // Copies at the same version are one Coherence: nothing to warn of.
  coherenceAt(join(project, "node_modules", PACKAGE_NAME), "0.0.0", join("dist", "cli.js"));
  assert.equal(versionBlock(project, false, env, sibling), "Coherence 0.0.0 runs this session: a checkout at ../coherence.\n");

  // Through the hook: the session start carries the line, beside the session block.
  const root = temp("coherence-start-");
  const result = await runHook("SessionStart", { session_id: "s1", cwd: root }, root);
  const context = (JSON.parse(result.stdout) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext;
  assert.match(context, new RegExp(`\\n\\nCoherence ${escaped(VERSION)} runs this session: a checkout at [^\\n]+\\.\\n\\nSession: s1\\n`));
});

test("a newer release in the kept answer is named at the session start with the update command for the project's package manager and its release-age setting", () => {
  const project = temp("coherence-update-");
  const installed = coherenceAt(join(project, "node_modules", PACKAGE_NAME), "1.5.2", join("dist", "cli.js"));
  const env = userEnv();
  const lines = (): string[] => versionBlock(project, false, env, installed).trimEnd().split("\n");
  assert.deepEqual(lines().slice(1), [], "no answer kept: nothing to say");

  keepLatest(env, { attempted: "2026-10-08T00:00:00.000Z", checked: "2026-10-08T00:00:01.000Z", latest: "1.6.0" });
  assert.equal(packageManager(project), "npm", "no lockfile: npm");
  assert.deepEqual(lines().slice(1), [
    `Coherence 1.6.0 is published (the registry said so 2026-10-08T00:00:01.000Z); this session runs 1.5.2. Update: npm install -D ${PACKAGE_NAME}@^1.6.0; a release-age setting may hold the newest back: npm's min-release-age holds a release back; min-release-age-exclude (npm 12) exempts ${PACKAGE_NAME}.`,
  ]);
  const expected: [string, RegExp][] = [
    ["pnpm-lock.yaml", new RegExp(`Update: pnpm add -D ${PACKAGE_NAME}@\\^1\\.6\\.0; .*minimumReleaseAge.*minimumReleaseAgeExclude in pnpm-workspace\\.yaml`)],
    ["yarn.lock", new RegExp(`Update: yarn add -D ${PACKAGE_NAME}@\\^1\\.6\\.0; .*Yarn .*npmPreapprovedPackages`)],
    ["bun.lock", new RegExp(`Update: bun add -d ${PACKAGE_NAME}@\\^1\\.6\\.0; .*install\\.minimumReleaseAge.*minimumReleaseAgeExcludes`)],
  ];
  for (const [lockfile, line] of expected) {
    write(join(project, lockfile), "");
    assert.match(lines()[1]!, line, lockfile);
    rmSync(join(project, lockfile));
  }

  // The same version, or an older one, says nothing; a refused check says nothing from a kept answer it no longer refreshes.
  keepLatest(env, { checked: "2026-10-08T00:00:01.000Z", latest: "1.5.2" });
  assert.equal(lines().length, 1);
  keepLatest(env, { checked: "2026-10-08T00:00:01.000Z", latest: "1.6.0" });
  for (const off of [{ COHERENCE_NO_UPDATE_CHECK: "1" }, { CI: "true" }, { DO_NOT_TRACK: "1" }]) {
    assert.equal(versionBlock(project, false, { ...env, ...off }, installed).trimEnd().split("\n").length, 1, JSON.stringify(off));
  }
  assert.equal(isNewer("1.10.0", "1.9.9"), true);
  assert.equal(isNewer("1.6.0", "1.6.0-rc.1"), true);
  assert.equal(isNewer("1.6.0-rc.1", "1.6.0"), false);
});

test("the check of the newest version starts detached at a session start at most once a day, and never under COHERENCE_NO_UPDATE_CHECK, CI or DO_NOT_TRACK", () => {
  const root = temp("coherence-check-");
  const env = userEnv();
  const { spawner, spawned } = spawnRecorder();
  const at = new Date("2026-10-08T12:00:00.000Z");
  for (const event of ["SubagentStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop", "SubagentStop"]) assert.equal(startUpdateCheck(root, event, env, spawner, () => at), false, event);
  for (const off of [{ COHERENCE_NO_UPDATE_CHECK: "1" }, { CI: "true" }, { DO_NOT_TRACK: "1" }]) assert.equal(startUpdateCheck(root, "SessionStart", { ...env, ...off }, spawner, () => at), false, JSON.stringify(off));
  assert.equal(spawned.length, 0);

  assert.equal(startUpdateCheck(root, "SessionStart", env, spawner, () => at), true);
  assert.equal(spawned.length, 1);
  assert.deepEqual(spawned[0]!.args.slice(-2), ["version", "--refresh"]);
  assert.deepEqual(spawned[0]!.options, { cwd: root, detached: true, stdio: "ignore" }, "detached, its output ignored");
  assert.equal(spawned[0]!.unref, true, "the hook never holds the child");
  assert.equal(readLatest(env).attempted, at.toISOString(), "the attempt is kept before the child runs, so a second session does not ask again");

  assert.equal(startUpdateCheck(root, "SessionStart", env, spawner, () => new Date(at.getTime() + CHECK_INTERVAL_MS - 1)), false, "within the day: no second check");
  assert.equal(startUpdateCheck(root, "SessionStart", env, spawner, () => new Date(at.getTime() + CHECK_INTERVAL_MS)), true, "a day later: the next");
  assert.equal(spawned.length, 2);
});

test("a failed fetch keeps the last answer, and version says when the registry last answered and when a check got none", async () => {
  const project = temp("coherence-refresh-");
  const installed = coherenceAt(join(project, "node_modules", PACKAGE_NAME), "1.5.2", join("dist", "cli.js"));
  const env = userEnv();
  assert.match(versionText(project, false, env, installed), /^coherence 1\.5\.2: the installed package \(node_modules\/@posthog\/coherence\)\.\nlatest published: never read yet\nupdate check: on, /);

  const asked: string[] = [];
  const first = await refreshLatest(env, async (url) => (asked.push(url), "1.6.0"), () => new Date("2026-10-07T00:00:00.000Z"));
  assert.deepEqual(asked, [REGISTRY_LATEST]);
  assert.deepEqual(first, { attempted: "2026-10-07T00:00:00.000Z", checked: "2026-10-07T00:00:00.000Z", latest: "1.6.0" });
  const failed = await refreshLatest(env, async () => undefined, () => new Date("2026-10-08T00:00:00.000Z"));
  assert.deepEqual(failed, { attempted: "2026-10-08T00:00:00.000Z", checked: "2026-10-07T00:00:00.000Z", latest: "1.6.0" }, "the failure is dropped; only its time is kept");

  const text = versionText(project, false, env, installed);
  assert.match(text, /\nlatest published: 1\.6\.0, as the registry said 2026-10-07T00:00:00\.000Z; update: npm install -D @posthog\/coherence@\^1\.6\.0; /);
  assert.match(text, /\nlast check: 2026-10-08T00:00:00\.000Z, which got no answer from the registry\n/);
  assert.match(versionText(project, false, { ...env, CI: "1" }, installed), /\nupdate check: off, CI is set\n$/);
});

test("--version, -v, version, --help, -h and help answer at the top level", () => {
  const env = { ...process.env, ...userEnv({ COHERENCE_NO_UPDATE_CHECK: "1" }) };
  for (const flag of ["--version", "-v", "version"]) {
    const run = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", CLI, flag], { cwd: CHECKOUT, env, encoding: "utf8" });
    assert.equal(run.status, 0, `${flag}: ${run.stderr}`);
    assert.match(run.stdout, new RegExp(`^coherence ${escaped(VERSION)}: this repository's own source\\.\\n`), flag);
  }
  for (const flag of ["--help", "-h", "help"]) {
    const run = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", CLI, flag], { cwd: CHECKOUT, env, encoding: "utf8" });
    assert.equal(run.status, 0, `${flag}: ${run.stderr}`);
    assert.match(run.stdout, /^usage:\n/, flag);
    assert.match(run.stdout, /coherence version {3}\(or --version, -v\)/, flag);
  }
});

test("the README's setup asks for at least the current major.minor of Coherence, invoked through npx --no --", () => {
  const readme = readFileSync(join(CHECKOUT, "README.md"), "utf8");
  const [major, minor] = VERSION.split(".");
  const floors = [...readme.matchAll(/@posthog\/coherence@\^(\d+\.\d+)\b/g)].map((m) => m[1]);
  assert.ok(floors.length >= 2, "the quick and the full setup each carry a floor");
  assert.deepEqual([...new Set(floors)], [`${major}.${minor}`], "every floor is package.json's major.minor");
  assert.doesNotMatch(readme, /npx --no coherence/, "npx eats a flag such as --version unless -- ends its own");
  assert.match(readme, /npx --no -- coherence/);
  assert.match(readme, /minimumReleaseAgeExclude/);
});
