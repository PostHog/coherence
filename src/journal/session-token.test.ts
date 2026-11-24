import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { SESSION_TOKEN } from "./session-token.ts";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

test("the rule a session id must meet to name a file is written once: every store, trace and baseline imports it", () => {
  const copies = readdirSync(SRC, { recursive: true })
    .map(String)
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts") && file !== join("journal", "session-token.ts"))
    .filter((file) => readFileSync(join(SRC, file), "utf8").includes(SESSION_TOKEN.source));
  assert.deepEqual(copies, [], "import SESSION_TOKEN from src/journal/session-token.ts");
  assert.ok(SESSION_TOKEN.test("11c93d87-0407-4ce7-9a27-189f3a835bb6") && !SESSION_TOKEN.test("../x") && !SESSION_TOKEN.test(""));
});
