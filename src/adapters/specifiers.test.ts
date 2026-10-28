/**
 * The pure rules the review of the JavaScript admission asked for: which
 * files a relative specifier may name, which of them a resolver with the file
 * list picks, and which files count as the project's sources when the walk
 * holds compiled JavaScript beside TypeScript.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { importsOf, resolveModule } from "../economy/source.ts";
import { projectSources, resolveSpecifier, seedFile, specifierCandidates } from "../../plugins/typescript/typescript.ts";

test("a NodeNext specifier written with .js names the TypeScript source first, and the JavaScript file only where that is what exists", () => {
  const candidates = specifierCandidates("src/index.ts", "./foo.js");
  assert.deepEqual(candidates.slice(0, 2), ["src/foo.js", "src/foo.ts"], "the specifier as written, then its TypeScript rewrite");
  const typescriptProject = new Set(["src/index.ts", "src/foo.ts"]);
  assert.equal(resolveSpecifier("src/index.ts", "./foo.js", (c) => typescriptProject.has(c)), "src/foo.ts", "export * from './foo.js' in a NodeNext project reaches foo.ts");
  const javascriptProject = new Set(["src/index.js", "src/foo.js"]);
  assert.equal(resolveSpecifier("src/index.js", "./foo.js", (c) => javascriptProject.has(c)), "src/foo.js");
  assert.equal(resolveSpecifier("src/index.ts", "./foo.js"), "src/foo.js", "without a file list the specifier as written wins, so readers that cannot test existence key by every candidate instead");
});

test("an extensionless specifier has JavaScript and folder-index candidates, in TypeScript-first order", () => {
  const candidates = specifierCandidates("src/app.js", "./components");
  assert.ok(candidates.includes("src/components.js"), candidates.join(","));
  assert.ok(candidates.includes("src/components/index.js"), candidates.join(","));
  assert.ok(candidates.indexOf("src/components.ts") < candidates.indexOf("src/components.js"));
  const bundlerProject = new Set(["src/app.js", "src/components/index.js"]);
  assert.equal(resolveSpecifier("src/app.js", "./components", (c) => bundlerProject.has(c)), "src/components/index.js");
  assert.deepEqual(specifierCandidates("src/app.ts", "react"), [], "a package is never a project file");
  assert.deepEqual(specifierCandidates("src/app.ts", "../../outside.ts"), [], "a specifier that leaves the project names nothing");
  assert.deepEqual(resolveSpecifier("src/index.ts", "./missing.js", () => false), undefined, "no existing candidate resolves to nothing, never to a guess");
});

test("compiled JavaScript a repository tracks beside its TypeScript is not a source: the seed and the text search stay on the TypeScript", () => {
  const tracked = ["dist/bar.js", "dist/foo.js", "src/bar.ts", "src/foo.ts"];
  assert.deepEqual(projectSources(tracked), ["src/bar.ts", "src/foo.ts"]);
  assert.equal(seedFile(tracked), "src/bar.ts", "the seed is a TypeScript file, never the compiled copy that sorts first");
  assert.deepEqual(projectSources(["src/a.mjs", "src/b.js", "README.md"]), ["src/a.mjs", "src/b.js"], "a project with no TypeScript is written in JavaScript");
  assert.equal(seedFile(["lib/types.d.ts", "src/a.mjs"]), "src/a.mjs", "a declaration file is neither language's source");
});

test("a specifier the project's tsconfig paths alias names the project file it aliases, longest pattern first, an exact pattern only when written whole, and a package never", () => {
  const root = mkdtempSync(join(tmpdir(), "coherence-alias-"));
  try {
    const files: Record<string, string> = {
      "tsconfig.json": `{\n  // Next.js writes comments and trailing commas\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": { "@/*": ["./src/*"], "@/lib/*": ["./packages/lib/*"], "config": ["./config/index.ts"], },\n  },\n}\n`,
      "src/app/page.ts": "import { load } from '@/lib/load'\nimport { x } from '@/util'\nimport conf from 'config'\nimport react from 'react'\nimport { y } from '@/missing'\n",
      "src/util.ts": "export const x = 1\n",
      "packages/lib/load.ts": "export function load() {}\n",
      "src/lib/load.ts": "export function load() {}\n",
      "config/index.ts": "export default {}\n",
    };
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(join(root, dirname(file)), { recursive: true });
      writeFileSync(join(root, file), text);
    }
    assert.equal(resolveModule(root, "src/app/page.ts", "@/util", "typescript"), "src/util.ts", "@/* to ./src/*");
    assert.equal(resolveModule(root, "src/app/page.ts", "@/lib/load", "typescript"), "packages/lib/load.ts", "the longer pattern wins, as the compiler picks it");
    assert.equal(resolveModule(root, "src/app/page.ts", "config", "typescript"), "config/index.ts", "an exact pattern");
    assert.equal(resolveModule(root, "src/app/page.ts", "config/other", "typescript"), undefined, "an exact pattern matches only when written whole");
    assert.equal(resolveModule(root, "src/app/page.ts", "react", "typescript"), undefined, "a package no pattern names is never a project file");
    assert.equal(resolveModule(root, "src/app/page.ts", "@/missing", "typescript"), undefined, "an alias to a file that is not there resolves to nothing, never a guess");
    assert.deepEqual(importsOf(root, "src/app/page.ts", files["src/app/page.ts"]!, "typescript").map((i) => i.module).sort(), ["config/index.ts", "packages/lib/load.ts", "src/util.ts"], "the import scan reads through them");
    writeFileSync(join(root, "tsconfig.json"), "{ not json");
    assert.equal(resolveModule(root, "src/app/page.ts", "@/util", "typescript"), undefined, "an unreadable tsconfig aliases nothing");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
