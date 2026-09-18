import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { HOOK_EVENTS } from "./hook.ts";
import { formatStatus, install, mergeHooks, status } from "./install.ts";

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), "..", "cli.ts");

let root: string;

before(async () => {
  root = await mkdtemp(join(tmpdir(), "coherence-install-"));
  await mkdir(join(root, ".claude"));
  await writeFile(
    join(root, ".claude", "settings.json"),
    JSON.stringify(
      {
        permissions: { allow: ["Bash(npm test)"] },
        hooks: {
          Stop: [{ hooks: [{ type: "command", command: "./other-tool stop" }] }],
          PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "./lint" }] }],
        },
      },
      null,
      2,
    ),
  );
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

test("mergeHooks adds one Coherence entry per event, keeps everything else, and replaces its own entry on a second pass", () => {
  const first = mergeHooks({ hooks: { Stop: [{ hooks: [{ type: "command", command: "./other" }] }] }, other: 1 }, { command: "npx coherence", host: "claude" });
  const hooks = first["hooks"] as Record<string, { hooks: { command: string }[] }[]>;
  assert.equal(first["other"], 1);
  assert.deepEqual(hooks["Stop"]!.map((e) => e.hooks[0]!.command), ["./other", "npx coherence hook Stop"]);
  assert.deepEqual(hooks["SessionStart"]!.map((e) => e.hooks[0]!.command), ["npx coherence hook SessionStart"]);
  for (const event of HOOK_EVENTS) assert.ok(hooks[event]!.some((e) => e.hooks[0]!.command === `npx coherence hook ${event}`));

  const second = mergeHooks(first, { command: "node src/cli.ts", host: "claude" });
  const again = second["hooks"] as Record<string, { hooks: { command: string }[] }[]>;
  assert.deepEqual(again["Stop"]!.map((e) => e.hooks[0]!.command), ["./other", "node src/cli.ts hook Stop"]);
  assert.equal(again["SessionStart"]!.length, 1);

  // Only a command that names this tool's binary or its own cli path is Coherence's; a stranger's cli.ts that also takes "hook Stop" is kept.
  const foreign = [
    "node tools/other-project/cli.ts hook Stop",
    "./scripts/cli.ts hook Stop",
    "npx incoherence hook Stop",
    "my-coherence-wrapper hook Stop",
  ];
  const crowded = mergeHooks({ hooks: { Stop: foreign.map((command) => ({ hooks: [{ type: "command", command }] })) } }, { command: "npx coherence", host: "claude" });
  const stop = (crowded["hooks"] as Record<string, { hooks: { command: string }[] }[]>)["Stop"]!;
  assert.deepEqual(stop.map((e) => e.hooks[0]!.command), [...foreign, "npx coherence hook Stop"], "no foreign hook is deleted");
  for (const command of ["npx coherence hook Stop", '"${CLAUDE_PROJECT_DIR:-.}/node_modules/.bin/coherence" hook Stop', "node src/cli.ts hook Stop", 'node "${CLAUDE_PROJECT_DIR:-.}/src/cli.ts" hook Stop', "coherence hook Stop"]) {
    const merged = mergeHooks({ hooks: { Stop: [{ hooks: [{ type: "command", command }] }] } }, { command: "npx coherence", host: "claude" });
    assert.deepEqual((merged["hooks"] as Record<string, { hooks: { command: string }[] }[]>)["Stop"]!.map((e) => e.hooks[0]!.command), ["npx coherence hook Stop"], `${command} is ours and is replaced`);
  }

  // An entry that carries a foreign hook beside ours keeps the foreign hook; only our command leaves it.
  const mixed = mergeHooks({ hooks: { Stop: [{ matcher: "x", hooks: [{ type: "command", command: "./theirs" }, { type: "command", command: "npx coherence hook Stop" }] }] } }, { command: "npx coherence", host: "claude" });
  const mixedStop = (mixed["hooks"] as Record<string, { matcher?: string; hooks: { command: string }[] }[]>)["Stop"]!;
  assert.deepEqual(mixedStop.map((e) => e.hooks.map((h) => h.command)), [["./theirs"], ["npx coherence hook Stop"]], "the foreign hook survives in its own entry, with its matcher");
  assert.equal(mixedStop[0]!.matcher, "x");
});

