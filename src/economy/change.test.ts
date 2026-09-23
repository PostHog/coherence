/**
 * The economy of the working change, over a temporary git repository: a
 * base commit on main, a feature branch that commits one change and leaves
 * main behind as main moves on, and a working tree holding a staged edit, an
 * unstaged edit, an untracked file, an ignored file, a staged deletion, an
 * unstaged deletion, a staged rename, a real nested repository, and a folder
 * whose `.git` file points nowhere (as an agent's worktree copy can). The
 * closure is computed with no instrument, so no language server is spawned.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import type { Io } from "../journal/cli.ts";
import { workingChange, type WorkingChange } from "./change.ts";
import { economyCommand, queryEconomyCommand, type EconomyOf } from "./cli.ts";
import { formatClosure, predictClosure } from "./closure.ts";

const CONFIG = JSON.stringify({ language: "typescript", testDir: "__tests__" });
const TSCONFIG = `{ "compilerOptions": { "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext", "strict": true, "noEmit": true, "allowImportingTsExtensions": true }, "include": ["src/**/*.ts"] }\n`;

const SECRETS = `export const SECRET_COLUMNS: Record<string, string[]> = { tokens: ["token"] };

export function seal(row: Record<string, unknown>): Record<string, unknown> {
  return { ...row };
}
`;
const RENDER = `import { seal } from "../store/secrets.ts";

export function render(row: Record<string, unknown>): string {
  return JSON.stringify(seal(row));
}
`;
const FORMAT = `export function pad(text: string): string {
  return " " + text;
}
`;
const OLD = `/** Moved by the change; its importer still names the old path. */
export function legacy(): number {
  return 1;
}
`;
const GONE = `export function gone(): number {
  return 2;
}
`;
const LOST = `export function lost(): number {
  return 3;
}
`;
const USES_OLD = `import { legacy } from "../util/old.ts";
export const a = legacy();
`;
const USES_GONE = `import { gone } from "../util/gone.ts";
export const b = gone();
`;
const STORE_SPEC = "# Store\n\nThe rows beneath everything.\n";
const UTIL_SPEC = "# Util\n\nSmall helpers.\n";

let root: string;
let clean: string;
let base: string;

function git(cwd: string, ...args: string[]): string {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_AUTHOR_NAME: "fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" };
  for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete env[name];
  const result = spawnSync("git", ["-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main", ...args], { cwd, encoding: "utf8", env });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

function write(at: string, path: string, text: string): void {
  mkdirSync(dirname(join(at, path)), { recursive: true });
  writeFileSync(join(at, path), text, "utf8");
}

before(() => {
  root = mkdtempSync(join(tmpdir(), "coherence-change-"));
  git(root, "init", "-q");
  write(root, "coherence.config.json", CONFIG);
  write(root, "tsconfig.json", TSCONFIG);
  write(root, ".gitignore", "ignored/\n");
  write(root, "src/store/Store.spec.md", STORE_SPEC);
  write(root, "src/store/secrets.ts", SECRETS);
  write(root, "src/store/extra.ts", "export const EXTRA = 1;\n");
  write(root, "src/api/render.ts", RENDER);
  write(root, "src/api/uses-old.ts", USES_OLD);
  write(root, "src/api/uses-gone.ts", USES_GONE);
  write(root, "src/util/Util.spec.md", UTIL_SPEC);
  write(root, "src/util/format.ts", FORMAT);
  write(root, "src/util/old.ts", OLD);
  write(root, "src/util/gone.ts", GONE);
  write(root, "src/util/lost.ts", LOST);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "base");
  base = git(root, "rev-parse", "HEAD");

  // The branch commits one change; main then moves on, so main's tip is not the merge base.
  git(root, "checkout", "-q", "-b", "feature");
  write(root, "src/util/format.ts", FORMAT + "export const WIDTH = 80;\n");
  git(root, "commit", "-q", "-am", "feature: width");
  git(root, "checkout", "-q", "main");
  write(root, "src/store/extra.ts", "export const EXTRA = 2;\n");
  git(root, "commit", "-q", "-am", "main moves on");
  git(root, "checkout", "-q", "feature");

  // The working change.
  write(root, "src/store/secrets.ts", SECRETS + "export const STAGED = true;\n");
  git(root, "add", "src/store/secrets.ts");
  write(root, "src/api/render.ts", RENDER + "export const UNSTAGED = true;\n");
  write(root, "src/api/fresh.ts", "export const FRESH = true;\n");
  write(root, "ignored/junk.ts", "export const JUNK = true;\n");
  git(root, "rm", "-q", "src/util/gone.ts");
  unlinkSync(join(root, "src/util/lost.ts"));
  git(root, "mv", "src/util/old.ts", "src/util/new.ts");
  // A real nested repository, and a folder whose .git file git cannot follow.
  mkdirSync(join(root, "vendor/peer"), { recursive: true });
  git(join(root, "vendor/peer"), "init", "-q");
  write(root, "vendor/peer/copy.ts", RENDER);
  write(root, ".claude/worktrees/agent-x/.git", "gitdir: /nowhere/at/all\n");
  write(root, ".claude/worktrees/agent-x/src/api/render.ts", RENDER);

  clean = mkdtempSync(join(tmpdir(), "coherence-change-clean-"));
  git(clean, "init", "-q");
  write(clean, "coherence.config.json", CONFIG);
  write(clean, "src/a.ts", "export const A = 1;\n");
  git(clean, "add", "-A");
  git(clean, "commit", "-q", "-m", "only commit");
});

