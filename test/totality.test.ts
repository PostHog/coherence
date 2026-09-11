// totality.test.ts — the gate that makes an unbackable totality claim UNSAYABLE.
//
// The finding this pins, measured in a consumer (mnemion) rather than here: 15 oracle names
// ending in "totality", covering two incompatible promises. `egress-sensitivity totality` is
// anchored to `SENSITIVE_COLUMNS`, a `const` this code owns — finite, iterable, finishable.
// `SSRF block-host totality` is anchored to `isBlockedFederationHost`, a predicate whose last
// line is `return false` — no enumeration exists, so every host encoding nobody thought of is
// admitted by construction. Both rendered green, in the same words.
//
// The gate now checks a bounded concrete-domain/direct-iteration grade. A declaration
// kind alone cannot establish population shape or oracle binding. Semantic coverage is
// still caller-assessed; execution must supply separate named-oracle evidence.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGraph } from "../src/derivation/derive.ts";
import { readStatus } from "../src/evidence/status.ts";
import { runVerify } from "../src/verification/verify.ts";
import { parseCoverage, claimsTotality, guaranteeRef, parseBoundary } from "../src/verification/boundary.ts";
import { tmpProject, cleanup, runCaptured, cfg, comp, sym, graph } from "./_helpers.ts";

/** A throwaway project root, cleaned up whatever the body does. */
async function withProject(files: Record<string, string>, fn: (root: string) => Promise<void>) {
  const root = await tmpProject(files);
  try { await fn(root); } finally { await cleanup(root); }
}

const ENUM = (name: string) => sym(name, "x.ts", undefined, "const");
const collectionFiles = (name: string, oracle = "checks domain") => ({
  "x.ts": `export const ${name} = ["a", "b"] as const; export function writeClass() {}`,
  "domain.test.ts": `import { test } from "node:test"; import assert from "node:assert/strict";
    import { ${name} } from "./x.ts";
    test("${oracle}", () => { for (const item of ${name}) assert.ok(item); });`,
});
const executable = (root: string) => cfg(root, {
  test: [process.execPath, "-e", "delete process.env.NODE_TEST_CONTEXT; const r = require('node:child_process').spawnSync(process.execPath, ['--experimental-transform-types', '--test', '--test-reporter=tap', '--test-name-pattern', process.argv[1]], { stdio: 'inherit' }); process.exit(r.status ?? 1)", "--"],
  testMatch: "ok [0-9]+ - checks domain", oracleExecution: "serial",
});

// ── the word, and what counts as saying it ────────────────────────────────────────────

test("totality — the promise is lexical, and both spellings count", () => {
  assert.ok(claimsTotality("egress-sensitivity totality"));
  assert.ok(claimsTotality("clipboard keysets are total"));   // "are total" is the same promise
  assert.ok(claimsTotality("TOTALITY"));                       // case-blind
  // Not the word. `totally` is an adverb, and a rule that fired on it would teach authors
  // to write around the gate rather than through it.
  assert.equal(claimsTotality("totally ordered comparison"), false);
  assert.equal(claimsTotality("subtotal reconciliation"), false);
  assert.equal(claimsTotality("covers every op"), false);
});

// ── the refusal ───────────────────────────────────────────────────────────────────────

test("totality — a claim anchored to a PREDICATE is refused, and the refusal names both exits", async () => {
  await withProject({}, async (root) => {
    const g = graph([
      comp(".", {
        // mnemion's actual claim, reduced: a guard on a `return false` predicate.
        claims: ['boundary "SSRF block-host totality" at isBlockedFederationHost via guard "SSRF block-host totality"'],
        invariants: ["SSRF block-host totality"], why: "r",
      }),
      sym("isBlockedFederationHost"),   // default kind: function — a predicate
    ]);
    const r = await runCaptured(() => runVerify(cfg(root), g, {}));
    assert.notEqual(r.code, 0, "an unbackable totality claim must go RED");
    assert.match(r.out, /\[totality\]/);
    assert.match(r.out, /is a function, not a supported concrete runtime enumeration/);
    // The refusal is only useful if it says what to do instead. BOTH exits, named:
    assert.match(r.out, /over <ENUMERATION>/, "must offer the enumeration exit");
    assert.match(r.out, /coverage "SSRF block-host totality" at isBlockedFederationHost residual/,
      "must offer the honest-sampling exit, spelled out for this claim");
  });
});

