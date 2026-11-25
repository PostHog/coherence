import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { mirrorsCommand } from "./cli.ts";
import { witnessHolds } from "./holds.ts";
import { MirrorUnable, readMirrors } from "./mirrors.ts";
import type { MirrorReading, Restatement } from "./model.ts";
import { MIRRORS_DIR } from "./recorded.ts";

/* ------------------------------------------------------------ fixtures */

function gitIn(root: string): (...args: string[]) => string {
  return (...args) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args], { cwd: root, encoding: "utf8" });
}

function write(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

/** A repository at one commit, its files as given. */
function repositoryOf(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "coherence-restatements-"));
  const git = gitIn(root);
  git("init", "-q", "-b", "main");
  for (const [path, text] of Object.entries(files)) write(root, path, text);
  git("add", "-A");
  git("commit", "-q", "-m", "the files");
  return root;
}

function commitFiles(root: string, files: Record<string, string>, message: string): string {
  const git = gitIn(root);
  for (const [path, text] of Object.entries(files)) write(root, path, text);
  git("add", "-A");
  git("commit", "-q", "-m", message);
  return git("rev-parse", "HEAD").trim();
}

const valueOf = (list: readonly Restatement[], value: string): Restatement | undefined => list.find((r) => r.value === value);
const filesOf = (r: Restatement | undefined): string[] => (r?.sites ?? []).map((s) => s.file).sort();

function capture(): { io: { out: (t: string) => void; err: (t: string) => void }; text: () => string; reset: () => void } {
  let out = "";
  return { io: { out: (t) => (out += t), err: (t) => (out += t) }, text: () => out, reset: () => (out = "") };
}

/* -------------------------------------------------- excluded by config */

