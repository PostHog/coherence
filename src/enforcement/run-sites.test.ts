/**
 * A run entry's reference sites are written once: an entry whose sites are
 * its enforcement's previous recorded sites carries a reference, and every
 * reader, through loadRuns, sees the sites as if they had been written in
 * full.
 */

import assert from "node:assert/strict";
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { appendRun, entryKey, latestByEnforcement, loadRuns, sitesHash, type RecordedSite, type RunRecord } from "./record.ts";

const site = (file: string, line: number): RecordedSite => ({ file, line, symbol: "seal", class: "inside", of: "protected", test: false });

function run(at: string, sites: RecordedSite[] | undefined): RunRecord {
  return {
    at,
    session: "sites",
    agent: "t",
    binding: "none",
    commit: null,
    dirty: false,
    instrument: { language: "typescript", server: "warm" },
    latency: 1,
    invariants: [{ component: "src/a", name: "sealed", form: "chokepoint", verdict: "pass", grade: "reference-choked", refutation: "automatic", bypasses: [], ...(sites === undefined ? {} : { sites }), testReferences: 0, files: ["src/a/x.ts"], latency: 1, reason: "t" }],
  } as RunRecord;
}

function written(root: string): Record<string, unknown>[] {
  return readFileSync(join(root, ".coherence", "runs", "sites.jsonl"), "utf8").trim().split("\n").map((l) => (JSON.parse(l) as { invariants: Record<string, unknown>[] }).invariants[0]!);
}

test("a run whose sites did not change stores a reference that resolves to the same sites; changed sites are stored in full; a reference no record holds is reported, never an empty list", () => {
  const root = mkdtempSync(join(tmpdir(), "coherence-sites-"));
  try {
    const first = [site("src/a/x.ts", 3), site("src/a/y.ts", 9)];
    appendRun(root, run("2026-05-01T00:00:00.000Z", first));
    appendRun(root, run("2026-05-02T00:00:00.000Z", first));
    const changed = [site("src/a/x.ts", 4)];
    appendRun(root, run("2026-05-03T00:00:00.000Z", changed));
    appendRun(root, run("2026-05-04T00:00:00.000Z", changed));
    const lines = written(root);
    assert.deepEqual(lines[0]!["sites"], first, "the first run writes its sites in full");
    assert.equal(lines[1]!["sites"], undefined, "the unchanged run writes none");
    assert.deepEqual(lines[1]!["sitesRef"], { hash: sitesHash(first), at: "2026-05-01T00:00:00.000Z" }, "but a reference to the run that holds them");
    assert.deepEqual(lines[2]!["sites"], changed, "changed sites are written in full");
    assert.deepEqual(lines[3]!["sitesRef"], { hash: sitesHash(changed), at: "2026-05-03T00:00:00.000Z" });
    const loaded = loadRuns(root);
    assert.deepEqual(loaded.damaged, []);
    assert.deepEqual(loaded.records.map((r) => r.invariants[0]!.sites), [first, first, changed, changed], "every reader sees every run's sites");
    assert.ok(loaded.records.every((r) => r.invariants[0]!.sitesRef === undefined), "and never a reference");
    assert.deepEqual(Object.keys(loaded.records[1]!.invariants[0]!), Object.keys(loaded.records[0]!.invariants[0]!), "the sites stand where a full write puts them");
    assert.deepEqual(latestByEnforcement(loaded.records).get(entryKey("src/a", "sealed", "chokepoint"))?.sites, changed);
    // A fifth run unchanged from a resolved one refers to the run that holds them in full, never to a reference.
    appendRun(root, run("2026-05-05T00:00:00.000Z", changed));
    assert.deepEqual(written(root)[4]!["sitesRef"], { hash: sitesHash(changed), at: "2026-05-03T00:00:00.000Z" });
    // A reference whose run is gone: said, in the damaged lines and on the entry, never read as no sites.
    const lost = { ...run("2026-05-06T00:00:00.000Z", undefined), session: "lost" };
    (lost.invariants[0] as unknown as Record<string, unknown>)["sitesRef"] = { hash: sitesHash([site("src/a/z.ts", 1)]), at: "2026-01-01T00:00:00.000Z" };
    appendFileSync(join(root, ".coherence", "runs", "lost.jsonl"), JSON.stringify(lost) + "\n");
    const again = loadRuns(root);
    const unresolved = again.records.find((r) => r.session === "lost")!.invariants[0]!;
    assert.equal(unresolved.sites, undefined, "no sites are invented");
    assert.match(unresolved.sitesUnresolved ?? "", /are in no record/, "the entry says its sites are unknown");
    assert.ok(again.damaged.some((d) => d.file.endsWith("lost.jsonl") && /src\/a\/sealed: the sites this entry refers to/.test(d.reason)), "and the line is reported");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("over this repository's run store, a run written with its unchanged sites by reference reads exactly as one written in full, in fewer bytes", () => {
  const repo = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
  const store = join(repo, ".coherence", "runs");
  if (!existsSync(store)) return;
  const real = loadRuns(repo);
  assert.ok(real.records.every((r) => r.invariants.every((e) => e.sitesRef === undefined && e.sitesUnresolved === undefined)), "nothing old is converted: every recorded entry reads as written");
  // The latest run that carries sites, run again now: every one of its entries is its enforcement's latest.
  const last = [...real.records].reverse().find((r) => r.invariants.some((e) => e.sites !== undefined));
  if (last === undefined) return;
  const again: RunRecord = { ...JSON.parse(JSON.stringify(last)), at: new Date(Date.parse(real.records.at(-1)!.at) + 1000).toISOString(), session: "sites-reference-test" };
  const roots = ["full", "reference"].map((name) => {
    const root = mkdtempSync(join(tmpdir(), `coherence-sites-${name}-`));
    mkdirSync(join(root, ".coherence"), { recursive: true });
    cpSync(store, join(root, ".coherence", "runs"), { recursive: true });
    return root;
  });
  const [full, reference] = roots as [string, string];
  try {
    writeFileSync(join(full, ".coherence", "runs", "sites-reference-test.jsonl"), JSON.stringify(again) + "\n");
    appendRun(reference, again);
    const views = (root: string): string => {
      const loaded = loadRuns(root);
      return JSON.stringify({ loaded, latest: [...latestByEnforcement(loaded.records)] });
    };
    assert.equal(views(reference), views(full), "every view the run store feeds is byte-identical");
    const bytes = (root: string): number => statSync(join(root, ".coherence", "runs", "sites-reference-test.jsonl")).size;
    assert.ok(bytes(reference) < bytes(full), `the reference run is smaller: ${bytes(reference)} bytes against ${bytes(full)}`);
  } finally {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  }
});