test("totality — `via guard` is NOT an exemption, because that is where the word was hiding", async () => {
  // `via guard` is the declared exemption from the live-domain meta-oracle, and it had become
  // the one place a totality claim could sit with nothing checking its domain at all. An
  // exemption from ANALYSING a domain is not an exemption from NAMING one.
  await withProject({}, async (root) => {
    for (const verb of ["guard", "test"]) {
      const g = graph([
        comp(".", { claims: [`boundary "write totality" at writeClass via ${verb} "write totality"`], invariants: ["write totality"], why: "r" }),
        sym("writeClass"),
      ]);
      const r = await runCaptured(() => runVerify(cfg(root, { oracleDomain: false }), g, {}));
      assert.notEqual(r.code, 0, `via ${verb} must be gated`);
      assert.match(r.out, /\[totality\]/, `via ${verb} must be gated`);
    }
  });
});

test("totality — `passes test` cannot launder the word, since it can name no domain", async () => {
  await withProject({}, async (root) => {
    const g = graph([comp(".", { claims: ['passes test "pattern-effects totality"'], why: "r" })]);
    const r = await runCaptured(() => runVerify(cfg(root), g, {}));
    assert.notEqual(r.code, 0);
    assert.match(r.out, /names no chokepoint/);
  });
});

test("totality — an unknown symbol kind REFUSES rather than passing (allow-list, not deny-list)", async () => {
  // A deny-list would let a language pack whose captures this code has never seen slip a
  // predicate through as an enumeration, silently. That is the green-by-absence the whole
  // feature exists to remove, so an unrecognised kind is loud and names itself.
  await withProject({}, async (root) => {
    const g = graph([
      comp(".", { claims: ['boundary "x totality" at Thing via guard "x totality"'], invariants: ["x totality"], why: "r" }),
      sym("Thing", "x.ts", undefined, "newfangled_capture"),
    ]);
    const r = await runCaptured(() => runVerify(cfg(root), g, {}));
    assert.notEqual(r.code, 0);
    assert.match(r.out, /is a newfangled_capture/, "the unrecognised kind must name itself");
  });
});

// ── the two ways to be entitled to the word ───────────────────────────────────────────

test("totality — a concrete enumeration with its bound executed oracle passes", async () => {
  // mnemion's `egress-sensitivity totality` at SENSITIVE_COLUMNS: already anchored to a list
  // this code owns, so it is entitled to the word as written and must NOT be churned.
  await withProject(collectionFiles("SENSITIVE_COLUMNS"), async (root) => {
    const g = graph([
      comp(".", { claims: ['boundary "egress-sensitivity totality" at SENSITIVE_COLUMNS via test "checks domain"'], invariants: ["egress-sensitivity totality"], why: "r" }),
      ENUM("SENSITIVE_COLUMNS"),
    ]);
    const r = await runCaptured(() => runVerify(executable(root), g, {}));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /1 green/);
  });
});

test("totality — `over` names the enumeration when the chokepoint is the applying function", async () => {
  // The mnemion repair shape: the gate runs at `writeClass`, but the SET is the policy table.
  await withProject(collectionFiles("KERNEL_WRITE_POLICY"), async (root) => {
    const g = graph([
      comp(".", { claims: ['boundary "write-policy totality" at writeClass over KERNEL_WRITE_POLICY via test "checks domain"'], invariants: ["write-policy totality"], why: "r" }),
      sym("writeClass"), ENUM("KERNEL_WRITE_POLICY"),
    ]);
    const r = await runCaptured(() => runVerify(executable(root), g, {}));
    assert.equal(r.code, 0, r.out);
    assert.match((await readStatus(cfg(root))).verify!.claims[0].detail!, /over KERNEL_WRITE_POLICY/, "the enumeration travels into the persisted verdict detail");
  });
});

