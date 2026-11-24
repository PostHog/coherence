import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { COHERENCE_ENFORCER } from "../adapters/adapter.ts";
import { BUNDLED_DIR } from "./registry.ts";

test("every bundled manifest's reference-choked rung names its enforcer as the adapters do", () => {
  const named: string[] = [];
  for (const entry of readdirSync(BUNDLED_DIR, { withFileTypes: true }).filter((e) => e.isDirectory())) {
    let manifest: { ladder?: { rungs?: { grade: string; enforcer: string }[] } };
    try {
      manifest = JSON.parse(readFileSync(join(BUNDLED_DIR, entry.name, "plugin.json"), "utf8")) as typeof manifest;
    } catch {
      continue;
    }
    for (const rung of manifest.ladder?.rungs ?? []) {
      if (rung.grade !== "reference-choked") continue;
      named.push(entry.name);
      assert.equal(rung.enforcer, COHERENCE_ENFORCER, `plugins/${entry.name}/plugin.json`);
    }
  }
  assert.ok(named.length >= 4, `the bundled ladders that list the rung: ${named.join(", ")}`);
});