after(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(clean, { recursive: true, force: true });
});

function capture(cwd: string): { io: Io; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { cwd, out: (line) => out.push(line), err: (line) => err.push(line) }, out, err };
}

/** The closure with no instrument: the economy's own, reached without spawning a language server. */
const noInstrument: EconomyOf = (at, paths, change) => predictClosure(at, paths, { change });

const shape = (change: WorkingChange): string[] => change.paths.map((c) => `${c.path} ${c.state}${c.from === undefined ? "" : ` from ${c.from}`} [${c.sources.join(",")}]`);

test("working change: staged, unstaged, and untracked project files against HEAD, deletions reported and renames as the new path, never an ignored file or a nested checkout; --since adds everything from the merge base; sorted and deterministic", () => {
  const change = workingChange(root);
  assert.equal(change.since, null);
  assert.deepEqual(shape(change), [
    "src/api/fresh.ts added [untracked]",
    "src/api/render.ts modified [unstaged]",
    "src/store/secrets.ts modified [staged]",
    "src/util/gone.ts deleted [staged]",
    "src/util/lost.ts deleted [unstaged]",
    "src/util/new.ts renamed from src/util/old.ts [staged]",
  ]);
  assert.deepEqual(workingChange(root), change, "the same tree reads as the same change");

  const since = workingChange(root, { since: "main" });
  assert.deepEqual(since.since, { ref: "main", base }, "--since main resolves through the merge base, not main's tip");
  assert.deepEqual(shape(since), [
    "src/api/fresh.ts added [untracked]",
    "src/api/render.ts modified [unstaged,since]",
    "src/store/secrets.ts modified [staged,since]",
    "src/util/format.ts modified [since]",
    "src/util/gone.ts deleted [staged,since]",
    "src/util/lost.ts deleted [unstaged,since]",
    "src/util/new.ts renamed from src/util/old.ts [staged,since]",
  ]);
  assert.ok(!since.paths.some((c) => c.path === "src/store/extra.ts"), "what main did after the branch left it is not this change");
  assert.deepEqual(workingChange(root, { since: base }).paths, since.paths, "an ancestor commit is its own merge base");

  // A git hook's index variable must not point the reading at another index.
  const saved = process.env["GIT_INDEX_FILE"];
  process.env["GIT_INDEX_FILE"] = join(root, "no-such-index");
  try {
    assert.deepEqual(workingChange(root), change);
  } finally {
    if (saved === undefined) delete process.env["GIT_INDEX_FILE"];
    else process.env["GIT_INDEX_FILE"] = saved;
  }

  assert.throws(() => workingChange(root, { since: "no-such-branch" }), /--since no-such-branch: not a commit/);
  assert.throws(() => workingChange(root, { since: "--output=/tmp/x" }), /--since takes a commit or a branch/);
});

