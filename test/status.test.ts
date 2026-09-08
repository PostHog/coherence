// status.test.ts — the persistent run record. The load-bearing logic is the MERGE:
// a skip must never clobber a real verdict (the --fast tier would otherwise erase
// last week's oracle pass every run), scoped runs must replace only what they
// touched, and full-tree runs must drop ghost rows for claims that left the specs.
// Plus the integration: runVerify actually files a report a reader can consume.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mergeClaimRecords, readStatus, recordVerify, recordAtlas, recordMass, type ClaimRecord } from "../src/evidence/status.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, mkdir, readdir } from "node:fs/promises";
import { runVerify } from "../src/verification/verify.ts";
import { tmpProject, cleanup, runCaptured, cfg, comp, graph } from "./_helpers.ts";

const rec = (node: string, claim: string, kind: ClaimRecord["kind"], o: Partial<ClaimRecord> = {}): ClaimRecord =>
  ({ node, claim, kind, at: "2026-01-01T00:00:00.000Z", commit: "aaaa111", tier: "full", ...o });

test("status publication — concurrent processes preserve independent reports and readers see complete JSON", async () => {
  const root = await tmpProject({ ".coherence/status.json": '{"version":1}\n' });
  const module = new URL("../src/evidence/status.ts", import.meta.url).href;
  const helper = new URL("./_helpers.ts", import.meta.url).href;
  const source = (kind: string) => `import {recordAtlas,recordMass,recordVerify,recordDrift,recordEconomy} from ${JSON.stringify(module)}; import {cfg} from ${JSON.stringify(helper)};
    for(let i=0;i<12;i++) { const c=cfg(process.cwd()); if(${JSON.stringify(kind)}==="atlas")
      await recordAtlas(c,{tiers:{enshrined:i,checked:0,convention:0},crossings:[],drift:[],dangling:[],overclaimed:[],tier3Security:[]});
      else if(${JSON.stringify(kind)}==="mass") await recordMass(c,{dims:[{key:"probe",value:i}]});
      else if(${JSON.stringify(kind)}==="drift") await recordDrift(c,{devCommits:i,locality:[],spread:[],seams:[],verdict:"probe"});
      else if(${JSON.stringify(kind)}==="economy") await recordEconomy(c,{considered:i,medianFiles:0,medianLines:0,p90Files:0,p90Lines:0,series:[]});
      else await recordVerify(c,{tier:"fast",scope:null,sigs:[],coverage:{components:0,claimed:0,withWhy:0,symbols:0,documented:0},invTotal:0,invGaps:[],narrative:null,jobs:0,failures:i}); }`;
  try {
    let done = false;
    const writers = Promise.all(["atlas", "mass", "verify", "drift", "economy"].map(kind => promisify(execFile)(process.execPath,
      ["--input-type=module", "-e", source(kind)], { cwd: root }))).finally(() => { done = true; });
    let reads = 0;
    // Retain reader errors until both children finish, so cleanup never races writers.
    let failure: unknown;
    while (!done) { try { await readStatus(cfg(root)); reads++; } catch (error) { failure = error; } }
    await writers;
    assert.equal(failure, undefined); assert.ok(reads > 0);
    const state = await readStatus(cfg(root));
    assert.equal(state.atlas?.tiers.enshrined, 11); assert.equal(state.mass?.dims[0].value, 11);
    assert.equal(state.verify?.failures, 11); assert.equal(state.drift?.devCommits, 11); assert.equal(state.economy?.considered, 11);
    assert.deepEqual(await readdir(join(root, ".coherence")), ["status.json"]);
  } finally { await cleanup(root); }
});

