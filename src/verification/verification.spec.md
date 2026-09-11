# Verification

Evaluates declared claims against structural checks and named test evidence, refusing missing or incomplete proof.

Oracle discovery, execution and record lookup converge here. A passing process is not a passing claim unless the named oracle demonstrably ran.

## invariants

- enumeration promises require concrete domains and bound oracles

- catalog binding support requires a named oracle check at unchanged explicit inputs
- candidate guarantee vocabulary stays project-independent and never activates obligations
- explicit guarantee links expire with their premises and never prove satisfaction
- a claim goes green only on positive evidence its oracle ran
- a vanished oracle reds its claim, never green-by-absence
- fast verification rejects a statically vanished Vitest oracle without executing tests
- fast oracle absence requires a complete direct-declaration population
- a declared invariant unanchored by any boundary fails coverage
- a via-test oracle that iterates no live domain fails its claim
- a named oracle that no test runs cannot pass
- an empty derivation against a remembered surface refuses, never passes
- python sources feed the same instruments as typescript at their declared grade
- an undeclared root refuses the walk, never wanders

## refutations

- enumeration promises require concrete domains and bound oracles: independent Python review executed a passing decoy oracle after `from registry import DOMAIN, OTHER as DOMAIN`; statement-level import permission had hidden its second binding. Import admission now checks every local target within the permitted statement, refusing duplicate bare or aliased targets before borrowing source identity.

- enumeration promises require concrete domains and bound oracles: the first Python helper accepted `match ("decoy",): case DOMAIN:` before a loop over imported DOMAIN because captures are bindings without assignment nodes. Root's independent probe returned null admission; conservative pattern binding targets now refuse that probe along with assignment, parameter, walrus, with and except shadows. Executed Python collection/alias/package/unittest controls retain the positive direction; a Python assignment's graph kind alone still supplies no population evidence.

- enumeration promises require concrete domains and bound oracles: independent implementation review found accepted catch/named-function/destructured shadows, an export alias pointing at another collection, a sole __proto__ setter, and object populations passed to empty Array.from or an authored forEach method. Regression cases now require direct export identity and shape-compatible traversal and refuse those shadows. These are source-binding controls, not a claim about arbitrary JavaScript mutation or control flow.

- enumeration promises require concrete domains and bound oracles: the campaign reproduced scalar/interface declarations, ambiguous global labels, unrelated live-domain iteration and no-oracle claims receiving unsupported passes. The prior focused fixtures themselves pinned graph-only const symbols without source or oracles as green. Concrete-domain admission now refuses those cases through runVerify; bound alias/array/object/enum positive controls execute real node:test oracles, and fast checks remain skipped. This pins declaration shape and direct binding, not semantic exhaustion.
- catalog binding support requires a named oracle check at unchanged explicit inputs: removed the flow-endpoint file pin check; the flow-endpoint guard failed because an owned symbol in an unpinned second file produced no missing-pin issue. Restored the check and the guard passed. This proves endpoint input inclusion, not authored direction or semantic entailment.

