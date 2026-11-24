import assert from "node:assert/strict";
import { test } from "node:test";
import { INDEX_EXTENSIONS, JAVASCRIPT_EXTENSIONS, MODULE_EXTENSIONS, TYPESCRIPT_EXTENSIONS } from "../../plugins/typescript/module-extensions.ts";
import { TYPESCRIPT_ENTRANCES } from "../../plugins/typescript/typescript-entrances.ts";
import { moduleExtensions } from "../../plugins/convex/convex-api.ts";

test("the TypeScript plugin's readers and the Convex plugin resolve imports with the one list the TypeScript manifest names", () => {
  assert.deepEqual([...MODULE_EXTENSIONS], [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
  assert.deepEqual([...TYPESCRIPT_EXTENSIONS], [".ts", ".tsx", ".mts", ".cts"]);
  assert.deepEqual([...JAVASCRIPT_EXTENSIONS], [".js", ".jsx", ".mjs", ".cjs"]);
  assert.deepEqual([...INDEX_EXTENSIONS], [".ts", ".tsx", ".js", ".jsx"]);
  assert.deepEqual([...moduleExtensions()], [...MODULE_EXTENSIONS]);
});

test("a relative import reaches a file under every module extension and a folder's index under every index extension", () => {
  for (const extension of MODULE_EXTENSIONS) {
    const files = ["scripts/run.ts", `scripts/widget${extension}`];
    const read = (file: string): string | undefined => (file === "scripts/run.ts" ? 'import { w } from "./widget";\n' : "");
    assert.ok(TYPESCRIPT_ENTRANCES.importedAmong(files, read).has(`scripts/widget${extension}`), `./widget reaches widget${extension}`);
  }
  for (const extension of INDEX_EXTENSIONS) {
    const files = ["scripts/run.ts", `scripts/ui/index${extension}`];
    const read = (file: string): string | undefined => (file === "scripts/run.ts" ? 'import { w } from "./ui";\n' : "");
    assert.ok(TYPESCRIPT_ENTRANCES.importedAmong(files, read).has(`scripts/ui/index${extension}`), `./ui reaches ui/index${extension}`);
  }
});
