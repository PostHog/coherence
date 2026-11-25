import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { mirrorsCommand } from "./cli.ts";
import { readMirrors } from "./mirrors.ts";
import type { Finding, Group, MirrorReading, Restatement, SetRef } from "./model.ts";
import { alarmsOf, isAlarm, proposalsOf, readingText, surfaced } from "./policy.ts";
import { Counts, Rarity } from "./rarity.ts";
import { NO_EXCLUSIONS, sourceOf, type RestatementInput } from "./restatements.ts";
import { lastMirrors, MIRRORS_DIR, ORIENT_LINE_LIMIT, orientMirrorText, recordMirrors } from "./recorded.ts";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/* ------------------------------------------------------------ fixtures */

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "coherence-mirrors-"));
}

function write(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

function gitIn(root: string): (...args: string[]) => string {
  return (...args) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args], { cwd: root, encoding: "utf8" });
}

/**
 * A project whose list of files (SOURCES in src/app/build.ts) equals the
 * import closure of its own files in the first commit; the second commit
 * makes a.ts import a new c.ts and leaves the list alone.
 */
function driftedRepository(): { root: string; first: string; second: string } {
  const root = scratch();
  const git = gitIn(root);
  git("init", "-q", "-b", "main");
  write(root, "src/app/build.ts", 'export const SOURCES = ["a.ts", "b.ts"];\n');
  write(root, "src/app/a.ts", 'import { b } from "./b.ts";\nexport const a = b + 1;\n');
  write(root, "src/app/b.ts", "export const b = 1;\n");
  git("add", "-A");
  git("commit", "-q", "-m", "the list and its files");
  const first = git("rev-parse", "HEAD").trim();
  write(root, "src/app/c.ts", "export const c = 2;\n");
  write(root, "src/app/a.ts", 'import { b } from "./b.ts";\nimport { c } from "./c.ts";\nexport const a = b + c;\n');
  git("add", "-A");
  git("commit", "-q", "-m", "a reads c");
  const second = git("rev-parse", "HEAD").trim();
  return { root, first, second };
}

function closureFinding(reading: MirrorReading): Finding | undefined {
  return reading.groups.flatMap((g) => g.findings).find((f) => f.a.name === "SOURCES" && f.b.form === "closure");
}

const ref = (file: string, name: string, members: string[], extra: Partial<SetRef> = {}): SetRef => ({ file, line: 1, name, form: "array", checked: false, members, ...extra });

function finding(a: SetRef, b: SetRef, extra: Partial<Finding> = {}): Finding {
  const sb = new Set(b.members);
  const sa = new Set(a.members);
  return {
    a,
    b,
    verdict: "duplicate",
    shared: a.members.filter((m) => sb.has(m)),
    onlyA: a.members.filter((m) => !sb.has(m)),
    onlyB: b.members.filter((m) => !sa.has(m)),
    jaccard: 1,
    containment: 1,
    score: 30,
    overlapScore: 30,
    historyScore: 0,
    copies: [],
    ...extra,
  };
}

const group = (rank: number, score: number, findings: Finding[]): Group => ({ rank, score, overlapScore: score, historyScore: 0, findings });

function readingOf(groups: Group[]): MirrorReading {
  return { rev: "HEAD", commit: "0123456789abcdef0123456789abcdef01234567", ms: 1, phases: {}, sets: 10, read: 10, unread: {}, groups, restatements: [], held: 0, excluded: [], unrefuted: [], declared: [], rules: "test", holds: [] };
}

/* ---------------------------------------------------- the invariants */

