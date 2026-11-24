import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { KINDS, POINTING_KINDS, pointsAt } from "./kinds.ts";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

test("which records point at an earlier one is said once: the journal's reader, its verbs and the Scope page ask pointsAt", () => {
  for (const kind of Object.keys(KINDS)) assert.equal(pointsAt({ kind, of: "d-1" }), (POINTING_KINDS as readonly string[]).includes(kind) ? "d-1" : null, kind);
  const spelled = readdirSync(SRC, { recursive: true })
    .map(String)
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts") && !file.includes("fixtures"))
    .filter((file) => /case "retraction":\s*case "resolution":\s*case "dismissal":\s*case "close":\s*case "acknowledgement":\s*return record\.of/.test(readFileSync(join(SRC, file), "utf8")));
  assert.deepEqual(spelled, [], "ask pointsAt from src/journal/kinds.ts which record a record points at");
});
