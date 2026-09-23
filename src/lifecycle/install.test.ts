import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { HOOK_EVENTS } from "./hook.ts";
import { driftOf, formatCheck, formatStatus, install, mergeHooks, status, stripHooks, uninstall } from "./install.ts";

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
  if (root !== undefined) await rm(root, { recursive: true, force: true });
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
    assert.ok(written.hooks["Stop"]![0]!.hooks[0]!.command.endsWith('/node_modules/.bin/coherence" hook Stop'));
    assert.ok(written.hooks["Stop"]![0]!.hooks[0]!.command.includes('while [ "$dir"'));

    const shown = spawnSync("node", ["--disable-warning=ExperimentalWarning", CLI, "hooks", "status"], { cwd: dir, encoding: "utf8" });
    assert.equal(shown.status, 0, shown.stderr);
    assert.match(shown.stdout, /claude: .*\n  SessionStart: .*\/node_modules\/\.bin\/coherence" hook SessionStart/);
    assert.match(shown.stdout, /codex: .*\(absent\)/);

    const noHost = spawnSync("node", ["--disable-warning=ExperimentalWarning", CLI, "hooks", "install"], { cwd: dir, encoding: "utf8" });
    assert.equal(noHost.status, 64);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the checkout installs start hooks for both hosts", async () => {
  const checkout = resolve(dirname(CLI), "..");
  for (const host of ["claude", "codex"] as const) {
    const found = await status(checkout, host);
    assert.equal(found.present, true, `${host}: the checkout must carry its hooks`);
    assert.deepEqual(found.missing, [], `${host}: all lifecycle events must be wired`);
    const settings = JSON.parse(await readFile(found.path, "utf8")) as {
      hooks: Record<string, { hooks: { command: string; additionalContextLimit?: number }[] }[]>;
    };
    for (const event of ["SessionStart", "SubagentStart"]) {
      const command = found.installed.find((entry) => entry.event === event)?.command;
      assert.ok(command, `${host}: ${event} must be installed`);
      if (host === "codex") {
        const handler = settings.hooks[event]!.flatMap((entry) => entry.hooks).find((hook) => hook.command === command)!;
        assert.equal(handler.additionalContextLimit, 4000);
      }
    }
  }
});

/** An adopter's settings: other settings, other tools' hooks (one with a matcher), an empty event list, and a layout of its own. */
const ADOPTER = {
  permissions: { allow: ["Bash(npm test)"] },
  env: { A: "1" },
  hooks: {
    Stop: [{ hooks: [{ type: "command", command: "./other-tool stop" }] }],
    PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "./lint", timeout: 5 }] }],
    Notification: [],
  },
  model: "x",
};

