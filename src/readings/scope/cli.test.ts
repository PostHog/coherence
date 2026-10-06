/**
 * The scope command as an adopter runs it: from the project's own folder,
 * with no --root. Coherence's lexicon comes from this installation and the
 * page is titled from the project's config, never from Coherence's checkout
 * layout.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { COHERENCE_LEXICON } from "../../lifecycle/project.ts";
import type { ShellState } from "./model.ts";
import { scopeCommand } from "./cli.ts";

test("scope run from an adopter's own folder reads Coherence's lexicon from the installation and names the page after the project", async () => {
  const root = mkdtempSync(join(tmpdir(), "coherence-scope-adopter-"));
  try {
    writeFileSync(join(root, "coherence.config.json"), JSON.stringify({ name: "demo", language: "typescript" }), "utf8");
    mkdirSync(join(root, "src", "billing"), { recursive: true });
    writeFileSync(join(root, "Demo.spec.md"), "# Demo\n\nA demo project.\n", "utf8");
    const out = join(root, "scope.html");
    const errors: string[] = [];
    const code = await scopeCommand(["--snapshot", "--out", out, "--no-interfaces"], { cwd: root, out: () => {}, err: (line) => errors.push(line) });
    assert.equal(code, 0, `the snapshot is written: ${errors.join("\n")}`);
    const html = readFileSync(out, "utf8");
    const match = /<script type="application\/json" id="scope-state">([\s\S]*?)<\/script>/.exec(html);
    assert.ok(match?.[1] !== undefined, "the page embeds its state");
    const state = JSON.parse(match[1]) as ShellState;
    const own = JSON.parse(readFileSync(COHERENCE_LEXICON, "utf8")) as { concepts: unknown[] };
    const first = state.lexicon.layers[0];
    assert.equal(first?.kind, "present", "Coherence's lexicon layer is present");
    assert.equal(first?.kind === "present" ? first.lexicon.concepts.length : -1, own.concepts.length, "and it is the installation's lexicon");
    assert.equal(state.project, "Demo", "the page is named after the project's config");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a snapshot without --out lands in the project's .coherence folder, resolved against the root, and never in a served folder such as public/", async () => {
  const root = mkdtempSync(join(tmpdir(), "coherence-scope-default-"));
  const elsewhere = mkdtempSync(join(tmpdir(), "coherence-scope-cwd-"));
  try {
    writeFileSync(join(root, "coherence.config.json"), JSON.stringify({ name: "demo", language: "typescript" }), "utf8");
    writeFileSync(join(root, "Demo.spec.md"), "# Demo\n\nA demo project.\n", "utf8");
    mkdirSync(join(root, "public"), { recursive: true });
    const errors: string[] = [];
    // Run from another folder with --root, as an agent outside the project would.
    const code = await scopeCommand(["--snapshot", "--root", root, "--no-interfaces"], { cwd: elsewhere, out: () => {}, err: (line) => errors.push(line) });
    assert.equal(code, 0, errors.join("\n"));
    assert.ok(existsSync(join(root, ".coherence", "scope", "_scope.html")), "the page is under the project's .coherence folder");
    assert.deepEqual(readdirSync(join(root, "public")), [], "nothing is written into the served folder");
    assert.ok(!existsSync(join(elsewhere, ".coherence")) && !existsSync(join(elsewhere, "public")), "nothing is written beside the working folder");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(elsewhere, { recursive: true, force: true });
  }
});