- catalog binding support requires a named oracle check at unchanged explicit inputs: removed the pre/post input-digest equality in bindRunEvidence. The guard then observed a populated bindingInputs record after a spec changed during the execution interval, where no support was allowed. Restored the comparison. This controls input freshness, not semantic entailment or immutable receipt integrity.
- candidate guarantee vocabulary stays project-independent and never activates obligations: the initial catalog branch ran after loadConfig. The public CLI guard supplied damaged configuration and a torn journal and observed exit 2 before reference lookup. Dispatching catalog lookup before configuration makes those project inputs irrelevant; the same guard then passes. Population/detail guards separately retain all 36 definitions, their limits, non-activation metadata and pinned evidence grades. These guards test the catalog product, not PostHog satisfaction or cross-project portability.
- explicit guarantee links expire with their premises and never prove satisfaction: disabled the subject-staleness check in resolveGuaranteeLinks (2026-09-08). The named guard failed with actual current versus expected stale, exposing the incorrectly retained mapping. Restored the check; the focused suite passes. This control tests link expiration, not semantic satisfaction.
- fast verification rejects a statically vanished Vitest oracle without executing tests: changed `resolveStaticOracle`'s complete zero-match branch from `absent` to `unknown` (2026-08-20), laundering the motivating Mnemion rename into an ordinary fast-tier skip — the focused boundary guard failed and captured the dangerous verdict: `claims: 1 · 0 green · 0 red · 1 skipped`, followed by `✓ coherent`. Restored; the same fixture now reds `VANISHED ORACLE (static)` without Vitest installed or invoked.
- fast verification rejects a statically vanished Vitest oracle without executing tests: 0.36.2 made incompleteness project-wide, so Mnemion's finite data-driven titles made an unrelated renamed clipboard oracle UNKNOWN forever. Reproduced against current main: renaming the literal clipboard test left fast verify green. The scanner now retains concrete runner names and owner paths from Git `HEAD`; losing a name from a deleted or still-complete former owner reds before unrelated current uncertainty is consulted, while a former owner that itself became dynamic remains UNKNOWN. No prefix guess or partial JavaScript evaluator is allowed to manufacture global completeness.
- fast oracle absence requires a complete direct-declaration population: before release, conventional files whose tests came only from a bare side-effect import, top-level `import()`, or `require()` each produced `fullNames=[]`, `incomplete=[]`, and `absent`, so fast verification could call a live runtime-owned oracle vanished. Release audit then found the same false absence behind a transitive local Vitest alias and a live `build/live.test.ts`, while a conventional file symlink was followed outside the declared traversal boundary. The scanner now resolves exact alias chains, marks registration-time module loads incomplete, mirrors Vitest v4's `node_modules`/`.git` default exclusions, and refuses every symlink/custom collection surface into UNKNOWN; loads inside test callbacks remain ordinary subject execution.
- a claim goes green only on positive evidence its oracle ran: deleted the testMatch evidence rule from the serial arm — the audit-M3 mutation that previously left the tree 23/23 "✓ coherent" with the anti-vacuity mechanism gone -> now `claims: 26 · 25 green · 1 red`, this claim red by name. Restored, 26/26.
- a vanished oracle reds its claim, never green-by-absence: made zero batch matches return `ok: true` -> `claims: 26 · 25 green · 1 red`, this claim red by name. Restored, 26/26.
- a declared invariant unanchored by any boundary fails coverage: wrapped the gap-collection loop in `if (false)` -> `claims: 26 · 25 green · 1 red`, this claim red by name. Restored, 26/26.
- a via-test oracle that iterates no live domain fails its claim: flipped the self-literal domain branch to report `live` -> `claims: 26 · 25 green · 1 red`, this claim red by name. Restored, 26/26.
- a named oracle that no test runs cannot pass: made the no-owning-file branch exit 0 -> `claims: 26 · 25 green · 1 red`, this claim red by name (the guard test, run by the mutated runner itself, observed the quiet pass). Restored, 26/26.
- an empty derivation against a remembered surface refuses, never passes: mutated BOTH ends (2026-07-31). (a) gutted `buildGraph` to return an empty graph — the original defect, which before the floor printed `claims: 0 · 0 green · 0 red · 0 skipped` and `✓ coherent`, exit 0: now full verify refuses before grading (`✗ [floor] the derived graph is EMPTY of claims — 0 component(s), 0 claims — but the record remembers 27 claim(s)`), exit 1, on the scoped path too, and the record is left un-clobbered so the refusal repeats. (b) made `vacuityRefusal` return null unconditionally — the floor itself deleted: full verify red BY NAME, `claims: 28 · 27 green · 1 red`, this claim failing through its guard. Restored, 28/28. (b) is the direction that matters: a floor that cannot fail is the vacuity it exists to catch.

## works when

- boundary "enumeration promises require concrete domains and bound oracles" at totalityGateFailure via guard "enumeration admission — concrete domains and bound oracles reject the measured false positives"
- boundary "enumeration promises require concrete domains and bound oracles" at totalityGateFailure via guard "enumeration admission — unique source binding preserves aliases and finite domain positive controls"
- boundary "enumeration promises require concrete domains and bound oracles" at totalityGateFailure via guard "enumeration admission — no oracle cannot pass while explicit disabling retains its documented escape"
- boundary "enumeration promises require concrete domains and bound oracles" at pythonTotalityFailure via guard "Python enumeration admission — literal collections and direct aliases retain executed positive controls"
- boundary "enumeration promises require concrete domains and bound oracles" at pythonTotalityFailure via guard "Python enumeration admission — genuine graph derivation and package-relative aliases reach public verification"
- boundary "enumeration promises require concrete domains and bound oracles" at pythonTotalityFailure via guard "Python enumeration admission — scalar, empty, dynamic and rebound assignments cannot borrow collection evidence"
- boundary "enumeration promises require concrete domains and bound oracles" at pythonTotalityFailure via guard "Python enumeration admission — wrong modules, module-package collisions and search-root shadows refuse"
- boundary "enumeration promises require concrete domains and bound oracles" at pythonTotalityFailure via guard "Python enumeration admission — shadows and partial traversal never acquire direct-domain identity"

