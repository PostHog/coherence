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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { checkChokepoint } from "../enforcement/check.ts";
import { readEnforcementConfig } from "../enforcement/config.ts";
import { generatedApiReferences } from "./convex.ts";
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

test("a generated API reference is read through the name its file imports it by, along the module's path, and never as a prefix of a longer name", () => {
  const lines = [
    `import { api, internal as generated } from "../_generated/api.js";`,
    `const a = api.model.telemetry.track;`,
    `const b = generated.model.telemetry.track;`,
    `const c = api.model.telemetry.trackLater;`,
    `const d = api.telemetry.track;`,
  ];
  const sites = generatedApiReferences(lines, ["model", "telemetry"], "track");
  assert.deepEqual(sites, [{ line: 1, character: 10 }, { line: 2, character: 10 }]);
  assert.deepEqual(generatedApiReferences([`const api = { model: { telemetry: { track: 1 } } };`, `const a = api.model.telemetry.track;`], ["model", "telemetry"], "track"), [], "an api the file does not import from _generated/api is not the generated API");
  assert.deepEqual(generatedApiReferences(lines, ["model", "telemetry"], undefined).length, 3, "a protected module is referenced through any of its functions");
});
