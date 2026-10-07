/**
 * The upgrade test: `npm run test:upgrade`. It installs the previous published
 * release of Coherence into a small adopter project, uses it the way an
 * adopter does (hooks, spec --check, run, refute, enact, decide, every hook
 * event), then upgrades the project to this checkout through `npm pack`, the
 * way the adopter's next `npm install` would, and asserts that nothing the
 * adopter already did is turned against it.
 *
 * It needs the network to fetch the previous release, so it is not part of
 * `npm test`; CI runs it as its own workflow (.github/workflows/upgrade.yml).
 *
 *   COHERENCE_UPGRADE_FROM  the previous release: a published version or a .tgz
 *                           (default: the newest published version not above
 *                           package.json's)
 *   COHERENCE_UPGRADE_TO    the release under test: a checkout to pack, or a .tgz
 *                           (default: this checkout)
 *   COHERENCE_UPGRADE_KEEP  set to keep the fixture folder for inspection
 *
 * The motivating defect: 1.5.0 amended a kernel practice in Coherence's own
 * tree, and every adopter that had enacted the earlier version was refused
 * at enact until it recorded an amend decision for a change it never made
 * (df-36efa8f2).
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const CHECKOUT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PACKAGE = "@posthog/coherence";
const KERNEL_PREFIX = "coherence:";
/** The kernel practice 1.5.0 amended; enacted when the previous release lists it. */
const AMENDED_KERNEL = "coherence:src/enforcement/witness a refutation";
const OWN_PRACTICE = "src/tokens/rotate a token";
const INVARIANT = "sealed display";
const AGENT = "upgrade-test";

interface Ran {
  label: string;
  code: number;
  stdout: string;
  stderr: string;
}

/** Everything the test ran, in order, printed whole when an assertion fails. */
const transcript: Ran[] = [];

function sh(label: string, command: string, args: string[], cwd: string, input?: string, env: NodeJS.ProcessEnv = {}): Ran {
  // NODE_TEST_CONTEXT would make the fixture's own node --test think it runs inside this one, and skip its files.
  const inherited = { ...process.env };
  delete inherited["NODE_TEST_CONTEXT"];
  delete inherited["COHERENCE_HOME"];
  const result = spawnSync(command, args, { cwd, input, encoding: "utf8", env: { ...inherited, ...env, COHERENCE_NO_WARM_UP: "1" }, maxBuffer: 64 * 1024 * 1024, timeout: 600_000 });
  const ran: Ran = { label, code: result.status ?? (result.error ? 127 : 1), stdout: result.stdout ?? "", stderr: (result.stderr ?? "") + (result.error ? `\n${result.error.message}` : "") };
  transcript.push(ran);
  return ran;
}

function shown(ran: Ran): string {
  return `$ ${ran.label}\n  exit ${ran.code}\n  stdout:\n${indent(ran.stdout)}\n  stderr:\n${indent(ran.stderr)}`;
}

function indent(text: string): string {
  const lines = text.trimEnd().split("\n");
  const kept = lines.length > 120 ? [...lines.slice(0, 60), `... ${lines.length - 120} lines ...`, ...lines.slice(-60)] : lines;
  return kept.map((l) => `    ${l}`).join("\n");
}

