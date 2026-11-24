import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { lexiconReading } from "./lexicon-coverage.ts";
import { openScanCache } from "./scan-cache.ts";

function tallyProject(): string {
  const root = mkdtempSync(join(tmpdir(), "coherence-scan-cache-"));
  writeFileSync(
    join(root, "lexicon.json"),
    JSON.stringify({
      version: 1,
      project: "tallyco",
      concepts: [
        { name: "exposure", definition: "Money at risk, in USD.", aliases: [], rejected: [{ alternative: "hazard", because: "a hazard is a cause, not money at risk" }] },
        { name: "work order", definition: "A unit of assigned work.", aliases: ["order"] },
      ],
    }),
  );
  writeFileSync(join(root, "coherence.config.json"), JSON.stringify({ name: "Tallyco" }));
  writeFileSync(join(root, "Tallyco.spec.md"), "# Tallyco\n\n## invariants\n");
  for (const component of ["books", "sales"]) {
    mkdirSync(join(root, component));
    writeFileSync(join(root, component, `${component}.spec.md`), `# ${component}\n\n## invariants\n`);
  }
  writeFileSync(join(root, "books", "notes.md"), "# Tally Basis\n\nThe Tally Basis sets each exposure.\nA hazard sits beside the exposure here.\n\n```\nTally Basis inside a fence\n```\nEvery work order names its Tally Basis.\n");
  writeFileSync(join(root, "books", "tally.ts"), "export interface TallyBasis {\n  settledAmount: number;\n}\nexport function settleExposure(basis: TallyBasis): number {\n  return basis.settledAmount;\n}\n");
  writeFileSync(join(root, "sales", "plan.md"), "The `Tally Basis` reaches sales too.\nSettled amount and work orders are counted per exposure.\n");
  writeFileSync(join(root, "sales", ".env"), "TALLY_BASIS=secret Tally Basis value\n");
  return root;
}

async function readingText(root: string, scans?: ReturnType<typeof openScanCache>): Promise<string> {
  const { coverage, contributions } = await lexiconReading(root, undefined, undefined, { contributions: true, scans });
  scans?.save();
  return JSON.stringify({ coverage, contributions: [...contributions] });
}

test("a reading through kept scans equals a fresh reading, byte for byte, after files are edited, added and deleted", async () => {
  const root = tallyProject();
  try {
    const version = "scan-cache-test";
    assert.equal(await readingText(root, openScanCache(root, version)), await readingText(root), "a reading that keeps every scan");
    assert.equal(await readingText(root, openScanCache(root, version)), await readingText(root), "a reading that replays every scan");

    writeFileSync(join(root, "books", "notes.md"), "# Tally Basis\n\nThe Tally Basis no longer sets a hazard.\nA Settlement Window opens here.\n");
    writeFileSync(join(root, "sales", "window.md"), "The Settlement Window closes daily.\nEach Settlement Window holds a work order.\n");
    rmSync(join(root, "sales", "plan.md"));
    assert.equal(await readingText(root, openScanCache(root, version)), await readingText(root), "a reading after an edit, an add and a delete");
    assert.equal(await readingText(root, openScanCache(root, version)), await readingText(root), "the next reading, from the scans the last one kept");

    const lexicon = JSON.parse(readFileSync(join(root, "lexicon.json"), "utf8")) as { concepts: unknown[] };
    lexicon.concepts.push({ name: "settlement window", definition: "The hours a settlement may run.", aliases: [] });
    writeFileSync(join(root, "lexicon.json"), JSON.stringify(lexicon));
    assert.equal(await readingText(root, openScanCache(root, version)), await readingText(root), "a reading after the lexicon changed under the same cache version");

    writeFileSync(join(root, "sales", "plan.md"), "The `Tally Basis` returns.\n");
    assert.equal(await readingText(root, openScanCache(root, "another-version")), await readingText(root), "a reading under another version scans everything again");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
