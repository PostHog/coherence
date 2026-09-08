# Diagnostics and ratchets

Measures change, risk sites, architectural coupling and evidence gaps against the repository and its recorded baselines.

Each instrument names its measured population and inference limits. Ratchets grade their declared dimensions; advisory findings do not become claims of overall safety.

## invariants

- calibration denominators contain only validated surviving evidence
- significant behavioral growth acquires an anchor or patch-specific decision
- cached decisions expose structurally expired premises
- predicted context closure is calibrated against observed reads and outcomes
- calibration preserves the weakest host attribution of its trace
- reviewed risk sites survive relocation but never duplication
- pinned mass follows a value-conserving rename but never absorbs growth
- python sources feed the same instruments as typescript at their declared grade
- instrument arms read languages through shared grammar queries, never a parallel scanner

## refutations

- calibration denominators contain only validated surviving evidence: one valid defect sample, one invalid outcome label and one torn row produced two labeled samples and a 0.5 defect rate. The strict reader and direct statistics boundary now refuse malformed evidence, with legacy attribution preserved at its weaker grade.
- pinned mass follows a value-conserving rename but never absorbs growth: mutated `reconcileMass` in BOTH directions (2026-07-31) and full verify reds the claim by name each time. (a) `const hit = undefined` — the pre-fix behaviour where a rename never absorbs: `claims: 27 · 26 green · 1 red`, the H1-rename phase failing on strictEqual (a one-line spec rename read as growth again). (b) dropped the VALUE from the move-invariant address so any same-family vanished pin absorbs any new name — the laundering direction: same `27 · 26 green · 1 red`, the renamed-AND-grown phase failing on match (the growth rode in under the rename and the guard caught the missing NEW-dimension report). Restored, back to 27/27. As with the sinks reconciler, (b) is the direction that matters: a rename-forgiver that cannot fail is a growth ratchet that deleted itself.
- reviewed risk sites survive relocation but never duplication: mutated `reconcile` in BOTH directions and the guard reds each time. (a) `const from = undefined` — the pre-fix behaviour where the path is part of a site's identity: `claims: 23 · 22 green · 1 red`, the moved file reported as new risk. (b) absorb from every baselined address instead of only vanished ones, without consuming the pool — plain content-addressing: same `1 red`, the copied sink waved through. Restored, back to 23/23. The loosening direction is the one that matters: a fix for a false alarm that cannot fail (b) is a fix that deleted the ratchet.
- cached decisions expose structurally expired premises: gutted `auditPremiseLeases` to return `{entries: [], expired: [], checked: 0}` unconditionally — the SAME mutation that left the tree "✓ coherent" while the claim carried no oracle. With the guard wired it reds by name: `claims: 22 · 21 green · 1 red`, `✗ 1 coherence failure(s)`. Restored, back to 22/22. The other four claims now execute (137ms, 135ms and siblings in the holding-cost block) but have not yet been individually mutated — that is the next increment, not a claim made here.
- predicted context closure is calibrated against observed reads and outcomes: hardcoded `calibrationStats`' defect count to `defects: 0` (audit M1, re-run 2026-07-31) -> full verify RED by name, `claims: 23 · 22 green · 1 red`, the calibration guard failing on strictEqual. Restored, back to green.
- significant behavioral growth acquires an anchor or patch-specific decision: made `signalState` return `"attested"` for an unattested zero-anchor alarm (audit M2, re-run 2026-07-31) -> full verify RED by name, `claims: 23 · 22 green · 1 red`, the zero-anchor guard failing. Restored, back to green. The SAME mutation left `verify --fast` "✓ coherent" and `npm test` 589-pass when the guard's test was merely RETITLED (audit M4) — which is why CI now runs the full tier.

## works when

