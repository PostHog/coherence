/**
 * The config's ignore list names a file as it names a folder: by its bare
 * name, which matches it anywhere, or by its path from the root, which
 * matches that one file. Every reader of the list honours it: the walks,
 * the bounded listing, the code walks, the vocabulary corpus, an edit's
 * reading, lexicon coverage and the Python adapter's bounded workspace. A
 * file elsewhere by the same name as a path entry is still read. An entry
 * that names nothing is a spec problem, so a typo in it is never silent.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { after, before, test } from "node:test";
import { boundedProjectFiles, underIgnored, walkBounds, walkedProjectFiles } from "./project-files.ts";
import { boundedWorkspaceConfig } from "../../plugins/python/python.ts";
import { sourceFiles } from "../economy/source.ts";
import { collectFiles, corpusFiles } from "../lifecycle/check.ts";
import { loadLexicon } from "../lifecycle/lexicon.ts";
import { lexiconCoverage } from "../lifecycle/lexicon-coverage.ts";
import { COHERENCE_LEXICON } from "../lifecycle/project.ts";
import { loadSpecModel } from "../spec/model.ts";

// Bare names (a file at the root and below it, a file only below it, a folder) and paths (a file in a folder, a file at a nested path).
const IGNORE = ["CHANGELOG.md", "route.generated.ts", "vendor", "src/generated.ts", "notes/draft.md"];

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
  write(root, "lib/generated.ts", "export const kept = 1;\n");
  write(root, "src/app/users/route.generated.ts", "export const users = 1;\n");
  write(root, "src/app/teams/route.generated.ts", "export const teams = 1;\n");
  write(root, "vendor/lib.ts", "export const lib = 1;\n");
  write(root, "CHANGELOG.md", "A `changeset` bumped it.\nThe `changeset` was patch.\nEvery `changeset` is generated.\n");
  write(root, "pkg/CHANGELOG.md", "A `changeset` bumped it.\nThe `changeset` was minor.\nEvery `changeset` is generated.\n");
  write(root, "notes/draft.md", "A `scribble` here.\nThe `scribble` was rough.\nEvery `scribble` is a draft.\n");
  write(root, "pkg/draft.md", "A `release` shipped.\nThe `release` was minor.\nEvery `release` is tagged.\n");
});

after(() => {
  for (const base of roots) rmSync(base, { recursive: true, force: true });
});

test("the ignore list names a file by its name anywhere or by its path from the root: every walk, the vocabulary corpus, an edit's reading and coverage leave it out, and a file elsewhere beside a path entry is read", async () => {
  // The one rule, asked directly: a bare name matches the file at the root and below it; a path matches that file alone.
  for (const file of ["CHANGELOG.md", "pkg/CHANGELOG.md", "src/app/users/route.generated.ts", "src/generated.ts", "notes/draft.md", "vendor/lib.ts"]) assert.ok(underIgnored(file, IGNORE), file);
  for (const file of ["lib/generated.ts", "pkg/draft.md", "src/main.ts", "CHANGELOG.md.bak", "src/app/route.ts"]) assert.ok(!underIgnored(file, IGNORE), file);

  // The walks name the rule that left each file out, and read the files a path entry does not name.
  const walked = walkedProjectFiles(walkBounds(root, IGNORE));
  const reason = (file: string) => walked.excluded.find((e) => e.file === file)?.reason;
  assert.equal(reason("CHANGELOG.md"), "config ignore: CHANGELOG.md");
  assert.equal(reason("pkg/CHANGELOG.md"), "config ignore: CHANGELOG.md");
  assert.equal(reason("src/app/users/route.generated.ts"), "config ignore: route.generated.ts");
  assert.equal(reason("src/app/teams/route.generated.ts"), "config ignore: route.generated.ts");
  assert.equal(reason("src/generated.ts"), "config ignore: src/generated.ts");
  assert.equal(reason("notes/draft.md"), "config ignore: notes/draft.md");
  assert.ok(walked.files.includes("lib/generated.ts") && walked.files.includes("pkg/draft.md"), walked.files.join(", "));
  const bounded = boundedProjectFiles(root);
  assert.ok(!bounded.some((f) => f.endsWith("CHANGELOG.md") || f.endsWith("route.generated.ts") || f === "src/generated.ts" || f === "notes/draft.md"), bounded.join(", "));
  assert.ok(bounded.includes("lib/generated.ts") && bounded.includes("pkg/draft.md"), bounded.join(", "));
  assert.deepEqual(sourceFiles(root, "typescript", IGNORE).sort(), ["lib/generated.ts", "src/main.ts"]);

  // The vocabulary corpus and an edit's reading leave the named files out.
  const coherence = await loadLexicon(COHERENCE_LEXICON);
  const corpus = (await collectFiles({ root, coherence })).files.map((p) => relative(root, p));
  assert.ok(!corpus.some((f) => f.endsWith("CHANGELOG.md") || f === "notes/draft.md" || f === "src/generated.ts"), corpus.join(", "));
  assert.ok(corpus.includes("pkg/draft.md"), corpus.join(", "));
  assert.deepEqual((await corpusFiles({ root, coherence }, ["CHANGELOG.md", "pkg/CHANGELOG.md", "notes/draft.md", "src/generated.ts"])).map((f) => f.rel), []);

  // Coverage counts no word only the ignored files hold, and still counts the other file's.
  const coverage = await lexiconCoverage(root);
  assert.ok(!coverage.population.files.some((f) => f.file.endsWith("CHANGELOG.md")), JSON.stringify(coverage.population.files));
  assert.ok(!coverage.terms.some((t) => t.term === "changeset"), "a word only the CHANGELOG.md files hold tops nothing");
  assert.ok(!coverage.terms.some((t) => t.term === "scribble"), "a word only the file named by path holds tops nothing");
  assert.ok(coverage.terms.some((t) => t.term === "release"), "the file of the same name the path entry does not name is read");

  // The Python adapter's bounded workspace excludes a bare name anywhere and a path from the root.
  const py = project({ language: "python", ignore: IGNORE });
  write(py, "pyrightconfig.json", "{}\n");
  const folder = mkdtempSync(join(tmpdir(), "coherence-ignore-files-pyright-"));
  roots.push(folder);
  const exclude = (boundedWorkspaceConfig(py, folder, { exclude: IGNORE })?.["exclude"] ?? []) as string[];
  const from = (path: string) => relative(folder, join(py, path)).split("\\").join("/");
  for (const glob of ["**/CHANGELOG.md", "**/route.generated.ts", "**/vendor", from("src/generated.ts"), from("notes/draft.md")]) assert.ok(exclude.includes(glob), `${glob} in ${exclude.join(", ")}`);
});