test("totality — an `over` naming a symbol that does not exist is refused", async () => {
  await withProject({}, async (root) => {
    const g = graph([
      comp(".", { claims: ['boundary "x totality" at writeClass over NO_SUCH_LIST via guard "x totality"'], invariants: ["x totality"], why: "r" }),
      sym("writeClass"),
    ]);
    const r = await runCaptured(() => runVerify(cfg(root), g, {}));
    assert.notEqual(r.code, 0);
    assert.match(r.out, /"NO_SUCH_LIST" \(over\) not found/);
  });
});

// ── the honest verb ───────────────────────────────────────────────────────────────────

test("coverage — parses only WITH a residual, and carries it into the report", async () => {
  // The residual is the price of the verb. COVERAGE_RE is where that is enforced: a coverage
  // claim with nothing to say about what it missed does not parse as one.
  assert.equal(parseCoverage('coverage "SSRF block-host" at isBlockedFederationHost via guard "cases"'), null);
  const c = parseCoverage('coverage "SSRF block-host" at isBlockedFederationHost crossing owner-trusted -> federated residual "DNS rebinding — no DNS API on Workers" via guard "SSRF block-host cases"')!;
  assert.equal(c.subject, "SSRF block-host");
  assert.equal(c.residual, "DNS rebinding — no DNS API on Workers");
  assert.deepEqual(c.crossing, { from: "owner-trusted", to: "federated" });

  await withProject({}, async (root) => {
    const g = graph([
      comp(".", {
        claims: ['coverage "SSRF block-host" at isBlockedFederationHost residual "DNS rebinding — no DNS API on Workers"'],
        invariants: ["SSRF block-host"], why: "r",
      }),
      sym("isBlockedFederationHost"),
    ]);
    const r = await runCaptured(() => runVerify(cfg(root), g, {}));
    assert.equal(r.code, 0, r.out);
    // The residual reaches the reader. It was a source comment before this verb existed.
    assert.match(r.out, /NOT covered: DNS rebinding/);
  });
});

test("coverage — the two populations are counted APART and never summed", async () => {
  await withProject(collectionFiles("SENSITIVE_COLUMNS"), async (root) => {
    const g = graph([
      comp(".", {
        claims: [
          'boundary "egress totality" at SENSITIVE_COLUMNS via guard "checks domain"',
          'coverage "SSRF block-host" at isBlockedFederationHost residual "DNS rebinding"',
        ],
        invariants: ["egress totality", "SSRF block-host"], why: "r",
      }),
      ENUM("SENSITIVE_COLUMNS"), sym("isBlockedFederationHost"),
    ]);
    const r = await runCaptured(() => runVerify(executable(root), g, {}));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /of which SAMPLED \(coverage, open domain\): 1/);
    assert.match(r.out, /never added to it/);
  });
});

test("coverage — a coverage claim that says totality is the contradiction, and is refused", async () => {
  await withProject({}, async (root) => {
    const g = graph([
      comp(".", { claims: ['coverage "SSRF totality" at isBlockedFederationHost residual "DNS rebinding"'], invariants: ["SSRF totality"], why: "r" }),
      sym("isBlockedFederationHost"),
    ]);
    const r = await runCaptured(() => runVerify(cfg(root), g, {}));
    assert.notEqual(r.code, 0);
    assert.match(r.out, /cannot both sample and be total/);
  });
});

// ── the escape hatch, and what it does NOT switch off ─────────────────────────────────

test("totality — `totalityEnumeration: false` disables the gate, but NOT the separate tallies", async () => {
  await withProject({}, async (root) => {
    const g = graph([
      comp(".", {
        claims: [
          'boundary "SSRF totality" at isBlockedFederationHost',
          'coverage "other" at isBlockedFederationHost residual "the rest"',
        ],
        invariants: ["SSRF totality", "other"], why: "r",
      }),
      sym("isBlockedFederationHost"),
    ]);
    const r = await runCaptured(() => runVerify(cfg(root, { totalityEnumeration: false }), g, {}));
    assert.equal(r.code, 0, r.out);
    // The gate is off — but a sampled claim and a total one still must not add up, because
    // that sum is a false statement regardless of whether anyone asked for the gate.
    assert.match(r.out, /of which SAMPLED/);
  });
});

