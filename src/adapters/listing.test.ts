/**
 * The project's file listing taken once: what keepProjectFiles answers with a
 * listing is exactly what it answers asking git, and the TypeScript adapter's
 * listing lasts until a forget, never past it.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { keepProjectFiles, projectListing } from "./project-files.ts";
import { TypeScriptAdapter } from "./typescript.ts";
import { PythonAdapter } from "./python.ts";

function repo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "coherence-listing-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const git = (...args: string[]) => spawnSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { cwd: root, encoding: "utf8" });
  git("init", "-q");
  git("add", "-A");
  git("commit", "-q", "-m", "seed");
  return root;
}

test("keepProjectFiles with a listing taken once answers exactly as it does asking git: tracked, untracked, ignored, deleted, nested, folder and outside paths", () => {
  const root = repo({ ".gitignore": "gen/\n", "src/a.ts": "a", "src/gone.ts": "b", "gen/x.ts": "c" });
  try {
    writeFileSync(join(root, "src/new.ts"), "untracked");
    unlinkSync(join(root, "src/gone.ts"));
    mkdirSync(join(root, "nested/.git"), { recursive: true });
    writeFileSync(join(root, "nested/inside.ts"), "another checkout");
    const paths = ["src/a.ts", "src/new.ts", "src/gone.ts", "gen/x.ts", "nested/inside.ts", "src", "../outside.ts", join(root, "src/a.ts"), "src/missing.ts"];
    const listing = projectListing(root);
    assert.ok(listing !== undefined, "a repository has a listing");
    assert.deepEqual([...keepProjectFiles(root, paths, listing)].sort(), [...keepProjectFiles(root, paths)].sort());
    assert.deepEqual([...keepProjectFiles(root, paths, listing)].sort(), ["src/a.ts", "src/gone.ts", "src/new.ts"], "a tracked file just deleted is still the project's, as git says");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the TypeScript adapter reads the project's files once per forget: a file created after the listing is found only after a forget", { timeout: 120_000 }, async () => {
  const root = repo({
    "tsconfig.json": JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", allowImportingTsExtensions: true, noEmit: true, strict: true }, include: ["src/**/*.ts"] }),
    "src/first.ts": "export function first(): number {\n  return 1;\n}\n",
  });
  const adapter = new TypeScriptAdapter(root);
  try {
    const before = await adapter.resolve("first in first.ts", { component: "src", testFolders: [] });
    assert.equal(before.ok, true, "the first file resolves");
    writeFileSync(join(root, "src/second.ts"), "export function second(): number {\n  return 2;\n}\n");
    const stale = await adapter.resolve("second in second.ts", { component: "src", testFolders: [] });
    assert.equal(stale.ok, false, "between forgets the listing holds still: a new file is not read");
    await adapter.forget(["src/second.ts"]);
    const fresh = await adapter.resolve("second in second.ts", { component: "src", testFolders: [] });
    assert.equal(fresh.ok, true, "after a forget the new file is found");
  } finally {
    await adapter.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("the Python adapter reads the project's files once per forget: a module created after the listing is found only after a forget", { timeout: 120_000 }, async () => {
  const root = repo({ "pkg/__init__.py": "", "pkg/first.py": "def first():\n    return 1\n" });
  const adapter = new PythonAdapter(root);
  try {
    const before = await adapter.resolve("first in first.py", { component: "pkg", testFolders: [] });
    assert.equal(before.ok, true, before.ok ? "" : before.reason);
    writeFileSync(join(root, "pkg/second.py"), "def second():\n    return 2\n");
    const stale = await adapter.resolve("second in second.py", { component: "pkg", testFolders: [] });
    assert.equal(stale.ok, false, "between forgets the listing holds still: a new module is not read");
    await adapter.forget(["pkg/second.py"]);
    const fresh = await adapter.resolve("second in second.py", { component: "pkg", testFolders: [] });
    assert.equal(fresh.ok, true, "after a forget the new module is found");
  } finally {
    await adapter.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("a cold server resolves a name the project declares even when the first source file of the walk lies outside the TypeScript project", { timeout: 120_000 }, async () => {
  const { seedFile } = await import("./typescript.ts");
  const root = repo({
    "tsconfig.json": JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", allowImportingTsExtensions: true, noEmit: true, strict: true }, include: ["src/**/*.ts"] }),
    "bench/a-measure.ts": "export const measured = 1;\n",
    "src/w/W.spec.md": "# W\n\nWidgets.\n\n## invariants\n",
    "src/w/thing.ts": "export function thing(): number {\n  return 1;\n}\n",
  });
  assert.equal(seedFile(["bench/a-measure.ts", "src/w/W.spec.md", "src/w/thing.ts"]), "src/w/thing.ts", "the seed is a source file inside a component folder");
  const adapter = new TypeScriptAdapter(root);
  try {
    const resolved = await adapter.resolve("thing", { component: "src/w", testFolders: [] });
    assert.equal(resolved.ok, true, resolved.ok ? "" : resolved.reason);
  } finally {
    await adapter.close();
    rmSync(root, { recursive: true, force: true });
  }
});
