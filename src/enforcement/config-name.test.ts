import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { CONFIG_NAME } from "./config-name.ts";
import { parsePeerFile } from "./peers.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("the form of a name the config keys a plugin, a peer or a declared language by is written once, with its words", () => {
  for (const name of readdirSync(join(REPO, "plugins"), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)) assert.ok(CONFIG_NAME.test(name), `the bundled plugin ${name} is keyed by its folder's name`);
  assert.deepEqual(parsePeerFile("hog-lake docs/a.md"), { peer: "hog-lake", path: "docs/a.md" }, "a peer: line opens on a peer's name");
  assert.equal(parsePeerFile("HogLake docs/a.md"), undefined);
  const spelled = ["src", "plugins"].flatMap((dir) =>
    readdirSync(join(REPO, dir), { recursive: true })
      .map(String)
      .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts") && !file.includes("fixtures") && !file.includes("node_modules"))
      .map((file) => join(dir, file))
      .filter((file) => file !== join("src", "enforcement", "config-name.ts"))
      .filter((file) => {
        const code = readFileSync(join(REPO, file), "utf8");
        return code.includes("[a-z][a-z0-9-]*") || /lower ?case letters, digits/.test(code);
      }),
  );
  assert.deepEqual(spelled, [], "import CONFIG_NAME and CONFIG_NAME_FORM from src/enforcement/config-name.ts");
});