// ── identity ──────────────────────────────────────────────────────────────────────────

test("totality — `over` expires a binding, and its ABSENCE leaves every existing ref byte-identical", () => {
  const bare = parseBoundary('boundary "x" at writeClass via guard "g"')!;
  const withOver = parseBoundary('boundary "x" at writeClass over ENUM via guard "g"')!;
  assert.notEqual(guaranteeRef("o", withOver), guaranteeRef("o", bare), "naming the set narrows the contract");
  // The pre-`over` hash, pinned: a rehash of the whole population would have expired every
  // `g-…` binding in every adopter to add a field most claims do not carry.
  assert.equal(guaranteeRef("o", bare), "g-f2e2667846d35669c2b73436e3dfa8b6334c15b79e8a807f2e987933af7e926b");
});

test("enumeration admission — concrete domains and bound oracles reject the measured false positives", async () => {
  const claim = 'boundary "policy totality" at apply over DOMAIN via guard "checks domain"';
  const g = (kind = "const", extra: ReturnType<typeof sym>[] = []) => graph([
    comp(".", { claims: [claim], invariants: ["policy totality"], why: "r" }),
    sym("apply"), sym("DOMAIN", "x.ts", undefined, kind), ...extra,
  ]);
  const base = collectionFiles("DOMAIN");
  const cases: Array<{ label: string; files: Record<string, string>; kind?: string; extra?: ReturnType<typeof sym>[]; detail: RegExp }> = [
    { label: "scalar", files: { ...base, "x.ts": "export const DOMAIN = 7;" }, detail: /not a supported nonempty/ },
    { label: "interface", files: { ...base, "x.ts": "export interface DOMAIN { name: string }" }, kind: "interface", detail: /is a interface/ },
    { label: "empty domain", files: { ...base, "x.ts": "export const DOMAIN = [];" }, detail: /not a supported nonempty/ },
    { label: "dynamic spread", files: { ...base, "x.ts": "export const DOMAIN = [...getItems()];" }, detail: /not a supported nonempty/ },
    { label: "dynamic call", files: { ...base, "x.ts": "export const DOMAIN = getItems();" }, detail: /not a supported nonempty/ },
    { label: "global collision", files: base, extra: [sym("DOMAIN", "other.ts", undefined, "const")], detail: /resolve uniquely; found 2/ },
    { label: "wrong module", files: { ...base, "other.ts": 'export const DOMAIN = ["decoy"];', "domain.test.ts": base["domain.test.ts"].replace('./x.ts', './other.ts') }, detail: /does not directly iterate/ },
    { label: "escaping import", files: { ...base, "domain.test.ts": base["domain.test.ts"].replace('./x.ts', '../x.ts') }, detail: /does not directly iterate/ },
    { label: "emitted-path ambiguity", files: { ...base, "x.js": 'export const DOMAIN=["decoy"];', "domain.test.ts": base["domain.test.ts"].replace('./x.ts', './x.js') }, detail: /does not directly iterate/ },
    { label: "extensionless import", files: { ...base, "domain.test.ts": base["domain.test.ts"].replace('./x.ts', './x') }, detail: /does not directly iterate/ },
    { label: "commented type import", files: { ...base, "domain.test.ts": base["domain.test.ts"].replace('import { DOMAIN }', 'import /* comment */ type { DOMAIN }') }, detail: /does not directly iterate/ },
    { label: "commented type specifier", files: { ...base, "domain.test.ts": base["domain.test.ts"].replace('import { DOMAIN }', 'import { type/*comment*/ DOMAIN }') }, detail: /does not directly iterate/ },
    { label: "wrong collection", files: { ...base, "domain.test.ts": base["domain.test.ts"].replace('of DOMAIN', 'of OTHER') }, detail: /does not directly iterate/ },
    { label: "shadowed parameter", files: { ...base, "domain.test.ts": base["domain.test.ts"].replace('() => {', '(DOMAIN) => {') }, detail: /does not directly iterate/ },
    { label: "shadowed local", files: { ...base, "domain.test.ts": base["domain.test.ts"].replace('() => {', '() => { const DOMAIN = ["decoy"];') }, detail: /does not directly iterate/ },
    { label: "enclosing shadow", files: { ...base, "domain.test.ts": 'import {DOMAIN} from "./x.ts"; function register(DOMAIN) { test("checks domain", () => { for (const x of DOMAIN) {} }); }' }, detail: /does not directly iterate/ },
    { label: "shadowed wrapper", files: { ...base, "domain.test.ts": 'import {DOMAIN} from "./x.ts"; const Object = { keys: () => [] }; test("checks domain", () => { for (const x of Object.keys(DOMAIN)) {} });' }, detail: /does not directly iterate/ },
    { label: "catch shadow", files: { ...base, "domain.test.ts": 'import {DOMAIN} from "./x.ts"; test("checks domain", () => { try { throw ["decoy"]; } catch (DOMAIN) { for (const x of DOMAIN) {} } });' }, detail: /does not directly iterate/ },
    { label: "named function shadow", files: { ...base, "domain.test.ts": 'import {DOMAIN} from "./x.ts"; test("checks domain", function DOMAIN() { for (const x of DOMAIN) {} });' }, detail: /does not directly iterate/ },
    { label: "export alias redirection", files: { ...base, "x.ts": 'const DOMAIN=["a","b"]; const OTHER=["decoy"]; export {OTHER as DOMAIN};' }, detail: /does not directly iterate/ },
    { label: "destructured wrapper", files: { ...base, "domain.test.ts": 'import {DOMAIN} from "./x.ts"; const { Object } = { Object: { keys: () => [] } }; test("checks domain", () => { for (const x of Object.keys(DOMAIN)) {} });' }, detail: /does not directly iterate/ },
    { label: "catch wrapper", files: { ...base, "domain.test.ts": 'import {DOMAIN} from "./x.ts"; test("checks domain", () => { try {} catch (Object) { for (const x of Object.keys(DOMAIN)) {} } });' }, detail: /does not directly iterate/ },
    { label: "prototype setter", files: { ...base, "x.ts": 'export const DOMAIN={__proto__:["a","b"]};' }, detail: /not a supported nonempty/ },
    { label: "escaped prototype setter", files: { ...base, "x.ts": 'export const DOMAIN={"__\\u0070roto__":["a","b"]};' }, detail: /not a supported nonempty/ },
    { label: "object array coercion", files: { ...base, "x.ts": 'export const DOMAIN={a:1,b:2};', "domain.test.ts": 'import {DOMAIN} from "./x.ts"; test("checks domain", () => { for (const x of Array.from(DOMAIN)) {} });' }, detail: /does not directly iterate/ },
    { label: "object authored traversal", files: { ...base, "x.ts": 'export const DOMAIN={a:1,forEach:()=>{}};', "domain.test.ts": 'import {DOMAIN} from "./x.ts"; test("checks domain", () => DOMAIN.forEach(x=>{}));' }, detail: /does not directly iterate/ },
    { label: "filtered subset", files: { ...base, "domain.test.ts": base["domain.test.ts"].replace('of DOMAIN)', 'of DOMAIN.filter(() => false))') }, detail: /does not directly iterate/ },
    { label: "short-circuit traversal", files: { ...base, "domain.test.ts": 'import {DOMAIN} from "./x.ts"; test("checks domain", () => DOMAIN.some(x => true));' }, detail: /does not directly iterate/ },
    { label: "missing oracle", files: { "x.ts": base["x.ts"] }, detail: /direct test\/it\/describe declaration; found 0/ },
    { label: "duplicate oracle", files: { ...base, "other.test.ts": base["domain.test.ts"] }, detail: /direct test\/it\/describe declaration; found 2/ },
    { label: "damaged oracle source", files: { ...base, "domain.test.ts": base["domain.test.ts"] + " function {" }, detail: /UNKNOWN/ },
  ];
  for (const row of cases) await withProject(row.files, async (root) => {
    const r = await runCaptured(() => runVerify(cfg(root, { oracleDomain: false }), g(row.kind, row.extra), { fast: true }));
    assert.notEqual(r.code, 0, `${row.label}: ${r.out}`);
    assert.match(r.out, row.detail, `${row.label}: ${r.out}`);
    assert.match(r.out, /\[totality\]/);
  });
});