function newer(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((p) => Number.parseInt(p, 10));
  const pb = b.split(/[.-]/).map((p) => Number.parseInt(p, 10));
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

/** The previous release: the env's choice, else the newest published version not above package.json's. */
function previousRelease(): string {
  const chosen = process.env["COHERENCE_UPGRADE_FROM"];
  if (chosen !== undefined && chosen !== "") return chosen.endsWith(".tgz") ? resolve(chosen) : `${PACKAGE}@${chosen}`;
  const own = (JSON.parse(readFileSync(join(CHECKOUT, "package.json"), "utf8")) as { version: string }).version;
  const listed = sh(`npm view ${PACKAGE} versions --json`, "npm", ["view", PACKAGE, "versions", "--json"], CHECKOUT);
  assert.equal(listed.code, 0, shown(listed));
  const versions = (JSON.parse(listed.stdout) as string[]).filter((v) => !v.includes("-") && newer(v, own) <= 0).sort(newer);
  const latest = versions.at(-1);
  assert.ok(latest !== undefined, `no published ${PACKAGE} at or below ${own}`);
  return `${PACKAGE}@${latest}`;
}

/** The release under test as a tarball: packed from a checkout as npm publishes it, or the env's .tgz. */
function currentTarball(scratch: string): string {
  const chosen = process.env["COHERENCE_UPGRADE_TO"];
  if (chosen !== undefined && chosen.endsWith(".tgz")) return resolve(chosen);
  const from = chosen !== undefined && chosen !== "" ? resolve(chosen) : CHECKOUT;
  const out = join(scratch, "pack");
  mkdirSync(out, { recursive: true });
  const packed = sh(`npm pack ${from}`, "npm", ["pack", from, "--pack-destination", out, "--json"], from);
  assert.equal(packed.code, 0, shown(packed));
  const name = (JSON.parse(packed.stdout.slice(packed.stdout.indexOf("["))) as { filename: string }[])[0]!.filename;
  return join(out, name.replace(/^@/, "").replace(/\//, "-"));
}

const TSCONFIG = JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, noEmit: true, allowImportingTsExtensions: true, types: ["node"] }, include: ["src/**/*.ts"] }, null, 2);

const STORE = `/** Every token the project holds, by name. */
export const TOKENS: Record<string, string> = { alpha: "tok-alpha-1", beta: "tok-beta-1" };

/** The one way a token leaves the store: its length, never its text. */
export function seal(name: string): string {
  const token = TOKENS[name];
  return token === undefined ? "" : \`sealed:\${token.length}\`;
}
`;

const BROKEN_STORE = STORE.replace("`sealed:${token.length}`", "token");

const PAGE = `import { seal } from "./store.ts";

export function show(name: string): string {
  return \`<p>\${name}: \${seal(name)}</p>\`;
}
`;

const STORE_TEST = `import assert from "node:assert/strict";
import { test } from "node:test";
import { show } from "./page.ts";
import { TOKENS } from "./store.ts";

test("every token is sealed before display", () => {
  for (const [name, token] of Object.entries(TOKENS)) assert.ok(!show(name).includes(token), name);
});
`;

const ENTRY_SPEC = `# Widgets

A store of tokens that pages show only sealed.

## trust levels
- storage: the rows beneath everything
- display: what a page shows
`;

const COMPONENT_SPEC = `# Tokens

The token store and the page that shows a token.

## invariants
- ${INVARIANT}: A token leaves the store only through seal, and every token a page shows is sealed.
  protects: TOKENS
  chokepoint: seal
  over: every token in TOKENS
  via: every token is sealed before display
  because: a page that shows a raw token leaks a credential
  crossing: storage -> display
  kinds: none
`;

function practiceText(cite: string): string {
  return `- rotate a token: A token is rotated by replacing it in the store, never by writing it into a page.
  when: edit src/tokens/store.ts adding tok- | explicit
  step: replace the token in TOKENS
  step: run the tests
    leaves: npm test passes
  pitfall: a token written into a page reached the display (${cite})
  invariants: ${INVARIANT}
  because: the store is the one place a token lives
`;
}

const CONFIG = JSON.stringify({ name: "widgets", language: "typescript", test: "node --test --test-name-pattern={filter} 'src/**/*.test.ts'", testMatch: "# pass [1-9][0-9]*" }, null, 2);

