import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ORIGIN_FIELDS, originText } from "./defect-states.ts";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

test("a defect's origin fields are listed once: the verbs' flags, the classification's words, the journal's reading and the fold read ORIGIN_FIELDS", () => {
  assert.deepEqual([...ORIGIN_FIELDS], ["class", "introduced", "caught"]);
  assert.equal(originText({ class: "path-identity", introduced: "PR #12", caught: "test" }), "class path-identity, introduced PR #12, caught test");
  assert.equal(originText({ caught: "review" }), "caught review");
  assert.equal(originText({}), "");
  const spelled = readdirSync(SRC, { recursive: true })
    .map(String)
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts") && !file.includes("fixtures") && file !== join("journal", "defect-states.ts"))
    .filter((file) => /(?<!-)introduced(?:: "one"|\?: string \| undefined| \$\{)/.test(readFileSync(join(SRC, file), "utf8")));
  assert.deepEqual(spelled, [], "read a defect's origin fields from ORIGIN_FIELDS, OriginGiven and originText in src/journal/defect-states.ts");
});
