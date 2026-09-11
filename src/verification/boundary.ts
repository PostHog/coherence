// boundary.ts — the ONE home of the boundary- and coverage-claim grammars.
//
// `boundary "<invariant>" at <chokepoint> [over <enumeration>] [crossing <zone> -> <zone>] [via (test|guard) "<oracle>"]`
// `coverage "<subject>" at <chokepoint> [crossing <zone> -> <zone>] residual "<what is NOT covered>" [via (test|guard) "<oracle>"]`
//
// ── WHY TWO VERBS, AND WHY `over` ─────────────────────────────────────────────────────
//
// MEASURED, in a consumer, not here: mnemion carries 15 oracles whose names end in
// "totality", and they are not the same kind of promise. Two of them:
//
//   boundary "egress-sensitivity totality" at SENSITIVE_COLUMNS  via test  "…"
//   boundary "SSRF block-host totality"    at isBlockedFederationHost via guard "…"
//
// A concrete source-owned list can bound a population; a predicate over external inputs
// cannot supply such a list merely by existing. Naming the domain is necessary, but a
// declaration KIND is insufficient: consts can be scalars and interfaces are erased.
// totality.ts therefore checks concrete runtime collection shape, unique source identity,
// and direct iteration by the named oracle at a bounded TS/JS grade. It does not infer
// semantic totality from those syntactic facts. Unsupported shapes refuse explicitly;
// a genuinely sampled open-domain claim uses coverage and declares its residual.
//
// The `over` clause mirrors `parity … over <domain> …`, which has required a resolvable
// enumeration since it shipped. This is that rule, applied to the other totality verb.
//
// This regex used to live (identically, in intent) at three sites — structural.ts,
// verify.ts, and render-claude.ts — and the render-claude copy drifted: it matched
// `via test` only, so `via guard` boundaries silently vanished from the generated
// CLAUDE.md invariants table. One exported regex + one parser is the structural fix:
// the grammar cannot drift again because it has nowhere else to live.
//
// The OPTIONAL `crossing <from> -> <to>` clause states what wall (which pair of declared
// trust zones) this gate sits on — the PROMISE GRAPH's topology axiom (a gate declares
// what it separates). It is purely declarative: verify ignores it (a crossing is not a
// runtime check), scene/atlas/structural read only the fields they already read, and every
// pre-crossing spec parses UNCHANGED because both the crossing clause and the via clause
// are optional and independently absent. The clause sits BETWEEN chokepoint and via, so a
// gate may declare a crossing with or without an oracle, in any combination.
//
// Capture groups: 1=invariant, 2=chokepoint symbol, 3=enumeration (`over`), 4=crossing-from,
// 5=crossing-to, 6=verb (test|guard), 7=oracle name. Group 3 is undefined without an `over`
// clause, 4/5 without a crossing, 6/7 without a via — each independently optional, so every
// pre-`over` spec in every consumer parses unchanged.
import { createHash } from "node:crypto";

