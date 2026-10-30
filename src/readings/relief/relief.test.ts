import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { REVISION, WORKTREE, districtsOf, parseCommitRows, parseLandings, parseNumstat, reliefCommits, reliefDiff, touchesOf, trunkOf, type ReliefFile } from "./relief.ts";

test("a diff names only commits: an option, a range or a path is refused before git sees it", () => {
  for (const bad of ["--output=/tmp/x", "-p", "HEAD", "main..HEAD", "HEAD~1", "../etc", "", "abc", "ABCDEF12", `a${"0".repeat(40)}`]) {
    assert.equal(REVISION.test(bad), false, `${JSON.stringify(bad)} is no commit name`);
    // The root is never reached: the names are refused first, so no git runs in it.
    assert.throws(() => reliefDiff("/nowhere", bad, WORKTREE), /a and b must be commit ids/, `refused as the earlier end: ${bad}`);
    if (bad !== WORKTREE) assert.throws(() => reliefDiff("/nowhere", "5a55b02", bad), /a and b must be commit ids/, `refused as the later end: ${bad}`);
  }
  for (const good of ["5a55b02", "8d85d0f99ec", "4b825dc642cb6eb9a060e54bf8d69288fbee4904"]) assert.equal(REVISION.test(good), true, good);
});

test("a container's own files stand as districts by the folder holding them: three files or more, a folder holding most of them opened into its own", () => {
  const f = (file: string, lines = 10): ReliefFile => ({ file, lines, reached: 0 });
  const files = [
    // src holds most of the lines, so it is opened: its folders are the districts, its loose file stays with the component.
    ...["a", "b", "c"].map((n) => f(`src/scenes/${n}.ts`, 100)),
    ...["a", "b", "c", "d"].map((n) => f(`src/lib/${n}.ts`, 100)),
    f("src/loose.ts", 100),
    ...["a", "b"].map((n) => f(`src/tiny/${n}.ts`, 100)),
    ...["a", "b", "c"].map((n) => f(`bench/${n}.ts`)),
    f("cli.ts"),
  ];
  const districts = districtsOf(".", files);
  assert.deepEqual([...districts.keys()], ["bench", "src/lib", "src/scenes"], "src is opened; a folder of two files is no district");
  assert.equal(districts.get("src/lib")?.length, 4);
  assert.equal([...districts.values()].flat().some((x) => x.file === "src/loose.ts" || x.file === "cli.ts"), false, "loose files stay with the component");
  // Inside a component folder, districts are named from below it.
  assert.deepEqual([...districtsOf("products", [...["a", "b", "c"].map((n) => f(`products/signals/${n}.py`)), ...["a", "b", "c"].map((n) => f(`products/tasks/${n}.py`))]).keys()], ["products/signals", "products/tasks"]);
});

test("a trace's appended lines are touches once: a line still being written waits, a damaged line lights nothing, and a snapshot is no touch", () => {
  const read = JSON.stringify({ kind: "read", at: "2026-10-30T04:00:00.000Z", session: "s1", file: "src/a.ts" });
  const write = JSON.stringify({ kind: "write", at: "2026-10-30T04:00:01.000Z", session: "s1", files: ["src/b.ts", 7, "src/c.ts"] });
  const snapshot = JSON.stringify({ kind: "snapshot", at: "2026-10-30T04:00:02.000Z", session: "s1", changed: ["src/a.ts"] });
  const partial = '{"kind":"read","at":"2026-10-30T04:00:03.000Z","session":"s1","fi';
  const text = `${read}\n{not json\n${write}\n${snapshot}\n${partial}`;
  const { touches, consumed } = touchesOf(text);
  assert.deepEqual(touches.map((t) => [t.kind, t.files]), [["read", ["src/a.ts"]], ["write", ["src/b.ts", "src/c.ts"]]]);
  assert.equal(consumed, Buffer.byteLength(text) - Buffer.byteLength(partial), "the unfinished line is left for the next look");
  assert.deepEqual(touchesOf(partial), { touches: [], consumed: 0 });
  // Multi-byte paths count by bytes, as the offset into the file does.
  const wide = `${JSON.stringify({ kind: "read", at: "", session: "s", file: "docs/é.md" })}\n`;
  assert.equal(touchesOf(wide).consumed, Buffer.byteLength(wide));
});

