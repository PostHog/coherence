/**
 * The README's and plugins/README.md's lists of agent hosts and bundled
 * plugins held to what src/readme.ts generates from HOSTS and the bundled
 * manifests: a list typed by hand there drifts the day a plugin ships.
 */

import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { fill, GENERATED, generatedBlocks, regenerate } from "./readme.ts";

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

test("a generated block opened and not closed is refused and no file is written, so the author's text up to the next block's close survives", () => {
  const dir = mkdtempSync(join(tmpdir(), "coherence-readme-"));
  try {
    for (const file of Object.keys(GENERATED)) {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      cpSync(join(CHECKOUT, file), join(dir, file));
    }
    const readme = join(dir, "README.md");
    const intact = readFileSync(readme, "utf8");
    // Drop the agents block's close: read to the next close, the block would swallow the text up to the languages block's own.
    const broken = intact.replace(/(<!-- generated: agents -->[^<]*)<!-- \/generated -->/, "$1");
    assert.notEqual(broken, intact, "the agents block closes on its own line of the table");
    // A stale opt-in table in the other file, which a write would change.
    const plugins = join(dir, "plugins/README.md");
    const stale = readFileSync(plugins, "utf8").replace(/(<!-- generated: opt-in plugins -->)[\s\S]*?(<!-- \/generated -->)/, "$1\n$2");
    writeFileSync(readme, broken);
    writeFileSync(plugins, stale);
    const run = regenerate(dir);
    assert.deepEqual(run.problems, ["README.md opens its generated block agents and does not close it with <!-- /generated --> before the block languages opens"]);
    assert.equal(readFileSync(readme, "utf8"), broken, "the README is left as it stands");
    assert.equal(readFileSync(plugins, "utf8"), stale, "no file is written while any has a problem");
    // The fill itself keeps every line the author wrote between the two blocks.
    assert.match(fill("README.md", broken).text, /\*\*Supported languages\*\*/);
    // Once closed again, the stale file is written and the README is current.
    writeFileSync(readme, intact);
    assert.deepEqual(regenerate(dir), { files: [{ file: "README.md", changed: false }, { file: "plugins/README.md", changed: true }], problems: [] });
    assert.equal(readFileSync(plugins, "utf8"), readFileSync(join(CHECKOUT, "plugins/README.md"), "utf8"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
