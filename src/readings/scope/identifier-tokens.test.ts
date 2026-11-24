import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { identifierTokens } from "./kept-answers.ts";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("a text's identifier tokens have one tokenizer: the kept answers' changed files, the word index and the scaffold's declarations read the same tokens", () => {
  const text = "export const $a = b1.c(_d, 2e);";
  assert.deepEqual(identifierTokens(text), ["export", "const", "$a", "b1", "c", "_d", "e"]);
  assert.deepEqual(identifierTokens(text), identifierTokens(text), "no call leaves the pattern's lastIndex behind for the next");
  assert.deepEqual(identifierTokens("1 2 ."), []);
  const spelled = readdirSync(SRC, { recursive: true })
    .map(String)
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts") && !file.includes("fixtures") && file !== join("readings", "scope", "kept-answers.ts"))
    .filter((file) => /\/\[A-Za-z_\$\]\[(?:A-Za-z0-9_\$|\\w\$)\]\*\/g/.test(readFileSync(join(SRC, file), "utf8")));
  assert.deepEqual(spelled, [], "tokenize a text with identifierTokens from src/readings/scope/kept-answers.ts");
});
