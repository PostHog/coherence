/**
 * Convex functions are reached through the generated API object
 * (`internal.telemetry.send`, `api.model.telemetry.track`), which the
 * language server does not follow back to the export. A small Convex project
 * written into a temporary folder, in the shape `convex dev` generates, is
 * checked through the real TypeScript adapter: a call through the generated
 * API is a reference to the export, so a direct call outside the chokepoint
 * is a bypass, and the refutation stages one.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { checkChokepoint } from "../enforcement/check.ts";
import { readEnforcementConfig } from "../enforcement/config.ts";
import { convexModule, generatedApiReferences } from "./convex.ts";
import { TypeScriptAdapter } from "./typescript.ts";

const TSCONFIG = `{ "compilerOptions": { "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler", "strict": true, "noEmit": true }, "include": ["convex/**/*.ts"] }\n`;

const GENERATED_API = `import type * as groups from "../groups.js";
import type * as model_telemetry from "../model/telemetry.js";
import type * as telemetry from "../telemetry.js";

import type { ApiFromModules, FilterApi, FunctionReference } from "convex/server";

declare const fullApi: ApiFromModules<{
  groups: typeof groups;
  "model/telemetry": typeof model_telemetry;
  telemetry: typeof telemetry;
}>;
export declare const api: FilterApi<typeof fullApi, FunctionReference<any, "public">>;
export declare const internal: FilterApi<typeof fullApi, FunctionReference<any, "internal">>;
`;

const GENERATED_SERVER = `export declare function mutation<T>(definition: T): T;
export declare function internalAction<T>(definition: T): T;
`;

const TELEMETRY = `import { internalAction } from "./_generated/server";

export const send = internalAction({
  handler: async () => {},
});
`;

const MODEL_TELEMETRY = `import { internal } from "../_generated/api";

type Scheduler = { runAfter: (delay: number, fn: unknown, args: object) => Promise<void> };

export async function track(ctx: { scheduler: Scheduler }): Promise<void> {
  await ctx.scheduler.runAfter(0, internal.telemetry.send, {});
}
`;

const GROUPS_CLEAN = `import { mutation } from "./_generated/server";
import { track } from "./model/telemetry";

export const create = mutation({
  handler: async (ctx: never) => {
    await track(ctx);
  },
});
`;

const GROUPS_BYPASS = `import { mutation } from "./_generated/server";
import { internal as generated } from "./_generated/api";
import { track } from "./model/telemetry";

export const create = mutation({
  handler: async (ctx: never) => {
    await track(ctx);
  },
});

export const plantedBypass = mutation({
  handler: async (ctx: { scheduler: { runAfter: (delay: number, fn: unknown, args: object) => Promise<void> } }) => {
    await ctx.scheduler.runAfter(0, generated.telemetry.send, {});
  },
});
`;

const hint = { component: ".", testFolders: readEnforcementConfig("/nowhere").testFolders };
const protects = "send in convex/telemetry.ts";
const chokepoint = "convex/model/telemetry.ts";

async function convexProject(groups: string): Promise<{ dir: string; adapter: TypeScriptAdapter }> {
  const dir = mkdtempSync(join(tmpdir(), "coherence-convex-"));
  const put = (path: string, text: string): void => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text, "utf8");
  };
  put("tsconfig.json", TSCONFIG);
  put("convex/_generated/api.d.ts", GENERATED_API);
  put("convex/_generated/server.d.ts", GENERATED_SERVER);
  put("convex/telemetry.ts", TELEMETRY);
  put("convex/model/telemetry.ts", MODEL_TELEMETRY);
  put("convex/groups.ts", groups);
  return { dir, adapter: new TypeScriptAdapter(dir) };
}

