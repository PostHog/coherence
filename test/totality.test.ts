// totality.test.ts — the gate that makes an unbackable totality claim UNSAYABLE.
//
// The finding this pins, measured in a consumer (mnemion) rather than here: 15 oracle names
// ending in "totality", covering two incompatible promises. `egress-sensitivity totality` is
// anchored to `SENSITIVE_COLUMNS`, a `const` this code owns — finite, iterable, finishable.
// `SSRF block-host totality` is anchored to `isBlockedFederationHost`, a predicate whose last
// line is `return false` — no enumeration exists, so every host encoding nobody thought of is
// admitted by construction. Both rendered green, in the same words.
//
// The gate does not ask an author (or a model) which kind a claim is — that judgment is the
// same failure one level up. It reads the shape: an enumeration is a data symbol, a predicate
// is a `function`, and the grammar decides.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runVerify } from "../src/verification/verify.ts";
import { parseCoverage, claimsTotality, guaranteeRef, parseBoundary } from "../src/verification/boundary.ts";
import { tmpProject, cleanup, runCaptured, cfg, comp, sym, graph } from "./_helpers.ts";

/** A throwaway project root, cleaned up whatever the body does. */
async function withProject(files: Record<string, string>, fn: (root: string) => Promise<void>) {
  const root = await tmpProject(files);
  try { await fn(root); } finally { await cleanup(root); }
}

const ENUM = (name: string) => sym(name, "x.ts", undefined, "const");

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
    assert.match(r.out, /is a function — a predicate, not an enumeration/);
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

test("totality — a chokepoint that IS an enumeration needs no ceremony", async () => {
  // mnemion's `egress-sensitivity totality` at SENSITIVE_COLUMNS: already anchored to a list
  // this code owns, so it is entitled to the word as written and must NOT be churned.
  await withProject({}, async (root) => {
    const g = graph([
      comp(".", { claims: ['boundary "egress-sensitivity totality" at SENSITIVE_COLUMNS'], invariants: ["egress-sensitivity totality"], why: "r" }),
      ENUM("SENSITIVE_COLUMNS"),
    ]);
    const r = await runCaptured(() => runVerify(cfg(root), g, {}));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /1 green/);
  });
});

test("totality — `over` names the enumeration when the chokepoint is the applying function", async () => {
  // The mnemion repair shape: the gate runs at `writeClass`, but the SET is the policy table.
  await withProject({}, async (root) => {
    const g = graph([
      comp(".", { claims: ['boundary "write-policy totality" at writeClass over KERNEL_WRITE_POLICY'], invariants: ["write-policy totality"], why: "r" }),
      sym("writeClass"), ENUM("KERNEL_WRITE_POLICY"),
    ]);
    const r = await runCaptured(() => runVerify(cfg(root), g, {}));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /over KERNEL_WRITE_POLICY/, "the enumeration travels into the verdict detail");
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
  await withProject({}, async (root) => {
    const g = graph([
      comp(".", {
        claims: [
          'boundary "egress totality" at SENSITIVE_COLUMNS',
          'coverage "SSRF block-host" at isBlockedFederationHost residual "DNS rebinding"',
        ],
        invariants: ["egress totality", "SSRF block-host"], why: "r",
      }),
      ENUM("SENSITIVE_COLUMNS"), sym("isBlockedFederationHost"),
    ]);
    const r = await runCaptured(() => runVerify(cfg(root), g, {}));
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
