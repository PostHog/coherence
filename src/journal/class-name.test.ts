import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { CLASS_NAME } from "./defect-states.ts";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

test("a defect class's name has one rule: the defect verb, the lexicon's class keys and a practice's defect trigger read it", () => {
  for (const name of ["path-identity", "silent-skip", "a1-b2"]) assert.match(name, CLASS_NAME);
  for (const name of ["Path-identity", "path--identity", "-path", "path-", "1path", "path_identity"]) assert.doesNotMatch(name, CLASS_NAME);
  const spelled = readdirSync(SRC, { recursive: true })
    .map(String)
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts") && !file.includes("fixtures") && file !== join("journal", "defect-states.ts"))
    .filter((file) => readFileSync(join(SRC, file), "utf8").includes("[a-z][a-z0-9]*(?:-[a-z0-9]+)*"));
  assert.deepEqual(spelled, [], "import CLASS_NAME from src/journal/defect-states.ts");
});