function write(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

function git(root: string, ...args: string[]): Ran {
  return sh(`git ${args.join(" ")}`, "git", ["-c", "user.name=Upgrade Test", "-c", "user.email=upgrade@coherence.invalid", "-c", "commit.gpgsign=false", ...args], root);
}

/** The adopter's CLI: whatever version node_modules holds, as an adopter runs it. */
function coherence(root: string, ...args: string[]): Ran {
  return sh(`npx --no coherence ${args.join(" ")}`, "npx", ["--no", "coherence", ...args], root);
}

function installedVersion(root: string): string {
  return (JSON.parse(readFileSync(join(root, "node_modules", "@posthog", "coherence", "package.json"), "utf8")) as { version: string }).version;
}

interface Problem {
  file?: string;
  message: string;
}

interface Model {
  problems: Problem[];
  components: { folder: string; invariants: { name: string; state: string }[] }[];
  runs?: { count: number };
}

function specModel(root: string, phase: string): Model {
  const ran = coherence(root, "spec", "--json");
  assert.doesNotThrow(() => JSON.parse(ran.stdout), `${phase}: spec --json printed no model\n${shown(ran)}`);
  return JSON.parse(ran.stdout) as Model;
}

function problemKey(p: Problem): string {
  return `${p.file ?? ""}: ${p.message}`;
}

/** A problem the adopter did not cause: one that names a kernel practice, or asks for an amend decision of one. */
function aboutCoherence(text: string): boolean {
  return text.includes(KERNEL_PREFIX) || /\bkernel\b/i.test(text) || /node_modules\/@posthog\/coherence/.test(text);
}

/** Every step of a practice, numbered as query practice prints it. */
function stepsOf(root: string, practice: string): number[] {
  const ran = coherence(root, "query", "practice", practice);
  assert.equal(ran.code, 0, shown(ran));
  const body = ran.stdout.split(/\n\s*Pitfalls/)[0]!;
  const steps = [...body.matchAll(/^\s+(\d+)\. /gm)].map((m) => Number(m[1]));
  assert.ok(steps.length > 0, `query practice "${practice}" listed no steps\n${shown(ran)}`);
  return steps;
}

function enact(root: string, practice: string, session: string): Ran {
  const steps = stepsOf(root, practice).flatMap((n) => ["--step", `${n}=skipped:the upgrade fixture carries no work`]);
  return coherence(root, "enact", practice, ...steps, "--session", session, "--agent", AGENT);
}

/** The installed hook command for an event, as the host would run it. */
function hookCommand(root: string, event: string): string {
  const settings = JSON.parse(readFileSync(join(root, ".claude", "settings.json"), "utf8")) as { hooks?: Record<string, { hooks: { command: string }[] }[]> };
  const commands = (settings.hooks?.[event] ?? []).flatMap((entry) => entry.hooks.map((h) => h.command)).filter((c) => /coherence/.test(c));
  assert.equal(commands.length, 1, `.claude/settings.json holds one Coherence hook for ${event}: ${JSON.stringify(commands)}`);
  return commands[0]!;
}

interface HookCall {
  event: string;
  what: string;
  ran: Ran;
}

/** One session's worth of hook events: start, a prompt, an edit and a command each before and after, and the stop. */
function driveHooks(root: string, session: string, edit: { from: string; to: string }): HookCall[] {
  const base = { session_id: session, cwd: root, transcript_path: join(root, ".no-transcript.jsonl"), permission_mode: "default" };
  const file = join(root, "src", "tokens", "store.ts");
  const editInput = { file_path: file, old_string: edit.from, new_string: edit.to };
  const bashInput = { command: "npm test", description: "Run the tests" };
  const calls: HookCall[] = [];
  const fire = (event: string, what: string, payload: Record<string, unknown>): void => {
    const command = hookCommand(root, event);
    const ran = sh(`${what}: ${command}`, "sh", ["-c", command], root, JSON.stringify({ ...base, hook_event_name: event, ...payload }), { CLAUDE_PROJECT_DIR: root });
    calls.push({ event, what, ran });
  };
  fire("SessionStart", "SessionStart", { source: "startup" });
  fire("UserPromptSubmit", "UserPromptSubmit", { prompt: "Rotate the alpha token." });
  fire("PreToolUse", "PreToolUse Edit", { tool_name: "Edit", tool_input: editInput });
  writeFileSync(file, readFileSync(file, "utf8").replace(edit.from, edit.to));
  fire("PostToolUse", "PostToolUse Edit", { tool_name: "Edit", tool_input: editInput, tool_response: { filePath: file, success: true } });
  fire("PreToolUse", "PreToolUse Bash", { tool_name: "Bash", tool_input: bashInput });
  const tests = sh("npm test", "npm", ["test"], root);
  fire("PostToolUse", "PostToolUse Bash", { tool_name: "Bash", tool_input: bashInput, tool_response: { stdout: tests.stdout, stderr: tests.stderr, interrupted: false } });
  fire("Stop", "Stop", { stop_hook_active: false });
  return calls;
}

/** What a hook said, as the host shows it: the text inside its JSON answer, or the plain text. */
function hookText(output: string): string {
  const said: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === "string") said.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value !== null && typeof value === "object") Object.values(value).forEach(walk);
  };
  for (const line of output.split("\n")) {
    try {
      walk(JSON.parse(line));
    } catch {
      said.push(line);
    }
  }
  return said.join("\n");
}

