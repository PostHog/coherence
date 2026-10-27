/**
 * Only the project's own files are ever evidence. A git fixture carries a
 * protected thing and its chokepoint, a nested checkout (a folder holding a
 * `.git` file that points elsewhere, as an agent's worktree does) with a copy
 * of a file that reaches the protected thing directly, and an ignored path
 * with another such copy. Neither copy may be a bypass, a reference the
 * adapter reports, a file the edit hook re-checks, a file the vocabulary
 * check reads, or mass.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { keepProjectFiles, nestedCheckouts, projectFiles, projectFilesEnding } from "./project-files.ts";
import { ejectPlugin } from "../plugins/eject.ts";
import { TypeScriptAdapter } from "../../plugins/typescript/typescript.ts";
import { checkChokepoint } from "../enforcement/check.ts";
import { readEnforcementConfig } from "../enforcement/config.ts";
import { computeMass } from "../economy/mass.ts";
import { sourceFiles } from "../economy/source.ts";
import { collectFiles } from "../lifecycle/check.ts";
import { loadLexicon } from "../lifecycle/lexicon.ts";
import { COHERENCE_LEXICON } from "../lifecycle/project.ts";
import { editContext } from "../lifecycle/hook.ts";

const TSCONFIG = `{ "compilerOptions": { "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext", "strict": true, "noEmit": true, "allowImportingTsExtensions": true }, "include": ["src/**/*.ts"] }\n`;

const SECRETS = `export const SECRET_COLUMNS: Record<string, string[]> = { tokens: ["token"] };

export function seal(pattern: string, row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row };
  for (const column of SECRET_COLUMNS[pattern] ?? []) delete out[column];
  return out;
}
`;

const RENDER_CLEAN = `import { seal } from "../store/secrets.ts";

export function render(pattern: string, row: Record<string, unknown>): string {
  return JSON.stringify(seal(pattern, row));
}
`;

/** The same file as an agent's worktree holds it mid-edit: it reaches the protected thing directly. */
const bypassFrom = (secrets: string): string => `import { SECRET_COLUMNS } from "${secrets}";

export function leak(pattern: string): string[] {
  return SECRET_COLUMNS[pattern] ?? [];
}
`;

const SPEC = `# Fixture

A store with one door out.

## invariants
- digest-only egress: A secret leaves storage only through seal.
  protects: SECRET_COLUMNS
  chokepoint: seal
  because: a leaked row must disclose nothing
  kinds: none
`;

const NESTED = "src/agent-copy";
const NESTED_FILE = `${NESTED}/src/api/leak.ts`;
const IGNORED_FILE = "src/generated/leak.ts";

let root: string;
let adapter: TypeScriptAdapter;
const testFolders = readEnforcementConfig("/nowhere").testFolders;

function write(path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text, "utf8");
}

before(() => {
  root = mkdtempSync(join(tmpdir(), "coherence-project-files-"));
  assert.equal(spawnSync("git", ["init", "-q"], { cwd: root }).status, 0, "git init");
  write(".gitignore", "src/generated/\n");
  write("tsconfig.json", TSCONFIG);
  write("coherence.config.json", JSON.stringify({ language: "typescript" }));
  write("Fixture.spec.md", SPEC);
  write("src/store/secrets.ts", SECRETS);
  write("src/api/render.ts", RENDER_CLEAN);
  // A worktree's .git is a file naming its gitdir elsewhere; git cannot follow this one, so it lists the folder as untracked files.
  write(`${NESTED}/.git`, "gitdir: /nowhere/.git/worktrees/agent-copy\n");
  write(`${NESTED}/src/store/secrets.ts`, SECRETS);
  write(NESTED_FILE, bypassFrom("../../../../store/secrets.ts"));
  write(IGNORED_FILE, bypassFrom("../store/secrets.ts"));
  adapter = new TypeScriptAdapter(root);
});

after(async () => {
  await adapter.close();
  rmSync(root, { recursive: true, force: true });
});