- boundary "catalog binding support requires a named oracle check at unchanged explicit inputs" at bindRunEvidence via guard "catalog bindings — only unchanged executed inputs earn support; edits and historical reports cannot renew it"
- boundary "catalog binding support requires a named oracle check at unchanged explicit inputs" at projectBindings via guard "catalog bindings — exact scoped declarations retain failures and never borrow example support"
- boundary "catalog binding support requires a named oracle check at unchanged explicit inputs" at projectBindings via guard "catalog bindings — flow endpoints require owned pinned symbols and changed paths cannot borrow support"
- boundary "candidate guarantee vocabulary stays project-independent and never activates obligations" at runGuaranteeCatalog via guard "guarantee catalog — public lookup never loads project configuration or reads its ledgers"
- boundary "candidate guarantee vocabulary stays project-independent and never activates obligations" at runGuaranteeCatalog via guard "guarantee catalog — list and detail preserve the canonical population, qualifications and refusal semantics"
- boundary "explicit guarantee links expire with their premises and never prove satisfaction" at resolveGuaranteeLinks via guard "guarantee links — expired premises never become current and passing evidence never proves satisfaction"
- boundary "a claim goes green only on positive evidence its oracle ran" at execNamedTest via guard "testMatch — a runner exiting 0 with no matching output FAILS (the renamed-test trap)"
- boundary "a vanished oracle reds its claim, never green-by-absence" at resolveFromBatch via guard "match — ZERO matching tests is its OWN state: the vanished oracle, named as such"
- boundary "fast verification rejects a statically vanished Vitest oracle without executing tests" at resolveStaticOracle via guard "static oracle floor — a renamed tracked literal owner reds despite unrelated dynamic titles"
- boundary "fast oracle absence requires a complete direct-declaration population" at resolveStaticOracle via guard "static names — a bare side-effect import may register tests and keeps absence UNKNOWN"
- boundary "a declared invariant unanchored by any boundary fails coverage" at runVerify via guard "RATCHET — a declared invariant with no anchoring boundary fails coverage"
- boundary "a via-test oracle that iterates no live domain fails its claim" at analyzeOracle via guard "META-ORACLE — a `via test` boundary whose oracle loops a LITERAL fails"
- boundary "a named oracle that no test runs cannot pass" at runNamedTest via guard "runner contract — a name that exists nowhere exits nonzero (the vanished oracle cannot pass)"
- boundary "an empty derivation against a remembered surface refuses, never passes" at vacuityRefusal via guard "FLOOR — an empty derivation against a remembered surface REFUSES, never reports coherent"
- boundary "python sources feed the same instruments as typescript at their declared grade" at analyzeParityOracle via guard "python parity — a .py oracle that iterates the live domain passes; a literal list fails; a vanished oracle cannot pass"
- boundary "python sources feed the same instruments as typescript at their declared grade" at resolveFromBatch via guard "pytest batch — nodeid names resolve per claim, zero matches is the vanished oracle, and a torn report falls back loudly"
- boundary "an undeclared root refuses the walk, never wanders" at requireDeclaredRoot via guard "declared root — a configless directory refuses the walk and an empty config declares it"

## relies on

- {"claim":"g-e8d24eb9de00abbec60bc1f3876c94517c970228bad3d4cf4f3b63d51bec89cf","provider":"src/evidence","because":"runVerify publishes scoped and fast results through recordVerify. A skipped oracle must retain its prior dated verdict rather than erase the evidence used by subsequent readers."}

## why