- boundary "calibration denominators contain only validated surviving evidence" at validateCalibrationSample via guard "calibration integrity — damaged rows and invalid direct inputs cannot enter a denominator"
- boundary "significant behavioral growth acquires an anchor or patch-specific decision" at signal via guard "only a zero-anchor alarm without attestation needs a decision"
- boundary "cached decisions expose structurally expired premises" at auditPremiseLeases via guard "audit — retracted decisions disappear and only broken strong leases fail a check"
- boundary "predicted context closure is calibrated against observed reads and outcomes" at calibrate via guard "calibration reports coverage, outside reads, and defect rates by prediction misses"
- boundary "calibration preserves the weakest host attribution of its trace" at calibrationPaths via guard "calibration keeps Codex parent-only writes aggregate and legacy rows unscoped"
- boundary "reviewed risk sites survive relocation but never duplication" at reconcile via guard "sinks — a moved file keeps its baselined identity and a genuinely new site still fails"
- boundary "pinned mass follows a value-conserving rename but never absorbs growth" at reconcileMass via guard "mass — a renamed component keeps its pin; growth and novelty are never absorbed"
- boundary "python sources feed the same instruments as typescript at their declared grade" at surfaceOfSource via guard "python surface — module defs, enum variants, and dict keys count; underscore and nested names do not"
- boundary "python sources feed the same instruments as typescript at their declared grade" at sitesOfPython via guard "python redundancy — two spellings of one domain in .py rank as a candidate; declared parity and idiom do not"
- boundary "python sources feed the same instruments as typescript at their declared grade" at lintSinks via guard "python sinks — an f-string into a SQL context is a site, a safe-pattern expression is not, and the ratchet reds the new site"
- boundary "instrument arms read languages through shared grammar queries, never a parallel scanner" at lintSinks via guard "ruby sinks — an interpolation into a SQL context is a site and the safe pattern exempts"

## why

**calibration denominators contain only validated surviving evidence.** A damaged sample
cannot silently become a cleaner-looking population. The validity of a statistical
denominator is part of the measurement, not an optional rendering detail; direct callers
and persisted history owe the same evidence grade. Legacy attribution remains weak
evidence rather than acquiring an exact owner during validation.

**significant behavioral growth acquires an anchor or patch-specific decision.** The cost
of adding an invariant is immediate while the cost of omitting it appears later, so the
current patch must carry either enforcement or an addressable reason that it needs none.

**cached decisions expose structurally expired premises.** A decision saves inference only
while the repository addresses supporting it remain live. Broken explicit referents must
be louder than readable but stale rationale.

**predicted context closure is calibrated against observed reads and outcomes.** Economy's
one-hop closure is a hypothesis about necessary reading, not cognition. Observed reads and
later defect labels give that model a path to correction instead of turning it into dogma.

**calibration preserves the weakest host attribution of its trace.** A Codex parent
session file can contain parent and descendant tool use because PostToolUse supplies no
child id. Calibration may still compare that aggregate against a patch, but it must name
the aggregate rather than relabeling those writes as one agent's work. Legacy rows remain
unscoped, shared-worktree fallback remains separate, and any unreadable row prevents a
new sample instead of disappearing from its denominator.

**reviewed risk sites survive relocation but never duplication.** A ratchet baseline is a
cached review, and a cached fact that expires on a rename rots the same way a decision's
premises do — a refactor then spends a reviewer's attention on sites nobody touched, and
attention spent on false alarms is how a real one gets waved through. Relocation changes
where a reviewed site lives; duplication changes how much unreviewed surface exists, and
only the second is news.

**pinned mass follows a value-conserving rename but never absorbs growth.** A mass
dimension's key embeds a name someone chose — a spec H1, a measure's config key — so a
rename re-addresses the pin, and a ratchet that reads its own re-addressing as "gained
parts nobody named" prints a lie beside the unchanged total that refutes it (measured:
one H1 edit, 35 lines relabeled, zero gained, gate red). The repair must stay
count-conserving: only a vanished pin with the same family, unit and exact value can
absorb a new name, or growth and novelty would ride in under renames.

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

**instrument arms read languages through shared grammar queries, never a parallel
scanner.** Phase 2b's contract, proven first on the injection ratchet: a language
contributes captures and signals — which node is an interpolation, how its SQL context
announces itself — and the mechanism owns classification, safe-pattern grading, site
identity, and the ratchet, once. The regex scanners this replaced matched line TEXT, so
they counted `${}` inside plain strings, comments, and test fixtures as sites, bounded
visibility at one brace of nesting, and one of them matched its own source. The query
scan re-pinned the baseline with every delta enumerated: nineteen real nested-brace
sites gained, one self-match artifact gone. A new language now gains the whole
instrument from a table row — ruby's took three lines and no scanner — which is the
two-tier boundary dissolving arm by arm.