test("status publication — failed serialization and an abandoned lock preserve the prior record", async () => {
  const root = await tmpProject({ ".coherence/status.json": '{"version":1}\n' });
  try {
    const c = cfg(root), original = await readFile(join(root, ".coherence/status.json"), "utf8");
    const circular = { dims: [] }; Object.assign(circular, { self: circular });
    await assert.rejects(recordMass(c, circular), /circular/i);
    assert.equal(await readFile(join(root, ".coherence/status.json"), "utf8"), original);
    assert.deepEqual(await readdir(join(root, ".coherence")), ["status.json"]);
    await mkdir(join(root, ".coherence/status.lock"));
    await assert.rejects(recordMass(c, { dims: [] }), /Status write busy/);
    assert.equal(await readFile(join(root, ".coherence/status.json"), "utf8"), original);
    assert.ok((await readdir(join(root, ".coherence"))).includes("status.lock"), "an abandoned lock is not stolen");
  } finally { await cleanup(root); }
});

test("merge — a skip never clobbers a real verdict; the old verdict rides through with its own stamp", () => {
  const prev = [rec("A", 'passes test "t"', "pass")];
  const fresh = [rec("A", 'passes test "t"', "skip", { at: "2026-02-01T00:00:00.000Z", tier: "fast", detail: "executable tier (--fast)" })];
  const out = mergeClaimRecords(prev, fresh, null);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, "pass");
  assert.equal(out[0].at, "2026-01-01T00:00:00.000Z"); // the OLD stamp — staleness stays honest
});

test("merge — annotating a boundary with a crossing clause never erases its history (identity is claimKey, not the raw string)", () => {
  // The trust-ledger amnesia case, demonstrated live 2026-07-31: the record held
  // everFailed:true, runs:50 for the bare claim; one purely declarative `crossing`
  // annotation — the exact edit normalizeBoundaryClaim exists to make safe — and a
  // raw-string-keyed merge returned everFailed:false, runs:1. The lookup must go
  // through claimKey on BOTH sides, so the pre-annotation record is found.
  const bare = 'boundary "fail-closed writes" at applyWritePolicy via guard "g"';
  const crossed = 'boundary "fail-closed writes" at applyWritePolicy crossing agent -> storage via guard "g"';
  const prev = [rec("A", bare, "pass", { everFailed: true, lastFailAt: "2025-12-01T00:00:00.000Z", lastFailCommit: "dead111", runs: 50 })];
  const out = mergeClaimRecords(prev, [rec("A", crossed, "pass", { at: "2026-02-01T00:00:00.000Z" })], null);
  assert.equal(out.length, 1);
  assert.equal(out[0].everFailed, true, "a claim that has ever been red must never be able to forget it — not even on pure annotation");
  assert.equal(out[0].lastFailCommit, "dead111", "the failure's provenance rides through the rename");
  assert.equal(out[0].runs, 51, "fifty prior runs plus this one — not a history reset to 1");
  assert.equal(out[0].claim, crossed, "the record itself carries the raw annotated claim — normalization is strictly a lookup concern");
});

test("merge — a fail replaces a pass, and a pass replaces a fail (real verdicts always win)", () => {
  const prev = [rec("A", "x.ts exists at root", "pass")];
  const fresh = [rec("A", "x.ts exists at root", "fail", { at: "2026-02-01T00:00:00.000Z" })];
  assert.equal(mergeClaimRecords(prev, fresh, null)[0].kind, "fail");
  assert.equal(mergeClaimRecords(fresh, prev, null)[0].kind, "pass");
});

test("merge — a full-tree run drops records for claims that vanished from the specs", () => {
  const prev = [rec("A", "old claim", "pass"), rec("A", "kept claim", "pass")];
  const fresh = [rec("A", "kept claim", "pass")];
  const out = mergeClaimRecords(prev, fresh, null);
  assert.deepEqual(out.map((c) => c.claim), ["kept claim"]);
});

test("merge — a scoped run replaces only the evaluated components; out-of-scope records ride through", () => {
  const prev = [rec("A", "a claim", "pass"), rec("B", "b claim", "fail")];
  const fresh = [rec("A", "a claim", "fail", { at: "2026-02-01T00:00:00.000Z" })];
  const out = mergeClaimRecords(prev, fresh, new Set(["A"]));
  const a = out.find((c) => c.node === "A")!;
  const b = out.find((c) => c.node === "B")!;
  assert.equal(a.kind, "fail");         // in scope: replaced
  assert.equal(b.kind, "fail");         // out of scope: untouched
  assert.equal(b.at, "2026-01-01T00:00:00.000Z");
});