export const BOUNDARY_RE =
  /^boundary\s+"([^"]+)"\s+at\s+(\S+)(?:\s+over\s+(\S+))?(?:\s+crossing\s+(\S+)\s+->\s+(\S+))?(?:\s+via (test|guard)\s+"([^"]+)")?$/;

/** The COVERAGE grammar — the honest verb for an open domain. `residual` is REQUIRED and
 *  the regex is where that is enforced: a coverage claim with nothing to say about what it
 *  does not cover is the green-by-absence this verb exists to prevent, so it simply does
 *  not parse as one. Capture groups: 1=subject, 2=chokepoint, 3=crossing-from,
 *  4=crossing-to, 5=residual, 6=verb, 7=oracle. */
export const COVERAGE_RE =
  /^coverage\s+"([^"]+)"\s+at\s+(\S+)(?:\s+crossing\s+(\S+)\s+->\s+(\S+))?\s+residual\s+"([^"]+)"(?:\s+via (test|guard)\s+"([^"]+)")?$/;

/** A parsed boundary claim. `verb`/`oracle` are `""` when the claim has no `via` clause;
 *  `crossing` is null when it declares no `crossing <from> -> <to>` wall; `over` is null
 *  when it names no explicit enumeration (the chokepoint may still be one). */
export interface Boundary {
  inv: string;
  chokepoint: string;
  verb: string;
  oracle: string;
  over: string | null;
  crossing: { from: string; to: string } | null;
}

/** A parsed coverage claim. `residual` is never empty — COVERAGE_RE will not match without
 *  it. Same shape as Boundary otherwise, so renderers can treat the two uniformly where the
 *  distinction does not matter (and MUST NOT where it does — see `verify`'s two tallies). */
export interface Coverage {
  subject: string;
  chokepoint: string;
  verb: string;
  oracle: string;
  residual: string;
  crossing: { from: string; to: string } | null;
}

/** Parse a boundary claim, or null if the line is not one. */
export function parseBoundary(claim: string): Boundary | null {
  const m = BOUNDARY_RE.exec(claim);
  if (!m) return null;
  return {
    inv: m[1],
    chokepoint: m[2],
    over: m[3] ?? null,
    verb: m[6] ?? "",
    oracle: m[7] ?? "",
    crossing: m[4] && m[5] ? { from: m[4], to: m[5] } : null,
  };
}

/** Parse a coverage claim, or null if the line is not one. */
export function parseCoverage(claim: string): Coverage | null {
  const m = COVERAGE_RE.exec(claim);
  if (!m) return null;
  return {
    subject: m[1],
    chokepoint: m[2],
    residual: m[5],
    verb: m[6] ?? "",
    oracle: m[7] ?? "",
    crossing: m[3] && m[4] ? { from: m[3], to: m[4] } : null,
  };
}

/**
 * Does this oracle name PROMISE COVERAGE OF A WHOLE DOMAIN? Lexical on purpose — the word
 * is what a reader believes, so the word is what must be backed. `totality` and `total`
 * both, as whole words, because "keysets are total" and "keyset totality" make the identical
 * promise and a rule that caught only one spelling would teach authors the other.
 *
 * NOT a general universal-term lint. `any`/`never`/`pure`/`deterministic`/`exact` make
 * related over-claims and are deliberately out of scope here: each needs its own
 * qualification suite, and shipping one enforceable rule beats gesturing at five.
 */
export const TOTALITY_RE = /\b(totality|total)\b/i;
export const claimsTotality = (oracleName: string): boolean => TOTALITY_RE.test(oracleName);

/** Full contract reference, unlike verdict lookup: crossing edits also expire links.
 * List position and display names are excluded; owner relocation needs explicit review.
 *
 * `over` is INSIDE the hash, and deliberately: naming the enumeration narrows what the
 * boundary promises, so a binding written against the unnamed form was written against a
 * weaker contract and must be re-made rather than silently inherited. That is the same
 * reason `crossing` is here — a link survives cosmetic edits, never contract edits.
 *
 * It is APPENDED ONLY WHEN PRESENT, so the hashed array of an `over`-less claim is
 * byte-identical to what it was before this clause existed. Every `g-…` ref already written
 * into a consumer's spec keeps resolving; only a claim that actually gains an enumeration
 * gets a new identity. A rehash of the whole population would have expired every binding in
 * every adopter to add a field most of them do not use. */
export function guaranteeRef(owner: string, boundary: Boundary): string {
  const { inv, chokepoint, over, verb, oracle, crossing } = boundary;
  return `g-${createHash("sha256").update(JSON.stringify([owner, inv, chokepoint, verb, oracle,
    crossing ? [crossing.from, crossing.to] : null, ...(over ? [over] : [])])).digest("hex")}`;
}

/** The crossing clause is PURELY DECLARATIVE (topology, never a runtime check) — so it must
 *  not leak into verify-record identity. Records are keyed on the verbatim claim string, and
 *  without this normalization, ANNOTATING an existing boundary with a crossing orphans its
 *  prior verdict (the post-crossing claim no longer matches the pre-crossing record key —
 *  every such gate silently drops from its earned grade on pure annotation). This
 *  reconstructs the canonical claim WITHOUT the crossing clause; non-boundary claims pass
 *  through verbatim. Two claims that collide after stripping share inv+chokepoint+verb+oracle
 *  — genuinely the same gate. Applied on BOTH sides of every record lookup (store + read);
 *  verify still WRITES the raw claim — normalization is strictly a lookup concern.
 *
 *  `over` SURVIVES this normalization while `crossing` does not, and the asymmetry is the
 *  point: a crossing is declarative topology verify never evaluates, but `over` names the
 *  enumeration the totality gate checks against — two claims differing in it are checked
 *  differently and must not share a verdict record. */
export function normalizeBoundaryClaim(claim: string): string {
  const m = BOUNDARY_RE.exec(claim);
  if (!m || !(m[4] && m[5])) return claim;   // not a boundary, or no crossing → verbatim
  return `boundary "${m[1]}" at ${m[2]}${m[3] ? ` over ${m[3]}` : ""}${m[6] ? ` via ${m[6]} "${m[7]}"` : ""}`;
}

/** The BRAND that makes raw-string record lookup a compile error. Only `claimKey` can mint
 *  one, so a `Map<ClaimKey, …>` cannot be probed with `` `${node} ${claim}` `` — the exact
 *  bypass that let mergeClaimRecords/panel/verify forget a claim's failure history on pure
 *  crossing annotation while scene/promise remembered it. */
declare const CLAIM_KEY_BRAND: unique symbol;
export type ClaimKey = string & { readonly [CLAIM_KEY_BRAND]: true };

/** The ONE record-lookup key EVERY consumer of `status.verify.claims` uses (store AND read)
 *  — the promise graph, the panel, the merge, and verify's decoration filter —
 *  so a pre-crossing record matches a post-crossing claim and vice versa. Returns the
 *  branded `ClaimKey`: there is no other way to mint one. */
export const claimKey = (node: string, claim: string): ClaimKey =>
  `${node} ${normalizeBoundaryClaim(claim)}` as ClaimKey;
