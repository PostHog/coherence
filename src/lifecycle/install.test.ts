import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { cliName, HOOK_EVENTS, REFUSE_EXIT } from "./hook.ts";
import { PACKAGE_NAME } from "./project.ts";
import { driftOf, formatCheck, formatStatus, formatUninstall, IGNORE_TEXT, install, LOCATED_PREFIX, locate, MISSING_CONTEXT, mergeHooks, NO_NODE, NOT_INSTALLED, status, stripHooks, uninstall } from "./install.ts";

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
    'exec node "$incoherence" hook Stop',
  ];
  const crowded = mergeHooks({ hooks: { Stop: foreign.map((command) => ({ hooks: [{ type: "command", command }] })) } }, { command: "npx coherence", host: "claude" });
  const stop = (crowded["hooks"] as Record<string, { hooks: { command: string }[] }[]>)["Stop"]!;
  assert.deepEqual(stop.map((e) => e.hooks[0]!.command), [...foreign, "npx coherence hook Stop"], "no foreign hook is deleted");
  for (const command of ["npx coherence hook Stop", '"${CLAUDE_PROJECT_DIR:-.}/node_modules/.bin/coherence" hook Stop', "node src/cli.ts hook Stop", 'node "${CLAUDE_PROJECT_DIR:-.}/src/cli.ts" hook Stop', "coherence hook Stop", `${LOCATED_PREFIX} hook Stop`]) {
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
  assert.deepEqual(written.hooks["PreToolUse"], [
    { matcher: "Bash", hooks: [{ type: "command", command: "./lint" }] },
    { matcher: "Bash|Edit|Write|MultiEdit|NotebookEdit", hooks: [{ type: "command", command: "npx coherence hook PreToolUse", timeout: 60 }] },
  ], "another tool's PreToolUse stays, with Coherence's practice delivery beside it, matched to the tools that can fire a practice");
  assert.deepEqual(written.hooks["Stop"]!.map((e) => e.hooks[0]!.command), ["./other-tool stop", "npx coherence hook Stop"]);
  assert.equal(written.hooks["SubagentStop"]![0]!.hooks[0]!.timeout, 60);
  assert.equal("additionalContextLimit" in written.hooks["SessionStart"]![0]!.hooks[0]!, false, "Claude Code has no such field");
  assert.equal(Object.keys(written.hooks).length, HOOK_EVENTS.length);

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
    assert.equal(written.hooks["Stop"]![0]!.hooks[0]!.command, `${LOCATED_PREFIX} hook Stop`, "an adopter's hook locates Coherence outside the project");
    assert.ok(!written.hooks["Stop"]![0]!.hooks[0]!.command.includes(dir), "the committed command names no path on this machine");
    assert.match(run.stdout, /note: the hooks cannot find Coherence from here/, "install says the hooks will find nothing, and how to fix it");

    const shown = spawnSync("node", ["--disable-warning=ExperimentalWarning", CLI, "hooks", "status"], { cwd: dir, encoding: "utf8" });
    assert.equal(shown.status, 0, shown.stderr);
    assert.match(shown.stdout, /claude: .*\n  SessionStart: .*exec node "\$coherence" "\$@"; }; coherence hook SessionStart/);
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
      { path: join(dir, "nowhere", ".claude", "settings.json"), removed: [], changed: false, removedIgnore: false },
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

/** Every folder Coherence writes under .coherence, durable or regenerated. */
const STATE_FOLDERS = ["journal", "runs", "work", "hooks", "feed", "lexicon", "models", "observations", "practices", "run", "structure", "traces"];
const DURABLE = new Set(["journal", "runs", "work", "hooks"]);

function gitStatus(dir: string): string[] {
  const run = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: dir, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout.split("\n").filter(Boolean).map((line) => line.slice(3)).sort();
}

