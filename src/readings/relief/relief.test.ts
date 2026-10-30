import assert from "node:assert/strict";
import { test } from "node:test";
import { REVISION, WORKTREE, districtsOf, reliefDiff, touchesOf, type ReliefFile } from "./relief.ts";

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
