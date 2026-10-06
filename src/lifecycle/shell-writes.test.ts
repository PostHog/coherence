/**
 * The files a shell command writes, read from its words: what lets an
 * edit-triggered practice and the chokepoint check at the edit see a heredoc,
 * sed -i, tee, a redirect or cp the way they see an edit tool.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { shellCommandOf, shellWrittenPaths } from "./shell-writes.ts";
import { writtenFiles } from "./hook.ts";

test("a shell command's written files are read from its words: redirects, heredocs, tee, sed -i, perl -i, cp and mv destinations, touch and rm, through cd, and never a quoted >, a heredoc body, a variable or a device", () => {
  const cases: [string, string[]][] = [
    ["cat > src/a.spec.md <<'EOF'\n- x: y\n  echo > not/this\nEOF", ["src/a.spec.md"]],
    ["echo hi >> notes.txt && ls", ["notes.txt"]],
    ["sed -i '' 's/a/b/' c.md d.md", ["c.md", "d.md"]],
    ["sed -i.bak -e s/x/y/ e.md", ["e.md"]],
    ["sed -i 's/x/y/' f.md", ["f.md"]],
    ["tee -a g.md h.md < in.txt", ["g.md", "h.md"]],
    ["cp x.md out/y.md; mv a b", ["out/y.md", "b"]],
    ["node run.js 2>/dev/null > out.txt 2>&1", ["out.txt"]],
    ['git commit -m "fix > than"', []],
    ["cd sub && echo x > h.md", ["sub/h.md"]],
    ["cd $DIR && echo x > h.md", []],
    ["perl -pi -e 's/a/b/' p.md", ["p.md"]],
    ["python3 -c \"open('x','w')\"", []],
    ["grep refute src/ | head > $OUT", []],
    ["printf '%s\\n' a > 'with space.md'", ["with space.md"]],
    ["touch a b && rm -rf c", ["a", "b", "c"]],
  ];
  for (const [command, written] of cases) assert.deepEqual(shellWrittenPaths(command), written, command);
  assert.equal(shellCommandOf({ command: ["bash", "-lc", "echo x > y.md"] }), "echo x > y.md", "a Codex shell argv runs its script");
});

test("writtenFiles counts a shell command's writes beside an edit tool's, resolved against the folder the command runs in and confined to the project", () => {
  const root = mkdtempSync(join(tmpdir(), "coherence-shell-writes-"));
  try {
    mkdirSync(join(root, "src", "widget"), { recursive: true });
    const bash = (command: string, cwd = root) => writtenFiles(root, { cwd, tool_name: "Bash", tool_input: { command } });
    assert.deepEqual(bash("cat > src/widget/Widget.spec.md <<'EOF'\n- a: b\nEOF"), ["src/widget/Widget.spec.md"]);
    assert.deepEqual(bash("echo x > Widget.spec.md", join(root, "src", "widget")), ["src/widget/Widget.spec.md"], "relative to the folder it runs in");
    assert.deepEqual(bash("echo x > ../../outside.md"), [], "a write above the root is not the project's");
    assert.deepEqual(bash("ls src"), [], "a command that writes nothing");
    assert.deepEqual(writtenFiles(root, { cwd: root, tool_name: "Read", tool_input: { file_path: join(root, "src/a.ts") } }), [], "a reading tool writes nothing");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
