/**
 * Which references a chokepoint governs, over a small Python project and
 * Pyright: the notebooks package keeps its rows behind a facade module, its
 * own renderer reads them directly, and a dashboard in another package does
 * too. The same proof as src/enforcement/from.test.ts, on the second adapter.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { checkChokepoint } from "../enforcement/check.ts";
import { readEnforcementConfig } from "../enforcement/config.ts";
import { PythonAdapter } from "./python.ts";

let root: string;
let adapter: PythonAdapter;
const hint = { component: "pkg/notebooks", testFolders: readEnforcementConfig("/nowhere").testFolders };

function write(path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text, "utf8");
}

before(() => {
  root = mkdtempSync(join(tmpdir(), "coherence-python-from-"));
  write("coherence.config.json", JSON.stringify({ language: "python" }));
  write("pkg/__init__.py", "");
  write("pkg/notebooks/__init__.py", "");
  write("pkg/notebooks/internal.py", 'NOTEBOOK_ROWS = ["a", "b"]\n');
  write("pkg/notebooks/facade.py", "from pkg.notebooks.internal import NOTEBOOK_ROWS\n\n\ndef open_notebook() -> list:\n    return list(NOTEBOOK_ROWS)\n");
  write("pkg/notebooks/render.py", "from pkg.notebooks.internal import NOTEBOOK_ROWS\n\n\ndef render_notebook() -> str:\n    return \",\".join(NOTEBOOK_ROWS)\n");
  write("pkg/dashboards/__init__.py", "");
  write("pkg/dashboards/board.py", "from pkg.notebooks.internal import NOTEBOOK_ROWS\n\n\ndef board() -> int:\n    return len(NOTEBOOK_ROWS)\n");
  adapter = new PythonAdapter(root);
});

after(async () => {
  await adapter.close();
  rmSync(root, { recursive: true, force: true });
});

test("Python: a chokepoint from outside the component exempts its own references and still catches a bypass from another component; from anywhere calls both bypasses", async () => {
  const input = { protects: "NOTEBOOK_ROWS", chokepoint: "pkg/notebooks/facade.py", ...hint, root };
  const anywhere = await checkChokepoint(adapter, input);
  assert.equal(anywhere.grade, "broken", anywhere.reason);
  assert.deepEqual(anywhere.bypasses.map((b) => `${b.file}:${b.line}`), ["pkg/dashboards/board.py:1", "pkg/dashboards/board.py:5", "pkg/notebooks/render.py:1", "pkg/notebooks/render.py:5"]);

  const scoped = await checkChokepoint(adapter, { ...input, from: "outside the component", fromBy: "bullet" });
  assert.equal(scoped.grade, "broken", scoped.reason);
  assert.deepEqual(scoped.bypasses.map((b) => `${b.file}:${b.line}`), ["pkg/dashboards/board.py:1", "pkg/dashboards/board.py:5"], "only the other component's references are bypasses");
  assert.deepEqual(scoped.sites.filter((s) => s.file === "pkg/notebooks/render.py").map((s) => `${s.line} ${s.class}`), ["1 exempt", "5 exempt"], "the component's own references are exempt, never dropped");
  assert.match(scoped.reason, /governs only references from outside pkg\/notebooks .* so 2 references from inside it are exempt/);
  assert.equal(scoped.refutation, "automatic", scoped.refutationAccount);
  assert.match(scoped.refutationAccount, /a use of NOTEBOOK_ROWS from the unsaved document pkg\/coherence_refutation_[0-9a-f]+\.py, outside pkg\/notebooks/);
});
