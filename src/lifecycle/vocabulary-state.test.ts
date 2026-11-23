import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { lexiconReading, type Coverage } from "./lexicon-coverage.ts";
import { loadProjectLexicons } from "./project.ts";
import { currentReading, editVocabulary, keptReading } from "./vocabulary-state.ts";

const COMPONENTS = ["books", "sales", "stock", "staff"];
const NAMES = ["Widget Ledger", "Widget Ledgers", "Tally Basis", "Tally Bases", "Settlement Window", "`Settlement Window`", "Stock Count"];
const WORDS = ["widget ledger", "widget ledgers", "tally basis", "settlement window", "settlement windows", "stock count", "stock counts"];
const DECLARATIONS = ["export function widgetLedger(): number {\n  return 1;\n}", "export class TallyBasis {}", "export interface SettlementWindow {\n  opensAt: number;\n}", "export const stockCount = 2;"];
const KNOWN = ["The exposure is set here.", "A hazard sits beside the exposure.", "Each exposure counts.", "work orders wait."];

function git(root: string, ...args: string[]): void {
  execFileSync("git", ["-c", "user.email=test@example.com", "-c", "user.name=test", "-c", "commit.gpgsign=false", ...args], { cwd: root, stdio: "ignore" });
}

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function tallyProject(): string {
  const root = mkdtempSync(join(tmpdir(), "coherence-vocabulary-index-"));
  writeFileSync(join(root, "lexicon.json"), JSON.stringify({ version: 1, project: "tallyco", concepts: [{ name: "exposure", definition: "Money at risk, in USD.", aliases: [], rejected: [{ alternative: "hazard", because: "a hazard is a cause, not money at risk" }] }, { name: "work order", definition: "A unit of assigned work.", aliases: ["order"] }] }));
  writeFileSync(join(root, "coherence.config.json"), JSON.stringify({ name: "Tallyco" }));
  writeFileSync(join(root, "Tallyco.spec.md"), "# Tallyco\n\n## invariants\n");
  for (const component of COMPONENTS) {
    mkdirSync(join(root, component));
    writeFileSync(join(root, component, `${component}.spec.md`), `# ${component}\n\n## invariants\n`);
  }
  mkdirSync(join(root, "pkg"));
  writeFileSync(join(root, "pkg", "notes.md"), "The Widget Ledger ships in a package.\nA Widget Ledger, and the `Widget Ledger` again.\n");
  for (const component of COMPONENTS) writeFileSync(join(root, component, "words.md"), WORDS.map((words) => `Each ${words} is counted here, and another ${words} there.`).join("\n") + "\n");
  git(root, "init", "-q");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "start");
  return root;
}

function withoutUses(coverage: Coverage): string {
  return JSON.stringify({ ...coverage, terms: coverage.terms.map(({ uses: _uses, ...term }) => term) });
}

