import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { REVISION, TraceTail, UNTRACKED_MAX_BYTES, WORKTREE, districtsOf, landingsUnreadBecause, parseCommitRows, parseLandings, parseNumstat, readRelief, readReliefApart, reliefCommits, reliefDiff, touchesOf, trunkOf, type ReliefFile, type Touch } from "./relief.ts";

/** A repository of its own in a temporary folder, and git run in it: a test never reads this checkout's history. */
function repository(prefix: string): { root: string; run: (...args: string[]) => string } {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const run = (...args: string[]): string => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  return { root, run };
}

test("a diff names only commits: an option, a range, a ref or a path is refused, and a name of hex digits is read as a commit id, never as a branch", async () => {
  for (const bad of ["--output=/tmp/x", "-p", "HEAD", "main..HEAD", "HEAD~1", "../etc", "", "abc", "ABCDEF12", `a${"0".repeat(40)}`, "0".repeat(41), "0".repeat(63), "0".repeat(65)]) {
    assert.equal(REVISION.test(bad), false, `${JSON.stringify(bad)} is no commit name`);
    // The root is never reached: the names are refused first, so no git runs in it.
    assert.throws(() => reliefDiff("/nowhere", bad, WORKTREE), /a and b must be commit ids/, `refused as the earlier end: ${bad}`);
    if (bad !== WORKTREE) assert.throws(() => reliefDiff("/nowhere", "5a55b02", bad), /a and b must be commit ids/, `refused as the later end: ${bad}`);
  }
  for (const good of ["5a55b02", "8d85d0f99ec", "4b825dc642cb6eb9a060e54bf8d69288fbee4904", "0".repeat(64)]) assert.equal(REVISION.test(good), true, `${good} has a commit id's shape, SHA-1 or SHA-256`);

  // A name of a commit id's shape can be a branch's: git would read the branch first. It is read as the commit it names.
  const { root, run } = repository("relief-refs-");
  try {
    run("init", "-q");
    writeFileSync(join(root, "a.txt"), "one\n");
    run("add", "-A");
    run("commit", "-q", "-m", "first");
    const first = run("rev-parse", "HEAD");
    writeFileSync(join(root, "a.txt"), "one\ntwo\nthree\n");
    run("add", "-A");
    run("commit", "-q", "-m", "second");
    const second = run("rev-parse", "HEAD");
    const short = first.slice(0, 7);
    // A branch named as the first commit's short id, at the second commit, and one named in hex that begins no object's id.
    run("branch", short, second);
    run("branch", "beefcafe", second);
    assert.equal(run("rev-parse", short), second, "git itself reads the name as the branch");

    const diff = await reliefDiff(root, short, second);
    assert.deepEqual(diff.files, [{ path: "a.txt", add: 2, del: 0 }], "the name is the first commit, so the diff is first to second, not empty");
    assert.equal(diff.a.rev, short, "the end is answered under the name the page gave");
    assert.equal(diff.a.subject, "first");
    await assert.rejects(reliefDiff(root, "beefcafe", WORKTREE), /no commit's id begins beefcafe/, "a branch named in hex that is no commit's id is refused");
    await assert.rejects(reliefDiff(root, second.slice(0, 7), "beefcafe"), /no commit's id begins beefcafe/, "as the later end too");
    // The tree object of a commit begins an id too, but it is no commit.
    const tree = run("rev-parse", `${first}^{tree}`);
    await assert.rejects(reliefDiff(root, tree, WORKTREE), /no commit's id begins/, "an object that is no commit is refused");
    assert.equal((await reliefDiff(root, first, second)).b.subject, "second", "a full id names its commit");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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

test("a trace's appended lines are touches once: what stood before the server followed or while no page was there is history, a line still being written waits, a damaged line lights nothing, and a snapshot is no touch", () => {
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

  // The offsets a live server keeps, over a traces folder of its own: each look reads only the traces the watcher named.
  const dir = mkdtempSync(join(tmpdir(), "relief-traces-"));
  const line = (session: string, file: string): string => `${JSON.stringify({ kind: "read", at: "2026-10-30T05:00:00.000Z", session, file })}\n`;
  const files = (touches: Touch[]): string[] => touches.flatMap((t) => t.files);
  try {
    writeFileSync(join(dir, "s-old.jsonl"), line("s-old", "before/start.ts"));
    const tail = new TraceTail(dir);
    tail.start();
    tail.note("s-old.jsonl");
    assert.deepEqual(tail.look(), [], "a trace as it stood when the server began following it is history");
    appendFileSync(join(dir, "s-old.jsonl"), line("s-old", "src/after.ts"));
    tail.note("s-old.jsonl");
    assert.deepEqual(files(tail.look()), ["src/after.ts"], "a line appended after is a touch");
    tail.note("s-old.jsonl");
    assert.deepEqual(tail.look(), [], "and only once");
    // Half a line, then the rest: the touch waits for the whole line and is sent when it is.
    const whole = line("s-old", "src/é half.ts");
    const cut = Buffer.byteLength(whole) - 12;
    appendFileSync(join(dir, "s-old.jsonl"), Buffer.from(whole).subarray(0, cut));
    tail.note("s-old.jsonl");
    assert.deepEqual(tail.look(), [], "a line still being written waits");
    appendFileSync(join(dir, "s-old.jsonl"), Buffer.from(whole).subarray(cut));
    tail.note("s-old.jsonl");
    assert.deepEqual(files(tail.look()), ["src/é half.ts"], "and lights once it is whole");
    // A trace that appears after the start is a session that began since: all of it is new.
    writeFileSync(join(dir, "s-new.jsonl"), line("s-new", "src/new.ts") + snapshot + "\n");
    tail.note("s-new.jsonl");
    tail.note("notes.txt");
    assert.deepEqual(files(tail.look()), ["src/new.ts"]);
    // Appended while no page was connected: never read, and history once one connects.
    appendFileSync(join(dir, "s-old.jsonl"), line("s-old", "src/unseen.ts"));
    appendFileSync(join(dir, "s-away.jsonl"), line("s-away", "src/away.ts"));
    tail.note("s-old.jsonl");
    tail.note("s-away.jsonl");
    tail.skip();
    appendFileSync(join(dir, "s-old.jsonl"), line("s-old", "src/seen.ts"));
    appendFileSync(join(dir, "s-away.jsonl"), line("s-away", "src/back.ts"));
    // The watcher named no file: every trace is looked at, each from where it was sent.
    tail.note(undefined);
    assert.deepEqual(files(tail.look()).sort(), ["src/back.ts", "src/seen.ts"], "what was appended while no page was there is never sent");
    // A trace that is not noted is not read, whatever it gained.
    appendFileSync(join(dir, "s-new.jsonl"), line("s-new", "src/quiet.ts"));
    assert.deepEqual(tail.look(), [], "a look reads only the traces the watcher named");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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

test("a diff lists only the paths that changed, a deleted one marked gone, an untracked file past the cap unread, and with no trunk the commits are HEAD's own line", async () => {
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
    // Past the cap, an untracked file is never read: it counts no lines, as git counts a binary file.
    writeFileSync(join(root, "src", "dump.txt"), "z\n".repeat(UNTRACKED_MAX_BYTES / 2 + 1));
    writeFileSync(join(root, "src", "no newline.txt"), "a\nb");

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
      { path: "src/no newline.txt", add: 2, del: 0 },
    ]);

    const commits = await reliefCommits(root);
    assert.equal(commits.trunk, null, "a repository whose trunk is called trunk has no main, master or origin HEAD to name it");
    assert.equal(commits.base, second);
    assert.deepEqual(commits.list.map((c) => [c.sha, c.subject]), [[second, "second\twith a tab"], [first, "first @@ commit"]]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a relief reading that is stopped ends its worker and answers that it was stopped, never a reading", async () => {
  const root = mkdtempSync(join(tmpdir(), "relief-stop-"));
  try {
    writeFileSync(join(root, "coherence.config.json"), JSON.stringify({ name: "stop", language: "typescript" }));
    writeFileSync(join(root, "a.ts"), "export const a = 1;\n");
    const stop = new AbortController();
    const reading = readReliefApart(root, stop.signal);
    stop.abort();
    // The answer comes once the worker has ended: a stopped one is never left reading after it.
    assert.deepEqual((await reading).reading, { kind: "unread", because: "the reading was stopped" });
    assert.deepEqual((await readReliefApart(root, stop.signal)).reading, { kind: "unread", because: "the reading was stopped" }, "a signal already aborted starts no worker");
    assert.equal((await readReliefApart(root)).reading.kind, "read", "an unstopped one reads");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a git log that fails for any reason but having no history is kept on the reading, a timeout among them; no checkout or no commit keeps nothing", async () => {
  const root = mkdtempSync(join(tmpdir(), "relief-git-"));
  try {
    writeFileSync(join(root, "coherence.config.json"), JSON.stringify({ name: "git", language: "typescript" }));
    writeFileSync(join(root, "a.ts"), "export const a = 1;\n");
    // execFile's own failures, stubbed: a git killed at its timeout, a runaway output, a missing git, and git's own refusals.
    const failing = (error: object) => async (): Promise<string> => {
      throw Object.assign(new Error("Command failed: git log"), error);
    };
    const timedOut = (await readRelief(root, undefined, failing({ killed: true, signal: "SIGTERM", code: null, stderr: "" }))).reading;
    assert.equal(timedOut.kind, "read", "the components stand whatever git did");
    assert.equal(timedOut.kind === "read" ? timedOut.landingsUnread : undefined, "git log timed out after 60 s");
    assert.deepEqual(timedOut.kind === "read" ? timedOut.landings : undefined, []);

    const reason = async (error: object): Promise<string | undefined> => {
      const read = (await readRelief(root, undefined, failing(error))).reading;
      return read.kind === "read" ? read.landingsUnread : "unread";
    };
    assert.equal(await reason({ code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" }), "git log printed more than 256 MB");
    assert.equal(await reason({ code: "ENOENT" }), "git was not found");
    assert.equal(await reason({ code: 128, stderr: "fatal: bad object HEAD\n" }), "git log failed: fatal: bad object HEAD");
    // No history to read is the genuine case: flat heights, nothing said.
    assert.equal(await reason({ code: 128, stderr: "fatal: not a git repository (or any of the parent directories): .git\n" }), undefined);
    assert.equal(await reason({ code: 128, stderr: "fatal: your current branch 'main' does not have any commits yet\n" }), undefined);
    assert.equal(landingsUnreadBecause({ code: 128, stderr: "fatal: ambiguous argument 'HEAD': unknown revision or path not in the working tree.\n" }), undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