test("economy of the working change: the files still importing a deleted path or a renamed-away path enter the closure as its dependents, with the spec that held the deleted file", async () => {
  const change = workingChange(root);
  const closure = await predictClosure(root, [], { change });
  assert.deepEqual(closure.given, ["src/api/fresh.ts", "src/api/render.ts", "src/store/secrets.ts", "src/util/new.ts"], "deleted files are reported, never given");
  const why = Object.fromEntries(closure.entries.map((e) => [e.file, e.why]));
  assert.deepEqual(why["src/api/uses-gone.ts"], ["imports gone from deleted src/util/gone.ts"]);
  assert.deepEqual(why["src/api/uses-old.ts"], ["imports legacy from src/util/old.ts, renamed to src/util/new.ts"]);
  assert.ok(why["src/util/Util.spec.md"]?.includes("spec of src/util, which held deleted src/util/gone.ts"), JSON.stringify(why["src/util/Util.spec.md"]));
  assert.ok(!("src/util/gone.ts" in why) && !("src/util/lost.ts" in why), "a deleted file is not an entry to load");
  assert.deepEqual(await predictClosure(root, [], { change }), closure, "deterministic");
});

test("economy --changed: plain text names each changed path and how; --json carries the working change; named paths join it; an empty change is said plainly and exits 0", async () => {
  const text = capture(root);
  assert.equal(await economyCommand(["--changed"], text.io, noInstrument), 0, text.err.join("\n"));
  const printed = text.out.join("\n");
  assert.match(printed, /^economy of the working change against HEAD: 6 changed paths: \d+ files, ~\d+ tokens/);
  assert.ok(printed.includes("  src/util/gone.ts  deleted (staged)"), printed);
  assert.ok(printed.includes("  src/util/new.ts  renamed from src/util/old.ts (staged)"), printed);
  assert.ok(printed.includes("  src/api/render.ts  modified (unstaged)"), printed);
  assert.ok(!printed.includes("ignored/junk.ts") && !printed.includes("vendor/peer") && !printed.includes(".claude/worktrees"), printed);

  const json = capture(root);
  assert.equal(await economyCommand(["src/store/extra.ts", "--since", "main", "--json"], json.io, noInstrument), 0, json.err.join("\n"));
  const closure = JSON.parse(json.out.join("\n"));
  assert.deepEqual(closure.change.named, ["src/store/extra.ts"]);
  assert.deepEqual(closure.change.working.since, { ref: "main", base });
  assert.deepEqual(closure.change.working.paths.find((c: { path: string }) => c.path === "src/util/format.ts"), { path: "src/util/format.ts", state: "modified", sources: ["since"] });
  assert.ok(closure.given.includes("src/store/extra.ts") && closure.given.includes("src/util/format.ts"), "named paths and the working change are unioned");

  const empty = capture(clean);
  assert.equal(await economyCommand(["--changed"], empty.io, noInstrument), 0);
  assert.equal(empty.out.join("\n"), "the working change is empty: nothing staged, unstaged, or untracked against HEAD; the closure is empty");
  const emptyJson = capture(clean);
  assert.equal(await economyCommand(["--changed", "--json"], emptyJson.io, noInstrument), 0);
  assert.deepEqual(JSON.parse(emptyJson.out.join("\n")).entries, []);

  const refused = capture(root);
  assert.equal(await economyCommand([], refused.io, noInstrument), 64);
  assert.match(refused.err.join("\n"), /name at least one file, or --changed/);
  const bad = capture(root);
  assert.equal(await economyCommand(["--since", "no-such-branch"], bad.io, noInstrument), 1);
  assert.match(bad.err.join("\n"), /not a commit/);
});

test("query economy --changed answers the economy of the working change in plain text, with the query's own --root", async () => {
  const asked = capture(tmpdir());
  assert.equal(await queryEconomyCommand(["--changed", "--root", root], asked.io, noInstrument), 0, asked.err.join("\n"));
  const printed = asked.out.join("\n");
  assert.equal(printed, formatClosure(await noInstrument(root, [], workingChange(root))));
  assert.match(printed, /^economy of the working change against HEAD: 6 changed paths/);
  const none = capture(root);
  assert.equal(await queryEconomyCommand([], none.io, noInstrument), 64);
  assert.match(none.err.join("\n"), /query economy: give at least one path, or --changed/);
});