test("a reading taken from the kept index equals a full reading after every random edit, add, delete, rename, declaration, edit hook, folder marker and commit", async () => {
  const root = tallyProject();
  try {
    const random = seeded(20261123);
    const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!;
    const files: string[] = [];
    const prose = (): string => Array.from({ length: 1 + Math.floor(random() * 5) }, () => (random() < 0.5 ? `The ${pick(NAMES)} meets the ${pick(NAMES)}.` : random() < 0.5 ? `Every ${pick(WORDS)} keeps a ${pick(WORDS)} and a ${pick(WORDS)}.` : pick(KNOWN))).join("\n");
    const layers = await loadProjectLexicons(root);
    await keptReading(root, layers);
    const tiers = new Set<string>();
    for (let step = 0; step < 20; step++) {
      const roll = random();
      const component = pick(COMPONENTS);
      const written: string[] = [];
      if (roll < 0.3 || files.length === 0) {
        const file = join(component, `${random() < 0.7 ? "notes" : "plan"}-${Math.floor(random() * 4)}.md`);
        writeFileSync(join(root, file), `# ${pick(NAMES)}\n\n${prose()}\n`);
        if (!files.includes(file)) files.push(file);
        written.push(file);
      }
      if (roll >= 0.3 && roll < 0.5) {
        const file = join(component, `code-${Math.floor(random() * 3)}.ts`);
        writeFileSync(join(root, file), random() < 0.8 ? `${pick(DECLARATIONS)}\n` : "export const nothing = 0;\n");
        if (!files.includes(file)) files.push(file);
        written.push(file);
      }
      if (roll >= 0.5 && roll < 0.62 && files.length > 0) {
        const file = files.splice(Math.floor(random() * files.length), 1)[0]!;
        if (existsSync(join(root, file))) rmSync(join(root, file));
      }
      if (roll >= 0.62 && roll < 0.74 && files.length > 0) {
        git(root, "add", "-A");
        const from = files.splice(Math.floor(random() * files.length), 1)[0]!;
        const to = join(pick(COMPONENTS), `moved-${step}${from.slice(from.lastIndexOf("."))}`);
        git(root, "mv", from, to);
        files.push(to);
        if (random() < 0.5) git(root, "commit", "-qm", `move ${step}`);
      }
      if (roll >= 0.74 && roll < 0.84) {
        const marker = join(root, "Cargo.toml");
        if (existsSync(marker)) rmSync(marker);
        if (!existsSync(marker)) writeFileSync(marker, step % 2 === 0 ? "[package]\nname = \"tally\"\n" : "");
        if (step % 2 !== 0) rmSync(marker);
      }
      if (roll >= 0.84) {
        git(root, "add", "-A");
        git(root, "commit", "-qm", `step ${step}`, "--allow-empty");
      }
      // The edit hook takes a write in through the same kept state the prompt then reads from.
      if (written.length > 0 && random() < 0.5) {
        const edited = await editVocabulary(root, layers, written, new Set());
        if ("keep" in edited) edited.keep();
      }
      const incremental = await currentReading(root, layers);
      const full = (await lexiconReading(root, layers)).coverage;
      assert.equal(incremental.fingerprint, full.fingerprint, `step ${step}: the fingerprint covers every term's full uses`);
      assert.equal(withoutUses(incremental), withoutUses(full), `step ${step}`);
    }
    const log = readFileSync(join(root, ".coherence", "cache", "vocabulary-tiers.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as { tier: string; reason?: string });
    for (const entry of log) tiers.add(entry.tier);
    assert.ok(tiers.has("files") && tiers.has("declared names"), `the sequence reached both incremental tiers: ${JSON.stringify(log.filter((entry) => entry.tier === "full"))}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a file renamed, staged and then committed, is read from its new path alone, as a full reading reads it", async () => {
  const root = tallyProject();
  try {
    const layers = await loadProjectLexicons(root);
    writeFileSync(join(root, "books", "ledger.md"), "The Widget Ledger opens.\nA Widget Ledger closes.\n");
    git(root, "add", "-A");
    git(root, "commit", "-qm", "ledger");
    await keptReading(root, layers);
    git(root, "mv", join("books", "ledger.md"), join("sales", "ledger.md"));
    for (const label of ["staged", "committed"]) {
      if (label === "committed") git(root, "commit", "-qm", "move");
      const incremental = await currentReading(root, layers);
      const full = (await lexiconReading(root, layers)).coverage;
      assert.equal(withoutUses(incremental), withoutUses(full), label);
      assert.equal(incremental.fingerprint, full.fingerprint, label);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a kept reading whose HEAD is no commit name never reaches git as an option: the reading is taken in full and no file is written", async () => {
  const root = tallyProject();
  const victim = join(root, "..", `${root.split("/").at(-1)}-victim`);
  try {
    writeFileSync(victim, "kept\n");
    const layers = await loadProjectLexicons(root);
    await keptReading(root, layers);
    const readingPath = join(root, ".coherence", "cache", "vocabulary", "reading.json");
    const kept = JSON.parse(readFileSync(readingPath, "utf8")) as { tree: Record<string, string> };
    kept.tree["\u0000HEAD"] = `--output=${victim}`;
    writeFileSync(readingPath, JSON.stringify(kept));
    writeFileSync(join(root, "books", "notes.md"), "The Widget Ledger moves.\n");
    await currentReading(root, layers);
    assert.equal(readFileSync(victim, "utf8"), "kept\n");
    const last = readFileSync(join(root, ".coherence", "cache", "vocabulary-tiers.jsonl"), "utf8").trim().split("\n").at(-1)!;
    assert.match(last, /"tier":"full"/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(victim, { force: true });
  }
});
