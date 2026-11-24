import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { isKind, isWorkKind, parseStamped, STAMP_FIELDS } from "./record.ts";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

test("the head every record in the journal and the work store shares is read by one parser; each store says only which kinds it holds", () => {
  const head = { id: "d-1", kind: "decision", at: "2026-11-24T00:00:00.000Z", session: "s", agent: "a" };
  assert.deepEqual(parseStamped(JSON.stringify(head), isKind), head);
  assert.equal(parseStamped(JSON.stringify(head), isWorkKind), 'unknown kind "decision"', "the work store holds no decision");
  assert.equal(parseStamped(JSON.stringify({ ...head, kind: "order" }), isWorkKind) instanceof Object, true);
  assert.match(parseStamped("{", isKind) as string, /^not JSON/);
  assert.equal(parseStamped("[]", isKind), "not a record object");
  for (const field of STAMP_FIELDS) assert.equal(parseStamped(JSON.stringify({ ...head, [field]: "" }), isKind), `missing ${field}`);
  assert.equal(parseStamped(JSON.stringify({ ...head, at: "yesterday" }), isKind), 'unreadable time "yesterday"');
  const spelled = readdirSync(SRC, { recursive: true })
    .map(String)
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts") && !file.includes("fixtures") && file !== join("journal", "record.ts"))
    .filter((file) => readFileSync(join(SRC, file), "utf8").includes('"id", "kind", "at", "session", "agent"'));
  assert.deepEqual(spelled, [], "read a store's line with parseStamped from src/journal/record.ts");
});
