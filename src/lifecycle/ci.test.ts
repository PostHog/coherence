/**
 * The CI check (ci.ts, ci-report.ts): the workflow ci install plans from the
 * tree for each mode and package manager, a registry's check covering every
 * listed project, an existing workflow never overwritten, the suggestion
 * hooks install prints only while no workflow runs Coherence, and the
 * report the comment mode posts. Nothing here reaches the network or GitHub.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { sessionFiles } from "../journal/shard-fixture.ts";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, test } from "node:test";
import { appendRun, type RunEntry, type RunRecord } from "../enforcement/record.ts";
import { stopWarmServers } from "../enforcement/server-fixture.ts";
import type { Io } from "../journal/cli.ts";
import type { Gap } from "../readings/scope/gaps.ts";
import { loadSpecModel } from "../spec/model.ts";
import { buildReport, ciReportCommand, renderReport, type GapReader, type ProjectReport } from "./ci-report.ts";
import { cli } from "./cli-fixture.ts";
import { ciInstallCommand, ciSuggestion, CiError, planWorkflow, REPORT_MARKER, WORKFLOW_PATH, workflowText } from "./ci.ts";


const made: string[] = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A repository top (a .git folder is what marks one) holding these files. */
function repository(files: Record<string, string>): string {
  const top = realpathSync(mkdtempSync(join(tmpdir(), "coherence-ci-")));
  made.push(top);
  mkdirSync(join(top, ".git"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(top, path)), { recursive: true });
    writeFileSync(join(top, path), text);
  }
  return top;
}

const ADOPTER_PACKAGE = JSON.stringify({ name: "adopter", devDependencies: { "@posthog/coherence": "^1.6.0" } });

function capture(cwd: string): { io: Io; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { cwd, out: (line) => out.push(line), err: (line) => err.push(line) }, out, err };
}

/** Structural sanity a YAML reader would also refuse: no tab, indentation in steps of two, and each step a "- " item under steps:. */
function assertWellFormed(text: string): void {
  for (const [i, line] of text.split("\n").entries()) {
    assert.ok(!line.includes("\t"), `line ${i + 1} holds a tab`);
    const indent = line.length - line.trimStart().length;
    assert.equal(indent % 2, 0, `line ${i + 1} is indented by ${indent}: ${line}`);
    assert.ok(!/\s$/.test(line), `line ${i + 1} ends in whitespace`);
  }
  assert.match(text, /^name: Coherence\n/m);
  assert.match(text, /^on:\n {2}pull_request:\n/m);
  assert.match(text, /^jobs:\n {2}coherence:\n {4}runs-on: ubuntu-latest\n/m);
}

/** The value of each `run:` line, in order; a block scalar's lines joined. */
function runs(text: string): string[] {
  const lines = text.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^ {8}run: (.*)$/.exec(lines[i]!);
    if (m === null) continue;
    if (m[1] !== "|") {
      out.push(m[1]!);
      continue;
    }
    const block: string[] = [];
    while (i + 1 < lines.length && /^ {10}/.test(lines[i + 1]!)) block.push(lines[++i]!.slice(10));
    out.push(block.join("\n"));
  }
  return out;
}

