import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { APPLY_CHOSE, applyChose } from "./lexicon-coverage.ts";
import { proposalIdOf } from "./lexicon-maintain.ts";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

test("an applied proposal's decision text has one writer and one reading: the coverage and the maintenance read what apply writes", () => {
  const id = proposalIdOf({ target: "docs/lexicon.json", before: "b", after: "a", change: { action: "define", name: "spec", because: "b" }, humanRequired: false });
  assert.match(id, /^lp-[a-f0-9]{24}$/);
  const applied = { change: { action: "reject", name: "spec", value: "widget page" }, human: null };
  const chose = applyChose(id, applied);
  assert.match(chose, APPLY_CHOSE, "the reading matches what the writer writes");
  assert.ok(chose.includes(` apply ${id} `), "the proposal's id is found as apply wrote it");
  assert.deepEqual(JSON.parse(chose.replace(APPLY_CHOSE, "")), applied, "the change reads back as it was applied");
  assert.match(`vocabulary apply ${id} {}`, APPLY_CHOSE, "a record written under an earlier name of the verb still reads as applied: the reading takes any lowercase word before apply");
  const spelled = readdirSync(SRC, { recursive: true })
    .map(String)
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts") && !file.includes("fixtures") && file !== join("lifecycle", "lexicon-coverage.ts"))
    .filter((file) => {
      const code = readFileSync(join(SRC, file), "utf8");
      return code.includes("apply [a-z]p-") || /["'`]lexicon apply (?:\$\{|["'`]\s*\+)/.test(code);
    });
  assert.deepEqual(spelled, [], "write and read an applied proposal's decision with applyChose and APPLY_CHOSE from src/lifecycle/lexicon-coverage.ts");
});