test("the mirror reading reads git objects at its revision: an uncommitted edit leaves it unchanged, and the commit before reads as it was", async () => {
  const { root, first } = driftedRepository();
  try {
    const before = await readMirrors(root);
    const drifted = closureFinding(before);
    assert.ok(drifted !== undefined, "the list meets the closure of its own files");
    assert.equal(drifted.verdict, "drifted");
    assert.deepEqual(drifted.onlyB, ["c.ts"]);

    // Repair the list in the working tree, and stage it, without committing: the reading at HEAD is unchanged.
    write(root, "src/app/build.ts", 'export const SOURCES = ["a.ts", "b.ts", "c.ts"];\n');
    gitIn(root)("add", "src/app/build.ts");
    const during = await readMirrors(root);
    assert.deepEqual(closureFinding(during), drifted, "an edit not yet committed changes nothing the reading says");
    assert.equal(during.commit, before.commit);

    const earlier = await readMirrors(root, { rev: first });
    assert.equal(earlier.commit, first);
    const latent = closureFinding(earlier);
    assert.ok(latent !== undefined);
    assert.equal(latent.verdict, "latent", "the commit before reads as it was committed: the list equal to its closure");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/** The relative modules a source imports at run time, statically: type-only imports erased, dynamic imports left out. */
function staticImports(file: string): string[] {
  const stripped = stripTypeScriptTypes(readFileSync(file, "utf8"));
  const out: string[] = [];
  for (const m of stripped.matchAll(/^(?:import|export)\s[^;]*?\sfrom\s+["']([^"']+)["']|^import\s+["']([^"']+)["']/gm)) out.push((m[1] ?? m[2])!);
  return out;
}

function runtimeClosure(entries: readonly string[]): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const visit = (file: string): void => {
    if (files.has(file)) return;
    files.add(file);
    for (const spec of staticImports(file)) {
      if (spec.startsWith(".")) visit(resolve(dirname(file), spec));
      else packages.add(spec);
    }
  };
  for (const entry of entries) visit(join(SRC, entry));
  return { files, packages };
}

test("no hook loads the mirror reading: the hooks' import closure never reaches it or the compiler, and orient reads only the kept reading, labeled with its commit", async () => {
  const { files, packages } = runtimeClosure(["cli.ts", "lifecycle/hook.ts"]);
  const reached = [...files].map((f) => relative(SRC, f));
  assert.ok(reached.includes("readings/mirrors/recorded.ts"), "the hooks do load the kept reading's module, so the closure is the real one");
  assert.ok(!reached.includes("readings/mirrors/mirrors.ts"), "the reading itself is never among the modules a hook loads");
  assert.ok(!reached.includes("readings/mirrors/cli.ts"), "query mirrors is loaded on demand");
  assert.ok(!packages.has("typescript"), "nor is the compiler's parser");

  const root = scratch();
  try {
    assert.equal(orientMirrorText(lastMirrors(root), "coherence"), "", "with no reading kept, orient says nothing and takes none");
    assert.equal(existsSync(join(root, MIRRORS_DIR)), false);
    const strong = group(1, 40, [finding(ref("src/a.ts", "KINDS", ["x", "y", "z"]), ref("src/b.ts", "COPY", ["x", "y", "z"]))]);
    recordMirrors(root, readingOf([strong]), () => new Date("2026-10-12T09:30:00Z"));
    const text = orientMirrorText(lastMirrors(root), "coherence");
    assert.match(text, /the mirror reading at 0123456, 2026-10-12 09:30 UTC/, "labeled with the commit and the time it read");
    assert.match(text, /KINDS \(src\/a\.ts:1\)/);
    assert.match(text, /coherence query mirrors/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("only cross-file groups sharing three or more names and scoring 20 or more are surfaced, and the rest are listed only on request", () => {
  const three = ["alpha", "beta", "gamma"];
  const sameFile = group(1, 50, [finding(ref("src/a.ts", "ONE", three), ref("src/a.ts", "TWO", three))]);
  const twoNames = group(2, 50, [finding(ref("src/a.ts", "PAIR", ["alpha", "beta"]), ref("src/b.ts", "PAIR", ["alpha", "beta"]))]);
  const weak = group(3, 19.9, [finding(ref("src/a.ts", "WEAK", three), ref("src/b.ts", "WEAK", three))]);
  const strong = group(4, 20, [finding(ref("src/a.ts", "STRONG", three), ref("src/b.ts", "STRONG", three))]);
  assert.deepEqual([sameFile, twoNames, weak, strong].map(surfaced), [false, false, false, true]);

  const reading = readingOf([sameFile, twoNames, weak, strong]);
  const shown = readingText(reading);
  assert.match(shown, /STRONG/);
  assert.doesNotMatch(shown, /ONE|PAIR|WEAK/, "by default only the surfaced groups");
  assert.match(shown, /never a spec problem and never block/);
  const all = readingText(reading, { all: true });
  for (const name of ["ONE", "PAIR", "WEAK", "STRONG"]) assert.match(all, new RegExp(name), "every group on request");

  const root = scratch();
  try {
    const kept = recordMirrors(root, reading);
    assert.deepEqual(kept.surfaced.map((g) => g.rank), [4], "the kept reading, which orient reads, holds the surfaced groups alone");
    assert.equal(kept.groups, 4);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a list of files drifted from its own import closure is an alarm naming the missing file and the commit that grew the closure alone", async () => {
  const { root, first, second } = driftedRepository();
  try {
    const latent = closureFinding(await readMirrors(root, { rev: first }));
    assert.ok(latent !== undefined);
    assert.equal(isAlarm(latent), false, "a list equal to its closure is latent, no alarm");

    const reading = await readMirrors(root);
    const alarms = alarmsOf(reading.groups);
    assert.equal(alarms.length, 1);
    const alarm = alarms[0]!;
    assert.equal(alarm.a.name, "SOURCES");
    assert.equal(alarm.b.list, "src/app/build.ts:1");
    assert.deepEqual(alarm.history?.missed.map((m) => [m.commit, m.member, m.side]), [[second.slice(0, 7), "c.ts", "b"]]);

    const recorded = recordMirrors(root, reading);
    const text = orientMirrorText(recorded, "coherence");
    assert.match(text, /SOURCES \(src\/app\/build\.ts:1\) has drifted from the import closure of its own files: it lacks c\.ts/);
    assert.match(text, new RegExp(`${second.slice(0, 7)} added c\\.ts to the closure alone`));
    assert.deepEqual(proposalsOf(reading.groups).map((p) => [p.list.name, p.universe]), [["SOURCES", "closure of files"]], "the alarm is proposed for declaration");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("latent and duplicate findings of surfaced groups and alarms become proposed pairs with one universe recipe each, and a folder proposes none", () => {
  const files = ["a.ts", "b.ts", "c.ts"];
  const names = ["red", "green", "blue"];
  const closure = finding(ref("src/app/build.ts", "SOURCES", files), ref("src/app", "import closure of SOURCES (src/app/build.ts:1)", files, { form: "closure", line: 0, list: "src/app/build.ts:1", of: files }), { verdict: "latent" });
  const keys = finding(ref("src/a.ts", "COLORS", names), ref("src/b.ts", "PAINT keys", names, { form: "keys", line: 7 }), { verdict: "duplicate" });
  const literal = finding(ref("src/a.ts", "HUES", names, { line: 3 }), ref("docs/colors.md", "table under \"Colors\"", names, { form: "doc-table", line: 12 }), { verdict: "duplicate" });
  const drifted = finding(ref("src/c.ts", "SOME", ["red", "green"]), ref("src/d.ts", "MORE", names, { line: 9 }), { verdict: "drifted" });
  const folder = finding(ref("src/e.ts", "FILES", files), ref("src/e", "files in src/e/", files, { form: "folder", line: 0 }), { verdict: "latent" });
  const quiet = finding(ref("src/f.ts", "QUIET", names), ref("src/g.ts", "QUIET", names), { verdict: "duplicate" });
  const groups = [group(1, 40, [closure]), group(2, 40, [keys]), group(3, 40, [literal, drifted]), group(4, 40, [folder]), group(5, 5, [quiet])];

  const proposed = proposalsOf(groups);
  assert.deepEqual(
    proposed.map((p) => [p.list.file, p.list.name, p.universe]),
    [
      ["src/app/build.ts", "SOURCES", "closure of files"],
      ["src/a.ts", "COLORS", "keys of src/b.ts:PAINT"],
      ["src/a.ts", "HUES", "literal at docs/colors.md:12"],
    ],
    "a drifted pair, a pair no group surfaces, and a folder propose nothing",
  );
  assert.deepEqual(proposed[0]!.members, files);
  assert.equal(proposed[0]!.list.line, 1);
});

test("files in a language the reading does not parse are counted by extension, said by query mirrors, and named at orient only when they outnumber the code it read", async () => {
  const root = scratch();
  try {
    const git = gitIn(root);
    git("init", "-q", "-b", "main");
    write(root, "app/models.py", 'KINDS = ["alpha", "beta", "gamma"]\n');
    write(root, "app/views.py", "from app.models import KINDS\n");
    write(root, "app/__init__.py", "");
    write(root, "app/models.pyi", "KINDS: list[str]\n");
    write(root, "web/index.ts", "export const one = 1;\n");
    write(root, "pyproject.toml", '[project]\nname = "app"\n');
    git("add", "-A");
    git("commit", "-q", "-m", "a Python project with one TypeScript file");
    const head = git("rev-parse", "HEAD").trim();

    const reading = await readMirrors(root, { history: false });
    assert.equal(reading.read, 1, "the one TypeScript file is parsed");
    assert.deepEqual(reading.unread, { ".py": 3, ".pyi": 1 }, "the Python files are counted by extension, and a file in no language is not");

    let out = "";
    const io = { out: (text: string): void => { out += text; }, err: (text: string): void => { out += text; } };
    assert.equal(await mirrorsCommand(root, [], io), 0);
    assert.match(out, /in \d+ ms; not read: 3 \.py files, 1 \.pyi file \(the reading parses TypeScript, JavaScript and Markdown\)/);
    out = "";
    assert.equal(await mirrorsCommand(root, ["--json"], io), 0);
    assert.deepEqual(JSON.parse(out).unread, { ".py": 3, ".pyi": 1 });

    // query mirrors kept the reading of HEAD; orient names the unread code, labeled with its commit.
    const kept = lastMirrors(root);
    assert.ok(kept !== undefined);
    assert.deepEqual(kept.unread, { ".py": 3, ".pyi": 1 });
    const text = orientMirrorText(kept, "coherence");
    assert.match(text, new RegExp(`^Hand lists \\(the mirror reading at ${head.slice(0, 7)}, \\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2} UTC; advisory\\): not read for 3 \\.py files, 1 \\.pyi file; the reading parses TypeScript, JavaScript and Markdown\\.$`));
    assert.ok(text.length <= ORIENT_LINE_LIMIT);

    // A project mostly TypeScript with a few stray Python files: orient adds nothing, and query mirrors still says them.
    const mostlyTypeScript = { ...readingOf([]), read: 10, unread: { ".py": 2 } };
    assert.equal(orientMirrorText(recordMirrors(root, mostlyTypeScript), "coherence"), "", "a few files unread beside the code read is no line at the session start");
    assert.match(readingText(mostlyTypeScript), /not read: 2 \.py files/);

    // A reading kept before the counts existed is treated as absent, never a crash.
    write(root, join(MIRRORS_DIR, "reading.json"), JSON.stringify({ version: 1, commit: head, at: "2026-10-12T09:30:00Z", ms: 1, sets: 0, groups: 0, surfaced: [], alarms: [] }));
    assert.equal(lastMirrors(root), undefined);
    assert.equal(orientMirrorText(lastMirrors(root), "coherence"), "");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------- restatements */

/** A repository at one commit, its files as given. */
function repositoryOf(files: Record<string, string>): string {
  const root = scratch();
  const git = gitIn(root);
  git("init", "-q", "-b", "main");
  for (const [path, text] of Object.entries(files)) write(root, path, text);
  git("add", "-A");
  git("commit", "-q", "-m", "the files");
  return root;
}

const valueOf = (reading: MirrorReading, value: string): Restatement | undefined => reading.restatements.find((r) => r.value === value);

test("a value written in two files is a restatement when what its copies share is rare enough, ranked by what has diverged and what history changed apart, and tests, literal types, prose and other parties' vocabulary are left out", async () => {
  const root = repositoryOf({
    "src/a/kinds.ts": 'export const KINDS = ["alpha", "beta", "gamma", "delta"];\n',
    "src/b/use.ts": 'export const SOME_KINDS = ["alpha", "beta", "gamma"];\n',
    "src/a/rule.ts": "export const NAME_RULE = /^zqname-[a-z][a-z0-9-]*$/;\nexport const NOTE = \"the note that two modules keep\";\n",
    "src/b/rule.ts": "const NAME_RULE = /^zqname-[a-z][a-z0-9-]*$/;\nconst NOTE = \"the note that two modules keep\";\nexport const ok = (s: string): boolean => NAME_RULE.test(s) && s !== NOTE;\n",
    "src/a/words.ts": 'export type Mode = "the-long-mode-name" | "the-other-mode-name";\nexport const one = (): string => "written-in-two-files";\nexport const say = (): string => "some prose that is not a name";\nexport const url = "https://example.com/one/two";\nexport const seen = "only-a-test-repeats-this";\nexport const mode = "the-long-mode-name";\nexport const ext = ".zqmts";\nexport const word = "name";\nexport const header = "WWW-Authenticate";\nexport const status = "Internal Server Error";\nexport const sub = "ls-files";\nexport const bare = /^[0-9a-f]{8}$/;\n',
    "src/b/words.ts": 'export const two = (): string => "written-in-two-files";\nexport const say = (): string => "some prose that is not a name";\nexport const url = "https://example.com/one/two";\nexport const mode = "the-long-mode-name";\nexport const ext = ".zqmts";\nexport const word = "name";\nexport const header = "WWW-Authenticate";\nexport const status = "Internal Server Error";\nexport const sub = "ls-files";\nexport const bare = /^[0-9a-f]{8}$/;\n',
    "src/b/words.test.ts": 'export const seen = "only-a-test-repeats-this";\n',
    "src/b/fixture-words.ts": 'export const seen = "only-a-test-repeats-this";\n',
  });
  try {
    const reading = await readMirrors(root, { history: false });
    const drift = reading.restatements.find((r) => r.kind === "drift");
    assert.ok(drift !== undefined, reading.restatements.map((r) => r.value).join("; "));
    assert.deepEqual(drift.members, ["alpha", "beta", "gamma"]);
    assert.deepEqual(drift.odd, { member: "delta", lacks: "src/b/use.ts:1" }, "the side that lacks the one member is named");
    assert.equal(reading.restatements[0], drift, "what has already diverged ranks first");
    assert.equal(valueOf(reading, "^zqname-[a-z][a-z0-9-]*$")?.kind, "rule", "a regular expression written in two files is one rule, weighed by its words");
    assert.equal(valueOf(reading, "the note that two modules keep")?.kind, "constant", "prose bound to a named constant in two files is kept");
    assert.equal(valueOf(reading, "written-in-two-files")?.kind, "literal");
    assert.deepEqual(valueOf(reading, "written-in-two-files")?.sites.map((s) => s.file), ["src/a/words.ts", "src/b/words.ts"]);
    assert.equal(valueOf(reading, ".zqmts")?.kind, "constant", "a short value counts when it is rare");
    assert.deepEqual(reading.restatements.map((r) => r.kind).sort(), ["constant", "constant", "drift", "literal", "rule"], "and nothing else");
    for (const left of ["the-long-mode-name", "some prose that is not a name", "https://example.com/one/two", "only-a-test-repeats-this", "name", "WWW-Authenticate", "Internal Server Error", "ls-files", "^[0-9a-f]{8}$"]) assert.equal(valueOf(reading, left), undefined, `${left} is left out`);

    let out = "";
    const io = { out: (text: string): void => { out += text; }, err: (text: string): void => { out += text; } };
    assert.equal(await mirrorsCommand(root, ["--no-history"], io), 0);
    assert.match(out, /^Restatements: 5 unheld, 0 excluded by config, 0 excluded as derived, 0 held, 0 held by a test not yet refuted, 0 declared different \(one value written in two or more files;/m, "the default answer says the counts");
    out = "";
    assert.equal(await mirrorsCommand(root, ["--no-history", "--restatements"], io), 0);
    assert.match(out, /1\. drift {2}3 members: alpha, beta, gamma\n {5}src\/a\/kinds\.ts:1 KINDS\n {5}src\/b\/use\.ts:1 SOME_KINDS\n {5}src\/b\/use\.ts:1 lacks delta\n {5}source: /);
    out = "";
    assert.equal(await mirrorsCommand(root, ["--no-history", "--json"], io), 0);
    assert.equal(JSON.parse(out).restatements.length, 5);

    // History ranks, never alarms: a copy one commit changed apart from the other ranks above one that never changed.
    const git = gitIn(root);
    write(root, "src/a/rule.ts", "export const NAME_RULE = /^zqname-[a-z][a-z0-9-]*$/; // kept here\nexport const NOTE = \"the note that two modules keep\";\n");
    git("commit", "-qam", "touch one copy");
    const later = await readMirrors(root);
    const apart = valueOf(later, "^zqname-[a-z][a-z0-9-]*$");
    const still = valueOf(later, "the note that two modules keep");
    assert.equal(apart?.standing, 2, "changed apart");
    assert.equal(still?.standing, 4, "never changed");
    assert.ok(later.restatements.indexOf(apart!) < later.restatements.indexOf(still!), "changed apart ranks above never changed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a copy held by an import of the list's name, a type or a declared mirror is counted held, and one a test reading every copy names is held only once that test went red, until then counted apart", async () => {
  const root = repositoryOf({
    "src/a/levels.ts": 'export const LEVELS = ["low", "middle", "high"] as const;\n',
    "src/b/levels.ts": 'import type { LEVELS } from "../a/levels.ts";\nexport const MY_LEVELS = ["low", "middle", "high"] as const satisfies readonly (typeof LEVELS)[number][];\n',
    "src/a/sizes.ts": 'export const SIZES = ["small", "medium", "large"];\n',
    "src/b/sizes.ts": 'export const SIZE_COPY = ["small", "medium", "large"];\n',
    "src/b/sizes.test.ts": 'import { SIZE_COPY } from "./sizes.ts";\nimport { SIZES } from "../a/sizes.ts";\nexport const same = SIZE_COPY.join() === SIZES.join();\n',
    "src/a/colors.ts": 'export const COLORS = ["red", "green", "blue"];\n',
    "src/b/colors.ts": 'export const PAINTS = ["red", "green", "blue"];\n',
    "src/b/B.spec.md": "# B\n\nThe b side.\n\n## mirrors\n- PAINTS in colors.ts: the paints there are\n  mirrors: COLORS in src/a/colors.ts\n",
    "src/a/value.ts": 'export const A_PATTERN = "held-by-a-test-value";\n',
    "src/b/value.ts": 'export const B_PATTERN = "held-by-a-test-value";\n',
    "src/b/value.test.ts": 'import { B_PATTERN } from "./value.ts";\nexport const same = B_PATTERN === "held-by-a-test-value";\n',
    "src/a/loose.ts": 'export const SHAPES = ["circle", "square", "triangle"];\nexport const LOOSE = "nothing-holds-this-value";\n',
    "src/b/loose.ts": 'export const MY_SHAPES = ["circle", "square", "triangle"];\nexport const LOOSE = "nothing-holds-this-value";\n',
    "src/a/home.ts": 'export const PHASES = ["sowing", "growing", "reaping"];\n',
    "src/b/copy.ts": 'export const MY_PHASES = ["sowing", "growing", "reaping"];\n',
    "src/a/home.test.ts": 'import { PHASES } from "./home.ts";\nexport const three = PHASES.length === 3;\n',
  });
  try {
    const reading = await readMirrors(root, { history: false });
    assert.deepEqual(reading.restatements.map((r) => r.value).sort(), ["circle, square, triangle", "nothing-holds-this-value", "sowing, growing, reaping"], "only what nothing holds is restated, and a test that reads one side alone holds nothing");
    assert.equal(reading.held, 2, "the type import and the declared mirror each hold one");
    assert.deepEqual(reading.unrefuted.map((r) => r.value).sort(), ["held-by-a-test-value", "small, medium, large"], "a copy a test names is held, not yet refuted, until the test has gone red with the copy changed");
    assert.deepEqual(reading.unrefuted.map((r) => r.hold?.test).sort(), ["src/b/sizes.test.ts", "src/b/value.test.ts"]);
    assert.equal(reading.holds.length, 2, "both are offered to the witness pass");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/** A restatement input over these files, each importing what is given. */
function sourceInput(imports: Record<string, string[]>, extra: Partial<RestatementInput> = {}): RestatementInput {
  return {
    pairs: [],
    values: new Map(),
    typed: new Set(),
    tests: new Map(),
    imports: new Map(Object.entries(imports).map(([file, to]) => [file, to.map((t) => ({ to: t.startsWith("node:") ? undefined : t, names: [], typeOnly: false }))])),
    untyped: new Set(),
    plugins: [],
    manifests: new Set(),
    declared: [],
    shapes: new Map(),
    exclusions: NO_EXCLUSIONS,
    rarity: new Rarity(new Counts(), new Counts()),
    predicates: [],
    parsers: [],
    literals: [],
    declarations: new Map(),
    blobs: new Map(),
    witnessed: () => undefined,
    ...extra,
  };
}

test("a restatement names its one source: a module every site can import, a plugin's manifest for a language's fact, or a test where a site cannot import it", () => {
  const core = { "src/a/one.ts": ["src/a/util.ts"], "src/b/two.ts": ["src/a/util.ts"], "src/a/util.ts": [] };
  assert.equal(sourceOf(sourceInput(core), ["src/a/one.ts", "src/b/two.ts"], ["src/b/two.ts"]), "one module, src/b/two.ts, imported by the rest", "the site that binds the value to a name, when every other site can import it");

  const plugin = { ...core, "plugins/lang/lang.ts": ["src/plugins/api.ts"], "plugins/lang/plugin.json": [], "src/plugins/api.ts": ["src/a/util.ts"] };
  const withPlugin = sourceInput(plugin, { plugins: ["plugins/lang"], manifests: new Set(["plugins/lang/plugin.json"]) });
  assert.equal(sourceOf(withPlugin, ["src/a/one.ts", "plugins/lang/lang.ts"], ["src/a/one.ts"]), "one module, src/a/one.ts, imported by the rest (plugins/lang/lang.ts through src/plugins/api.ts)", "a plugin reaches the core through the one module it already imports");
  assert.match(sourceOf(withPlugin, ["src/a/one.ts", "plugins/lang/lang.ts"], [], [".ab", ".cd", ".ef"]), /^the owning plugin's manifest \(plugins\/lang\/plugin\.json\), read through the registry: the core names no language$/, "file extensions in the core and a plugin belong to the plugin's manifest");
  assert.match(sourceOf(withPlugin, ["plugins/lang/lang.ts", "plugins/lang/plugin.json"], []), /^the plugin's manifest \(plugins\/lang\/plugin\.json\)/, "a value the manifest already holds lives there");

  const apart = sourceInput({ ...core, "pkg/hooks/answer.ts": ["pkg/hooks/tree.ts"], "pkg/hooks/tree.ts": [], "src/status.ts": ["node:fs"], "src/line.ts": ["node:path"], "bench/run.ts": ["src/a/util.ts"] }, { untyped: new Set(["src/a/scene.ts"]) });
  assert.equal(sourceOf(apart, ["pkg/hooks/answer.ts", "src/a/one.ts"], ["pkg/hooks/answer.ts"]), "one source, src/a/one.ts, and a test that holds the other copies equal to it: pkg/hooks/answer.ts imports nothing from src/", "a part that imports nothing from the home's is held by a test, and the home is where others already import from");
  assert.equal(sourceOf(apart, ["src/status.ts", "src/a/one.ts"], ["src/a/one.ts"]), "one module, src/status.ts, imported by the rest", "a file kept self-contained imports nothing, so it is the home the rest import");
  assert.match(sourceOf(apart, ["src/status.ts", "src/line.ts"], []), /a test that holds the other copies equal to it: src\/(line|status)\.ts imports nothing of the project's$/, "two files kept self-contained are held by a test");
  assert.equal(sourceOf(apart, ["src/a/scene.ts", "src/a/one.ts"], []), "hold the copies equal by a test: src/a/scene.ts is not type-checked");
});
