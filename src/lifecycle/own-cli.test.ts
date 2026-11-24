import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { CLI_BESIDE, cliArgs } from "./own-cli.ts";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

test("every child Coherence starts of itself runs the cli beside the code with the one set of node arguments", () => {
  assert.equal(CLI_BESIDE, join(SRC, "cli.ts"));
  assert.deepEqual(cliArgs(CLI_BESIDE, "warm"), ["--disable-warning=ExperimentalWarning", CLI_BESIDE, "warm"]);
  const [flag] = cliArgs("");
  const spelled = readdirSync(SRC, { recursive: true })
    .map(String)
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts") && !file.endsWith(".e2e.ts") && file !== join("lifecycle", "own-cli.ts"))
    .filter((file) => readFileSync(join(SRC, file), "utf8").includes(flag!));
  assert.deepEqual(spelled, [], "start a child of Coherence with cliArgs from src/lifecycle/own-cli.ts");
});

test("the benches that run alone and the mod, which import nothing of src, start Coherence with the same node arguments", () => {
  const flags = cliArgs("").slice(0, -1);
  const REPO = join(SRC, "..");
  const held: string[] = [];
  for (const dir of ["bench", "mods"]) {
    for (const file of readdirSync(join(REPO, dir), { recursive: true }).map(String).filter((f) => /\.(ts|tsx|mjs)$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.includes("node_modules"))) {
      const code = readFileSync(join(REPO, dir, file), "utf8");
      for (const m of code.matchAll(/["'](--(?:disable-warning|no-warnings)[^"']*)["']/g)) {
        held.push(`${dir}/${file}`);
        assert.ok(flags.includes(m[1]!), `${dir}/${file} starts node with ${m[1]}, not with cliArgs' ${flags.join(" ")}`);
      }
    }
  }
  assert.ok(held.length >= 4, `the held copies: ${held.join(", ")}`);
});