test("a Convex function called through the generated API outside its chokepoint is a bypass", async () => {
  const { dir, adapter } = await convexProject(GROUPS_BYPASS);
  try {
    const result = await checkChokepoint(adapter, { protects, chokepoint, ...hint, root: dir });
    assert.equal(result.grade, "broken", result.reason);
    assert.deepEqual(result.bypasses.map((b) => `${b.file}:${b.line}`), ["convex/groups.ts:13"], result.reason);
    assert.equal(result.counts.inside, 1, "the chokepoint's own call through internal.telemetry.send is inside");
  } finally {
    await adapter.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a Convex function reached only through its chokepoint passes, and the refutation stages a reference through the generated API", async () => {
  const { dir, adapter } = await convexProject(GROUPS_CLEAN);
  try {
    const result = await checkChokepoint(adapter, { protects, chokepoint, ...hint, root: dir });
    assert.equal(result.verdict, "pass", result.reason);
    assert.equal(result.grade, "reference-choked", result.reason);
    assert.equal(result.counts.inside, 1, result.reason);
    assert.equal(result.refutation, "automatic", result.refutationAccount);
    assert.match(result.refutationAccount, /a reference to send through the generated internal\.telemetry\.send/, result.refutationAccount);
  } finally {
    await adapter.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a call through the generated API is a bypass after a regex literal, inside a template substitution, and under the name an export list gives the function", async () => {
  const hidden = `import { mutation } from "./_generated/server";
import { internal } from "./_generated/api";

const strip = /\`/g;
type Ctx = { scheduler: { runAfter: (delay: number, fn: unknown, args: object) => Promise<void> } };
export const afterRegex = mutation({
  handler: async (ctx: Ctx) => {
    await ctx.scheduler.runAfter(0, internal.telemetry.send, {});
  },
});
export const label = \`sent by \${String(internal.telemetry.send)}\`;
`;
  const { dir, adapter } = await convexProject(GROUPS_CLEAN);
  try {
    writeFileSync(join(dir, "convex/hidden.ts"), hidden, "utf8");
    writeFileSync(join(dir, "convex/telemetry.ts"), `import { internalAction } from "./_generated/server";\n\nconst sendLocal = internalAction({\n  handler: async () => {},\n});\nexport { sendLocal as send };\n`, "utf8");
    await adapter.forget(["convex/hidden.ts", "convex/telemetry.ts"]);
    const result = await checkChokepoint(adapter, { protects: "convex/telemetry.ts", chokepoint, ...hint, root: dir });
    assert.deepEqual(result.bypasses.map((b) => `${b.file}:${b.line}`), ["convex/hidden.ts:8", "convex/hidden.ts:11"], result.reason);
    const aliased = await checkChokepoint(adapter, { protects: "sendLocal in convex/telemetry.ts", chokepoint, ...hint, root: dir });
    assert.doesNotMatch(aliased.refutationAccount, /through the generated|sendLocal through/, `the generated reference is staged as internal.telemetry.send, and the instrument saw it: ${aliased.refutationAccount}`);
  } finally {
    await adapter.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the refutation stages a generated reference for a registered function whatever its declaration's length, and never for a plain export beside one", async () => {
  const { dir, adapter } = await convexProject(GROUPS_CLEAN);
  try {
    writeFileSync(join(dir, "convex/telemetry.ts"), `import { internalAction } from "./_generated/server";\n\nexport const LIMIT = 10;\nexport const flush = internalAction({ handler: async () => {} });\nexport const send: ReturnType<\n  typeof internalAction<{\n    handler: () => Promise<void>;\n  }>\n> = internalAction({\n  handler: async () => {},\n});\n`, "utf8");
    await adapter.forget(["convex/telemetry.ts"]);
    const registered = await checkChokepoint(adapter, { protects, chokepoint, ...hint, root: dir });
    assert.match(registered.refutationAccount, /through the generated internal\.telemetry\.send/, registered.refutationAccount);
    const plain = await checkChokepoint(adapter, { protects: "LIMIT in convex/telemetry.ts", chokepoint, ...hint, root: dir });
    assert.doesNotMatch(plain.refutationAccount, /through the generated/, plain.refutationAccount);
  } finally {
    await adapter.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("under a from: line that exempts the functions folder, a client's call through the generated API is still a bypass, and the refutation stages its generated reference outside the folder", async () => {
  const { dir, adapter } = await convexProject(GROUPS_CLEAN);
  const from = { outside: "convex" };
  try {
    const clean = await checkChokepoint(adapter, { protects, chokepoint, from, ...hint, root: dir });
    assert.equal(clean.refutation, "automatic", clean.refutationAccount);
    assert.equal(clean.verdict, "pass", clean.reason);
    assert.match(clean.refutationAccount, /a reference to send through the generated internal\.telemetry\.send from the unsaved document coherence-refutation-[0-9a-f]+\.ts, outside convex/, clean.refutationAccount);
    writeFileSync(join(dir, "src-leak.ts"), `import { internal } from "./convex/_generated/api";\nexport const leaked = internal.telemetry.send;\n`, "utf8");
    await adapter.forget(["src-leak.ts"]);
    const leaked = await checkChokepoint(adapter, { protects, chokepoint, from, ...hint, root: dir });
    assert.deepEqual(leaked.bypasses.map((b) => `${b.file}:${b.line}`), ["src-leak.ts:2"], leaked.reason);
  } finally {
    await adapter.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a client outside the project that calls a Convex function through the generated API is found under a horizon that names its folder", async () => {
  const top = mkdtempSync(join(tmpdir(), "coherence-convex-horizon-"));
  const put = (path: string, text: string): void => {
    mkdirSync(dirname(join(top, path)), { recursive: true });
    writeFileSync(join(top, path), text, "utf8");
  };
  put("backend/coherence.config.json", JSON.stringify({ name: "backend", language: "typescript", references: ["web"] }) + "\n");
  put("backend/tsconfig.json", TSCONFIG);
  put("backend/convex/_generated/api.d.ts", GENERATED_API);
  put("backend/convex/_generated/server.d.ts", GENERATED_SERVER);
  put("backend/convex/telemetry.ts", TELEMETRY);
  put("backend/convex/model/telemetry.ts", MODEL_TELEMETRY);
  put("web/leak.ts", `import { internal } from "../backend/convex/_generated/api";\nexport const leaked = internal.telemetry.send;\n`);
  execFileSync("git", ["init", "-q"], { cwd: top });
  const root = join(top, "backend");
  const adapter = new TypeScriptAdapter(root);
  try {
    const result = await checkChokepoint(adapter, { protects, chokepoint, ...hint, root });
    assert.deepEqual(result.bypasses.map((b) => `${b.file}:${b.line}`), ["../web/leak.ts:2"], result.reason);
  } finally {
    await adapter.close();
    rmSync(top, { recursive: true, force: true });
  }
});

test("a generated API reference is read through the name its file imports it by, along the module's path, across lines, and never as a prefix, a comment, a string or another backend's API", () => {
  const target = { folder: "convex", path: ["model", "telemetry"], names: ["track"] };
  const text = [
    `import { api, internal as generated } from "../_generated/api.js";`,
    `const a = api.model.telemetry.track;`,
    `const b = generated.model.telemetry.track;`,
    `const c = api.model.telemetry.trackLater;`,
    `const d = api.telemetry.track;`,
    `const e = api.model`,
    `  .telemetry.track;`,
    `// const f = api.model.telemetry.track;`,
    `const g = "api.model.telemetry.track";`,
  ].join("\n");
  assert.deepEqual(generatedApiReferences("convex/model/use.ts", text, target), [{ line: 1, character: 10 }, { line: 2, character: 10 }, { line: 5, character: 10 }]);
  assert.deepEqual(generatedApiReferences("convex/other.ts", `const api = { model: { telemetry: { track: 1 } } };\nconst a = api.model.telemetry.track;\n`, target), [], "an api the file does not import from _generated/api is not the generated API");
  assert.deepEqual(generatedApiReferences("convex/other.ts", `// import { api } from "./_generated/api";\nconst a = api.model.telemetry.track;\n`, target), [], "an import that is commented out imports nothing");
  assert.deepEqual(generatedApiReferences("admin/backend/use.ts", `import { api } from "./_generated/api";\nconst a = api.model.telemetry.track;\n`, target), [], "another functions folder's generated API is another backend");
  assert.deepEqual(generatedApiReferences("src/hooks.tsx", `import type { api } from "@/convex/_generated/api";\ntype T = typeof api.model.telemetry.track;\n`, target), [{ line: 1, character: 16 }], "a type import through a path alias is read too");
  assert.deepEqual(generatedApiReferences("convex/use.ts", `import { api } from "./_generated/api";\nconst a = api.model.telemetry.track;\nconst b = api.model.telemetry.flush;\n`, { ...target, names: ["track", "flush"] }).length, 2, "a protected module is referenced through any function it exports");

});

test("a functions folder is one where Convex generated both its API and its server builders", () => {
  const generated = (files: string[]) => (path: string): boolean => files.includes(path);
  assert.deepEqual(convexModule("convex/model/telemetry.ts", generated(["convex/_generated/api.d.ts", "convex/_generated/server.d.ts"])), { folder: "convex", path: ["model", "telemetry"] });
  assert.equal(convexModule("src/users.ts", generated(["src/_generated/api.ts"])), undefined, "an API another generator writes is not Convex's");
});