test("install --host claude merges into .claude/settings.json without clobbering", async () => {
  const result = await install({ root, host: "claude", command: "npx coherence" });
  assert.equal(result.path, join(root, ".claude", "settings.json"));
  const written = JSON.parse(await readFile(result.path, "utf8")) as {
    permissions: unknown;
    hooks: Record<string, { matcher?: string; hooks: { command: string; timeout?: number }[] }[]>;
  };
  assert.deepEqual(written.permissions, { allow: ["Bash(npm test)"] });
  assert.deepEqual(written.hooks["PreToolUse"], [{ matcher: "Bash", hooks: [{ type: "command", command: "./lint" }] }]);
  assert.deepEqual(written.hooks["Stop"]!.map((e) => e.hooks[0]!.command), ["./other-tool stop", "npx coherence hook Stop"]);
  assert.equal(written.hooks["SubagentStop"]![0]!.hooks[0]!.timeout, 60);
  assert.equal("additionalContextLimit" in written.hooks["SessionStart"]![0]!.hooks[0]!, false, "Claude Code has no such field");
  assert.equal(Object.keys(written.hooks).length, HOOK_EVENTS.length + 1);

  await install({ root, host: "claude", command: "npx coherence" });
  const twice = JSON.parse(await readFile(result.path, "utf8")) as { hooks: Record<string, unknown[]> };
  assert.equal(twice.hooks["Stop"]!.length, 2, "a second install does not duplicate");
});

test("install --host codex writes .codex/hooks.json in the same shape", async () => {
  const result = await install({ root, host: "codex", command: "npx coherence" });
  assert.equal(result.path, join(root, ".codex", "hooks.json"));
  const written = JSON.parse(await readFile(result.path, "utf8")) as { hooks: Record<string, { hooks: { type: string; command: string }[] }[]> };
  assert.deepEqual(Object.keys(written.hooks), [...HOOK_EVENTS]);
  assert.deepEqual(written.hooks["SessionStart"]![0]!.hooks[0], {
    type: "command",
    command: "npx coherence hook SessionStart",
    timeout: 60,
    additionalContextLimit: 4000,
  });
  assert.deepEqual(written.hooks["Stop"]![0]!.hooks[0], { type: "command", command: "npx coherence hook Stop", timeout: 60 });
});

test("status reports what is installed per host and what other hooks were kept", async () => {
  const claude = await status(root, "claude");
  assert.equal(claude.present, true);
  assert.deepEqual(claude.missing, []);
  assert.deepEqual(claude.others, { Stop: 1, PreToolUse: 1 });
  assert.equal(claude.installed.length, HOOK_EVENTS.length);

  const text = formatStatus([claude, await status(root, "codex")]);
  assert.match(text, /^claude: .*settings\.json\n/);
  assert.match(text, /\n  SessionStart: npx coherence hook SessionStart\n/);
  assert.match(text, /other hooks kept: Stop \(1\), PreToolUse \(1\)/);
  assert.match(text, /\ncodex: .*hooks\.json\n/);

  const empty = await mkdtemp(join(tmpdir(), "coherence-status-"));
  try {
    const none = await status(empty, "claude");
    assert.equal(none.present, false);
    assert.deepEqual(none.missing, [...HOOK_EVENTS]);
    assert.match(formatStatus([none]), /\(absent\)\n  not installed: SessionStart, /);
  } finally {
    await rm(empty, { recursive: true, force: true });
  }
});

test("the CLI installs into the current directory and reports status", async () => {
  const dir = await mkdtemp(join(tmpdir(), "coherence-cli-install-"));
  try {
    const run = spawnSync("node", ["--disable-warning=ExperimentalWarning", CLI, "hooks", "install", "--host", "claude"], { cwd: dir, encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /^wrote .*\.claude\/settings\.json: SessionStart, /);
    const written = JSON.parse(await readFile(join(dir, ".claude", "settings.json"), "utf8")) as { hooks: Record<string, { hooks: { command: string }[] }[]> };
    assert.equal(written.hooks["Stop"]![0]!.hooks[0]!.command, '"${CLAUDE_PROJECT_DIR:-.}/node_modules/.bin/coherence" hook Stop');

    const shown = spawnSync("node", ["--disable-warning=ExperimentalWarning", CLI, "hooks", "status"], { cwd: dir, encoding: "utf8" });
    assert.equal(shown.status, 0, shown.stderr);
    assert.match(shown.stdout, /claude: .*\n  SessionStart: "\$\{CLAUDE_PROJECT_DIR:-\.\}\/node_modules\/\.bin\/coherence" hook SessionStart/);
    assert.match(shown.stdout, /codex: .*\(absent\)/);

    const noHost = spawnSync("node", ["--disable-warning=ExperimentalWarning", CLI, "hooks", "install"], { cwd: dir, encoding: "utf8" });
    assert.equal(noHost.status, 64);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