**enumeration promises require concrete domains and bound oracles.** A parser kind is
not a population: an interface has no runtime members and a const may hold a scalar.
The bounded TS/JS grade requires one globally unambiguous source symbol backed by a
nonempty top-level const array/object literal or runtime enum. Dynamic constructors,
spreads, computed keys, erased declarations and unsupported languages refuse explicitly.
A named top-level test/it/describe oracle must directly iterate that declaration through
a same-file binding or a direct named import using an explicit relative source-file path
to a directly exported declaration,
including import aliases. Object/enum domains require for-in or Object.keys/values/entries;
Array.from and array methods cannot borrow traversal semantics for an authored object. A wrong module,
shadowed name, filtered subset or absent oracle cannot borrow another collection's
liveness. Both verbs owe this check independently of the older oracleDomain setting;
totalityEnumeration: false remains the explicit opt-out. Fast admission is still a skip,
and only named execution evidence can make the claim pass. This is a source-shape and
identity grade: it does not prove assertion correctness, control-flow reachability,
runtime immutability, exhaustive iteration or completeness of the author's domain.
Extensionless/emitted-path resolution, escaped specifiers/keys, re-export chasing, arbitrary type/member resolution and compiler evaluation remain outside that grade.

The Python grammar supplies a separate bounded grade without importing or executing
project code during admission. One module-level assignment must hold a nonempty literal
tuple, list, set or dictionary; members are literals, and keys/set elements must have a
statically hashable literal shape. Direct rebinding, deletion, mutation methods and
scope-wide shadows refuse. A unique bare-named test function or direct class test method
must contain a direct unfiltered for loop over that binding (or dictionary keys/values/items).
Same-file bindings and direct `from module import DOMAIN as alias` imports are supported
at the existing root-relative/explicit-relative direct-module grade, with actual source
module/package collisions, conflicting package prefixes and test-directory alternatives
refusing identity even when the graph excluded them. Duplicate method names across
classes refuse rather than guessing a qualified target. Python Enum classes, dynamic
members/constructors, comprehensions, splats, decorators/parameterization, async/nested
oracles, wrapper calls, early exits, re-exports and runtime search-path changes are outside
this grade. Pattern captures participate in conservative shadow checks. This does not
prove runtime reachability, absence of indirect mutation, assertion adequacy or completeness
of the authored population; named execution remains separate evidence.

**catalog binding support requires a named oracle check at unchanged explicit inputs.**
A catalog's good example does not verify another adoption, and a prior test pass
cannot speak for edited applicability or source. The existing claim record therefore
retains the binding input identity observed on both sides of an executable check.
Structural failure, imported history and changed inputs cannot mint that support.
Optional authored flow endpoints must resolve to owned symbols and belong to the
explicit pinned input set. Their role titles and direction remain caller-assessed;
the local boundary remains the only promise string. Changing that mapping changes
the binding identity, so an old observation cannot endorse a new visual relationship.
This is a bounded freshness relation, not immutable receipt integrity or semantic
proof that a caller chose the right guarantee and complete dependency population.

**candidate guarantee vocabulary stays project-independent and never activates obligations.**
A reusable reference is not a project assessment. Loading a project's configuration
or damaged ledger to look up a definition creates a false dependency, while treating
candidate presence as an obligation would create promises nobody adopted. The lookup
therefore has no project input and preserves its candidate and evidence qualifications
in both list and detail. Existing taxonomy history, spec bindings and oracle verdicts
retain their independent meanings; candidate IDs cannot silently replace them.

**explicit guarantee links expire with their premises and never prove satisfaction.**
A taxonomy suggestion names an obligation, not the claim that enforces it. Spec-owned
links preserve that caller's assessment without letting a passing oracle certify the
mapping itself. Claim edits, missing providers, revised assessments and changed subject
content invalidate or expire the reference. Unlinked obligations stay visible. The v0
consumer grade requires direct import adjacency and makes no claim of proving consumption;
recorded oracle evidence remains distinct from future immutable verification receipts.

**a claim goes green only on positive evidence its oracle ran.** The verifier's whole
authority rests on this one property, and until now no claim cited it: an audit deleted
the rule and the tree stayed "✓ coherent" while the unit test failed unseen. An exit
code is the runner's statement about itself, not about the named test — a filter that
matched nothing exits clean on every runner class this repo has measured — so green
must require output that names the run, the one reading absence cannot produce.

**a vanished oracle reds its claim, never green-by-absence.** A renamed or deleted test
leaves a claim citing a name nothing owns, and that claim then guards nothing while
wearing green. Absence has to be its own observable verdict, distinct from ran-and-failed,
because the two demand different repairs: a red test needs the code fixed, a vanished
oracle needs the contract re-tied to something that exists.

**fast oracle absence requires a complete direct-declaration population.** Absence is a
stronger statement than failure: it says the registry owns no matching name. The static
floor may say that only when every registration mechanism it recognizes was enumerable;
dynamic titles, fixture DSLs, registration-time module loads, custom includes, and damaged
source must poison absence into UNKNOWN while still allowing positive direct matches.
Otherwise the cheap tier would turn its own inability to see a live oracle into evidence
that the oracle vanished.