test("ci install writes the fail mode for npm: spec --check and the chokepoint run, failing on either, pinned, with minimal permissions", () => {
  const top = repository({ "package.json": ADOPTER_PACKAGE, "package-lock.json": "{}\n", "coherence.config.json": "{}\n" });
  const text = workflowText(planWorkflow(top, "github", "fail"));
  assertWellFormed(text);
  assert.match(text, /^permissions:\n {2}contents: read\n\n/m, "fail mode asks to read the contents and nothing more");
  assert.doesNotMatch(text, /pull-requests:/);
  for (const name of ["COHERENCE_TELEMETRY: \"0\"", "DO_NOT_TRACK: \"1\"", "COHERENCE_NO_UPDATE_CHECK: \"1\""]) assert.ok(text.includes(`\n  ${name}\n`), `env ${name}`);
  assert.match(text, /- uses: actions\/checkout@[0-9a-f]{40} # v\d/);
  assert.match(text, /persist-credentials: false\n {10}fetch-depth: 0\n/);
  assert.match(text, /- uses: actions\/setup-node@[0-9a-f]{40} # v\d/);
  for (const line of text.split("\n").filter((l) => /^\s*- uses: /.test(l))) assert.match(line, /@[0-9a-f]{40} # v\d/, `every action pinned by commit: ${line}`);
  assert.doesNotMatch(text, /pnpm/);
  assert.deepEqual(runs(text), ["npm ci", "npx --no -- coherence spec --check", 'npx --no -- coherence run --form chokepoint --no-server --session "ci-${{ github.run_id }}" --agent ci']);
  assert.match(text, /- name: Chokepoints\n {8}if: \$\{\{ !cancelled\(\) \}\}\n/, "the chokepoints are checked even when the spec check failed");
  assert.doesNotMatch(text, /working-directory/, "a project at the top runs there");
});

test("ci install sets up what a language plugin's adapter asks: the Go plugin's toolchain and gopls, pinned, after the install and before the checks", () => {
  const top = repository({ "package.json": ADOPTER_PACKAGE, "package-lock.json": "{}\n", "coherence.config.json": JSON.stringify({ language: "go", plugins: { go: "bundled" } }) });
  const text = workflowText(planWorkflow(top, "github", "fail"));
  assertWellFormed(text);
  assert.match(text, /- name: Install\n {8}run: npm ci\n\n {6}# The Go plugin grades through gopls[^\n]*\n\n {6}- name: "Go"\n {8}uses: actions\/setup-go@[0-9a-f]{40} # v\d[^\n]*\n {8}with:\n {10}go-version: "stable"\n\n {6}- name: "gopls"\n {8}run: "go install golang\.org\/x\/tools\/gopls@v[\d.]+"\n\n {6}- name: Spec check\n/);
  assert.doesNotMatch(workflowText(planWorkflow(repository({ "package.json": ADOPTER_PACKAGE, "package-lock.json": "{}\n", "coherence.config.json": "{}\n" }), "github", "fail")), /setup-go|gopls/, "a project that does not run the plugin sets up none of it");
});

test("ci install writes the comment mode for pnpm: findings never fail the job, and one comment is posted or updated", () => {
  const top = repository({ "package.json": ADOPTER_PACKAGE, "pnpm-lock.yaml": "lockfileVersion: '9.0'\n" });
  const text = workflowText(planWorkflow(top, "github", "comment"));
  assertWellFormed(text);
  assert.match(text, /^permissions:\n {2}contents: read\n {2}pull-requests: write\n/m, "comment mode adds only what posting a comment needs");
  assert.match(text, /- uses: pnpm\/action-setup@[0-9a-f]{40} # v\d.*\n {8}with:\n {10}version: 10\n/, "no packageManager: the pnpm that writes lockfile 9.0");
  const steps = runs(text);
  assert.equal(steps[0], "pnpm install --frozen-lockfile");
  assert.equal(steps[1], "pnpm exec coherence spec --check || [ $? -eq 1 ]", "a spec problem is a finding; any other exit breaks the job");
  assert.equal(steps[2], 'pnpm exec coherence run --form chokepoint --no-server --session "ci-${{ github.run_id }}" --agent ci || [ $? -eq 1 ]');
  assert.match(steps[3]!, /pnpm exec coherence ci report --session "ci-\$\{\{ github.run_id \}\}" > "\$RUNNER_TEMP\/coherence-report.md" \|\| status=\$\?/);
  assert.match(steps[3]!, />> "\$GITHUB_STEP_SUMMARY"\nexit "\$status"$/, "the report reaches the job summary, then its exit stands");
  assert.ok(steps[4]!.includes(`startswith("${REPORT_MARKER}")`), "the comment is found by the report's marker");
  assert.match(steps[4]!, /gh api --method PATCH "repos\/\$REPO\/issues\/comments\/\$id" -F body=@"\$body"/, "an existing comment is updated in place");
  assert.match(steps[4]!, /gh api --method POST "repos\/\$REPO\/issues\/\$PR\/comments" -F body=@"\$body"/);
  assert.match(steps[4]!, /::warning::.*fork/, "a read-only token is said, never silent");
  assert.match(text, /GH_TOKEN: \$\{\{ github\.token \}\}/);

  const declared = repository({ "package.json": JSON.stringify({ name: "x", packageManager: "pnpm@10.18.0", devDependencies: { "@posthog/coherence": "^1.6.0" } }), "pnpm-lock.yaml": "lockfileVersion: '9.0'\n" });
  assert.doesNotMatch(workflowText(planWorkflow(declared, "github", "comment")), /version: 10/, "packageManager names the pnpm, so the workflow does not");
});

test("ci install sets up Bun for a bun lockfile: Bun beside the Node.js the CLI needs, a frozen install, and the installed Coherence only", () => {
  const top = repository({ "package.json": ADOPTER_PACKAGE, "bun.lock": "{}\n" });
  const text = workflowText(planWorkflow(top, "github", "fail"));
  assertWellFormed(text);
  assert.match(text, /- uses: oven-sh\/setup-bun@[0-9a-f]{40} # v\d.*\n {8}with:\n {10}bun-version: latest\n/, "no packageManager: the newest Bun, which reads every lockfile an older one wrote");
  assert.match(text, /- uses: actions\/setup-node@[0-9a-f]{40} # v\d.*\n {8}with:\n {10}node-version: "22"\n/, "the CLI runs on Node.js, which Bun does not bring");
  assert.deepEqual(runs(text), ["bun install --frozen-lockfile", "npx --no -- coherence spec --check", 'npx --no -- coherence run --form chokepoint --no-server --session "ci-${{ github.run_id }}" --agent ci'], "the installed Coherence through Node.js, never one fetched, whatever the Bun");
  assert.doesNotMatch(text, /npm ci|pnpm|bunx/);

  for (const declares of [{ packageManager: "bun@1.4.2" }, { engines: { bun: "1.1.45" } }]) {
    const declared = repository({ "package.json": JSON.stringify({ name: "x", ...declares, devDependencies: { "@posthog/coherence": "^1.7.0" } }), "bun.lock": "{}\n" });
    assert.match(workflowText(planWorkflow(declared, "github", "fail")), /- uses: oven-sh\/setup-bun@[0-9a-f]{40} # v\d.*\n\n/, `${JSON.stringify(declares)} at the top: the action reads it there, and no input overrides it`);
  }

  const binary = repository({ "package.json": ADOPTER_PACKAGE, "bun.lockb": "" });
  assert.equal(planWorkflow(binary, "github", "comment").manager, "bun", "the binary lockfile older Bun writes is Bun's too");

  const nested = repository({
    "apps/web/package.json": JSON.stringify({ name: "web", packageManager: "bun@1.4.2", devDependencies: { "@posthog/coherence": "^1.7.0" } }),
    "apps/web/bun.lock": "{}\n",
    "apps/web/coherence.config.json": "{}\n",
  });
  const nestedText = workflowText(planWorkflow(join(nested, "apps/web"), "github", "fail"));
  assert.match(nestedText, /- uses: oven-sh\/setup-bun@.*\n {8}with:\n {10}bun-version-file: apps\/web\/package\.json\n/, "the Bun its packageManager names, read below the top");
  assert.match(nestedText, /working-directory: apps\/web\n {8}run: bun install --frozen-lockfile\n/);

  const underPinnedTop = repository({
    "package.json": JSON.stringify({ name: "top", packageManager: "bun@1.1.45" }),
    "apps/web/package.json": ADOPTER_PACKAGE,
    "apps/web/bun.lock": "{}\n",
    "apps/web/coherence.config.json": "{}\n",
  });
  assert.match(workflowText(planWorkflow(join(underPinnedTop, "apps/web"), "github", "fail")), /- uses: oven-sh\/setup-bun@.*\n {8}with:\n {10}bun-version: latest\n/, "a pin at the top is not the Bun that wrote a lockfile below it");
});

test("ci install runs a registry's check at the repository top, covering every listed project, and a nested project in its own folder", () => {
  const top = repository({
    "package.json": ADOPTER_PACKAGE,
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    "coherence.config.json": JSON.stringify({ projects: ["products/a", "products/b"], language: "typescript" }),
    "products/a/A.spec.md": "# a\n\nThe a product.\n",
    "products/b/B.spec.md": "# b\n\nThe b product.\n",
  });
  const fromLeaf = planWorkflow(join(top, "products/a"), "github", "fail");
  assert.equal(fromLeaf.workdir, ".", "run from a leaf, the check still runs at the top");
  assert.deepEqual(fromLeaf.projects, ["products/a", "products/b"]);
  const text = workflowText(fromLeaf);
  assert.doesNotMatch(text, /working-directory/);
  assert.match(text, /# The registry at the repository top lists 2 projects: both commands run at the top and cover each one\./);

  const nested = repository({ "package.json": ADOPTER_PACKAGE, "package-lock.json": "{}\n", ".nvmrc": "22\n", "apps/web/coherence.config.json": "{}\n" });
  const plan = planWorkflow(join(nested, "apps/web"), "github", "fail");
  assert.equal(plan.workdir, "apps/web");
  assert.equal(plan.installDir, ".");
  const nestedText = workflowText(plan);
  assert.equal(nestedText.match(/working-directory: apps\/web/g)?.length, 2, "both checks run in the project's folder");
  assert.match(nestedText, /node-version-file: \.nvmrc/, "the project's own Node.js version file is used");

  const topless = repository({ "package.json": ADOPTER_PACKAGE, "products/a/package-lock.json": "{}\n", "coherence.config.json": JSON.stringify({ projects: ["products/a"] }) });
  assert.throws(() => planWorkflow(join(topless, "products/a"), "github", "fail"), /no package-lock\.json, pnpm-lock\.yaml, bun\.lock or bun\.lockb at the repository top, where a registry's check runs/);
});

test("ci install refuses what it cannot set up, and says what to do", () => {
  const yarn = repository({ "package.json": ADOPTER_PACKAGE, "yarn.lock": "" });
  assert.throws(() => planWorkflow(yarn, "github", "fail"), (e: unknown) => e instanceof CiError && /yarn\.lock is a lockfile the workflow does not set up; it installs with npm \(package-lock\.json\), pnpm \(pnpm-lock\.yaml\) or bun \(bun\.lock or bun\.lockb\)$/.test(e.message));
  const bare = repository({ "package.json": ADOPTER_PACKAGE });
  assert.throws(() => planWorkflow(bare, "github", "fail"), /no package-lock\.json, pnpm-lock\.yaml, bun\.lock or bun\.lockb from \. up to the repository top; install @posthog\/coherence as a dev dependency first \(npm install -D, pnpm add -D or bun add -d\)$/);
  const unlisted = repository({ "package.json": JSON.stringify({ name: "x" }), "package-lock.json": "{}\n" });
  assert.throws(() => planWorkflow(unlisted, "github", "fail"), /no package\.json from \. up to \. lists @posthog\/coherence/);
  const both = repository({ "package.json": ADOPTER_PACKAGE, "package-lock.json": "{}\n", "pnpm-lock.yaml": "" });
  assert.throws(() => planWorkflow(both, "github", "fail"), /holds package-lock\.json and pnpm-lock\.yaml/);

  const top = repository({ "package.json": ADOPTER_PACKAGE, "package-lock.json": "{}\n" });
  const noMode = capture(top);
  assert.equal(ciInstallCommand(["--host", "github"], noMode.io), 64);
  assert.match(noMode.err.join("\n"), /choose a mode: --mode fail to fail the check on a spec problem or a structural defect, or --mode comment to post one report comment/, "both modes are presented, neither assumed");
});

test("ci install prints without --write, writes with it, and never overwrites a workflow already there", () => {
  const top = repository({ "package.json": ADOPTER_PACKAGE, "package-lock.json": "{}\n" });
  const path = join(top, WORKFLOW_PATH);
  const printed = capture(top);
  assert.equal(ciInstallCommand(["--host", "github", "--mode", "fail"], printed.io), 0);
  assert.match(printed.out.join("\n"), /^# Coherence on every pull request/);
  assert.ok(!existsSync(path), "printed, not written");

  const written = capture(top);
  assert.equal(ciInstallCommand(["--host=github", "--mode=comment", "--write"], written.io), 0, written.err.join("\n"));
  assert.equal(readFileSync(path, "utf8"), workflowText(planWorkflow(top, "github", "comment")));

  writeFileSync(path, "name: theirs\n");
  const again = capture(top);
  assert.equal(ciInstallCommand(["--host", "github", "--mode", "fail", "--write"], again.io), 1);
  assert.match(again.err.join("\n"), /coherence\.yml already exists and was not overwritten/);
  assert.equal(readFileSync(path, "utf8"), "name: theirs\n", "the file there is kept byte for byte");
  assert.deepEqual(readdirSync(dirname(path)), ["coherence.yml"], "and nothing is written beside it");
});

test("hooks install offers ci install and its two modes only while no workflow runs Coherence", async () => {
  const bare = repository({ "package.json": ADOPTER_PACKAGE });
  const line = await ciSuggestion(bare);
  assert.match(line, /^CI: no workflow runs Coherence on pull requests; npx --no -- coherence ci install --host github --mode fail \(.+\) or --mode comment \(.+\) prints one, and --write writes it\.\n$/);

  const installed = await cli(["hooks", "install", "--host", "claude"], { cwd: bare });
  assert.equal(installed.status, 0, installed.stderr);
  assert.equal(installed.stdout.split("\n").filter((l) => l.startsWith("CI: ")).length, 1, "hooks install prints the offer once");

  const ours = repository({ [WORKFLOW_PATH]: "name: Coherence\n" });
  assert.equal(await ciSuggestion(ours), "", "the workflow ci install writes");
  const theirs = repository({ ".github/workflows/checks.yaml": "jobs:\n  x:\n    steps:\n      - run: pnpm exec coherence spec --check\n" });
  assert.equal(await ciSuggestion(theirs), "", "a workflow of the adopter's own that runs the check");
  const unrelated = repository({ ".github/workflows/checks.yml": "jobs:\n  x:\n    steps:\n      - run: npm test\n" });
  assert.notEqual(await ciSuggestion(unrelated), "", "a workflow that does not run Coherence is no reason to stay quiet");
  const again = await cli(["hooks", "install", "--host", "claude"], { cwd: ours });
  assert.equal(again.status, 0, again.stderr);
  assert.doesNotMatch(again.stdout, /^CI: /m, "with a workflow there, install says nothing of CI");
});

/** A run record of one session holding these chokepoint entries. */
function record(session: string, entries: Partial<RunEntry>[]): RunRecord {
  return {
    at: new Date().toISOString(),
    session,
    agent: "ci",
    commit: null,
    dirty: false,
    instrument: { language: "typescript", server: "cold" },
    latency: 1,
    invariants: entries.map((e) => ({ component: ".", name: "door", form: "chokepoint", verdict: "pass", refutation: "automatic", bypasses: [], testReferences: 0, files: [], latency: 1, reason: "every reference is inside", ...e })),
  };
}

const SPEC = (name: string) => `# ${name}\n\nThe ${name} product.\n\n## invariants\n- ${name} door: ROWS leave only through door.\n  protects: ROWS\n  chokepoint: door\n  because: a fixture\n  kinds: none\n`;

test("ci report carries each project's problems, chokepoint verdicts, spec gaps and guard failures as Markdown, and fails only when Coherence did not finish", async () => {
  const top = repository({
    "coherence.config.json": JSON.stringify({ projects: ["products/a", "products/b"], language: "typescript" }),
    "products/a/A.spec.md": SPEC("a"),
    "products/b/B.spec.md": SPEC("b"),
    "products/b/Extra.spec.md": "# extra\n",
  });
  const a = join(top, "products/a");
  const b = join(top, "products/b");
  appendRun(a, record("ci-7", [{ name: "a door" }]));
  appendRun(b, record("ci-7", [{ name: "b door", verdict: "fail", grade: "broken", reason: "1 reference to ROWS outside door: src/leak.ts:3 in leak", bypasses: [{ file: "src/leak.ts", line: 3, symbol: "leak" }] }]));
  appendRun(b, record("someone-else", [{ name: "b door" }]));
  const gaps: GapReader = async (root) =>
    root === a
      ? { gaps: [{ component: ".", name: "webhook", specPath: "A.spec.md", handler: "hook in src/hook.ts", file: "src/hook.ts", trust: ["outside"], route: { id: "r", first: "webhook", entrances: 1, stops: [".", "store"] } }] }
      : { unread: "the language server never answered" };

  const report = await buildReport(top, "ci-7", gaps);
  const md = report.markdown;
  assert.ok(md.startsWith(`${REPORT_MARKER}\n## Coherence\n`), "the marker the workflow finds its comment by comes first");
  assert.match(md, /\*\*📄 1 spec file error · ⛔ 1 broken rule · 🚪 1 unchecked input · 🐛 0 bugs that came back\*\* in 2 projects/);
  assert.doesNotMatch(md, /`a door`/, "a rule that holds is not listed");
  assert.match(md, /### products\/b[\s\S]*\*\*📄 Spec file errors \(1\)\*\*\n\n- `Extra\.spec\.md:1` a folder holds one spec[^\n]*\n\n<details>\n<summary>What this means and how to fix it<\/summary>\n\nCoherence cannot read these lines in the spec files\. Fix each line\. Then run `npx --no -- coherence spec --check` in `products\/b` again\./);
  assert.match(md, /- ✕ `b door`: 1 reference to ROWS outside door: src\/leak\.ts:3 in leak\n {2}- used without the function at `src\/leak\.ts:3`, in leak\n/);
  assert.match(md, /\*\*🚪 Unchecked inputs \(1\)\*\*\n\n- \*\*webhook\*\* in `A\.spec\.md`\. The input comes from: outside\. It reaches: `store`\.\n/);
  assert.match(md, /\*\*🚪 Unchecked inputs:\*\* Coherence could not trace the code: the language server never answered\./, "a gap reading that failed is said, never shown as none");
  assert.deepEqual(report.unfinished, [], "findings alone leave the report finished");
  assert.doesNotMatch(md, /someone-else|\[!WARNING\]/, "only the CI session's run is read");

  const missing = capture(top);
  assert.equal(await ciReportCommand(["--session", "ci-8"], missing.io, gaps), 1, "no run of the session: Coherence did not finish");
  assert.match(missing.out.join("\n"), /> \[!WARNING\]\n> Coherence did not finish\. This report is not complete, and the check fails:\n> - no check run was recorded for session ci-8 in products\/a\n/);

  appendRun(a, record("ci-9", [{ name: "a door", verdict: "not run", reason: "the instrument never answered" }]));
  appendRun(b, record("ci-9", [{ name: "b door" }]));
  const notRun = await buildReport(top, "ci-9", gaps);
  assert.deepEqual(notRun.unfinished, ["rule a door in products/a was not checked: the instrument never answered"]);

  assert.equal(await ciReportCommand([], capture(top).io, gaps), 64, "the session is required");

  // A guard failure is the defect floor's: a defect in a class a witnessed guard already closed.
  const model = loadSpecModel(a);
  model.defects = { recorded: 2, closed: 1, guarded: 1, decided: 0, unguarded: [], undeclared: [], guardFailures: [{ id: "df-2", class: "bypass", guard: "products/a/a door", guardedBy: "df-1", resolution: "rs-1" }] };
  const guarded = renderReport([{ name: ".", model, runs: [record("ci-7", [{ name: "a door" }])], gaps: { gaps: [] }, baselined: new Set() }], "ci-7", undefined);
  assert.match(guarded.markdown, /🚪 0 unchecked inputs · 🐛 1 bug that came back\*\*/);
  assert.match(guarded.markdown, /\*\*🐛 Bugs that came back \(1\)\*\*\n\n- `df-2`: kind `bypass`\. Guard: `products\/a\/a door`, added when `rs-1` closed `df-1`\.\n\n<details>\n<summary>What this means<\/summary>\n\nA guard is a rule that was added to stop one kind of bug\. These bugs came back after their guard was added\. Find out why the guard did not stop each one\. Coherence cannot tell if this pull request caused them\.\n\n<\/details>\n/);
  assert.doesNotMatch(guarded.markdown, /^### /m, "one project at the root needs no heading");
});

const UNNAMED = "# a\n\nThe a product.\n\n## invariants\n- ROWS leave only through door.\n";
const WEBHOOK: Gap = { component: ".", name: "webhook", specPath: "A.spec.md", handler: "hook in src/hook.ts", file: "src/hook.ts", trust: ["outside"], route: { id: "r", first: "webhook", entrances: 1, stops: [".", "store"] } };

describe("ci report says what each finding means and what to do", () => {
  for (const { finding, spec, runs, gaps, baselined, changed, says } of [
    { finding: "nothing", spec: SPEC("a"), runs: [{ name: "a door" }], gaps: [], baselined: [], says: [/\*\*\n\n<details>\n<summary>What is Coherence\?<\/summary>\n\nCoherence compares the code with its spec files \(`\*\.spec\.md`\)\. A spec file lists the rules for one part of the code\.\n\nThis check read 1 part of the code and 1 rule\. 1 rule passes\.\n\n<\/details>\n\n> \[!TIP\]\n> Nothing to fix\.\n/] },
    {
      finding: "a spec problem",
      spec: UNNAMED,
      runs: [],
      gaps: [],
      baselined: [],
      says: [/> \[!NOTE\]\n> These findings do not make this check fail\. Some findings can come from files that this pull request does not change\.\n/, /\*\*📄 Spec file errors \(1\)\*\*\n\n- `A\.spec\.md:6` an invariant bullet starts with a short name and a colon, as in "- \\<name\\>: \\<sentence\\>"\n\n<details>\n<summary>What this means and how to fix it<\/summary>\n\nCoherence cannot read these lines in the spec files\. Fix each line\. Then run `npx --no -- coherence spec --check` again\.\n\n<\/details>\n/],
    },
    {
      finding: "a failing chokepoint",
      spec: SPEC("a"),
      runs: [{ name: "a door", verdict: "fail", grade: "broken" }],
      gaps: [],
      baselined: [],
      says: [
        /\*\*⛔ Broken rules \(1\)\*\*\n\n- ✕ `a door`: [^\n]*\n\n<details>\n<summary>What this means and how to fix it<\/summary>\n\nEach of these rules says that some code or data must only be used through one function\. The code above uses it without that function\. Fix the code so it uses the function\. If the rule is wrong, fix the rule in the spec\.\n/,
      ],
    },
    {
      finding: "a failing chokepoint recorded against its own file, with no bypass",
      spec: SPEC("a"),
      runs: [{ name: "a door", verdict: "fail", grade: "broken", files: ["src/door.ts"] }],
      gaps: [],
      baselined: [],
      changed: ["src/door.ts"],
      says: [/- ✕ `a door`: [^\n]+ · 📍 \*\*changed in this pull request\*\*\n/],
    },
    {
      finding: "a spec gap and one the baseline holds",
      spec: SPEC("a"),
      runs: [{ name: "a door" }],
      gaps: [WEBHOOK, { ...WEBHOOK, name: "old" }],
      baselined: ["old"],
      says: [
        /\*\*🚪 Unchecked inputs \(1\)\*\*\n\n- \*\*webhook\*\* in `A\.spec\.md`\. The input comes from: outside\. It reaches: `store`\.\n\n<details>\n<summary>What this means and how to fix it<\/summary>\n\nInput from outside this code comes in at these places\. The spec does not say what checks that input\. 1 more place was already like this when Coherence was added\. This list does not show it\.\n/,
        /\nTo close one of these, find the place by its name in the `## entrances` section of its spec file\. Add one line under it:\n\n- If all of the input goes through one function that a rule in the spec protects, add `guard: <function>`\.\n- If a rule in the spec already checks input from the same source, add the place's name to the `entrances:` line of that rule\.\n- If the input needs no check, add `control: none - <reason>`\.\n\nTo get the line to add, run `npx --no -- coherence scaffold control \"<name>\"`\.\n\n<\/details>\n/,
      ],
    },
    {
      finding: "a spec problem in a file the pull request changed",
      spec: UNNAMED,
      runs: [],
      gaps: [],
      baselined: [],
      changed: ["A.spec.md"],
      says: [/> \[!IMPORTANT\]\n> These findings do not make this check fail\.\n>\n> 1 finding is in a file that this pull request changes\. It has the mark 📍 \*\*changed in this pull request\*\*\.\n/, /- `A\.spec\.md:6` [^\n]+ · 📍 \*\*changed in this pull request\*\*\n/],
    },
    { finding: "a spec gap whose handler the pull request changed", spec: SPEC("a"), runs: [{ name: "a door" }], gaps: [WEBHOOK], baselined: [], changed: ["src/hook.ts"], says: [/The input comes from: outside\. It reaches: `store`\. · 📍 \*\*changed in this pull request\*\*\n/] },
    { finding: "findings in no file the pull request changed", spec: UNNAMED, runs: [], gaps: [WEBHOOK], baselined: [], changed: ["src/other.ts"], says: [/\n> None of these findings are in files that this pull request changes\. You do not need to fix them in this pull request\.\n/] },
    { finding: "changed files git could not list", spec: UNNAMED, runs: [], gaps: [], baselined: [], changed: "git diff main failed: bad revision", says: [/\n> Coherence could not find the files that this pull request changes: git diff main failed: bad revision\.\n/] },
    {
      finding: "no chokepoint run, so there is nothing to fix only in appearance",
      spec: SPEC("a"),
      runs: [{ name: "a door", verdict: "not run", reason: "the instrument never answered" }],
      gaps: [],
      baselined: [],
      says: [/> \[!WARNING\]\n> Coherence could not check everything\. This list can be incomplete\.\n/, /\*\*⏸️ Rules Coherence could not check \(1\)\*\*\n\n- ○ `a door`: the instrument never answered\n/],
    },
  ] satisfies { finding: string; spec: string; runs: Partial<RunEntry>[]; gaps: Gap[]; baselined: string[]; changed?: string[] | string; says: RegExp[] }[]) {
    test(finding, () => {
      const root = repository({ "A.spec.md": spec });
      const model = loadSpecModel(root);
      const report = renderReport([{ name: ".", model, runs: [record("ci-7", runs)], gaps: { gaps }, baselined: new Set(baselined.map((n) => `.\u0000${n}`)), changed: changed === undefined ? undefined : typeof changed === "string" ? { unread: changed } : { files: new Set(changed) } }], "ci-7", undefined);
      for (const said of says) assert.match(report.markdown, said);
    });
  }

  test("a project with a recorded run that declares no rules says nothing about rules", () => {
    const root = repository({ "A.spec.md": "# a\n\nThe a product.\n" });
    const model = loadSpecModel(root);
    const report = renderReport([{ name: ".", model, runs: [record("ci-7", [])], gaps: { gaps: [] }, baselined: new Set() }], "ci-7", undefined);
    assert.doesNotMatch(report.markdown, /Broken rules|Rules Coherence could not check|Coherence has no record of running its check/, "a run was recorded, and it declared no rules, so there is nothing to say about them");
  });

  test("no record of a run for the session names the session and says Coherence did not check the rules", () => {
    const root = repository({ "A.spec.md": SPEC("a") });
    const model = loadSpecModel(root);
    const report = renderReport([{ name: ".", model, runs: [], gaps: { gaps: [] }, baselined: new Set() }], "ci-7", undefined);
    assert.match(report.markdown, /\*\*⛔ Rules:\*\* Coherence has no record of running its check \(session `ci-7`\), so it did not check the rules\.\n/);
  });

  test("a spec gap whose route goes no further than its own component says nothing extra after its source", () => {
    const root = repository({ "A.spec.md": SPEC("a") });
    const model = loadSpecModel(root);
    const gap: Gap = { ...WEBHOOK, route: { ...WEBHOOK.route, stops: ["."] } };
    const report = renderReport([{ name: ".", model, runs: [record("ci-7", [{ name: "a door" }])], gaps: { gaps: [gap] }, baselined: new Set() }], "ci-7", undefined);
    assert.match(report.markdown, /The input comes from: outside\.\n/, "no route clause when the route stops at the entrance's own component");
    assert.doesNotMatch(report.markdown, /It reaches:/);
  });

  test("spec gaps Coherence could not read keep the lead from claiming there is nothing to fix", () => {
    const root = repository({ "A.spec.md": SPEC("a") });
    const model = loadSpecModel(root);
    const report = renderReport([{ name: ".", model, runs: [record("ci-7", [{ name: "a door" }])], gaps: { unread: "the language server never answered" }, baselined: new Set() }], "ci-7", undefined);
    assert.match(report.markdown, /> \[!WARNING\]\n> Coherence could not check everything\. This list can be incomplete\.\n/);
  });

  test("a project whose changed files were read beside one that was not keeps the lead from claiming none of the findings changed", () => {
    const root = repository({ "A.spec.md": SPEC("a") });
    const model = loadSpecModel(root);
    const read: ProjectReport = { name: "read", model, runs: [record("ci-7", [{ name: "a door" }])], gaps: { gaps: [WEBHOOK] }, baselined: new Set(), changed: { files: new Set(["src/other.ts"]) } };
    const unread: ProjectReport = { name: "unread", model, runs: [record("ci-7", [{ name: "a door" }])], gaps: { gaps: [] }, baselined: new Set(), changed: { unread: "git diff main failed: bad revision" } };
    const report = renderReport([read, unread], "ci-7", undefined);
    assert.match(report.markdown, /None of the findings that Coherence could check are in files that this pull request changes\./);
    assert.doesNotMatch(report.markdown, /None of these findings/);
  });

  test("registry problems are marked when the pull request changed the file they are about", () => {
    const root = repository({ "A.spec.md": SPEC("a") });
    const model = loadSpecModel(root);
    const changedReport = renderReport(
      [{ name: ".", model, runs: [record("ci-7", [{ name: "a door" }])], gaps: { gaps: [] }, baselined: new Set() }],
      "ci-7",
      { problems: [{ file: "coherence.config.json", message: "projects is a list of folders relative to the repository top" }], changed: { files: new Set(["coherence.config.json"]) } },
    );
    assert.match(changedReport.markdown, /\*\*⚙️ Project list errors \(1\)\*\*\n\n- `coherence\.config\.json` [^\n]+\n\n<details>\n<summary>What this means and how to fix it<\/summary>\n\nCoherence cannot read the list of projects in `coherence\.config\.json`\. Fix each line above\.\n/);
    assert.match(changedReport.markdown, /- `coherence\.config\.json` projects is a list of folders relative to the repository top · 📍 \*\*changed in this pull request\*\*\n/);
    const unchangedReport = renderReport(
      [{ name: ".", model, runs: [record("ci-7", [{ name: "a door" }])], gaps: { gaps: [] }, baselined: new Set() }],
      "ci-7",
      { problems: [{ file: "coherence.config.json", message: "projects is a list of folders relative to the repository top" }], changed: { files: new Set(["src/other.ts"]) } },
    );
    assert.match(unchangedReport.markdown, /- `coherence\.config\.json` projects is a list of folders relative to the repository top\n/);
  });

  test("a registry top whose changed files git could not list says so", () => {
    const root = repository({ "A.spec.md": SPEC("a") });
    const project = { name: "products/a", model: loadSpecModel(root), runs: [record("ci-7", [{ name: "a door" }])], gaps: { gaps: [] }, baselined: new Set<string>(), changed: { files: new Set<string>() } };
    const report = renderReport([project], "ci-7", { problems: [{ file: "coherence.config.json", message: "lists a folder that is not there" }], changed: { unread: "git diff main failed" } });
    assert.match(report.markdown, /\n> Coherence could not find the files that this pull request changes for the list of projects in `coherence\.config\.json`: git diff main failed\.\n/);
    assert.match(report.markdown, /\n> None of the findings that Coherence could check are in files that this pull request changes\.\n/);
  });

  test("a file name git would quote still matches its finding", async () => {
    const root = repository({ "A.spec.md": SPEC("a") });
    const git = (...args: string[]): string => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: root, encoding: "utf8" }).trim();
    rmSync(join(root, ".git"), { recursive: true });
    git("init", "-q");
    git("add", "-A");
    git("commit", "-q", "-m", "base");
    const base = git("rev-parse", "HEAD");
    writeFileSync(join(root, "Café.spec.md"), "# café\n");
    git("add", "-A");
    git("commit", "-q", "-m", "a second spec");
    appendRun(root, record("ci-7", [{ name: "a door" }]));
    const said = capture(root);
    assert.equal(await ciReportCommand(["--session", "ci-7", "--base", base], said.io, async () => ({ gaps: [] }), {}), 0);
    assert.match(said.out.join("\n"), /- `Café\.spec\.md:1` [^\n]+ · 📍 \*\*changed in this pull request\*\*/);
  });

  test("ci report --base, or a pull request's base branch on GitHub Actions, reads the files changed since that commit", async () => {
    const root = repository({ "A.spec.md": SPEC("a") });
    const git = (...args: string[]): string => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: root, encoding: "utf8" }).trim();
    rmSync(join(root, ".git"), { recursive: true });
    git("init", "-q");
    git("add", "-A");
    git("commit", "-q", "-m", "base");
    const base = git("rev-parse", "HEAD");
    writeFileSync(join(root, "A.spec.md"), UNNAMED);
    git("commit", "-q", "-am", "the change");
    appendRun(root, record("ci-7", []));
    const said = capture(root);
    assert.equal(await ciReportCommand(["--session", "ci-7", "--base", base], said.io, async () => ({ gaps: [] })), 0);
    const marked = /1 finding is in a file that this pull request changes[\s\S]*- `A\.spec\.md:6` [^\n]+ · 📍 \*\*changed in this pull request\*\*/;
    assert.match(said.out.join("\n"), marked);

    git("update-ref", "refs/remotes/origin/main", base);
    const onActions = capture(root);
    assert.equal(await ciReportCommand(["--session", "ci-7"], onActions.io, async () => ({ gaps: [] }), { GITHUB_BASE_REF: "main" }), 0);
    assert.match(onActions.out.join("\n"), marked, "GITHUB_BASE_REF names the base when --base does not");

    const head = git("rev-parse", "HEAD");
    git("update-ref", "refs/remotes/origin/main", head);
    const eventPath = join(root, "event.json");
    writeFileSync(eventPath, JSON.stringify({ pull_request: { base: { sha: base } } }));
    const fixedBase = capture(root);
    assert.equal(await ciReportCommand(["--session", "ci-7"], fixedBase.io, async () => ({ gaps: [] }), { GITHUB_BASE_REF: "main", GITHUB_EVENT_PATH: eventPath }), 0);
    assert.match(fixedBase.out.join("\n"), marked, "the event's fixed base commit is used even once origin/main has moved past it");

    const noEvent = capture(root);
    assert.equal(await ciReportCommand(["--session", "ci-7"], noEvent.io, async () => ({ gaps: [] }), { GITHUB_BASE_REF: "main", GITHUB_EVENT_PATH: join(root, "missing-event.json") }), 0);
    assert.doesNotMatch(noEvent.out.join("\n"), marked, "a missing event file falls back to the moved base branch, which no longer shows the change");

    const elsewhere = capture(root);
    assert.equal(await ciReportCommand(["--session", "ci-7"], elsewhere.io, async () => ({ gaps: [] }), {}), 0);
    assert.match(elsewhere.out.join("\n"), /These findings do not make this check fail\. Some findings can come from files that this pull request does not change\./, "with neither, no files are compared");
  });
});

test("run at a registry's top runs each listed project from its own folder, its records in each", async () => {
  const top = repository({
    "coherence.config.json": JSON.stringify({ projects: ["products/a", "products/b"], language: "typescript" }),
    "products/a/A.spec.md": SPEC("a"),
    "products/a/src/door.ts": "export const ROWS = [1];\nexport function door(): number[] { return ROWS; }\n",
    "products/b/B.spec.md": SPEC("b"),
    "products/b/src/door.ts": "export const ROWS = [1];\nexport function door(): number[] { return ROWS; }\nexport const leak = (): number[] => ROWS;\n",
    "products/stray/Stray.spec.md": SPEC("stray"),
  });
  try {
    const ran = await cli(["run", "--form", "chokepoint", "--no-server", "--session", "ci-1", "--agent", "ci"], { cwd: top });
    assert.equal(ran.status, 1, "b's bypass fails the run at the top");
    assert.match(ran.stdout, /^project products\/a:\n {2}\.\/a door\n[\s\S]*^project products\/b:\n {2}\.\/b door\n {4}chokepoint door protects ROWS: broken/m);
    assert.doesNotMatch(ran.stdout, /stray/, "a folder the registry does not list is not run");
    assert.ok(!existsSync(join(top, ".coherence")), "nothing is recorded at the top");
    for (const leaf of ["products/a", "products/b"]) assert.ok(sessionFiles(join(top, leaf, ".coherence", "runs"), "ci-1").length > 0, `${leaf} keeps its own run`);

    const report = await buildReport(top, "ci-1", async () => ({ gaps: [] }));
    assert.deepEqual(report.unfinished, [], "the report finds each project's run of the session");
    assert.match(report.markdown, /1 broken rule/);
  } finally {
    await stopWarmServers(top);
  }
});