test("enumeration admission — unique source binding preserves aliases and finite domain positive controls", async () => {
  const base = collectionFiles("DOMAIN");
  const cases = [
    { source: 'export const DOMAIN = ["a", "b"] as const;', kind: "const", domain: "DOMAIN" },
    { source: 'export const DOMAIN = { a: 1, b: 2 } as const;', kind: "const", domain: "Object.keys(DOMAIN)" },
    { source: 'export enum DOMAIN { A = "a", B = "b" }', kind: "enum", domain: "Object.values(DOMAIN)" },
  ];
  for (const row of cases) await withProject({
    ...base,
    "x.ts": row.source,
    "domain.test.ts": base["domain.test.ts"].replace('import { DOMAIN }', 'import { DOMAIN as actual }').replace('of DOMAIN', `of ${row.domain.replace('DOMAIN', 'actual')}`),
  }, async (root) => {
    const g = graph([comp(".", { claims: ['boundary "policy totality" at DOMAIN via guard "checks domain"'], invariants: ["policy totality"], why: "r" }), sym("DOMAIN", "x.ts", undefined, row.kind)]);
    const fast = await runCaptured(() => runVerify(cfg(root), g, { fast: true }));
    assert.equal(fast.code, 0, fast.out);
    assert.match(fast.out, /0 green · 0 red · 1 skipped/, "structural binding cannot mint an execution pass");
    const full = await runCaptured(() => runVerify(executable(root), g, {}));
    assert.equal(full.code, 0, full.out);
    assert.match(full.out, /1 green/);
    assert.match((await readStatus(cfg(root))).verify!.claims[0].detail!, /semantic coverage is caller-assessed/);
  });
});

