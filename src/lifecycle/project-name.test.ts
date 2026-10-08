/**
 * The project's name has one source, the config's `name`: lexicon apply
 * stores no copy of it, every reader of the project lexicon takes the
 * config's, a lexicon written before the config named the project keeps its
 * stored name only where the config gives none, and a stored name that
 * disagrees with the config's is a spec problem.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { after, test } from "node:test";
import { acceptedNames } from "./lexicon.ts";
import { applyProposal, propose } from "./lexicon-maintain.ts";
import { loadProjectLexicons } from "./project.ts";
import { loadSpecModel } from "../spec/model.ts";
import { projectNameOf } from "../readings/scope/build.ts";

const who = { session: "project-name-test", agent: "test" };
const roots: string[] = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function project(config: Record<string, unknown>, lexicon?: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), "coherence-project-name-"));
  roots.push(root);
  writeFileSync(join(root, "coherence.config.json"), JSON.stringify(config));
  if (lexicon !== undefined) writeFileSync(join(root, "lexicon.json"), JSON.stringify(lexicon, null, 2));
  writeFileSync(join(root, "notes.md"), "A `roster` is a player's army list.\n");
  return root;
}

const nameProblems = (root: string) => loadSpecModel(root, { runs: false }).problems.filter((p) => p.message.includes("the lexicon stores project"));

test("the project's name is the config's: lexicon apply stores no copy, readers of the lexicon take the config's name, and a stored one only where the config names none", async () => {
  // A folder named otherwise than the config's name: apply writes no project, and the loaded lexicon carries the config's.
  const root = project({ name: "praetorium", language: "typescript" });
  assert.notEqual(basename(root), "praetorium");
  const proposal = await propose(root, { action: "declare", name: "roster", definition: "A player's army list.", because: "the domain's own noun" });
  applyProposal(root, proposal.id, who, "the domain's own noun", ["none"]);
  const written = JSON.parse(readFileSync(join(root, "lexicon.json"), "utf8")) as Record<string, unknown>;
  assert.ok(!("project" in written), `a new lexicon stores no project: ${JSON.stringify(written)}`);
  const loaded = (await loadProjectLexicons(root)).project!;
  assert.equal(loaded.project, "praetorium");
  assert.ok(acceptedNames(loaded).has("praetorium"));
  assert.ok(!acceptedNames(loaded).has(basename(root).toLowerCase()), "the folder's name is no accepted name");
  assert.equal(projectNameOf(root), "Praetorium", "Scope's masthead takes the same name");

  // A lexicon that stored the folder's name (as apply once did): the config's name is read over it.
  const stale = project({ name: "praetorium", language: "typescript" }, { version: 1, project: "praetorium-gg", concepts: [] });
  assert.equal((await loadProjectLexicons(stale)).project!.project, "praetorium");

  // With no name configured, a stored name is still read, and the folder's only when the lexicon stored none.
  const unnamed = project({ language: "typescript" }, { version: 1, project: "acme", concepts: [] });
  assert.equal((await loadProjectLexicons(unnamed)).project!.project, "acme");
  const bare = project({ language: "typescript" }, { version: 1, concepts: [] });
  assert.equal((await loadProjectLexicons(bare)).project!.project, basename(bare));
});

test("a stored project name that disagrees with the config's name is a spec problem at the lexicon; one that agrees, none stored, or no configured name is not", () => {
  const stale = project({ name: "praetorium", language: "typescript" }, { version: 1, project: "praetorium-gg", concepts: [] });
  const found = nameProblems(stale);
  assert.equal(found.length, 1, JSON.stringify(found));
  assert.equal(found[0]!.file, "lexicon.json");
  assert.equal(found[0]!.line, 3);
  assert.match(found[0]!.message, /"praetorium-gg".*"praetorium"/);

  // A stored name that agrees, in any case, is no problem.
  assert.deepEqual(nameProblems(project({ name: "praetorium" }, { version: 1, project: "Praetorium", concepts: [] })), []);

  // None stored, and a stored name under a config that names no project.
  assert.deepEqual(nameProblems(project({ name: "praetorium" }, { version: 1, concepts: [] })), []);
  assert.deepEqual(nameProblems(project({ language: "typescript" }, { version: 1, project: "acme", concepts: [] })), []);
});
