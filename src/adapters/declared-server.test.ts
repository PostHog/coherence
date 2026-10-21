/**
 * The generic adapter of a declared language (declared.ts) over a real
 * language server: typescript-language-server, which CI already installs.
 * The config would refuse this declaration, since the TypeScript adapter owns
 * `.ts`; the adapter is built directly instead, so that nothing it does is
 * proved against a stub alone. It knows only the protocol: no export rule, no
 * compiler refusal. In a git repository, as a real project is, it resolves,
 * finds the bypass, grades it broken, stages the declared refute template
 * unsaved and sees the server report it, and once the bypass is gone it earns
 * reference-choked, never more.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { DeclaredAdapter } from "./declared.ts";
import { locateServer } from "./typescript.ts";
import { checkChokepoint } from "../enforcement/check.ts";
import { DEFAULT_TEST_FOLDERS } from "../enforcement/config.ts";

const RENDER_BYPASS = `import { SECRET_COLUMNS, seal } from "../store/secrets.js";\nexport function render(row: Record<string, unknown>) { return JSON.stringify({ sealed: seal(row), leaked: SECRET_COLUMNS }); }\n`;
const RENDER_CLEAN = `import { seal } from "../store/secrets.js";\nexport function render(row: Record<string, unknown>) { return JSON.stringify(seal(row)); }\n`;

let root: string;
let adapter: DeclaredAdapter;
const located = locateServer(process.cwd());

function write(path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text, "utf8");
}

before(() => {
  root = mkdtempSync(join(tmpdir(), "coherence-declared-real-"));
  write("tsconfig.json", `{ "compilerOptions": { "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext", "strict": true, "noEmit": true }, "include": ["src"] }`);
  write("src/store/secrets.ts", `export const SECRET_COLUMNS = { tokens: ["token"] };\nexport function seal(row: Record<string, unknown>) {\n  const out = { ...row };\n  for (const column of SECRET_COLUMNS.tokens) delete out[column];\n  return out;\n}\n`);
  write("src/api/render.ts", RENDER_BYPASS);
  // A repository, as a real project is: its files are what git lists, so the unsaved document is evidence only because the refutation staged it.
  execFileSync("git", ["init", "-q"], { cwd: root });
  adapter = new DeclaredAdapter(root, {
    name: "ts-generic",
    extensions: [".ts"],
    server: located.found ? [located.command, ...located.args, "--stdio"] : ["typescript-language-server", "--stdio"],
    refute: `import { {name} } from "{file}";\nexport const coherenceProbe = {name};\n`,
  });
});

after(async () => {
  await adapter.close();
  rmSync(root, { recursive: true, force: true });
});

test("a declared language over a real language server: the bypass grades broken, the declared refute template is staged unsaved and seen, and a clean chokepoint earns reference-choked and no rung above it", async () => {
  assert.ok(located.found, "typescript-language-server must be installed: npm install");
  const input = { protects: "SECRET_COLUMNS", chokepoint: "seal", component: ".", testFolders: [...DEFAULT_TEST_FOLDERS], root };
  const broken = await checkChokepoint(adapter, input);
  assert.equal(broken.grade, "broken", broken.reason);
  assert.deepEqual(broken.bypasses.map((b) => `${b.file}:${b.line}`), ["src/api/render.ts:1", "src/api/render.ts:2"]);
  assert.equal(broken.refutation, "automatic", broken.refutationAccount);
  assert.match(broken.refutationAccount, /ts-generic via \S+ \(declared in the config\) reported a reference to SECRET_COLUMNS from the unsaved document src\/store\/coherence-refutation-[0-9a-f]{8}\.ts/);

  write("src/api/render.ts", RENDER_CLEAN);
  await adapter.forget(["src/api/render.ts"]);
  const clean = await checkChokepoint(adapter, input);
  assert.equal(clean.verdict, "pass", clean.reason);
  assert.equal(clean.grade, "reference-choked", "the protocol says nothing of visibility, so the compiler is never credited");
  assert.equal(clean.refutation, "automatic");
});
