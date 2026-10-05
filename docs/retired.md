# Retired mechanisms of the reference implementation

Decided during the lexicon pass of 2026-09-17. These are rejected designs, not rejected words; the words that must not return are recorded as rejected names on the concepts that replaced them. Journal record: d-05165276. The reference implementation is preserved on branch feat/totality-enumeration-gate at commit 645d928.

## atlas (charts, transitions, atlas gate)

vestigial; components and subcomponents address the same problem concretely with zero config. In the reference: 6 charts and 62 transitions in config, all keyed by chokepoints that already exist as spec claims.

Carried over: a security-relevance marker on the invariant (48 of 62 transitions were flagged security); the translates prose folds into the invariant sentence

Decided by owner, 2026-09-17.

## zone topology (residence, nesting, placement) and the region as a container

mechanism with zero subjects: 0 zones sections and 0 crossing claims anywhere in the reference, including assays. Component nesting is the topology. Trust levels and crossings survive as the security marker on the invariant.

Correction: 2026-09-17: the zero count was Coherence-only. Mnemion (121 source files) declares 6 zones, 7 lives-in claims, and 12 of its 16 boundary claims carry a crossing. Retirement reopened for the owner to reaffirm or revise.

Resolution: trust levels and crossings survive as the security marker on the invariant; zone topology (residence, nesting, placement) and the atlas retire

Decided by owner, 2026-09-17.

## guarantee links (relies on, addresses), promise-graph reliance ledger, declared handoffs

reliance is computed from the import graph, not declared

Decided by owner, 2026-09-17.

## taxonomy (roles, facets, obligations, assessments, taxonomy records)

see decomposition checklist; the intent moves to requirement declaration

Decided by owner, 2026-09-17.

## guarantee catalog machinery (ids, assessments, addresses links, activation)

the 36 sentences survive as the decomposition checklist; nothing else does

Decided by owner, 2026-09-17.

## imports claim form and the import edge as a concept

references subsume imports; imports were only cheap to derive

Decided by owner, 2026-09-17.

## exists claim form

overused; if nothing more concrete than existence can be pointed to, the claim is not needed. Mnemion had 46, Coherence 7, all inventory; the reference scaffold had already stopped seeding them.

Decided by owner, 2026-09-17.

## ## why section (free rationale prose per spec)

rationale attaches to the invariant it justifies as a because; a section of free prose invited restating mechanisms (the reference built why-lint to catch it). 7,666 words in Coherence, 4,392 in Mnemion.

Decided by owner, 2026-09-17.

## claim forms: responds, coverage, parity, conforms to, lives in, typechecks, passes test (bare), imports

one grammar: every spec bullet is an invariant with enforcement. Zero-use forms retire on count; passes-test survives only as the oracle half of an invariant; typechecks becomes a tree-wide invariant whose enforcement is the compiler; responds (3 uses in hoist) is live evidence against a running service and does not carry a form.

Decided by owner, 2026-09-17.

## work authority, granted-by, risk, handoff tokens, consequences

see work order evidence

Decided by owner, 2026-09-17.

## command classes: gate / ratchet / advisory

one thing goes red (a structural defect or an unacknowledged retirement) and it belongs to the invariant, not to a class of command; everything else is a reading

Decided by owner, 2026-09-17.

## ratchets (lint-sinks, conventions, mass baselines with growth failure)

each is an invariant never written as one (sink quoting and conventions are chokepoint claims) or a measurement (mass, a reading); a known residual becomes a totality oracle whose named set excludes a listed residual

Decided by owner, 2026-09-17.

## diagnostics: decompose, drift, redundancy, prose, why-lint, premise, signal, log, novelty

questions the project asked of itself while growing; not questions an adopter asks. Economy, calibrate, and mass survive.

Decided by owner, 2026-09-17.

## doctrine (versioned rulebook the regulator applies)

its rules are the ordered list of what a session owes at the end of its cycle, which regulate carries directly

Decided by owner, 2026-09-17.

## activity ledger (per-tool-use hook telemetry, 8,701 records)

its consumers were hook self-verification (one row per session suffices), experiment attribution (the session id on every record carries it), and a Scope view over the ledger itself

Carried over: one row per session recording that the hook reached the body with which bundle

Decided by owner, 2026-09-17.

## observed as a measured value (label, value, baseline, threshold; an unexplained crossing opened a conjecture)

a harness metric crossing its own threshold is the project's business; when it surprises an agent, the conjecture verb records it directly, with the number in the observation text. The name now belongs to observation: a record of runtime behavior from a named source, bound to a commit and a session (per-test coverage and failures, read by `query observed`).

Carried over: nothing; the conjecture verb covers the unexplained-move case

Decided by owner, 2026-09-23.

## typecheck (a config key) and the tree-wide typechecks invariant

the typechecks claim form retired into a tree-wide invariant whose enforcement is the compiler (above), and the config concept carried how to typecheck for it; that invariant was never built and nothing read the key, while every adopter's own test command already runs its compiler. A fresh adoption wrote the key and found it inert (df-b8084178).

Carried over: nothing; a project's compiler runs in its own test command

Decided by owner, 2026-10-05 (e-3bf51fcc, acknowledged ak-9e146686).