/** A line of hook output that tells the adopter to decide, amend or acknowledge something about Coherence's own practices or lexicon. */
function asksAboutCoherence(text: string): string[] {
  return hookText(text).split("\n").filter((line) => /\b(decide|amend|amendment|acknowledge)\b/i.test(line) && (line.includes(KERNEL_PREFIX) || /\bkernel practice\b/i.test(line) || /Coherence.s (own )?(lexicon|practice)/i.test(line)));
}

function recordIds(text: string): string[] {
  const ids = new Set<string>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value !== null && typeof value === "object") {
      const id = (value as { id?: unknown }).id;
      if (typeof id === "string") ids.add(id);
      for (const child of Object.values(value)) if (Array.isArray(child)) child.forEach(walk);
    }
  };
  const trimmed = text.trim();
  try {
    walk(JSON.parse(trimmed));
  } catch {
    for (const line of trimmed.split("\n")) {
      try {
        walk(JSON.parse(line));
      } catch {
        // not a record line
      }
    }
  }
  return [...ids];
}

function stateOf(model: Model): string | undefined {
  return model.components.flatMap((c) => c.invariants).find((i) => i.name === INVARIANT)?.state;
}

test("an adopter of the previous release upgrades to this one with nothing it did turned against it", { timeout: 1_800_000 }, () => {
  const scratch = mkdtempSync(join(tmpdir(), "coherence-upgrade-"));
  const root = join(scratch, "widgets");
  const failures: string[] = [];
  const fail = (what: string, ...ran: Ran[]): void => {
    failures.push([what, ...ran.map(shown)].join("\n"));
  };
  try {
    const previous = previousRelease();
    const current = currentTarball(scratch);

    // The adopter: a TypeScript project with a spec, an invariant, a test and a practice of its own.
    mkdirSync(root, { recursive: true });
    write(root, "package.json", JSON.stringify({ name: "widgets", private: true, type: "module", scripts: { test: "node --test 'src/**/*.test.ts'" } }, null, 2));
    write(root, "tsconfig.json", TSCONFIG);
    write(root, "coherence.config.json", CONFIG);
    write(root, "Widgets.spec.md", ENTRY_SPEC);
    write(root, "src/tokens/Tokens.spec.md", COMPONENT_SPEC);
    write(root, "src/tokens/store.ts", STORE);
    write(root, "src/tokens/page.ts", PAGE);
    write(root, "src/tokens/store.test.ts", STORE_TEST);
    write(root, ".gitignore", "node_modules\n");
    assert.equal(git(root, "init", "-q").code, 0);
    assert.equal(git(root, "add", "-A").code, 0);
    assert.equal(git(root, "commit", "-q", "-m", "widgets").code, 0);

    // Under the previous release.
    const installed = sh(`npm install --save-dev ${previous}`, "npm", ["install", "--save-dev", "--no-audit", "--no-fund", previous], root);
    assert.equal(installed.code, 0, shown(installed));
    const version = installedVersion(root);
    const hooks = coherence(root, "hooks", "install", "--host", "claude");
    assert.equal(hooks.code, 0, shown(hooks));
    const before = "upgrade-before";
    const decided = coherence(root, "decide", "a token lives only in the store", "--over", "a token written into a page", "--because", "a page that held a token showed it", "--session", before, "--agent", AGENT);
    assert.equal(decided.code, 0, shown(decided));
    const cite = /\bd-[0-9a-f]{8}\b/.exec(decided.stdout)?.[0];
    assert.ok(cite !== undefined, `decide printed no decision id\n${shown(decided)}`);
    write(root, "src/tokens/Tokens.practice.md", practiceText(cite));

    // A run, a refutation of the totality oracle with the break staged, and a run that sees it green again.
    const firstRun = coherence(root, "run", "--session", before, "--agent", AGENT);
    write(root, "src/tokens/store.ts", BROKEN_STORE);
    const refuted = coherence(root, "refute", `src/tokens/${INVARIANT}`, "--broke", "made seal return the raw token", "--session", before, "--agent", AGENT);
    write(root, "src/tokens/store.ts", STORE);
    const secondRun = coherence(root, "run", "--session", before, "--agent", AGENT);
    if (firstRun.code !== 0 || secondRun.code !== 0 || refuted.code !== 0) fail("the previous release could not run and refute the fixture's invariant (the fixture, not the upgrade)", firstRun, refuted, secondRun);

    const listed = coherence(root, "query", "practice");
    const kernel = listed.stdout.includes(AMENDED_KERNEL) ? AMENDED_KERNEL : /coherence:src\/[a-z]+\/[^,\n]+/.exec(listed.stdout)?.[0]?.trim();
    assert.ok(kernel !== undefined, `the previous release lists no kernel practice\n${shown(listed)}`);
    assert.ok(listed.stdout.includes(OWN_PRACTICE), `the previous release does not list the project's own practice\n${shown(listed)}`);
    for (const practice of [kernel, OWN_PRACTICE]) {
      const ran = enact(root, practice, before);
      if (ran.code !== 0) fail(`the previous release refused enact of ${practice} (the fixture, not the upgrade)`, ran);
    }
    const hooksBefore = driveHooks(root, before, { from: "tok-alpha-1", to: "tok-alpha-2" });
    const checkBefore = coherence(root, "spec", "--check");
    const modelBefore = specModel(root, "before");
    const journalBefore = coherence(root, "journal", "--json");
    const idsBefore = recordIds(journalBefore.stdout);
    assert.ok(idsBefore.includes(cite), `the previous release's journal --json does not list ${cite}\n${shown(journalBefore)}`);
    assert.equal(git(root, "add", "-A").code, 0);
    assert.equal(git(root, "commit", "-q", "-m", "adopt Coherence").code, 0);

    // The upgrade, as the adopter's next npm install.
    const upgraded = sh(`npm install --save-dev ${current}`, "npm", ["install", "--save-dev", "--no-audit", "--no-fund", current], root);
    assert.equal(upgraded.code, 0, shown(upgraded));
    const versionAfter = installedVersion(root);
    const after = "upgrade-after";

    // hooks --check passes, or says how to fix what the upgrade changed.
    const check = coherence(root, "hooks", "--check", "--host", "claude");
    if (check.code !== 0 && !/hooks install/.test(check.stdout + check.stderr)) fail("hooks --check fails after the upgrade and does not say how to fix it", check);

    // spec --check: no problem the adopter did not cause.
    const checkAfter = coherence(root, "spec", "--check");
    const modelAfter = specModel(root, "after");
    const known = new Set(modelBefore.problems.map(problemKey));
    const fresh = modelAfter.problems.filter((p) => !known.has(problemKey(p)));
    if (fresh.length > 0) fail(`spec --check names ${fresh.length} problem(s) the previous release did not, though the adopter changed nothing:\n${fresh.map((p) => `  - ${problemKey(p)}`).join("\n")}`, checkBefore, checkAfter);
    const coherences = modelAfter.problems.filter((p) => aboutCoherence(problemKey(p)) || /\bamend\b/.test(p.message) && aboutCoherence(p.message));
    if (coherences.length > 0) fail(`spec --check names problem(s) about Coherence's own practices, which are not the adopter's to fix:\n${coherences.map((p) => `  - ${problemKey(p)}`).join("\n")}`, checkAfter);
    if (checkAfter.code !== 0 && checkBefore.code === 0) fail("spec --check passed before the upgrade and fails after it", checkBefore, checkAfter);

    // enact of the kernel practice and of the project's own both go through.
    for (const practice of [kernel, OWN_PRACTICE]) {
      const ran = enact(root, practice, after);
      if (ran.code !== 0) fail(`enact of ${practice} is refused after the upgrade`, ran);
    }

    // Every hook event exits 0 and asks nothing about Coherence's own practices or lexicon.
    const hooksAfter = driveHooks(root, after, { from: "tok-beta-1", to: "tok-beta-2" });
    for (const { what, ran } of hooksAfter) {
      if (ran.code !== 0) fail(`${what} exits ${ran.code} after the upgrade; the fixture earns no refusal`, ran);
      const asked = asksAboutCoherence(ran.stdout + "\n" + ran.stderr);
      if (asked.length > 0) fail(`${what} asks the adopter to decide, amend or acknowledge something about Coherence's own practices or lexicon:\n${asked.map((l) => `  > ${l}`).join("\n")}`, ran);
    }
    for (const { what, ran } of hooksBefore) if (ran.code !== 0) fail(`${what} exited ${ran.code} under the previous release (the fixture, not the upgrade)`, ran);

    // The journal, the runs and the config are still read.
    const journalAfter = coherence(root, "journal", "--json");
    const lost = idsBefore.filter((id) => !recordIds(journalAfter.stdout).includes(id));
    if (journalAfter.code !== 0 || lost.length > 0) fail(`the journal no longer loads ${lost.length} record(s) the previous release wrote: ${lost.join(", ")}`, journalBefore, journalAfter);
    const decision = coherence(root, "journal", cite);
    if (decision.code !== 0 || !decision.stdout.includes("a token lives only in the store")) fail(`journal ${cite} does not read the decision the previous release recorded`, decision);
    if ((modelAfter.runs?.count ?? 0) < (modelBefore.runs?.count ?? 0) || modelBefore.runs === undefined) fail(`the runs the previous release recorded no longer count: ${modelBefore.runs?.count ?? "none"} before, ${modelAfter.runs?.count ?? "none"} after`, checkBefore, checkAfter);
    if (stateOf(modelAfter) !== stateOf(modelBefore)) fail(`"${INVARIANT}" was ${stateOf(modelBefore)} before the upgrade and is ${stateOf(modelAfter)} after it, with no run since`, checkBefore, checkAfter);
    const status = coherence(root, "run", "--status");
    if (status.code !== 0 || !status.stdout.includes(INVARIANT)) fail("run --status does not report the verdicts the previous release recorded", status);
    if (!modelAfter.components.some((c) => c.folder === "src/tokens")) fail("spec --json no longer reads the adopter's component", checkAfter);
    const rerun = coherence(root, "run", "--session", after, "--agent", AGENT);
    if (rerun.code !== 0) fail("run fails after the upgrade, where it passed before it, with the config unchanged", secondRun, rerun);

    process.stdout.write(`# upgrade ${version} -> ${versionAfter}; enacted ${kernel} and ${OWN_PRACTICE}; ${idsBefore.length} journal records; "${INVARIANT}" ${stateOf(modelAfter)}\n`);
    assert.deepEqual(failures, [], `the upgrade from ${previous} to ${current} turned the adopter's own state against it:\n\n${failures.join("\n\n")}`);
  } catch (error) {
    process.stderr.write(`\nEverything the upgrade test ran, in order:\n\n${transcript.map(shown).join("\n\n")}\n`);
    throw error;
  } finally {
    if (process.env["COHERENCE_UPGRADE_KEEP"] === undefined) rmSync(scratch, { recursive: true, force: true });
    else process.stdout.write(`# fixture kept at ${root}\n`);
  }
});