test("only the project's own files are ever evidence: a nested checkout and an ignored path are no bypass, no vocabulary, and no mass", async () => {
  // The rule itself.
  const files = projectFiles(root);
  assert.ok(files.includes("src/api/render.ts") && files.includes("src/store/secrets.ts"), files.join(", "));
  assert.ok(!files.some((f) => f.startsWith(`${NESTED}/`)), `a nested checkout's files are not the project's: ${files.join(", ")}`);
  assert.ok(!files.includes(IGNORED_FILE), "an ignored file is not the project's");
  assert.deepEqual([...keepProjectFiles(root, ["src/api/render.ts", NESTED_FILE, IGNORED_FILE, join(root, "src/store/secrets.ts")])].sort(), ["src/api/render.ts", "src/store/secrets.ts"]);
  assert.deepEqual(nestedCheckouts(root), [NESTED]);

  // The chokepoint check: the instrument indexes src/**, so without the rule both copies would be bypasses.
  const hint = { component: ".", testFolders };
  const protectedThing = await adapter.resolve("SECRET_COLUMNS", hint);
  assert.ok(protectedThing.ok, "the protected thing resolves to the project's one declaration, not the nested copy's");
  assert.equal(protectedThing.definition.file, "src/store/secrets.ts");
  const sites = await adapter.references(protectedThing.definition);
  assert.deepEqual(sites.filter((s) => s.file.startsWith(`${NESTED}/`) || s.file === IGNORED_FILE), [], "the adapter reports no site outside the project's files");
  const result = await checkChokepoint(adapter, { protects: "SECRET_COLUMNS", chokepoint: "seal", root, ...hint });
  assert.deepEqual(result.bypasses, [], result.reason);
  assert.notEqual(result.grade, "broken", result.reason);
  // The refutation's unsaved document is the adapter's own probe, not a file: the rule must never make the check vacuous.
  assert.equal(result.refutation, "automatic", result.refutationAccount);
  assert.equal(result.verdict, "pass", result.reason);
  // An instrument that indexed the nested checkout (a warm server started before the rule) may resolve the name to the copy there:
  // nothing is graded on another tree's definition, and it is never a structural defect of this one.
  const stale: typeof adapter = Object.create(adapter);
  stale.resolve = async (name, given) => {
    const resolved = await adapter.resolve(name, given);
    return resolved.ok && name === "SECRET_COLUMNS" ? { ok: true, definition: { ...resolved.definition, file: `${NESTED}/src/store/secrets.ts` } } : resolved;
  };
  const foreign = await checkChokepoint(stale, { protects: "SECRET_COLUMNS", chokepoint: "seal", root, ...hint });
  assert.equal(foreign.verdict, "not run", foreign.reason);
  assert.deepEqual(foreign.bypasses, []);
  assert.match(foreign.reason, /not one of the project's files/);

  // The edit hook: an edit to the nested copy is not an edit to this project, and nothing is re-checked.
  const revealed = await editContext(root, { tool_name: "Edit", tool_input: { file_path: join(root, NESTED_FILE) }, session_id: "s" }, { adapter });
  assert.equal(revealed, "", "an edit inside a nested checkout reveals nothing about this project");
  const ignoredEdit = await editContext(root, { tool_name: "Edit", tool_input: { file_path: join(root, IGNORED_FILE) }, session_id: "s" }, { adapter });
  assert.equal(ignoredEdit, "", "an edit to an ignored file reveals nothing about this project");

  // The vocabulary check's corpus.
  const corpus = await collectFiles({ root, coherence: await loadLexicon(COHERENCE_LEXICON) });
  const read = corpus.files.map((f) => f.slice(root.length + 1));
  assert.ok(read.includes("src/api/render.ts"), read.join(", "));
  assert.ok(!read.some((f) => f.startsWith(`${NESTED}/`) || f === IGNORED_FILE), `the corpus holds only the project's files: ${read.join(", ")}`);

  // Economy and mass.
  assert.deepEqual(sourceFiles(root, "typescript"), ["src/api/render.ts", "src/store/secrets.ts"]);
  const mass = computeMass(root);
  assert.deepEqual(mass.files.map((f) => f.file).sort(), ["src/api/render.ts", "src/store/secrets.ts"], "mass counts only the project's files");
});

test("a folder the config names as a plugin is not the project's source: its files are walked by nothing and graded by nothing, its declarations shadow nothing, unless the config says gradePlugins", async () => {
  const adopter = mkdtempSync(join(tmpdir(), "coherence-plugin-folder-"));
  const put = (path: string, text: string): void => {
    mkdirSync(dirname(join(adopter, path)), { recursive: true });
    writeFileSync(join(adopter, path), text, "utf8");
  };
  let own: TypeScriptAdapter | undefined;
  try {
    assert.equal(spawnSync("git", ["init", "-q"], { cwd: adopter }).status, 0, "git init");
    put("tsconfig.json", TSCONFIG.replace('"src/**/*.ts"', '"**/*.ts"'));
    put("coherence.config.json", JSON.stringify({ language: "typescript" }, null, 2) + "\n");
    put("Fixture.spec.md", SPEC);
    put("src/store/secrets.ts", SECRETS);
    put("src/api/render.ts", RENDER_CLEAN);
    ejectPlugin(adopter, "typescript");
    // The copy, enhanced: it declares a name the project's code declares too, and reaches the protected thing directly.
    put("coherence-plugins/typescript/secrets.ts", SECRETS);
    put("coherence-plugins/typescript/leak.ts", bypassFrom("../../src/store/secrets.ts"));
    put("coherence-plugins/typescript/Plugin.spec.md", SPEC);

    const files = projectFiles(adopter);
    assert.ok(files.includes("src/store/secrets.ts"), files.join(", "));
    assert.ok(!files.some((f) => f.startsWith("coherence-plugins/")), `no walk reads the plugin's folder: ${files.join(", ")}`);
    assert.deepEqual(projectFilesEnding(adopter, ".spec.md"), ["Fixture.spec.md"], "a spec in the plugin's folder is not the project's");
    assert.deepEqual([...keepProjectFiles(adopter, ["coherence-plugins/typescript/leak.ts", "src/api/render.ts"])], ["src/api/render.ts"], "a reference there is none of the project's");

    own = new TypeScriptAdapter(adopter);
    const hint = { component: ".", testFolders };
    const resolved = await own.resolve("SECRET_COLUMNS", hint);
    assert.ok(resolved.ok, resolved.ok ? "" : resolved.reason);
    assert.equal(resolved.definition.file, "src/store/secrets.ts", "the copy's declaration of the same name shadows nothing");
    const graded = await checkChokepoint(own, { protects: "SECRET_COLUMNS", chokepoint: "seal", root: adopter, ...hint });
    assert.deepEqual(graded.bypasses, [], graded.reason);
    assert.equal(graded.verdict, "pass", graded.reason);

    const config = JSON.parse(readFileSync(join(adopter, "coherence.config.json"), "utf8")) as Record<string, unknown>;
    put("coherence.config.json", JSON.stringify({ ...config, gradePlugins: true }, null, 2) + "\n");
    assert.ok(projectFiles(adopter).includes("coherence-plugins/typescript/leak.ts"), "a project that opts its plugins in has them walked");
  } finally {
    await own?.close();
    rmSync(adopter, { recursive: true, force: true });
  }
});

test("a reading is handed only files it can open: a pipe, a link to a pipe, a link to a folder and a link to nothing are no project file, in a repository or out of one, nor a path an edit names", () => {
  for (const versioned of [true, false]) {
    const root = mkdtempSync(join(tmpdir(), "coherence-unreadable-"));
    try {
      writeFileSync(join(root, "own.py"), "OWN = 1\n");
      symlinkSync("own.py", join(root, "linked.py"));
      spawnSync("mkfifo", [join(root, "pipe.py")]);
      symlinkSync("pipe.py", join(root, "to-pipe.py"));
      mkdirSync(join(root, "folder"));
      writeFileSync(join(root, "folder", "inside.py"), "INSIDE = 1\n");
      symlinkSync("folder", join(root, "to-folder.py"));
      symlinkSync("nowhere.py", join(root, "dangling.py"));
      if (versioned) spawnSync("git", ["init", "-q"], { cwd: root });
      assert.deepEqual(projectFiles(root), ["folder/inside.py", "linked.py", "own.py"], `${versioned ? "in a repository" : "out of one"}: a regular file, and a link to one, alone`);
      const kept = [...keepProjectFiles(root, ["own.py", "pipe.py", "to-pipe.py", "to-folder.py", "dangling.py", "deleted.py"])].sort();
      assert.deepEqual(kept.filter((f) => f !== "deleted.py"), ["own.py"], "a path an edit names is kept only where it can be opened");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});