test("a landing's subject is read whole, whatever it holds: @@, a tab, nothing at all, and a commit that changed no files", () => {
  // git log -z --numstat with the landing format, as git printed it for a repository made to hold these subjects.
  const out =
    "\u0000893f086\u00002026-10-30\u0000empty @@ one\u0000" +
    "\u00000b5c3c8\u00002026-10-30\u0000\u0000" +
    "\u000010602d8\u00002026-10-30\u0000second\u0000\n-\t-\tbin.dat\u00001\t0\t\u0000src/a.txt\u0000src/b.txt\u0000" +
    "\u0000e2f5459\u00002026-10-30\u0000first @@ subject\twith tab\u0000\n2\t0\tsrc/a.txt\u00001\t0\tsrc/é tab\tx.txt\u0000";
  assert.deepEqual(parseLandings(out), [
    { sha: "893f086", date: "2026-10-30", subject: "empty @@ one", files: [] },
    { sha: "0b5c3c8", date: "2026-10-30", subject: "", files: [] },
    { sha: "10602d8", date: "2026-10-30", subject: "second", files: [{ path: "bin.dat", lines: null }, { path: "src/b.txt", lines: [1, 0] }] },
    { sha: "e2f5459", date: "2026-10-30", subject: "first @@ subject\twith tab", files: [{ path: "src/a.txt", lines: [2, 0] }, { path: "src/é tab\tx.txt", lines: [1, 0] }] },
  ]);
  assert.deepEqual(parseLandings(""), []);
  // A subject that reads like a header of its own is still one subject.
  assert.deepEqual(parseLandings("\u0000abc1234\u00002026-10-30\u0000@@def5678\t2026-10-29\tfake\u0000\n3\t1\treal.ts\u0000").map((c) => [c.subject, c.files.length]), [["@@def5678\t2026-10-29\tfake", 1]]);
  assert.deepEqual(parseCommitRows("893f086\u00002026-10-30\u0000a @@ b\tc\u00000b5c3c8\u00002026-10-29\u0000\u0000e2f5459\u00002026-10-28\u0000last\u0000"), [
    { sha: "893f086", date: "2026-10-30", subject: "a @@ b\tc" },
    { sha: "0b5c3c8", date: "2026-10-29", subject: "" },
    { sha: "e2f5459", date: "2026-10-28", subject: "last" },
  ]);
  assert.deepEqual(parseNumstat("4\t2\tsrc/x.ts\u0000-\t-\tlogo.png\u00000\t0\t\u0000old name.ts\u0000new name.ts\u0000"), [
    { path: "src/x.ts", lines: [4, 2] },
    { path: "logo.png", lines: null },
    { path: "new name.ts", lines: [0, 0] },
  ]);
});

test("the trunk is the branch origin's HEAD names, else main, else master, else none, and only one that exists", () => {
  const refs = (...names: string[]) => new Set(names);
  assert.equal(trunkOf("refs/remotes/origin/develop", refs("refs/heads/develop", "refs/heads/main")), "develop", "origin's HEAD wins over a main");
  assert.equal(trunkOf("refs/remotes/origin/develop", refs("refs/remotes/origin/develop", "refs/heads/main")), "origin/develop", "origin's copy where there is no local branch");
  assert.equal(trunkOf("refs/remotes/origin/gone", refs("refs/heads/master")), "master", "a dangling origin HEAD falls through");
  assert.equal(trunkOf("", refs("refs/heads/main", "refs/heads/master")), "main");
  assert.equal(trunkOf("", refs("refs/heads/master")), "master");
  assert.equal(trunkOf("", refs("refs/remotes/origin/main")), "origin/main");
  assert.equal(trunkOf("", refs("refs/heads/trunk", "refs/heads/develop")), null, "a trunk by another name with no origin HEAD is none, never a guess");
});

test("a diff lists only the paths that changed, a deleted one marked gone, and with no trunk the commits are HEAD's own line", async () => {
  // Its own repository in a temporary folder: the test never reads this checkout's history.
  const root = mkdtempSync(join(tmpdir(), "relief-diff-"));
  const run = (...args: string[]) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args], { cwd: root, encoding: "utf8" }).trim();
  try {
    run("init", "-q", "-b", "trunk");
    mkdirSync(join(root, "src"));
    for (const n of ["a", "b", "c", "keep"]) writeFileSync(join(root, "src", `${n}.txt`), "one\ntwo\n");
    run("add", "-A");
    run("commit", "-q", "-m", "first @@ commit");
    const first = run("rev-parse", "--short=7", "HEAD");
    writeFileSync(join(root, "src", "a.txt"), "one\ntwo\nthree\n");
    rmSync(join(root, "src", "b.txt"));
    run("add", "-A");
    run("commit", "-q", "-m", "second\twith a tab");
    const second = run("rev-parse", "--short=7", "HEAD");
    writeFileSync(join(root, "src", "c.txt"), "one\n");
    writeFileSync(join(root, "src", "new é.txt"), "x\ny\n");

    const between = await reliefDiff(root, first, second);
    assert.deepEqual(between.files.sort((x, y) => x.path.localeCompare(y.path)), [
      { path: "src/a.txt", add: 1, del: 0 },
      { path: "src/b.txt", add: 0, del: 2, gone: true },
    ]);
    assert.equal(between.b.subject, "second\twith a tab");
    const working = await reliefDiff(root, second, WORKTREE);
    assert.deepEqual(working.files.sort((x, y) => x.path.localeCompare(y.path)), [
      { path: "src/c.txt", add: 0, del: 1 },
      { path: "src/new é.txt", add: 2, del: 0 },
    ]);

    const commits = await reliefCommits(root);
    assert.equal(commits.trunk, null, "a repository whose trunk is called trunk has no main, master or origin HEAD to name it");
    assert.equal(commits.base, second);
    assert.deepEqual(commits.list.map((c) => [c.sha, c.subject]), [[second, "second\twith a tab"], [first, "first @@ commit"]]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
