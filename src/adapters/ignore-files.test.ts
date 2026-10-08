/**
 * The config's ignore list names a file by its path from the root, as it
 * names a folder by its name or its path, and every reader of the list
 * honours it: the walks, the bounded listing, the code walks, the vocabulary
 * corpus, an edit's reading and lexicon coverage. A file elsewhere by the
 * same name is still read. An entry that names nothing is a spec problem, so
 * a typo in it is never silent.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { after, before, test } from "node:test";
import { boundedProjectFiles, underIgnored, walkBounds, walkedProjectFiles } from "./project-files.ts";
import { sourceFiles } from "../economy/source.ts";
import { collectFiles, corpusFiles } from "../lifecycle/check.ts";
import { loadLexicon } from "../lifecycle/lexicon.ts";
import { lexiconCoverage } from "../lifecycle/lexicon-coverage.ts";
import { COHERENCE_LEXICON } from "../lifecycle/project.ts";
import { loadSpecModel } from "../spec/model.ts";

const IGNORE = ["CHANGELOG.md", "src/generated.ts", "vendor"];

let root: string;
const roots: string[] = [];

function write(base: string, path: string, text: string): void {
  mkdirSync(dirname(join(base, path)), { recursive: true });
  writeFileSync(join(base, path), text, "utf8");
}

function project(config: Record<string, unknown>): string {
  const base = mkdtempSync(join(tmpdir(), "coherence-ignore-files-"));
  roots.push(base);
  assert.equal(spawnSync("git", ["init", "-q"], { cwd: base }).status, 0, "git init");
  write(base, "coherence.config.json", JSON.stringify(config));
  return base;
}

before(() => {
  root = project({ language: "typescript", ignore: IGNORE });
  write(root, "src/Src.spec.md", "# Src\n\nThe source.\n");
  write(root, "src/main.ts", "export const main = 1;\n");
  write(root, "src/generated.ts", "export const generated = 1;\n");
  write(root, "vendor/lib.ts", "export const lib = 1;\n");
  write(root, "CHANGELOG.md", "A `changeset` bumped it.\nThe `changeset` was patch.\nEvery `changeset` is generated.\n");
  write(root, "pkg/CHANGELOG.md", "A `release` shipped.\nThe `release` was minor.\nEvery `release` is tagged.\n");
});

after(() => {
  for (const base of roots) rmSync(base, { recursive: true, force: true });
});

test("the ignore list names a file by its path: every walk, the vocabulary corpus, an edit's reading and coverage leave it out, and a file elsewhere by the same name is read", async () => {
  // The one rule, asked directly: a file by its path from the root, never by its name anywhere.
  assert.ok(underIgnored("CHANGELOG.md", IGNORE));
  assert.ok(underIgnored("src/generated.ts", IGNORE));
  assert.ok(!underIgnored("pkg/CHANGELOG.md", IGNORE));
  assert.ok(!underIgnored("src/main.ts", IGNORE));

  // The walks name the rule that left each file out, and read the other CHANGELOG.md.
  const walked = walkedProjectFiles(walkBounds(root, IGNORE));
  assert.deepEqual(walked.excluded.find((e) => e.file === "CHANGELOG.md"), { file: "CHANGELOG.md", reason: "config ignore: CHANGELOG.md" });
  assert.deepEqual(walked.excluded.find((e) => e.file === "src/generated.ts"), { file: "src/generated.ts", reason: "config ignore: src/generated.ts" });
  assert.ok(walked.files.includes("pkg/CHANGELOG.md"), walked.files.join(", "));
  const bounded = boundedProjectFiles(root);
  assert.ok(!bounded.includes("CHANGELOG.md") && !bounded.includes("src/generated.ts") && bounded.includes("pkg/CHANGELOG.md"), bounded.join(", "));
  assert.deepEqual(sourceFiles(root, "typescript", IGNORE), ["src/main.ts"]);

  // The vocabulary corpus and an edit's reading leave the named file out.
  const coherence = await loadLexicon(COHERENCE_LEXICON);
  const corpus = (await collectFiles({ root, coherence })).files.map((p) => relative(root, p));
  assert.ok(!corpus.includes("CHANGELOG.md") && !corpus.includes("src/generated.ts"), corpus.join(", "));
  assert.ok(corpus.includes("pkg/CHANGELOG.md"), corpus.join(", "));
  assert.deepEqual((await corpusFiles({ root, coherence }, ["CHANGELOG.md", "src/generated.ts"])).map((f) => f.rel), []);

  // Coverage counts no word only the ignored file holds, and still counts the other file's.
  const coverage = await lexiconCoverage(root);
  assert.ok(!coverage.population.files.some((f) => f.file === "CHANGELOG.md"), JSON.stringify(coverage.population.files));
  assert.ok(!coverage.terms.some((t) => t.term === "changeset"), "a word only the ignored CHANGELOG.md holds tops nothing");
  assert.ok(coverage.terms.some((t) => t.term === "release"), "the CHANGELOG.md the list does not name is read");
});

test("an ignore entry that names no file or folder is a spec problem; a folder by name or path, a file by path, and a folder git ignores are not", () => {
  // Every entry here names something: a file and a folder by path, a folder by its name below the root, and a folder on disk git ignores.
  const named = project({ language: "typescript", ignore: ["CHANGELOG.md", "src/generated.ts", "generated", "dist"] });
  write(named, "CHANGELOG.md", "notes\n");
  write(named, "src/generated.ts", "export const g = 1;\n");
  write(named, "pkg/generated/out.ts", "export const o = 1;\n");
  write(named, ".gitignore", "dist/\n");
  write(named, "dist/bundle.js", "1;\n");
  const ignoreProblems = (base: string) => loadSpecModel(base, { runs: false }).problems.filter((p) => p.message.startsWith("ignore entry"));
  assert.deepEqual(ignoreProblems(named), []);

  // A typo, a path that moved, and a file named by its bare name below the root name nothing; each is reported where it is written.
  const typo = project({ language: "typescript", ignore: ["CHANGELOG.md", "CHANGELGO.md", "src/old", "pkg/missing.ts"] });
  write(typo, "pkg/CHANGELOG.md", "notes\n");
  write(typo, "src/main.ts", "export const m = 1;\n");
  const found = ignoreProblems(typo);
  assert.deepEqual(found.map((p) => p.message.match(/"([^"]+)"/)?.[1]), ["CHANGELOG.md", "CHANGELGO.md", "src/old", "pkg/missing.ts"]);
  assert.ok(found.every((p) => p.file === "coherence.config.json" && p.line === 1), JSON.stringify(found));
});

test("an ignore entry git ignores is no spec problem though nothing it names is there: dist and build absent in a single-package repo, and dist only in a monorepo package; a typo beside them still is", () => {
  const ignoreProblems = (base: string) => loadSpecModel(base, { runs: false }).problems.filter((p) => p.message.startsWith("ignore entry"));

  // A single package whose build output is gitignored and absent, as in a fresh checkout or CI.
  const single = project({ language: "typescript", ignore: ["dist", "build", "dsit"] });
  write(single, ".gitignore", "dist/\nbuild\n");
  write(single, "src/main.ts", "export const m = 1;\n");
  assert.deepEqual(ignoreProblems(single).map((p) => p.message.match(/"([^"]+)"/)?.[1]), ["dsit"], "only the typo names nothing git ignores");

  // A monorepo whose package ignores its own dist: absent in one package, present (and so unlisted) in another.
  const mono = project({ language: "typescript", ignore: ["dist", "packages/api/build", "buidl"] });
  write(mono, "packages/web/.gitignore", "dist/\n");
  write(mono, "packages/web/src/index.ts", "export const w = 1;\n");
  write(mono, "packages/api/.gitignore", "dist/\nbuild/\n");
  write(mono, "packages/api/src/index.ts", "export const a = 1;\n");
  write(mono, "packages/api/dist/index.js", "1;\n");
  assert.deepEqual(ignoreProblems(mono).map((p) => p.message.match(/"([^"]+)"/)?.[1]), ["buidl"], "a nested-only dist and an absent gitignored path are no typo");
});
