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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { keepProjectFiles, nestedCheckouts, projectFiles } from "./project-files.ts";
import { TypeScriptAdapter } from "./typescript.ts";
import { checkChokepoint } from "../enforcement/check.ts";
import { readEnforcementConfig } from "../enforcement/config.ts";
import { computeMass } from "../economy/mass.ts";
import { sourceFiles } from "../economy/source.ts";
import { collectFiles } from "../lifecycle/check.ts";
import { loadGlossary } from "../lifecycle/glossary.ts";
import { COHERENCE_GLOSSARY } from "../lifecycle/project.ts";
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
  const corpus = await collectFiles({ root, coherence: await loadGlossary(COHERENCE_GLOSSARY) });
  const read = corpus.files.map((f) => f.slice(root.length + 1));
  assert.ok(read.includes("src/api/render.ts"), read.join(", "));
  assert.ok(!read.some((f) => f.startsWith(`${NESTED}/`) || f === IGNORED_FILE), `the corpus holds only the project's files: ${read.join(", ")}`);

  // Economy and mass.
  assert.deepEqual(sourceFiles(root, "typescript"), ["src/api/render.ts", "src/store/secrets.ts"]);
  const mass = computeMass(root);
  assert.deepEqual(mass.files.map((f) => f.file).sort(), ["src/api/render.ts", "src/store/secrets.ts"], "mass counts only the project's files");
});