test("runVerify files a report — claims, coverage, invariants land in .coherence/status.json", async () => {
  const root = await tmpProject({ "present.txt": "" });
  try {
    const c = cfg(root);
    const g = graph([comp(".", { label: "Root", claims: ["present.txt exists at root", "gibberish claim line"], why: "r" })]);
    await runCaptured(() => runVerify(c, g, { fast: true }));
    const s = await readStatus(c);
    assert.ok(s.verify, "verify section written");
    assert.equal(s.verify!.tier, "fast");
    assert.equal(s.verify!.scope, null);
    assert.equal(s.verify!.lastFastAt, s.verify!.at);
    const claims = s.verify!.claims;
    assert.equal(claims.find((x) => x.claim.startsWith("present"))!.kind, "pass");
    const gap = claims.find((x) => x.claim.startsWith("gibberish"))!;
    assert.equal(gap.kind, "skip");
    assert.match(gap.detail ?? "", /dialect gap/);
    assert.equal(s.verify!.coverage.components, 1);
    assert.equal(s.verify!.coverage.withWhy, 1);
    assert.equal(s.verify!.commit, null); // tmp dir is not a git repo — stamped honestly
  } finally { await cleanup(root); }
});

test("full-then-fast — the fast tier's skip does not erase the full tier's oracle pass; both tier stamps tracked", async () => {
  // A fake runner that always passes; the full run records the pass, then a --fast run
  // skips the executable tier — the record must keep the pass, and lastFastAt/lastFullAt
  // must age independently.
  // Name-sensitive (the serial canary refuses a runner that cannot fail).
  const runner = "process.exit(process.argv[2] === 'the oracle' ? 0 : 1);";
  const root = await tmpProject({ "runner.js": runner });
  try {
    const c = cfg(root, { test: ["node", join(root, "runner.js")] });
    const g = graph([comp(".", { label: "Root", claims: ['passes test "the oracle"'], why: "r" })]);
    await runCaptured(() => runVerify(c, g, { fast: false, serial: true }));
    let s = await readStatus(c);
    assert.equal(s.verify!.claims[0].kind, "pass");
    const fullAt = s.verify!.lastFullAt;
    assert.ok(fullAt);

    await runCaptured(() => runVerify(c, g, { fast: true }));
    s = await readStatus(c);
    assert.equal(s.verify!.claims[0].kind, "pass", "fast-tier skip must not clobber the full-tier pass");
    assert.equal(s.verify!.claims[0].tier, "full", "the surviving record is the full-tier verdict");
    assert.equal(s.verify!.lastFullAt, fullAt, "full stamp untouched by a fast run");
    assert.ok(s.verify!.lastFastAt, "fast stamp recorded");
  } finally { await cleanup(root); }
});

test("scoped recordVerify — gap lists merge per component (touched replaced, untouched inherited)", async () => {
  const root = await tmpProject({});
  try {
    const c = cfg(root);
    // Full-tree run first: two components, each with one gap.
    await recordVerify(c, {
      tier: "fast", scope: null, sigs: [],
      coverage: { components: 2, claimed: 2, withWhy: 2, symbols: 0, documented: 0 },
      invTotal: 4, invGaps: [{ comp: "A", inv: "a-inv" }, { comp: "B", inv: "b-inv" }],
      narrative: null, jobs: 0, failures: 2,
    });
    // Scoped run touching only A, which fixed its gap.
    await recordVerify(c, {
      tier: "fast", scope: ["A"], sigs: [],
      coverage: { components: 2, claimed: 2, withWhy: 2, symbols: 0, documented: 0 },
      invTotal: 4, invGaps: [],
      narrative: null, jobs: 0, failures: 0,
    });
    const s = await readStatus(c);
    assert.deepEqual(s.verify!.invariants.gaps, [{ comp: "B", inv: "b-inv" }], "A's gap cleared, B's inherited");
    assert.equal(s.verify!.invariants.anchored, 3);
  } finally { await cleanup(root); }
});