test("install keeps Coherence's regenerated state out of the project's git, and uninstall removes only the ignore file it wrote", async () => {
  const dir = await mkdtemp(join(tmpdir(), "coherence-ignore-"));
  try {
    assert.equal(spawnSync("git", ["init", "-q"], { cwd: dir }).status, 0);
    await writeFile(join(dir, ".gitignore"), "node_modules/\n");
    const before = await readFile(join(dir, ".gitignore"), "utf8");
    const first = await install({ root: dir, host: "claude", command: "npx coherence" });
    assert.deepEqual(first.ignore, { path: join(dir, ".coherence", ".gitignore"), action: "wrote" });
    for (const folder of STATE_FOLDERS) {
      await mkdir(join(dir, ".coherence", folder), { recursive: true });
      await writeFile(join(dir, ".coherence", folder, "state.jsonl"), "{}\n");
    }
    assert.deepEqual(
      gitStatus(dir),
      [".claude/settings.json", ".coherence/.gitignore", ...[...DURABLE].map((f) => `.coherence/${f}/state.jsonl`), ".gitignore"].sort(),
      "git sees the settings, the ignore file and the durable folders, and none of the regenerated state",
    );
    assert.equal(await readFile(join(dir, ".gitignore"), "utf8"), before, "the adopter's own .gitignore is never edited");
    assert.equal((await install({ root: dir, host: "claude", command: "npx coherence" })).ignore.action, "unchanged", "a second install writes nothing");

    // A second host shares the file; uninstall leaves it while any host keeps a hook of ours.
    await install({ root: dir, host: "codex", command: "npx coherence" });
    const claude = await uninstall(dir, "claude");
    assert.equal(claude.removedIgnore, false, "codex still holds our hooks");
    assert.equal(await readFile(join(dir, ".coherence", ".gitignore"), "utf8"), IGNORE_TEXT);
    const codex = await uninstall(dir, "codex");
    assert.equal(codex.removedIgnore, true, "the last host's uninstall removes the file install wrote");
    assert.match(formatUninstall("codex", codex), /removed \.coherence\/\.gitignore/);
    assert.equal(existsSync(join(dir, ".coherence", ".gitignore")), false);
    assert.equal(existsSync(join(dir, ".coherence", "journal", "state.jsonl")), true, "the records stay");
    assert.equal((await uninstall(dir, "codex")).removedIgnore, false, "a second uninstall changes nothing");

    // A fresh tree: install then uninstall leaves no .coherence folder behind.
    const fresh = join(dir, "fresh");
    await mkdir(fresh);
    await install({ root: fresh, host: "claude", command: "npx coherence" });
    await uninstall(fresh, "claude");
    assert.equal(existsSync(join(fresh, ".coherence")), false, "the folder install made is gone when it held only the ignore file");

    // A .coherence/.gitignore with any other text is the adopter's: install keeps it and uninstall never removes it.
    const theirs = "# ours\n*.log\n";
    await mkdir(join(dir, ".coherence"), { recursive: true });
    await writeFile(join(dir, ".coherence", ".gitignore"), theirs);
    assert.equal((await install({ root: dir, host: "claude", command: "npx coherence" })).ignore.action, "kept");
    assert.equal((await uninstall(dir, "claude")).removedIgnore, false);
    assert.equal(await readFile(join(dir, ".coherence", ".gitignore"), "utf8"), theirs);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
    h["Notification"] = [{ hooks: [{ type: "command", command: "coherence hook Stop" }] }];
  });
  assert.deepEqual(extra, [
    { event: "Stop", kind: "extra", found: "npx coherence hook Stop", reason: "a second entry of ours for this event" },
    { event: "Notification", kind: "extra", found: "coherence hook Stop", reason: "install wires no hook for this event" },
  ]);
  // Another tool's hook changing is not drift of ours.
  assert.deepEqual(edit((h) => { h["Stop"]![0]!.hooks[0]!["command"] = "./other-tool v2"; }), []);

  const text = formatCheck({ host: "codex", path: "/p/.codex/hooks.json", present: true, drift: [...stale, ...extra] });
  assert.match(text, /^codex: \/p\/\.codex\/hooks\.json: 3 events drifted from what install would write\n  PostToolUse: stale\n    command: /);
  assert.match(text, /\n  Stop: extra Coherence entry \(a second entry of ours for this event\): npx coherence hook Stop\n/);
  assert.match(formatCheck({ host: "claude", path: "/p", present: true, drift: [] }), /all 7 events match what install would write/);
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
    assert.match(absent.stdout, /7 events drifted/);

    assert.equal(cli("install", "--host", "claude").status, 0);
    const clean = cli("--check", "--host", "claude");
    assert.equal(clean.status, 0, clean.stdout);
    assert.match(clean.stdout, /all 7 events match/);
    assert.match(cli("install", "--host", "claude").stdout, /^unchanged /, "a second install writes nothing");

    const other = cli("--check", "--host", "claude", "--command", "npx coherence");
    assert.equal(other.status, 1);
    assert.match(other.stdout, /SessionStart: stale\n    command: installed ".*exec node \\"\$coherence\\" \\"\$@\\"; }; coherence hook SessionStart"; install would write "npx coherence hook SessionStart"/);

    const gone = cli("uninstall", "--host", "claude");
    assert.equal(gone.status, 0, gone.stderr);
    assert.match(gone.stdout, /^claude: removed 7 Coherence hooks from /);
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

/** This checkout, as an adopter keeps it outside the project. */
const CHECKOUT = resolve(dirname(CLI), "..");

/** The environment a host starts a hook with: nothing of Coherence's, and Claude Code's project dir only for Claude Code. */
function hostEnv(host: "claude" | "codex", project: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  if (extra["COHERENCE_HOME"] === undefined) delete env["COHERENCE_HOME"];
  if (host === "claude") env["CLAUDE_PROJECT_DIR"] = project;
  else delete env["CLAUDE_PROJECT_DIR"];
  return env;
}

/** Run one installed command as the host does: through a shell, in the project, with the event on stdin. */
function runInstalled(project: string, host: "claude" | "codex", event: string, input: Record<string, unknown>, extra: NodeJS.ProcessEnv = {}) {
  const file = host === "claude" ? ".claude/settings.json" : ".codex/hooks.json";
  return (async () => {
    const settings = JSON.parse(await readFile(join(project, file), "utf8")) as { hooks: Record<string, { hooks: { command: string }[] }[]> };
    const command = settings.hooks[event]!.at(-1)!.hooks[0]!.command;
    return spawnSync("bash", ["-c", command], { cwd: project, env: hostEnv(host, project, extra), input: JSON.stringify({ cwd: project, hook_event_name: event, ...input }), encoding: "utf8" });
  })();
}

function git(cwd: string, ...args: string[]): void {
  const run = spawnSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { cwd, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
}

test("a hook without Coherence installed tells the user once and the agent how to supply it, and is otherwise silent", async () => {
  const parent = await mkdtemp(join(tmpdir(), "coherence-absent-"));
  const project = join(parent, "project");
  try {
    await mkdir(project);
    for (const host of ["claude", "codex"] as const) {
      await install({ root: project, host, command: LOCATED_PREFIX });
      assert.deepEqual((await status(project, host)).missing, [], `${host}: every event is wired and recognised as ours`);
      assert.deepEqual(driftOf(JSON.parse(await readFile(join(project, host === "claude" ? ".claude/settings.json" : ".codex/hooks.json"), "utf8")), { command: LOCATED_PREFIX, host }), [], `${host}: the check accepts the located command`);
    }
    assert.equal(locate(project, hostEnv("codex", project)), undefined);
    for (const host of ["claude", "codex"] as const) {
      for (const event of HOOK_EVENTS) {
        const run = await runInstalled(project, host, event, { session_id: "s1", stop_hook_active: false });
        assert.equal(run.status, 0, `${host} ${event}: never blocks the session`);
        assert.equal(run.stderr, "", `${host} ${event}: no shell errors`);
        if (event === "SessionStart") {
          const out = JSON.parse(run.stdout) as { systemMessage: string; hookSpecificOutput: { hookEventName: string; additionalContext: string } };
          assert.equal(out.systemMessage, NOT_INSTALLED, `${host}: one line the user is shown`);
          assert.deepEqual(out.hookSpecificOutput, { hookEventName: "SessionStart", additionalContext: MISSING_CONTEXT }, `${host}: the agent is told how to supply Coherence`);
          assert.match(MISSING_CONTEXT, /npm install -D @posthog\/coherence/, "the agent is given the install command");
          assert.match(MISSING_CONTEXT, /ask before installing/, "and told the dependency change is the user's call");
        } else assert.equal(run.stdout, "", `${host} ${event}: nothing after the session start`);
      }
    }

    // Found, but node is not on the PATH the hook runs with: the same one line, naming node.
    await symlink(CHECKOUT, join(parent, "coherence"));
    const noNode = (process.env["PATH"] ?? "").split(":").filter((dir) => dir !== "" && !existsSync(join(dir, "node"))).join(":");
    const bare = await runInstalled(project, "claude", "SessionStart", {}, { PATH: noNode });
    assert.deepEqual([bare.status, bare.stderr, bare.stdout], [0, "", JSON.stringify({ systemMessage: NO_NODE }) + "\n"]);
    const quiet = await runInstalled(project, "claude", "Stop", { stop_hook_active: false }, { PATH: noNode });
    assert.deepEqual([quiet.status, quiet.stderr, quiet.stdout], [0, "", ""], "without node, only the session start speaks");

    // Uninstall still knows the located command as ours and removes all of it.
    for (const host of ["claude", "codex"] as const) assert.equal((await uninstall(project, host)).removed.length, HOOK_EVENTS.length);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("an installed package is located by its own cli before the project's bin, which a package manager may write as a shim node cannot run", async () => {
  const project = await mkdtemp(join(tmpdir(), "coherence-package-"));
  try {
    await install({ root: project, host: "codex", command: LOCATED_PREFIX });
    const cli = join(project, "node_modules", PACKAGE_NAME, "dist", "cli.js");
    const bin = join(project, "node_modules", ".bin", "coherence");
    await mkdir(dirname(cli), { recursive: true });
    await mkdir(dirname(bin), { recursive: true });
    await writeFile(bin, "#!/bin/sh\nexec node \"$(dirname \"$0\")/../@posthog/coherence/dist/cli.js\" \"$@\"\n");
    assert.equal(locate(project, hostEnv("codex", project)), bin, "with only the bin, the bin is found");
    await writeFile(cli, "");
    assert.equal(locate(project, hostEnv("codex", project)), cli, "the package's own cli comes first");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("a located Coherence answers, and refuses, as a direct command does", async () => {
  const parent = await mkdtemp(join(tmpdir(), "coherence-located-"));
  const project = join(parent, "project");
  try {
    await mkdir(project);
    await writeFile(join(project, "clean.md"), "Nothing to see.\n");
    await writeFile(join(project, "lexicon.json"), JSON.stringify({ project: "widgetry", version: 0, concepts: [{ name: "widget", definition: "A thing with a knob." }], rejected: [{ concept: "doohickey", because: "retired surface" }] }));
    git(project, "init", "-q");
    git(project, "add", ".");
    git(project, "commit", "-q", "-m", "seed");
    for (const host of ["claude", "codex"] as const) await install({ root: project, host, command: LOCATED_PREFIX });
    await symlink(CHECKOUT, join(parent, "coherence"));
    assert.equal(realpathSync(locate(project, hostEnv("codex", project))!), realpathSync(CLI), "the sibling is found");

    for (const host of ["claude", "codex"] as const) {
      const start = await runInstalled(project, host, "SessionStart", { session_id: `s-${host}` });
      assert.equal(start.status, 0, start.stderr);
      const context = (JSON.parse(start.stdout) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext;
      assert.match(context, /Coherence vocabulary/, `${host}: the start injection arrives through the located command`);
      assert.match(context, /\n  node \.\.\/coherence\/src\/cli\.ts journal\n/, `${host}: the session is told the checkout beside it, not a node_modules path`);
    }

    // A rejected name in a changed file: the subagent stop is refused exactly as a direct command refuses it.
    await writeFile(join(project, "notes.md"), "The doohickey turns.\n");
    const direct = spawnSync("node", ["--disable-warning=ExperimentalWarning", CLI, "hook", "SubagentStop"], { cwd: project, env: hostEnv("codex", project), input: JSON.stringify({ cwd: project, stop_hook_active: false }), encoding: "utf8" });
    assert.equal(direct.status, REFUSE_EXIT, direct.stderr);
    for (const host of ["claude", "codex"] as const) {
      const refused = await runInstalled(project, host, "SubagentStop", { stop_hook_active: false });
      assert.deepEqual([refused.status, refused.stdout, refused.stderr], [direct.status, direct.stdout, direct.stderr], `${host}: the located command refuses as the direct one does`);
    }

    // COHERENCE_HOME finds a checkout kept anywhere; it is read before the sibling.
    await rm(join(parent, "coherence"));
    assert.equal(locate(project, hostEnv("codex", project)), undefined);
    const home = await runInstalled(project, "codex", "SessionStart", {}, { COHERENCE_HOME: CHECKOUT });
    assert.equal(home.status, 0, home.stderr);
    assert.match(home.stdout, /"hookSpecificOutput"/);

    // A git worktree of the project finds the Coherence beside its main checkout.
    await symlink(CHECKOUT, join(parent, "coherence"));
    git(project, "add", ".");
    git(project, "commit", "-q", "-m", "hooks");
    const worktree = join(project, ".claude", "worktrees", "w");
    git(project, "worktree", "add", "-q", worktree);
    assert.equal(realpathSync(locate(worktree, hostEnv("codex", worktree))!), realpathSync(CLI), "the main checkout's sibling is found from a worktree");
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("a session is told the checkout it ran from: beside it by a relative path, far away by an absolute one, quoted when it must be", async () => {
  assert.equal(await cliName("/work/project", "/work/coherence/src/cli.ts"), "node ../coherence/src/cli.ts");
  assert.equal(await cliName("/a/b/c/d/e/project", "/opt/tools/coherence/src/cli.ts"), "node /opt/tools/coherence/src/cli.ts");
  assert.equal(await cliName("/work/project", "/work/my tools/coherence/src/cli.ts"), 'node "../my tools/coherence/src/cli.ts"');
});