test("a restatement the config's restatements key excludes is counted as excluded by its entry, never lost, and a count it lowers reads as reclassified, not as a fix", async () => {
  const files = {
    "src/core/kinds.ts": 'export const KINDS = ["zqalpha", "zqbeta", "zqgamma"];\n',
    "src/seed/demo.ts": 'export const DEMO_KINDS = ["zqalpha", "zqbeta", "zqgamma"];\n',
    "scripts/a.mjs": 'export const a = "zq-script-value";\nexport const t = "zq-three-sites";\n',
    "scripts/b.mjs": 'export const b = "zq-script-value";\n',
    "src/x.ts": 'export const v = "vocab-zq-shared";\nexport const u = "zq-left-unheld";\nexport const t = "zq-three-sites";\n',
    "src/y.ts": 'export const v = "vocab-zq-shared";\nexport const u = "zq-left-unheld";\nexport const t = "zq-three-sites";\n',
  };
  const root = repositoryOf(files);
  try {
    const before = await readMirrors(root, { history: false });
    const first = before.commit;
    assert.equal(before.restatements.length, 5, before.restatements.map((r) => r.value).join("; "));
    const config = { restatements: { data: ["src/seed/**"], scripts: ["scripts"], values: ["^vocab-"] } };
    commitFiles(root, { "coherence.config.json": JSON.stringify(config) }, "tailor the count");

    const after = await readMirrors(root, { history: false });
    assert.deepEqual(after.restatements.map((r) => r.value).sort(), ["zq-left-unheld", "zq-three-sites"]);
    assert.deepEqual(after.excluded.map((r) => [r.value, r.by?.key, r.by?.entry]).sort(), [["vocab-zq-shared", "values", "^vocab-"], ["zq-script-value", "scripts", "scripts"], ["zqalpha, zqbeta, zqgamma", "data", "src/seed/**"]]);
    assert.equal(after.restatements.length + after.excluded.length, before.restatements.length, "every restatement is still counted: unheld or excluded, never gone");
    assert.match(valueOf(after.excluded, "zq-script-value")!.source, /standalone scripts, which run alone/, "a script's copy is never told to be held by a test");
    assert.doesNotMatch(valueOf(after.excluded, "zq-script-value")!.source, /a test/);
    assert.deepEqual(filesOf(valueOf(after.restatements, "zq-three-sites")), ["src/x.ts", "src/y.ts"], "a script's site is left out, and the rest still restate");
    assert.match(valueOf(after.restatements, "zq-three-sites")!.source, /scripts\/a\.mjs is a standalone script, which runs alone/);

    const c = capture();
    assert.equal(await mirrorsCommand(root, ["--no-history"], c.io), 0);
    assert.match(c.text(), /^Restatements: 2 unheld, 3 excluded by config \(data: 1, scripts: 1, values: 1\), 0 excluded as derived, 0 held, 0 held by a test not yet refuted, 0 declared different/m);
    c.reset();
    assert.equal(await mirrorsCommand(root, ["--no-history", "--json"], c.io), 0);
    const json = JSON.parse(c.text()) as { counts: { unheld: number; excluded: number; excludedBy: { key: string; count: number; entries: { entry: string; count: number }[] }[] }; excluded: Restatement[] };
    assert.deepEqual([json.counts.unheld, json.counts.excluded], [2, 3]);
    assert.deepEqual(json.counts.excludedBy.map((k) => [k.key, k.count, k.entries.map((e) => e.entry)]), [["data", 1, ["src/seed/**"]], ["scripts", 1, ["scripts"]], ["values", 1, ["^vocab-"]]]);
    c.reset();
    assert.equal(await mirrorsCommand(root, ["--no-history", "--restatements", "--base", first], c.io), 0);
    assert.match(c.text(), /unheld 5 → 2; the code removed 0; reclassified 3 \(excluded by config or declared different, not fixed\)/, "a count config lowered is reclassified, and the code is credited with nothing");

    commitFiles(root, { "coherence.config.json": JSON.stringify({ restatements: { seed: ["x"] } }) }, "an unknown key");
    await assert.rejects(readMirrors(root, { history: false }), (e: unknown) => e instanceof MirrorUnable && /restatements has no key seed/.test(e.message), "a key the reading does not know makes no reading");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/* ---------------------------------------------------------------- JSX */

test("JSX modules are read: a list in a .tsx file and its copy in a .ts file are one restatement, and .tsx is never counted unread", async () => {
  const root = repositoryOf({
    "web/src/Menu.tsx": 'export const MENU_ITEMS = ["zqopen", "zqsave", "zqclose"];\nexport const Menu = () => <ul>{MENU_ITEMS.map((m) => <li key={m}>{m}</li>)}</ul>;\n',
    "src/menu.ts": 'export const MENU = ["zqopen", "zqsave", "zqclose"];\n',
  });
  try {
    const reading = await readMirrors(root, { history: false });
    assert.equal(reading.read, 2, "both modules are parsed");
    assert.deepEqual(reading.unread, {});
    assert.deepEqual(filesOf(valueOf(reading.restatements, "zqopen, zqsave, zqclose")), ["src/menu.ts", "web/src/Menu.tsx"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/* -------------------------------------------------------- records */

test("an object's keys are no list when one type holds them: both objects of one named type, a shape they differ from only in optional fields, or records read only by property access", async () => {
  const root = repositoryOf({
    "src/cmd/types.ts": "export interface Command { zqname: string; zqsummary: string; zqoptions: string[]; zqhandler: () => number }\nexport interface Feature { zqfname: string; zqpatterns: string[]; zqhooks?: object; zqroutes?: string[] }\n",
    "src/cmd/one.ts": 'import type { Command } from "./types.ts";\nexport const oneCommand: Command = { zqname: "one", zqsummary: "s", zqoptions: [], zqhandler: () => 1 };\n',
    "src/cmd/two.ts": 'import type { Command } from "./types.ts";\nexport const twoCommand = { zqname: "two", zqsummary: "t", zqoptions: [], zqhandler: () => 2 } satisfies Command;\n',
    "src/feat/pages.ts": 'import type { Feature } from "../cmd/types.ts";\nexport const pages: Feature = { zqfname: "pages", zqpatterns: [], zqhooks: {} };\n',
    "src/feat/docs.ts": 'export const docs = { zqfname: "docs", zqpatterns: [], zqhooks: {}, zqroutes: [] };\n',
    "src/conf/a.ts": "const conf = { zqcolor: 1, zqshade: 2, zqtone: 3 };\nexport const shade = conf.zqshade + conf.zqtone;\n",
    "src/conf/b.ts": "const conf = { zqcolor: 1, zqshade: 2, zqtone: 3 };\nexport const color = conf.zqcolor;\n",
    "src/set/a.ts": "const flags = { zqfast: 1, zqsafe: 2, zqsure: 3 };\nexport const names = Object.keys(flags);\n",
    "src/set/b.ts": "const flags = { zqfast: 1, zqsafe: 2, zqsure: 3 };\nexport const known = (k: string): boolean => k in flags;\n",
  });
  try {
    const reading = await readMirrors(root, { history: false });
    const keys = reading.restatements.filter((r) => r.members?.some((m) => m.startsWith("zq")));
    assert.deepEqual(keys.map((r) => r.value), ["zqfast, zqsafe, zqsure"], "only the objects used as sets restate their keys");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------- tests */

test("the project's test files are tests by the rule every reading shares: the config's test folders, .spec and .e2e-spec names, and a copy a test writes is where it is held, never a site", async () => {
  const root = repositoryOf({
    "coherence.config.json": JSON.stringify({ testDirs: ["checks"] }),
    "src/a.ts": 'export const ZQ_ONLY = "zq-only-in-tests";\nexport const ZQ_TWO = "zq-in-two-files";\n',
    "src/c.ts": 'export const ZQ_TWO = "zq-in-two-files";\n',
    "checks/helper.ts": 'export const v = "zq-only-in-tests";\n',
    "src/b.spec.ts": 'import { ZQ_TWO } from "./a.ts";\nimport { ZQ_TWO as C_TWO } from "./c.ts";\nexport const v = "zq-only-in-tests";\nexport const same = ZQ_TWO === C_TWO;\n',
    "e2e/flow.e2e-spec.ts": 'export const v = "zq-only-in-tests";\n',
    "src/__tests__/d.ts": 'export const v = "zq-only-in-tests";\n',
  });
  try {
    const reading = await readMirrors(root, { history: false });
    assert.equal(valueOf(reading.restatements, "zq-only-in-tests"), undefined, "a value one production file writes and only tests repeat is no restatement");
    assert.equal(valueOf(reading.restatements, "zq-in-two-files"), undefined);
    assert.equal(valueOf(reading.unrefuted, "zq-in-two-files")?.hold?.test, "src/b.spec.ts", "the .spec test that names it is where it would be held");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------- predicates */

test("one rule however it is written: a regular expression, one built from a template, a chain of string tests and a set accepting the same strings are one rule, a strict part of another rule is a derivation, and a pattern with no words never groups", async () => {
  const root = repositoryOf({
    "src/a/shards.ts": "export const SHARD = /\\.[0-9a-f]{8}\\.(zqjsonl|zqjsonseq)$/;\n",
    "src/b/status.ts": "export const shardOf = (s: string): RegExp => new RegExp(`^${s}\\\\.[0-9a-f]{8}\\\\.(zqjsonl|zqjsonseq)$`);\n",
    "src/c/ends.ts": 'export const isLog = (n: string): boolean => n.endsWith(".zqlog") || n.endsWith(".zqlogseq");\n',
    "src/d/logs.ts": "export const LOG = /\\.(zqlog|zqlogseq)$/;\n",
    "src/e/wide.ts": "export const WIDE = /\\.(zqalpha|zqbeta|zqgamma)$/;\n",
    "src/f/narrow.ts": "export const NARROW = /\\.(zqalpha|zqbeta)$/;\n",
    "src/g/starts.ts": 'export const STARTS = new Set(["ZqSessionStart", "ZqSubagentStart"]);\n',
    "src/h/hook.ts": 'export const quiet = (e: string): boolean => e === "ZqSessionStart" || e === "ZqSubagentStart";\n',
    "src/i/id.ts": "export const ID = /^[0-9a-f]{8}$/;\n",
    "src/j/token.ts": "export const TOKEN = /^[0-9a-f]{8}$/;\n",
    "src/k/exts.ts": "export const EXTS = /\\.(zqscript|zqmodule)$/;\n",
    "src/l/wider.ts": "export const WIDER = /\\.(zqscript|zqscriptx|zqmodule)$/;\n",
  });
  try {
    const reading = await readMirrors(root, { history: false });
    const rules = reading.restatements.filter((r) => r.kind === "rule");
    assert.ok(!rules.some((r) => filesOf(r).includes("src/k/exts.ts")), "two patterns anchored alike are compared as written: one that also accepts .zqscriptx is not the same rule, though each one's ends, dropped, find the other's strings");
    assert.deepEqual(rules.map(filesOf).sort(), [["src/a/shards.ts", "src/b/status.ts"], ["src/c/ends.ts", "src/d/logs.ts"], ["src/g/starts.ts", "src/h/hook.ts"]], "the template, the chain and the set each join their rule");
    const derivation = reading.restatements.find((r) => r.kind === "derivation");
    assert.deepEqual(filesOf(derivation), ["src/e/wide.ts", "src/f/narrow.ts"]);
    assert.equal(derivation?.sites[1]?.file, "src/f/narrow.ts", "the part is named after the whole");
    assert.deepEqual(reading.restatements.filter((r) => r.kind === "derivation").map(filesOf).sort(), [["src/e/wide.ts", "src/f/narrow.ts"], ["src/k/exts.ts", "src/l/wider.ts"]].map((f) => [...f].sort()).sort(), "and nothing else derives");
    assert.ok(!reading.restatements.some((r) => filesOf(r).includes("src/i/id.ts")), "a pattern with no words of its own is the same text with different referents, and never groups");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/* ---------------------------------------------------------- parsers */

test("two functions that read text into one type checking the same fields are one parser written twice, its source the exported one, and a private one is told to export it first", async () => {
  const guard = (fn: string, exported: boolean, type: string): string =>
    `${exported ? "export " : ""}function ${fn}(text: string): ${type}[] {\n  return text.split("\\n").flatMap((line) => {\n    try {\n      const v = JSON.parse(line) as Partial<${type}>;\n      return typeof v.zqat === "string" && typeof v.zqevent === "string" && typeof v.zqms === "number" ? [v as ${type}] : [];\n    } catch {\n      return [];\n    }\n  });\n}\n`;
  const root = repositoryOf({
    "src/a/times.ts": `export interface ZqTime { zqat: string; zqevent: string; zqms: number }\n${guard("parseZqTimes", true, "ZqTime")}`,
    "src/b/reader.ts": `import type { ZqTime } from "../a/times.ts";\n${guard("readZqTimes", false, "ZqTime")}`,
    "src/c/x.ts": `export interface QqTime { zqat: string; zqevent: string; zqms: number }\n${guard("parseQq", false, "QqTime")}`,
    "src/d/y.ts": `import type { QqTime } from "../c/x.ts";\n${guard("readQq", false, "QqTime")}`,
  });
  try {
    const reading = await readMirrors(root, { history: false });
    const parsers = reading.restatements.filter((r) => r.kind === "parser");
    assert.equal(parsers.length, 2, parsers.map((p) => p.value).join("; "));
    const zq = parsers.find((p) => p.value.startsWith("ZqTime"))!;
    assert.equal(zq.sites[0]?.name, "parseZqTimes", "the exported one is the source");
    assert.match(zq.source, /^one module, src\/a\/times\.ts, imported by the rest$/);
    const qq = parsers.find((p) => p.value.startsWith("QqTime"))!;
    assert.match(qq.source, /parseQq is not exported: export it in src\/c\/x\.ts first, then import \{ parseQq \} from it/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/* ---------------------------------------------------------- subsets */

test("a list that is a strict part of another, typed as plain strings, is a subset nothing holds, named with the member the whole lacks, and typed against the whole's members it is held", async () => {
  const root = repositoryOf({
    "src/h/events.ts": 'export const EVENTS = ["ZqStart", "ZqPre", "ZqTool", "ZqPost", "ZqStop"] as const;\n',
    "src/i/flat.ts": 'const FLAT: ReadonlySet<string> = new Set(["ZqStart", "ZqPre", "ZqPostInv", "ZqStop"]);\nexport const flat = (e: string): boolean => FLAT.has(e);\n',
    "src/j/typed.ts": 'import type { EVENTS } from "../h/events.ts";\nconst TYPED: ReadonlySet<(typeof EVENTS)[number]> = new Set(["ZqStart", "ZqTool", "ZqStop"]);\nexport const typed = TYPED;\n',
  });
  try {
    const reading = await readMirrors(root, { history: false });
    const subsets = reading.restatements.filter((r) => r.kind === "subset");
    assert.equal(subsets.length, 1, subsets.map((r) => filesOf(r).join(" ")).join("; "));
    assert.deepEqual(filesOf(subsets[0]), ["src/h/events.ts", "src/i/flat.ts"]);
    assert.deepEqual(subsets[0]!.odd, { member: "ZqPostInv", lacks: "src/h/events.ts:1" });
    assert.match(subsets[0]!.source, /^type FLAT against EVENTS's members \(src\/h\/events\.ts:1\), so the compiler holds it to them; it holds ZqPostInv, which EVENTS lacks/);
    assert.ok(!reading.restatements.some((r) => filesOf(r).includes("src/j/typed.ts")), "the part typed against the whole's members is held by the compiler");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/* ----------------------------------------------------------- witness */

test("a test holds a copy only once it went red with the copy changed: the witness pass changes each copy a test names in a scratch worktree, a red test holds it, a green one does not, and the verdict is kept by the blobs it was earned over", async () => {
  const root = repositoryOf({
    "coherence.config.json": JSON.stringify({ test: "node --disable-warning=ExperimentalWarning --test --test-name-pattern={filter} 'src/**/*.test.ts'" }),
    "src/a/sizes.ts": 'export const SIZES = ["zqsmall", "zqmedium", "zqlarge"];\n',
    "src/b/sizes.ts": 'export const SIZE_COPY = ["zqsmall", "zqmedium", "zqlarge"];\n',
    "src/b/sizes.test.ts": 'import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { SIZES } from "../a/sizes.ts";\nimport { SIZE_COPY } from "./sizes.ts";\ntest("the copy equals the home", () => {\n  assert.deepEqual(SIZE_COPY, SIZES);\n});\n',
    "src/a/colors.ts": 'export const COLORS = ["zqred", "zqgreen", "zqblue"];\n',
    "src/b/colors.ts": 'export const PAINTS = ["zqred", "zqgreen", "zqblue"];\n',
    "src/b/colors.test.ts": 'import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { PAINTS } from "./colors.ts";\ntest("there are paints", () => {\n  assert.ok(PAINTS.length > 0);\n});\n',
  });
  try {
    const before = await readMirrors(root, { history: false });
    assert.equal(before.unrefuted.length, 2, "both copies are held by a test not yet refuted");
    // The fixture's own runner: NODE_TEST_CONTEXT would make it think it runs inside this one, and report nothing by its exit.
    const context = process.env["NODE_TEST_CONTEXT"];
    delete process.env["NODE_TEST_CONTEXT"];
    let report;
    try {
      report = await witnessHolds(root, before);
    } finally {
      if (context !== undefined) process.env["NODE_TEST_CONTEXT"] = context;
    }
    assert.deepEqual(report.witnessed.map((w) => [w.hold.test, w.verdict]).sort(), [["src/b/colors.test.ts", "green"], ["src/b/sizes.test.ts", "red"]], report.skipped.map((s) => s.why).join("; "));

    const after = await readMirrors(root, { history: false });
    assert.equal(after.unrefuted.length, 0);
    assert.equal(after.held, 1, "the red test holds its copy");
    const unheld = valueOf(after.restatements, "zqred, zqgreen, zqblue");
    assert.match(unheld?.source ?? "", /src\/b\/colors\.test\.ts names it but stayed green when src\/b\/colors\.ts:1 changed, so it holds nothing/);

    // A verdict is earned again when the test changes: its blob is part of the key.
    commitFiles(root, { "src/b/sizes.test.ts": 'import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { SIZE_COPY } from "./sizes.ts";\ntest("the copy equals the home", () => {\n  assert.ok(SIZE_COPY.length > 0);\n});\n' }, "weaken the test");
    const weakened = await readMirrors(root, { history: false });
    assert.equal(weakened.unrefuted.length, 1, "a changed test is not yet refuted again");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------- rules */

test("a count is compared with a base under one set of rules: the reading records its rules with its counts, --base reads the base under the same rules, says what the code changed apart from what the rules changed, and names what was born since", async () => {
  const root = repositoryOf({
    "src/a.ts": 'export const A = "zq-fixed-later";\nexport const B = "zq-stays";\n',
    "src/b.ts": 'export const A = "zq-fixed-later";\nexport const B = "zq-stays";\n',
  });
  try {
    const base = await readMirrors(root, { history: false });
    assert.match(base.rules, /^[0-9a-f]{12}$/, "the rules are a digest of the modules that apply them");
    commitFiles(root, { "src/b.ts": 'import { A } from "./a.ts";\nexport const B = "zq-stays";\nexport const C = A;\nexport const D = "zq-born-later";\n', "src/c.ts": 'export const D = "zq-born-later";\n' }, "fix one, copy another");
    // The base as a reading under other rules kept it: two more than these rules count.
    write(root, join(MIRRORS_DIR, "counts.json"), JSON.stringify({ [base.commit]: [{ rules: "000000000000", at: "2026-11-01T00:00:00Z", counts: { unheld: 4, held: 0, unrefuted: 0, excluded: 0, excludedBy: [], declared: 0 } }] }));
    const c = capture();
    assert.equal(await mirrorsCommand(root, ["--no-history", "--base", base.commit], c.io), 0);
    const text = c.text();
    assert.match(text, new RegExp(`Since ${base.commit.slice(0, 7)}, both read under rules ${base.rules}: unheld 2 → 2; the code removed 0; reclassified 0`));
    assert.match(text, /The rules changed the base's count by -2: rules 000000000000 read it as 4 unheld, rules [0-9a-f]{12} as 2\. That change is the detector's, not the code's\./);
    assert.match(text, /Born since the base \(1\):\n1\. constant {2}the value "zq-born-later"/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------- planted */

/**
 * The planted copies every version of the detector must still find, one per
 * form a copy takes: reordered, one member added, one member dropped, a
 * regular expression rewritten as a chain of string tests, and a helper
 * parser inlined into another function. A later detector that finds fewer
 * lowers the count by missing things, and this test goes red.
 */
const PLANTED: Record<string, string> = {
  "src/core/phases.ts": 'export const PHASES = ["ZqGather", "ZqWeigh", "ZqSettle", "ZqArchive"];\nexport const isZqLog = (name: string): boolean => /\\.(zqjsonl|zqjsonseq)$/.test(name);\nexport interface ZqTick { zqat: string; zqcount: number }\nexport function parseZqTicks(text: string): ZqTick[] {\n  return text.split("\\n").flatMap((line) => {\n    try {\n      const t = JSON.parse(line) as Partial<ZqTick>;\n      return typeof t.zqat === "string" && typeof t.zqcount === "number" ? [t as ZqTick] : [];\n    } catch {\n      return [];\n    }\n  });\n}\n',
  "src/main.ts": 'import { PHASES, isZqLog, parseZqTicks } from "./core/phases.ts";\nexport const all = [PHASES, isZqLog, parseZqTicks];\n',
  "src/ui/reordered.ts": 'export const SHOWN = ["ZqSettle", "ZqArchive", "ZqGather", "ZqWeigh"];\n',
  "src/ui/added.ts": 'export const MORE = ["ZqGather", "ZqWeigh", "ZqSettle", "ZqArchive", "ZqPurge"];\n',
  "src/ui/dropped.ts": 'export const FEWER = ["ZqGather", "ZqWeigh", "ZqSettle"];\n',
  "src/ui/chain.ts": 'export const isLogFile = (name: string): boolean => name.endsWith(".zqjsonl") || name.endsWith(".zqjsonseq");\n',
  "src/ui/inlined.ts": 'import { readFileSync } from "node:fs";\nimport type { ZqTick } from "../core/phases.ts";\nexport function loadTicks(path: string): ZqTick[] {\n  return readFileSync(path, "utf8").split("\\n").flatMap((line) => {\n    try {\n      const t = JSON.parse(line) as Partial<ZqTick>;\n      return typeof t.zqat === "string" && typeof t.zqcount === "number" ? [t as ZqTick] : [];\n    } catch {\n      return [];\n    }\n  });\n}\n',
};

/** Each planted copy: the file it is in, and the kind it must be found as. */
const PLANTED_COPIES: readonly [string, Restatement["kind"]][] = [
  ["src/ui/reordered.ts", "copy"],
  ["src/ui/added.ts", "drift"],
  ["src/ui/dropped.ts", "drift"],
  ["src/ui/chain.ts", "rule"],
  ["src/ui/inlined.ts", "parser"],
];

test("every planted copy is found: reordered, one member added, one dropped, a regular expression rewritten as string tests, and a helper inlined, each as a restatement beside its home", async () => {
  const root = repositoryOf(PLANTED);
  try {
    const reading: MirrorReading = await readMirrors(root, { history: false });
    const found = PLANTED_COPIES.filter(([file, kind]) => reading.restatements.some((r) => r.kind === kind && filesOf(r).includes(file) && filesOf(r).includes("src/core/phases.ts")));
    assert.deepEqual(found, PLANTED_COPIES, reading.restatements.map((r) => `${r.kind} ${filesOf(r).join(" ")}`).join("; "));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------- declared */

test("a comment at a copy that names its home and how its behavior differs declares it different on purpose, counted apart; a copy written the same cannot be declared different", async () => {
  const root = repositoryOf({
    "src/a/kinds.ts": 'export const KINDS = ["zqalpha", "zqbeta", "zqgamma", "zqdelta"];\nexport const SAME = ["zqone", "zqtwo", "zqthree"];\n',
    "src/b/menu.ts": '// differs on purpose from src/a/kinds.ts:KINDS: the menu never shows zqdelta, which is internal\nexport const MENU_KINDS = ["zqalpha", "zqbeta", "zqgamma"];\n// differs on purpose from src/a/kinds.ts:SAME: none\nexport const SAME_COPY = ["zqone", "zqtwo", "zqthree"];\n',
  });
  try {
    const reading = await readMirrors(root, { history: false });
    assert.deepEqual(reading.declared.map((r) => [r.kind, r.declared]), [["drift", "the menu never shows zqdelta, which is internal"]]);
    const same = valueOf(reading.restatements, "zqone, zqtwo, zqthree");
    assert.match(same?.source ?? "", /a copy written the same cannot differ on purpose: import it, or hold it by a test/);
    const c = capture();
    assert.equal(await mirrorsCommand(root, ["--no-history"], c.io), 0);
    assert.match(c.text(), /1 unheld, 0 excluded by config, 0 excluded as derived, 0 held, 0 held by a test not yet refuted, 1 declared different/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/* -------------------------------------------------- derived classes */

test("a copy in a generated file, a numbered migration or an example app is left out of a restatement's sites and counted as excluded under its class, never lost", async () => {
  const root = repositoryOf({
    "server/src/enum.ts": 'export const PERMISSIONS = ["zqalbum.create", "zqalbum.delete", "zqalbum.read"];\nexport const ZQ_KEY = "zq-shared-key";\n',
    "open-api/client/fetch-client.ts": '/**\n * Auto-generated by the OpenAPI generator. DO NOT EDIT.\n */\nexport const PERMISSION = ["zqalbum.create", "zqalbum.delete", "zqalbum.read"];\n',
    "web/routeTree.gen.ts": 'export const KEY = "zq-shared-key";\n',
    "server/src/migrations/1752267649968-Rename.ts": 'export const TABLES = ["zqasset", "zqasset_file", "zquser"];\n',
    "server/src/tables.ts": 'export const TABLES = ["zqasset", "zqasset_file", "zquser"];\n',
    "examples/example-node/package.json": '{ "name": "example-node" }\n',
    "examples/example-node/index.ts": 'export const FLAGS = ["zqflag-one", "zqflag-two", "zqflag-three"];\n',
    "playground/demo.ts": 'export const MORE = ["zqflag-one", "zqflag-two", "zqflag-three"];\n',
    "src/flags.ts": 'export const FLAGS = ["zqflag-one", "zqflag-two", "zqflag-three"];\n',
  });
  try {
    const reading = await readMirrors(root, { history: false });
    const classes = reading.excluded.map((r) => r.by?.key).sort();
    assert.deepEqual(classes, ["examples", "generated", "generated", "migrations"], reading.excluded.map((r) => `${r.value} ${r.by?.key}`).join("; "));
    assert.match(reading.excluded.find((r) => r.by?.key === "generated")!.source, /held by its generator/);
    assert.deepEqual(filesOf(valueOf(reading.restatements, "zqflag-one, zqflag-two, zqflag-three")), ["playground/demo.ts", "src/flags.ts"], "a playground with no package.json of its own is code, and stays a site");
    const c = capture();
    assert.equal(await mirrorsCommand(root, ["--no-history"], c.io), 0);
    assert.match(c.text(), /4 excluded as derived \(generated: 2, migrations: 1, examples: 1\)/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------- families */

test("one family counted once: a list at any number of sites, the rule written over its members and a subset of it in the same files are listed under the strongest, never counted again", async () => {
  const root = repositoryOf({
    "plugin/source.ts": 'export const KEYWORDS = ["zqfunc", "zqstruct", "zqclass", "zqactor", "zqenum"];\nexport const isDecl = (w: string): boolean => /\\b(?:zqfunc|zqstruct|zqclass|zqactor|zqenum)\\b/.test(w);\n',
    "plugin/entrances.ts": 'export const DECLS = ["zqfunc", "zqstruct", "zqclass", "zqactor"];\nexport const isDef = (w: string): boolean => /\\b(?:zqfunc|zqstruct|zqclass|zqactor|zqenum)\\b/.test(w);\n',
    "src/other.ts": 'export const OTHER = ["zqalpha", "zqbeta", "zqgamma"];\n',
    "src/again.ts": 'export const AGAIN = ["zqalpha", "zqbeta", "zqgamma"];\n',
    "src/journal/store.ts": 'export const STDIO = ["zqpipe", "zqignore", "zqinherit"];\n',
    "src/a/one.ts": 'export const A = ["zqpipe", "zqignore", "zqinherit"];\n',
    "src/b/two.ts": 'export const B = ["zqpipe", "zqignore", "zqinherit"];\n',
    "src/c/three.ts": 'export const C = ["zqpipe", "zqignore", "zqinherit"];\n',
  });
  try {
    const reading = await readMirrors(root, { history: false });
    const family = reading.restatements.filter((r) => filesOf(r).includes("plugin/source.ts"));
    assert.equal(family.length, 1, family.map((r) => `${r.kind} ${r.value}`).join("; "));
    assert.ok((family[0]!.forms ?? []).length >= 1, "its other forms are listed under it");
    assert.ok(valueOf(reading.restatements, "zqalpha, zqbeta, zqgamma") !== undefined, "another family in other files stays its own");
    const stdio = reading.restatements.filter((r) => r.members?.includes("zqpipe"));
    assert.equal(stdio.length, 1, "one list at four sites is one family on its sites, not three pairs");
    assert.deepEqual(filesOf(stdio[0]), ["src/a/one.ts", "src/b/two.ts", "src/c/three.ts", "src/journal/store.ts"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------- vocabulary */

test("what another party names is not the project's fact: package names its package.json files name, CSS keywords and locale tags are left out, a list a pattern embeds among words of its own pairs only with the same words, and build configs rank last", async () => {
  const root = repositoryOf({
    "package.json": '{ "name": "zq-root", "dependencies": { "zq-left-pad": "1.0.0" } }\n',
    "src/stdio-a.ts": 'export const STDIO = ["no-store", "no-cache", "force-cache"];\n',
    "src/stdio-b.ts": 'export const STDIO = ["no-store", "no-cache", "force-cache"];\n',
    "src/a.ts": 'export const PKG = "zq-left-pad";\nexport const WRAP = "break-word";\nexport const LOCALE = "en-US";\nexport const ROUTE = /(^|\\/)zqapp\\/(.+\\/)?zqroute\\.(zqts|zqtsx|zqjs)$/;\nexport const KEPT = "zq-kept-value";\n',
    "src/b.ts": 'export const PKG = "zq-left-pad";\nexport const WRAP = "break-word";\nexport const LOCALE = "en-US";\nexport const EXTENSIONS = ["zqts", "zqtsx", "zqjs", "zqmjs"];\nexport const KEPT = "zq-kept-value";\n',
    "pkg-a/rollup.config.mjs": 'export default { extensions: ["zqone", "zqtwo", "zqthree"] };\nexport const ext = ["zqone", "zqtwo", "zqthree"];\n',
    "pkg-b/rollup.config.mjs": 'export const ext = ["zqone", "zqtwo", "zqthree"];\n',
  });
  try {
    const reading = await readMirrors(root, { history: false });
    for (const left of ["zq-left-pad", "break-word", "en-US"]) assert.equal(valueOf(reading.restatements, left), undefined, `${left} is another party's`);
    assert.deepEqual(reading.excluded.filter((r) => r.by?.key === "owned").map((r) => [r.value, r.by?.entry]).sort(), [["break-word", "CSS"], ["en-US", "a locale tag"], ["no-store, no-cache, force-cache", "the platform's typings"], ["zq-left-pad", "the npm registry"]], "each is counted as excluded, by its owner");
    assert.ok(!reading.restatements.some((r) => r.members?.includes("zqtsx")), "the route pattern's extensions are the route's, not the list's");
    const last = reading.restatements[reading.restatements.length - 1];
    assert.equal(last?.buildConfig, true, reading.restatements.map((r) => r.value).join("; "));
    assert.equal(reading.restatements[0]?.value, "zq-kept-value", "the project's own value ranks above the build configs'");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

