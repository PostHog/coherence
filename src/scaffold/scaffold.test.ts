/**
 * The scaffold check: the component and invariant shapes, written into a
 * temporary directory and read back through the spec model.
 */

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Io } from "../journal/cli.ts";
import { KEYS } from "../spec/grammar.ts";
import { loadSpecModel } from "../spec/model.ts";
import { applicableShapes, loadSeed } from "../spec/seed.ts";
import { scaffoldCommand } from "./cli.ts";
import { renderInvariant } from "./scaffold.ts";

const seed = loadSeed();

interface Run {
  code: number;
  out: string[];
  err: string[];
}

function runner(cwd: string): (...argv: string[]) => Run {
  return (...argv) => {
    const run: Run = { code: 0, out: [], err: [] };
    const io: Io = { cwd, out: (line) => run.out.push(line), err: (line) => run.err.push(line) };
    run.code = scaffoldCommand(argv, io);
    return run;
  };
}

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "coherence-scaffold-"));
}

test("scaffold component creates the folder and a spec with the intent and an empty invariants section, and refuses to overwrite", () => {
  const root = scratch();
  try {
    const run = runner(root);
    const first = run("component", "src/vault", "Holds the secrets.");
    assert.equal(first.code, 0, first.err.join("\n"));
    const path = join(root, "src", "vault", "Vault.spec.md");
    assert.ok(existsSync(path));
    assert.equal(readFileSync(path, "utf8"), "# Vault\n\nHolds the secrets.\n\n## invariants\n");
    const again = run("component", "src/vault", "Something else.");
    assert.equal(again.code, 1);
    assert.match(again.err.join("\n"), /already holds a spec: Vault\.spec\.md/);
    assert.equal(readFileSync(path, "utf8"), "# Vault\n\nHolds the secrets.\n\n## invariants\n", "the spec is untouched");
    const model = loadSpecModel(root, { seed });
    assert.deepEqual(model.problems, []);
    assert.equal(model.components[0]?.intent, "Holds the secrets.");
    const noIntent = run("component", "src/other", "");
    assert.equal(noIntent.code, 1);
    assert.match(noIntent.err.join("\n"), /needs its intent/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("scaffold invariant prints every slot and only the applicable checklist shapes", () => {
  const { bullet, shapes } = renderInvariant(seed, { sentence: "A secret leaves only as a digest.", kinds: ["credential", "output"], form: "chokepoint" });
  const expected = applicableShapes(seed, ["credential", "output"]);
  assert.deepEqual(shapes, expected);
  assert.ok(expected.length > 0 && expected.length < seed.shapes.length);
  for (const key of KEYS) {
    if (key === "over" || key === "via") {
      assert.doesNotMatch(bullet, new RegExp(`^  ${key}:`, "m"), `the chokepoint form has no ${key}`);
    } else {
      assert.match(bullet, new RegExp(`^  ${key}:`, "m"), `slot ${key} is present`);
    }
  }
  assert.match(bullet, /^- <name>: A secret leaves only as a digest\.$/m);
  const checklist = bullet.split("\n").filter((line) => line.startsWith("  checklist:"));
  assert.deepEqual(
    checklist,
    expected.map((shape) => `  checklist: ${shape.shape} declared as <invariant name> | dismissed: <reason>`),
  );
  const totality = renderInvariant(seed, { sentence: "S.", name: "given", kinds: "none", form: "totality oracle" });
  assert.match(totality.bullet, /^- given: S\.$/m);
  assert.match(totality.bullet, /^  over: </m);
  assert.match(totality.bullet, /^  via: </m);
  assert.doesNotMatch(totality.bullet, /^  protects:/m);
  assert.match(totality.bullet, /^  kinds: none$/m);
  assert.doesNotMatch(totality.bullet, /checklist:/);
  assert.throws(() => renderInvariant(seed, { sentence: "S.", kinds: ["sprocket"], form: "chokepoint" }), /unknown kind sprocket/);
});

test("scaffold invariant --write appends to the invariants section, and the result parses as a requirement with unfilled slots", () => {
  const root = scratch();
  try {
    const run = runner(root);
    writeFileSync(join(root, "Root.spec.md"), "# Root\n\nThe root.\n\n## trust levels\n- a: one\n\n## invariants\n", "utf8");
    assert.equal(run("component", "vault", "Holds the secrets.").code, 0);
    const missing = run("invariant", "nowhere", "S.", "--kinds", "credential");
    assert.equal(missing.code, 1);
    assert.match(missing.err.join("\n"), /holds no spec; scaffold component nowhere/);
    const first = run("invariant", "vault", "A secret leaves only as a digest.", "--kinds", "credential,output", "--write");
    assert.equal(first.code, 0, first.err.join("\n"));
    assert.match(first.out.join("\n"), /appended to .*Vault\.spec\.md/);
    assert.match(first.err.join("\n"), /checklist shapes apply/);
    const second = run("invariant", "vault", "Second.", "--name", "second", "--kinds", "none", "--totality-oracle", "--write");
    assert.equal(second.code, 0, second.err.join("\n"));
    const text = readFileSync(join(root, "vault", "Vault.spec.md"), "utf8");
    assert.match(text, /## invariants\n- <name>: A secret leaves only as a digest\.\n  protects:/);
    assert.match(text, /\n- second: Second\.\n  over: /);
    const model = loadSpecModel(root, { seed });
    assert.deepEqual(model.problems, []);
    const vault = model.components.find((c) => c.folder === "vault");
    assert.ok(vault !== undefined);
    assert.deepEqual(
      vault.invariants.map((i) => [i.name, i.state, i.lacks]),
      [
        ["<name>", "requirement", ["enforcement", "refutation", "checklist", "because"]],
        ["second", "requirement", ["enforcement", "refutation", "because"]],
      ],
    );
    assert.ok(vault.invariants[0]!.unfilled.includes("name"));
    assert.ok(vault.invariants[0]!.unfilled.includes("chokepoint"));
    // Appending into a section that is not last keeps the next section in place.
    writeFileSync(join(root, "Root.spec.md"), "# Root\n\nThe root.\n\n## invariants\n\n## trust levels\n- a: one\n", "utf8");
    const third = run("invariant", ".", "Third.", "--name", "third", "--kinds", "none", "--write");
    assert.equal(third.code, 0, third.err.join("\n"));
    const rootText = readFileSync(join(root, "Root.spec.md"), "utf8");
    assert.match(rootText, /## invariants\n- third: Third\.\n(  .*\n)+\n## trust levels\n- a: one\n$/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the entry component is named for the project, not the checkout folder", async () => {
  const { mkdtempSync, writeFileSync: write } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join: j } = await import("node:path");
  const { specFileName } = await import("./scaffold.ts");
  const root = mkdtempSync(j(tmpdir(), "agent-0123abcd-"));
  assert.match(specFileName(".", root), /^Agent-0123abcd.*\.spec\.md$/, "no project name: the folder's");
  write(j(root, "package.json"), JSON.stringify({ name: "widgetry" }));
  assert.equal(specFileName(".", root), "Widgetry.spec.md", "package.json names the project");
  write(j(root, "coherence.config.json"), JSON.stringify({ name: "gadgetry" }));
  assert.equal(specFileName(".", root), "Gadgetry.spec.md", "coherence.config.json wins");
  assert.equal(specFileName("src/journal", root), "Journal.spec.md", "a component keeps its folder name");
});
