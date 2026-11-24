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