**a declared invariant unanchored by any boundary fails coverage.** A spec may not
assert a property that nothing enforces: that is the ratchet the whole harness turns on,
and if it silently loosened, specs would drift back into aspiration prose. The gap has to
cost a red at the run that opened it, while the person who opened it still holds the
context to close it.

**a via-test oracle that iterates no live domain fails its claim.** A totality label on a
sampling test is worse than no label: it retires the reader's suspicion without retiring
the risk. Deriving the checked set from the live registry the chokepoint actually serves
is what makes "covers every case" a fact about the system rather than about the fixture
list the author remembered.

**a named oracle that no test runs cannot pass.** The serial runner is the component the
executable tier leans its trust on, and it was outside the evidence perimeter — unclaimed,
untested, and (measured) willing to exit clean when the cited title survived only as a
string in a file. The runner itself must refuse a name it cannot show ran, because every
green above it inherits that refusal.

**an empty derivation against a remembered surface refuses, never passes.** Every verdict
in this file rests on the graph deriving non-empty, and nothing checked that premise:
gutting `buildGraph` left the gate printing "claims: 0" and "✓ coherent", exit 0 —
deeper than a vanished oracle, because it empties every check at once while announcing
they all passed. The record remembers how many claims the last run graded, so a run that
suddenly sees zero must refuse rather than report success over nothing; the only
legitimate zero (a project adopting from nothing) is exactly the one with no memory, and
it gets the adoption ladder instead. The floor deliberately stops at zero: a partial
collapse where every component keeps a claim is observationally identical to deliberate
pruning, and deletion has to stay free or people stop deleting. What the complement
underneath it actually reaches is narrower than it first appears — a component stripped of
its claims is still a node someone can red, while a component the walk never discovered
leaves nothing behind to notice, so an N→1 slide reads as N ordinary prunings. Pinning the
population as a mass dimension is the honest answer there, because the question it settles
is not whether anything survived but whether as much survived as last time.

**python sources feed the same instruments as typescript at their declared grade.**
The adapter seam always promised language-agnosticism, but three analyzers and two
scanners parsed TypeScript directly, so a python project's surface grew invisibly — the
zero-anchor alarm never fired, parity claims skipped `.py` oracles, duplicated domains
went unranked, batch oracles knew one report format, and f-string interpolations were not
sites. Each instrument now reads python at a DECLARED grade: most through the shared
grammar queries of phase 2b (surface, sites, sinks), the oracle arms at the pinned
indent-block grade their guards froze — in-harness, no subprocess, and since the arms
ported, no compiler dependency at all. The grade is declared, not hidden —
precision is preferred over recall everywhere, because an advisory that cries wolf
retires the reader's attention without retiring risk, and with no compiler behind `.py`
a false positive can never be rescued downstream. What the regex grade deliberately does
not count is journaled beside each instrument, so the next reader inherits the boundary
of the instrument instead of rediscovering it.

**an undeclared root refuses the walk, never wanders.** A configless run walks whatever
directory the shell happened to be in and grades that population with full confidence —
the incident run was `npx coherence verify` from a home directory, which is not exotic;
it is the first thing a curious adopter types. The config file's PRESENCE is the
declaration, so `{}` is a complete first rung of the adoption ladder, and the refusal
prints exactly that one-line bootstrap. Journal, hook, and reference commands never
walk, so they stay available in an undeclared directory — the field does not require a
config to remember decisions.

**fast verification rejects a statically vanished Vitest oracle without executing
tests.** Name ownership is cheaper than test outcome: a literal Vitest declaration either
still supplies a runner-style full name or it does not. The edit loop should answer that
structural question without buying remote credentials or a suite boot, while refusing to
turn dynamic or damaged source into false certainty. Static presence therefore remains a
skip. A complete current population can prove absence; independently, a concrete Git
`HEAD` owner disappearing from a deleted or still-complete former path proves an ownership
loss even when unrelated current source is incomplete. If that same path becomes dynamic
or damaged, it stays explicitly unknown; everything else does too. The
executable tier alone can supply pass/fail evidence. This is a direct-declaration grade,
not an evaluator for arbitrary runtime registration; projects beyond it disable
`staticOracleExistence` or resolve a fresh report.
