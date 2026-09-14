import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../src/config.ts";
import { captureScope } from "../src/readings/scope/capture.ts";
import { recordDefect } from "../src/evidence/defects.ts";
import { createWork } from "../src/coordination/work.ts";
import { appendDecision, openSession } from "../src/evidence/decisions.ts";
import { beginReceipt, readReceiptStart } from "../src/evidence/receipts.ts";
import { execFileSync } from "node:child_process";

export async function scopeFixture() {
  const root = await mkdtemp(join(tmpdir(), "scope-assets-"));
  await mkdir(join(root, "src"));
  await writeFile(join(root, "coherence.config.json"), JSON.stringify({ name: "Fixture", test: [], typecheck: [], ignore: ["node_modules", ".git", ".coherence", "public"] }));
  await writeFile(join(root, "project.spec.md"), '# Fixture\n\nAuthored purpose.\n\n## invariants\n\n- a quiet component is unmeasured\n\n## works when\n\n- src/main.ts exists\n');
  await writeFile(join(root, "src/main.ts"), 'export function hello() { return "hello"; }\n');
  return { root, cfg: await loadConfig(root) };
}
test("Scope assets — canonical structure, work and defects retain identities, full attributes and empty source readings", async () => {
  const { root, cfg } = await scopeFixture();
  try {
    const defect = recordDefect(cfg, { session: "scope-test", summary: "A real failure", evidence: "negative control", files: ["src/main.ts"] });
    const work = createWork(cfg, { session: "scope-test", objective: "Repair", criteria: ["negative control passes"], risk: "low",
      authority: { kind: "user-directed", grantedBy: "user", boundary: "fixture" }, writeScopes: ["src/main.ts"] });
    const snapshot = await captureScope(cfg), { assets, sources } = snapshot.catalog;
    assert.equal(snapshot.configuration.initialView, "structure");
    assert.ok(assets.some(a => a.kind === "component" && a.attributes.invariants));
    assert.ok(assets.some(a => a.kind === "file")); assert.ok(assets.some(a => a.kind === "symbol"));
    assert.deepEqual(assets.find(a => a.id === `defect:${defect.id}`)!.attributes, JSON.parse(JSON.stringify(defect)));
    assert.ok(assets.some(a => a.kind === "work" && a.attributes.opened));
    assert.ok(assets.some(a => a.kind === "work-event" && a.attributes.id === work.id));
    assert.ok(snapshot.catalog.relations.some(r => r.kind === "work-history" && r.source === `work-event:${work.id}`));
    assert.equal(sources.find(s => s.id === "receipts")!.status, "available");
    assert.equal(sources.find(s => s.id === "receipts")!.count, 0);
    assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), snapshot);
    assert.deepEqual(await captureScope(cfg), snapshot, "unchanged input is deterministic");
    assert.equal(await readFile(join(root, "src/main.ts"), "utf8"), 'export function hello() { return "hello"; }\n');
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("Scope assets — damage remains visible outside filters and invalid project configuration never becomes defaults", async () => {
  const { root, cfg } = await scopeFixture();
  try {
    await mkdir(join(root, ".coherence/defects"), { recursive: true });
    await writeFile(join(root, ".coherence/defects/torn.jsonl"), '{');
    const snapshot = await captureScope(cfg);
    assert.equal(snapshot.catalog.sources.find(s => s.id === "defects")!.status, "unavailable");
    assert.ok(snapshot.catalog.assets.some(a => a.kind === "component"));
    await writeFile(join(root, "coherence.scope.json"), '{"version":900}');
    await assert.rejects(captureScope(cfg), /supported version/);
    await writeFile(join(root, "coherence.scope.json"), '{');
    await assert.rejects(captureScope(cfg), /Scope configuration/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Scope specs — every content category and custom section survives with canonical semantics and exact authored text", async () => {
  const { root, cfg } = await scopeFixture();
  try {
    const text = '# Full spec\n\nThe complete intent.\n\nAdditional prose.\n\n## invariants\n\n- guarded\n- unanchored\n\n## works when\n\n- boundary "guarded" at hello via guard "hello test" [structural]\n\n## why\n\nA rationale that stays intact.\n\n## refutations\n\n- guarded: removed check; observed failure\n\n## zones\n\n- public: input\n- core inside public: state\n\n## addresses\n\n- {"claim":"missing"}\n\n## relies on\n\n- malformed declaration retained\n\n## guarantee bindings\n\n- {"custom":"retained"}\n\n## Local conventions\n\nCustom content.\n\n```md\n## Not a section\n```\n\n### Detailed note\n\nNested content.\n';
    await writeFile(join(root, "project.spec.md"), text);
    const snapshot = await captureScope(cfg), assets = snapshot.catalog.assets;
    const spec = assets.find(a => a.kind === "spec")!;
    assert.equal(spec.attributes.text, text);
    const headings = assets.filter(a => a.kind === "spec-section").map(a => a.attributes.heading);
    for (const heading of ["Full spec", "invariants", "works when", "why", "refutations", "zones", "addresses", "relies on", "guarantee bindings", "Local conventions", "Detailed note"]) assert.ok(headings.includes(heading), heading);
    assert.ok(!headings.includes("Not a section"));
    assert.equal(assets.find(a => a.kind === "invariant" && a.label === "guarded")!.attributes.anchored, true);
    assert.equal(assets.find(a => a.kind === "invariant" && a.label === "unanchored")!.attributes.anchored, false);
    assert.equal(assets.find(a => a.kind === "refutation")!.attributes.basis, "authored-negative-control");
    assert.equal(assets.find(a => a.kind === "claim")!.attributes.claimKind, "structural");
    assert.equal(assets.filter(a => a.kind === "zone").length, 2);
    assert.ok(assets.filter(a => a.kind === "zone").every(a => a.attributes.authoritative === true));
    assert.equal(snapshot.catalog.relations.filter(r => r.kind === "zone-inside").length, 1);
    assert.ok(assets.some(a => a.kind === "spec-section" && String(a.attributes.text).includes("malformed declaration retained")));
    assert.equal(assets.find(a => a.kind === "rationale")!.attributes.text, "A rationale that stays intact.");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Scope atlas — chart transitions are explicit selectable edges rather than opaque attributes", async () => {
  const { root, cfg } = await scopeFixture();
  try {
    cfg.atlas = { charts: { input: "Authored input", output: "Derived value" }, transitions: { hello: { from: "input", to: "output", translates: "Named crossing" } } };
    const catalog = (await captureScope(cfg)).catalog;
    assert.equal(catalog.assets.filter(a => a.kind === "chart").length, 2);
    assert.equal(catalog.assets.filter(a => a.kind === "zone").length, 0, "atlas charts are not spec trust zones");
    assert.ok(catalog.relations.some(r => r.kind === "translates" && r.source === "chart:input" && r.target === "chart:output"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Scope architecture — declarations retain provenance and one unresolved endpoint does not erase valid meaning", async () => {
  const { root, cfg } = await scopeFixture();
  try {
    await writeFile(join(root, "project.spec.md"), `# Fixture

Authored purpose.

## architecture

- {"kind":"purpose","id":"purpose","text":"A canonical project purpose."}
- {"kind":"entrance","id":"start","label":"Start here","component":".","description":"The supported entrance.","anchor":"src/main.ts"}
- {"kind":"relationship","id":"missing","from":".","to":"absent","label":"Names an unresolved participant","because":"The declaration must remain inspectable."}
`);
    const catalog = (await captureScope(cfg)).catalog;
    const purpose = catalog.assets.find(asset => asset.id === "description:architecture:.:purpose")!;
    assert.match(String(purpose.attributes.declaration), /project\.spec\.md:\d+$/);
    assert.ok(catalog.assets.some(asset => asset.id === "entrance:.:start"));
    assert.ok(catalog.assets.some(asset => asset.kind === "architecture-issue" && String(asset.attributes.message).includes("absent")));
    assert.ok(catalog.relations.some(relation => relation.kind === "architecture" && relation.target === "component:absent"));
    assert.equal(catalog.sources.find(source => source.id === "architecture")!.status, "available");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Scope architecture parser — fenced examples and duplicate or malformed declarations are explicit problems", async () => {
  const { parseSpec } = await import("../src/derivation/walk.ts");
  const parsed = parseSpec(`# Example

Purpose.

\`\`\`
## architecture
- {"kind":"purpose","id":"example","text":"Not live."}
\`\`\`

## architecture
- {"kind":"purpose","id":"live","text":"Live."}
- {"kind":"purpose","id":"live","text":"Duplicate."}
- {"kind":"purpose","id":"bad","text":"line\\nbreak"}
`);
  assert.deepEqual(parsed.architecture?.declarations.map(row => row.id), ["live"]);
  assert.ok(parsed.architecture?.problems.some(problem => problem.includes("duplicate id live")));
  assert.ok(parsed.architecture?.problems.some(problem => problem.includes("single-line")));
});

test("Scope journal assets — shared session-opening ids and repeated decision envelopes preserve every occurrence", async () => {
  const { root, cfg } = await scopeFixture();
  try {
    openSession(cfg, { session: "one", now: "2026-01-01T00:00:00.000Z" });
    openSession(cfg, { session: "two", now: "2026-01-01T00:00:01.000Z" });
    const decision = { session: "one", kind: "decision" as const, chose: "same semantic choice", because: "same reason" };
    const a = appendDecision(cfg, { ...decision, now: "2026-01-01T00:00:02.000Z" });
    const b = appendDecision(cfg, { ...decision, now: "2026-01-01T00:00:03.000Z" });
    assert.equal(a.id, b.id);
    const catalog = (await captureScope(cfg)).catalog;
    assert.equal(catalog.sources.find(s => s.id === "journal")!.status, "available");
    assert.equal(catalog.assets.filter(a => a.kind === "decision" && a.attributes.kind === "session").length, 2);
    const item = catalog.assets.find(asset => asset.id === `decision:${a.id}`)!;
    assert.deepEqual((item.attributes.occurrences as Array<{ at: string }>).map(row => row.at), [a.at, b.at]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Scope receipt assets — incomplete execution retains its complete canonical start rather than a bare run id", async () => {
  const { root, cfg } = await scopeFixture();
  try {
    execFileSync("git", ["init", "-q"], { cwd: root });
    const start = beginReceipt(cfg, { session: "scope-run", agent: "test", fast: true });
    assert.deepEqual(readReceiptStart(cfg, start.run), start);
    assert.throws(() => readReceiptStart(cfg, "../../outside"), /invalid run identity/);
    const asset = (await captureScope(cfg)).catalog.assets.find(a => a.id === `verification-start:${start.run}`)!;
    assert.deepEqual(asset.attributes, { ...start, status: "incomplete" });
    await writeFile(join(root, ".coherence/verification/starts", `${start.run}.json`), '{}\n');
    assert.throws(() => readReceiptStart(cfg, start.run), /invalid start shape/);
    assert.equal((await captureScope(cfg)).catalog.sources.find(s => s.id === "receipts")!.status, "unavailable");
  } finally { await rm(root, { recursive: true, force: true }); }
});