test("uninstall removes only Coherence's commands and returns the settings to what they were before install", async () => {
  const dir = await mkdtemp(join(tmpdir(), "coherence-uninstall-"));
  try {
    // Every host, and every layout: two spaces with a final newline, a tab without one, and settings with no hooks at all.
    const layouts: [string, string][] = [
      ["two spaces", JSON.stringify(ADOPTER, null, 2) + "\n"],
      ["tab, no final newline", JSON.stringify(ADOPTER, null, "\t")],
      ["no hooks object", JSON.stringify({ permissions: ADOPTER.permissions }, null, 4) + "\n"],
    ];
    for (const host of ["claude", "codex"] as const) {
      for (const [layout, original] of layouts) {
        const path = join(dir, host === "claude" ? ".claude/settings.json" : ".codex/hooks.json");
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, original);
        await install({ root: dir, host, command: "npx coherence" });
        assert.notEqual(await readFile(path, "utf8"), original, `${host}/${layout}: install wrote`);
        const first = await uninstall(dir, host);
        assert.equal(first.removed.length, HOOK_EVENTS.length, `${host}/${layout}: one command per event removed`);
        assert.equal(await readFile(path, "utf8"), original, `${host}/${layout}: the round trip gives back the file byte for byte`);
        const second = await uninstall(dir, host);
        assert.deepEqual([second.removed, second.changed], [[], false], `${host}/${layout}: a second uninstall changes nothing`);
        assert.equal(await readFile(path, "utf8"), original);
      }
    }
    assert.deepEqual(
      await uninstall(join(dir, "nowhere"), "claude"),
      { path: join(dir, "nowhere", ".claude", "settings.json"), removed: [], changed: false },
      "no settings file: nothing to do, nothing created",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  // Pure: a foreign hook sharing an entry with ours stays in that entry with its matcher; an event list that held only ours goes;
  // a list another tool left empty stays; commands that merely look like ours are never touched.
  const foreign = ["node tools/other-project/cli.ts hook Stop", "npx incoherence hook Stop", "my-coherence-wrapper hook Stop"];
  const { settings, removed } = stripHooks({
    hooks: {
      Stop: [
        { matcher: "x", hooks: [{ type: "command", command: "./theirs" }, { type: "command", command: "npx coherence hook Stop" }] },
        ...foreign.map((command) => ({ hooks: [{ type: "command", command }] })),
      ],
      SessionStart: [{ hooks: [{ type: "command", command: 'node "${CLAUDE_PROJECT_DIR:-.}/src/cli.ts" hook SessionStart' }] }],
      Notification: [],
    },
  });
  assert.deepEqual(settings, {
    hooks: {
      Stop: [{ matcher: "x", hooks: [{ type: "command", command: "./theirs" }] }, ...foreign.map((command) => ({ hooks: [{ type: "command", command }] }))],
      Notification: [],
    },
  });
  assert.deepEqual(removed.map((r) => r.event), ["Stop", "SessionStart"]);
  assert.deepEqual(
    stripHooks({ hooks: { Stop: [{ hooks: [{ type: "command", command: "coherence hook Stop" }] }] }, other: 1 }).settings,
    { other: 1 },
    "an emptied hooks object goes",
  );
});

type Hooks = Record<string, { matcher?: string; hooks: Record<string, unknown>[] }[]>;

test("the check names every drift from what install would write: missing, stale, and extra", () => {
  const options = { command: "npx coherence", host: "codex" } as const;
  const clean = mergeHooks(structuredClone(ADOPTER), options);
  assert.deepEqual(driftOf(clean, options), [], "what install writes has no drift, beside other tools' hooks");
  assert.deepEqual(driftOf(ADOPTER, options).map((d) => [d.event, d.kind]), HOOK_EVENTS.map((e) => [e, "missing"]), "nothing installed: every event missing");

  const edit = (change: (hooks: Hooks) => void) => {
    const copy = structuredClone(clean);
    change(copy["hooks"] as Hooks);
    return driftOf(copy, options);
  };
  const ours = (hooks: Hooks, event: string) => hooks[event]!.find((e) => e.hooks.some((h) => String(h["command"]).includes("coherence hook")))!;

  // Missing: one event's entry gone.
  assert.deepEqual(edit((h) => { h["UserPromptSubmit"] = []; }), [{ event: "UserPromptSubmit", kind: "missing", expected: "npx coherence hook UserPromptSubmit" }]);
  // Stale command: another prefix, and the wrong event named.
  const stale = edit((h) => {
    ours(h, "Stop").hooks[0]!["command"] = "node src/cli.ts hook Stop";
    ours(h, "PostToolUse").hooks[0]!["command"] = "npx coherence hook Stop";
  });
  assert.deepEqual(stale.map((d) => [d.event, d.kind]), [["PostToolUse", "stale"], ["Stop", "stale"]]);
  assert.deepEqual(stale[1]!.kind === "stale" ? stale[1]!.differences : [], ['command: installed "node src/cli.ts hook Stop"; install would write "npx coherence hook Stop"']);
  // Stale fields: a timeout changed, a Codex start limit dropped, an entry shared with another tool's hook, a matcher added.
  const fields = edit((h) => {
    ours(h, "Stop").hooks[0]!["timeout"] = 5;
    delete ours(h, "SessionStart").hooks[0]!["additionalContextLimit"];
    ours(h, "SubagentStop").hooks.unshift({ type: "command", command: "./theirs" });
    ours(h, "SubagentStart").matcher = "*";
  });
  const byEvent = Object.fromEntries(fields.map((d) => [d.event, d.kind === "stale" ? d.differences : [d.kind]]));
  assert.deepEqual(Object.keys(byEvent).sort(), ["SessionStart", "Stop", "SubagentStart", "SubagentStop"]);
  assert.deepEqual(byEvent["Stop"], ["timeout: installed 5; install would write 60"]);
  assert.deepEqual(byEvent["SessionStart"], ["additionalContextLimit: installed absent; install would write 4000"]);
  assert.match(byEvent["SubagentStop"]!.join("\n"), /shared with 1 other hook/);
  assert.match(byEvent["SubagentStart"]!.join("\n"), /entry field matcher: installed "\*"/);
  // Extra: a duplicate entry of ours, and ours under an event install never wires.
  const extra = edit((h) => {
    h["Stop"]!.push({ hooks: [{ type: "command", command: "npx coherence hook Stop", timeout: 60 }] });
    h["PreToolUse"]!.push({ hooks: [{ type: "command", command: "coherence hook Stop" }] });
  });
  assert.deepEqual(extra, [
    { event: "Stop", kind: "extra", found: "npx coherence hook Stop", reason: "a second entry of ours for this event" },
    { event: "PreToolUse", kind: "extra", found: "coherence hook Stop", reason: "install wires no hook for this event" },
  ]);
  // Another tool's hook changing is not drift of ours.
  assert.deepEqual(edit((h) => { h["Stop"]![0]!.hooks[0]!["command"] = "./other-tool v2"; }), []);

  const text = formatCheck({ host: "codex", path: "/p/.codex/hooks.json", present: true, drift: [...stale, ...extra] });
  assert.match(text, /^codex: \/p\/\.codex\/hooks\.json: 3 events drifted from what install would write\n  PostToolUse: stale\n    command: /);
  assert.match(text, /\n  Stop: extra Coherence entry \(a second entry of ours for this event\): npx coherence hook Stop\n/);
  assert.match(formatCheck({ host: "claude", path: "/p", present: true, drift: [] }), /all 6 events match what install would write/);
});

test("the CLI checks, uninstalls, and exits by what it found", async () => {
  const dir = await mkdtemp(join(tmpdir(), "coherence-cli-check-"));
  const cli = (...args: string[]) => spawnSync("node", ["--disable-warning=ExperimentalWarning", CLI, "hooks", ...args], { cwd: dir, encoding: "utf8" });
  try {
    const path = join(dir, ".claude", "settings.json");
    await mkdir(dirname(path), { recursive: true });
    const original = JSON.stringify(ADOPTER, null, 2) + "\n";
    await writeFile(path, original);

    const absent = cli("--check", "--host", "claude");
    assert.equal(absent.status, 1, absent.stderr);
    assert.match(absent.stdout, /6 events drifted/);

    assert.equal(cli("install", "--host", "claude").status, 0);
    const clean = cli("--check", "--host", "claude");
    assert.equal(clean.status, 0, clean.stdout);
    assert.match(clean.stdout, /all 6 events match/);
    assert.match(cli("install", "--host", "claude").stdout, /^unchanged /, "a second install writes nothing");

    const other = cli("--check", "--host", "claude", "--command", "npx coherence");
    assert.equal(other.status, 1);
    assert.match(other.stdout, /SessionStart: stale\n    command: installed ".*node_modules\/\.bin\/coherence\\" hook SessionStart"; install would write "npx coherence hook SessionStart"/);

    const gone = cli("uninstall", "--host", "claude");
    assert.equal(gone.status, 0, gone.stderr);
    assert.match(gone.stdout, /^claude: removed 6 Coherence hooks from /);
    assert.equal(await readFile(path, "utf8"), original);
    assert.match(cli("uninstall", "--host", "claude").stdout, /no Coherence hook installed; nothing changed/);

    await writeFile(path, "{ not json");
    const broken = cli("--check", "--host", "claude");
    assert.equal(broken.status, 2, "a settings file the check cannot read is neither clean nor drift");
    assert.match(broken.stderr, /^hooks --check: /);

    assert.equal(cli("--check").status, 64, "the check names its agent host");
    assert.equal(cli("uninstall").status, 64);
    assert.equal(cli("uninstall", "--host", "claude", "--command", "x").status, 64, "uninstall takes no prefix: ownership is by the command");
    assert.equal(cli("status", "--bogus").status, 64);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
