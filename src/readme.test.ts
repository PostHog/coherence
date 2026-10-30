/**
 * The README's and plugins/README.md's lists of agent hosts and bundled
 * plugins held to what src/readme.ts generates from HOSTS and the bundled
 * manifests: a list typed by hand there drifts the day a plugin ships.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { fill, GENERATED, generatedBlocks } from "./readme.ts";

const CHECKOUT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("the README's lists of agent hosts and bundled plugins are the ones generated from the hosts and the bundled manifests, each file carrying every block it is owed", () => {
  const blocks = generatedBlocks();
  for (const file of Object.keys(GENERATED)) {
    const text = readFileSync(join(CHECKOUT, file), "utf8");
    const filled = fill(file, text, blocks);
    assert.deepEqual(filled.problems, [], file);
    assert.equal(text, filled.text, `${file} drifted from the hosts and the bundled plugins' manifests; run npm run readme`);
  }
  // A file whose blocks were all missing would pass the equality above on nothing.
  const bare = fill("README.md", "# Coherence\n<!-- generated: plugins --><!-- /generated -->\n", blocks);
  assert.deepEqual(bare.problems, [
    "README.md carries a generated block named plugins, which it is not owed (agents, languages, language plugins, tool plugins)",
    ...GENERATED["README.md"]!.map((name) => `README.md lacks its generated block ${name}: <!-- generated: ${name} --><!-- /generated -->`),
  ]);
});
