/**
 * TypeScript's source scan reads a re-export as an import of what it
 * re-exports: a barrel file depends on every module it re-exports from, so
 * mass's reach and the economy's closure follow it.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { importsOf } from "../economy/source.ts";

const fixtures: string[] = [];
after(() => {
  for (const dir of fixtures) rmSync(dir, { recursive: true, force: true });
});

test("a TypeScript re-export is read as an import of the module it re-exports from: by name, renamed, type-only, whole, and whole under a namespace", () => {
  const root = mkdtempSync(join(tmpdir(), "coherence-reexports-"));
  fixtures.push(root);
  const files: Record<string, string> = {
    "src/store/secrets.ts": "export const SECRET_COLUMNS = {};\nexport function seal() {}\nexport type Row = {};\n",
    "src/store/rows.ts": "export const ROWS = 1;\n",
    "src/store/audit.ts": "export const AUDIT = 1;\n",
    "src/store/index.ts": 'export { seal as sealRow, SECRET_COLUMNS, type Row } from "./secrets.ts";\nexport * from "./rows.ts";\nexport * as audit from "./audit.ts";\n',
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const read = importsOf(root, "src/store/index.ts", files["src/store/index.ts"]!, "typescript").map((i) => `${i.name ?? "*"} <- ${i.module}`);
  assert.deepEqual(read.sort(), ["* <- src/store/audit.ts", "* <- src/store/rows.ts", "Row <- src/store/secrets.ts", "SECRET_COLUMNS <- src/store/secrets.ts", "seal <- src/store/secrets.ts"]);
});