test("enumeration admission — no oracle cannot pass while explicit disabling retains its documented escape", async () => {
  await withProject(collectionFiles("DOMAIN"), async (root) => {
    const g = graph([comp(".", { claims: ['boundary "policy totality" at DOMAIN'], invariants: ["policy totality"], why: "r" }), ENUM("DOMAIN")]);
    const on = await runCaptured(() => runVerify(cfg(root), g, {}));
    assert.notEqual(on.code, 0, on.out);
    assert.match(on.out, /names no oracle/);
    const off = await runCaptured(() => runVerify(cfg(root, { totalityEnumeration: false }), g, {}));
    assert.equal(off.code, 0, off.out);
    assert.match(off.out, /1 green/);
  });
});


test("enumeration admission — derived source graphs retain scalar refusal and direct-domain acceptance", async () => {
  for (const [source, rejects] of [["export const DOMAIN = 1;", true], ['export const DOMAIN = ["a", "b"];', false]] as const) {
    await withProject({ ...collectionFiles("DOMAIN"), "x.ts": source,
      "project.spec.md": '# Project\n\nA domain checker.\n\n## works when\n\n- boundary "policy totality" at DOMAIN via guard "checks domain"\n\n## why\n\nThe fixture checks the real derivation boundary.\n',
    }, async (root) => {
      const config = cfg(root);
      const derived = await buildGraph(config);
      const r = await runCaptured(() => runVerify(config, derived, { fast: true }));
      if (rejects) { assert.notEqual(r.code, 0, r.out); assert.match(r.out, /not a supported nonempty/); }
      else { assert.equal(r.code, 0, r.out); assert.match(r.out, /0 green · 0 red · 1 skipped/); }
    });
  }
});
