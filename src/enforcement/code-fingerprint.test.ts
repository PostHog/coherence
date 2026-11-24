import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { MODULE_FILE } from "./code-fingerprint.ts";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

test("the extensions of a module Coherence's code is written in, which the mirror reading parses, are written once; the fingerprint's JSON is its own", () => {
  assert.deepEqual(["a.ts", "a.mts", "a.cts", "a.js", "a.mjs", "a.cjs", "a.tsx", "a.json"].map((f) => MODULE_FILE.test(f)), [true, true, true, true, true, true, false, false]);
  const spelled = readdirSync(SRC, { recursive: true })
    .map(String)
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts") && !file.includes("fixtures") && file !== join("enforcement", "code-fingerprint.ts"))
    .filter((file) => readFileSync(join(SRC, file), "utf8").includes("(ts|mts|cts|js|mjs|cjs"));
  assert.deepEqual(spelled, [], "import MODULE_FILE from src/enforcement/code-fingerprint.ts");
});
