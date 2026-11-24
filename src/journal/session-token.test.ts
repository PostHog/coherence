import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { fileStemOf, SESSION_TOKEN } from "./session-token.ts";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

test("the rule a session id must meet to name a file is written once: every store, trace and baseline imports it", () => {
  const copies = readdirSync(SRC, { recursive: true })
    .map(String)
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts") && file !== join("journal", "session-token.ts") && file !== join("lifecycle", "statusline.ts"))
    .filter((file) => readFileSync(join(SRC, file), "utf8").includes(SESSION_TOKEN.source));
  assert.deepEqual(copies, [], "import SESSION_TOKEN from src/journal/session-token.ts (the status line, which imports nothing but node's own, holds a copy statusline.test.ts keeps equal)");
  assert.ok(SESSION_TOKEN.test("11c93d87-0407-4ce7-9a27-189f3a835bb6") && !SESSION_TOKEN.test("../x") && !SESSION_TOKEN.test(""));
});

test("a host-supplied name keeps the file name every state file has given it, and one that would name a folder above takes a hashed stem", () => {
  assert.equal(fileStemOf("11c93d87-0407-4ce7-9a27-189f3a835bb6"), "11c93d87-0407-4ce7-9a27-189f3a835bb6");
  assert.equal(fileStemOf("agent:a1/b"), "agent_a1_b");
  for (const name of ["..", ".", "", ".hidden", "x".repeat(200)]) {
    const stem = fileStemOf(name);
    assert.ok(SESSION_TOKEN.test(stem), `${JSON.stringify(name)} names ${stem}`);
    assert.equal(fileStemOf(name), stem, "the same name takes the same stem");
  }
  const rewrites = readdirSync(SRC, { recursive: true })
    .map(String)
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts") && file !== join("journal", "session-token.ts") && file !== join("lifecycle", "statusline.ts"))
    .filter((file) => readFileSync(join(SRC, file), "utf8").includes(".replace(/[^\\w.-]/g"));
  assert.deepEqual(rewrites, [], "name a state file by fileStemOf from src/journal/session-token.ts (the status line's copy is held equal by statusline.test.ts)");
});