test("an ignore entry that names no file or folder is a spec problem; a folder or a file by name or path, and a folder git ignores, are not", () => {
  // Every entry here names something: a file and a folder by path, a folder and a file by their names below the root, and a folder on disk git ignores.
  const named = project({ language: "typescript", ignore: ["CHANGELOG.md", "src/generated.ts", "generated", "dist", "route.generated.ts"] });
  write(named, "pkg/CHANGELOG.md", "notes\n");
  write(named, "src/generated.ts", "export const g = 1;\n");
  write(named, "pkg/generated/out.ts", "export const o = 1;\n");
  write(named, "src/app/users/route.generated.ts", "export const r = 1;\n");
  write(named, ".gitignore", "dist/\n");
  write(named, "dist/bundle.js", "1;\n");
  const ignoreProblems = (base: string) => loadSpecModel(base, { runs: false }).problems.filter((p) => p.message.startsWith("ignore entry"));
  assert.deepEqual(ignoreProblems(named), []);

  // A typo, a path that moved, a file path that does not exist and a bare name no file or folder bears name nothing; each is reported where it is written.
  const typo = project({ language: "typescript", ignore: ["CHANGELOG.md", "CHANGELGO.md", "src/old", "pkg/missing.ts", "missing.generated.ts"] });
  write(typo, "pkg/CHANGELOG.md", "notes\n");
  write(typo, "src/main.ts", "export const m = 1;\n");
  const found = ignoreProblems(typo);
  assert.deepEqual(found.map((p) => p.message.match(/"([^"]+)"/)?.[1]), ["CHANGELGO.md", "src/old", "pkg/missing.ts", "missing.generated.ts"]);
  assert.ok(found.every((p) => p.file === "coherence.config.json" && p.line === 1), JSON.stringify(found));
  assert.ok(found.every((p) => p.message.endsWith("A folder or a file is named by its name, which matches it anywhere, or by its path from the root")), found[0]?.message);
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
