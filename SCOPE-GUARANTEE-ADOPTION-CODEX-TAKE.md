# Scope guarantee adoption audit — Codex's take

Baseline: implementation commit `1979969`, audited 2026-09-08. This is a bounded adoption report, not another live guarantee ledger. Specs remain canonical.

**Historical pass, withdrawn 2026-09-09:** the 112 exploratory reliance additions were
archived, measured and removed; the three baseline relies, three addresses and 83 claims
remain. The figures below describe the historical pass, not current adoption. See the
[extraction findings and assay readiness](docs/assays/guarantee-adoption-2026-09-09/README.md).
The original report bytes are retained with the archived patch. The implementation plan
below is superseded by the rejection-first guarantee product plan.

## Result

The graph has **56 directed connections**. This pass raises explicit consumer declarations from 3 to **115**, covering **30 connections**. It does not claim every imported function on a mapped connection is guaranteed. Each spec bullet names the actual consumed property and path; an edge can carry several independent claims. The other **26 connections** are individually accounted for below: seven type-only, ten test/evidence, and 9 contract/representation gaps.

There are still **83 existing boundary claims**, not 115 newly verified guarantees. This pass authors consumer relationships to existing contracts; it adds no oracle or obligation-satisfaction claim. The three existing taxonomy-to-claim mappings remain narrow caller assessments. The 57 current taxonomy suggestion rows include historical/stale assessments: they are not 57 proven obligations, and adding reliance declarations does not satisfy them.

## Supported connections

A mapped connection means at least one specifically identified property is consumed, not that the provider is safe or every call is covered. Full rationale and exact claim IDs live in each consumer's `## relies on` section and `coherence guarantees --json`.

| Consumer → provider | Declared properties | Existing enforcement references |
| --- | ---: | --- |
| `src` → `src/coordination` | 16 | `selectRegulation`, `observeRegulation`, `readWork`, `validateWorkGraph`, `detectWorkScopeOverlaps`, `createWork`, `traceConsequences`, `relationProblem`, `readConsequences`, `observeOrientation`, `verifyOrientation` |
| `src` → `src/derivation` | 2 | `buildGraph`, `resolveLanguageAdapter` |
| `src` → `src/diagnostics` | 11 | `validateCalibrationSample`, `signal`, `auditPremiseLeases`, `calibrate`, `calibrationPaths`, `reconcile`, `reconcileMass`, `surfaceOfSource`, `sitesOfPython`, `lintSinks` |
| `src` → `src/evidence` | 7 | `closeExperiment`, `recordDefect`, `readDefects`, `tailJournal`, `recordVerify` |
| `src` → `src/lifecycle` | 10 | `runHook`, `assignedWorkInstructions`, `inspectLifecycleHook`, `setLifecycleHookForHost`, `currentObservation`, `composeHookText` |
| `src` → `src/readings` | 6 | `buildScopeModel`, `renderContextProjection`, `renderScope` |
| `src` → `src/taxonomy` | 8 | `classifyTaxonomy`, `taxonomyView`, `TAXONOMY`, `recordTaxonomy`, `readTaxonomyRecords`, `validateTaxonomyRecord`, `captureTaxonomy` |
| `src` → `src/verification` | 11 | `resolveGuaranteeLinks`, `execNamedTest`, `resolveFromBatch`, `resolveStaticOracle`, `runVerify`, `analyzeOracle`, `runNamedTest`, `vacuityRefusal`, `analyzeParityOracle` |
| `src/coordination` → `src/diagnostics` | 1 | `signal` |
| `src/coordination` → `src/evidence` | 5 | `readTrustedJournal`, `analyzeDecisionPositions`, `readDefects`, `recordVerify` |
| `src/coordination` → `src/lifecycle` | 1 | `inspectLifecycleHook` |
| `src/derivation` → `src/adapters` | 3 | `makeTreeSitterAdapter`, `withTree`, `cloudflareBindings` |
| `src/derivation` → `src/verification` | 1 | `requireDeclaredRoot` |
| `src/diagnostics` → `src/adapters` | 1 | `withTree` |
| `src/diagnostics` → `src/derivation` | 2 | `buildGraph`, `resolveLanguageAdapter` |
| `src/diagnostics` → `src/evidence` | 1 | `recordVerify` |
| `src/diagnostics` → `src/verification` | 1 | `requireDeclaredRoot` |
| `src/evidence` → `src/lifecycle` | 1 | `isActivityRow` |
| `src/lifecycle` → `src/diagnostics` | 3 | `signal`, `validateCalibrationSample`, `calibrationPaths` |
| `src/lifecycle` → `src/evidence` | 2 | `readTrustedJournal` |
| `src/readings` → `src/derivation` | 2 | `buildGraph`, `resolveLanguageAdapter` |
| `src/readings` → `src/evidence` | 2 | `recordVerify` |
| `src/readings` → `src/verification` | 1 | `resolveGuaranteeLinks` |
| `src/taxonomy` → `src/derivation` | 2 | `buildGraph`, `resolveLanguageAdapter` |
| `src/taxonomy` → `src/verification` | 1 | `requireDeclaredRoot` |
| `src/verification` → `src/adapters` | 1 | `withTree` |
| `src/verification` → `src/derivation` | 2 | `buildGraph`, `resolveLanguageAdapter` |
| `src/verification` → `src/evidence` | 2 | `recordVerify` |
| `src/verification` → `src/readings` | 4 | `buildScopeModel` |
| `src/verification` → `src/taxonomy` | 5 | `classifyTaxonomy`, `taxonomyView`, `readTaxonomyRecords`, `validateTaxonomyRecord` |

## Why the rest cannot honestly receive a current guarantee label

| Connection | Exact limit and next decision |
| --- | --- |
| `src/adapters` → `src` | TYPE-ONLY: every canonical file edge imports types from src/types.ts. There is no runtime consumer contract to attach to the CLI singleton-flag guarantee. Derive a distinct type-reference edge or exclude it from runtime gravity. |
| `src/coordination` → `src` | CONTRACT GAP: regulate.ts consumes commandFor from commands.ts, not CLI singleton-flag parsing. Need a command-registry lookup/metadata contract; inspect the existing commands registry/dispatch parity tests before anchoring it. |
| `src/coordination` → `src/verification` | ERROR-SHAPE DEPENDENCY: regulate.ts imports only Unrunnable, an error carrier. No provider boundary promises that carrier shape; a named-oracle or root-walk guarantee would be unrelated. Decide whether this belongs in behavioral Scope at all. |
| `src/derivation` → `src` | TYPE-ONLY: every canonical file edge imports types from src/types.ts. There is no runtime consumer contract to attach to the CLI singleton-flag guarantee. Derive a distinct type-reference edge or exclude it from runtime gravity. |
| `src/derivation` → `src/diagnostics` | INSPECTION DATA: language-packs.ts imports SURFACE_LANGUAGES, SITE_LANGUAGES and SINK_LANGUAGES for aggregation/purity inspection, not execution of the provider analyzers. The existing pack-purity contract belongs to derivation itself. Do not misattribute it to a diagnostics provider. |
| `src/diagnostics` → `src` | CONTRACT GAP: diagnostics consumes loadConfig plus COMMANDS and types. The sole core boundary protects CLI singleton flags, not config refusal or registry metadata. Config refusal has ordinary tests and an atlas description but needs a correctly owned boundary before it can label this edge. |
| `src/diagnostics` → `src/lifecycle` | CONTRACT GAP: calibration.ts consumes readTraceDetailed. Lifecycle has an activity-row guard, but read traces are a different format and isActivityRow does not validate them. Pin trace damage/attribution behavior at the reader; do not borrow the activity guarantee. |
| `src/evidence` → `src` | TYPE-ONLY: every canonical file edge imports types from src/types.ts. There is no runtime consumer contract to attach to the CLI singleton-flag guarantee. Derive a distinct type-reference edge or exclude it from runtime gravity. |
| `src/evidence` → `src/readings` | PRESENTATION HELPER: journal.ts consumes sty, clip, padE, wrapText and humanAge from panel.ts. Scope/context projection boundaries do not govern these helpers. Decide whether to hide formatting dependencies or add a narrowly tested terminal encoding/width contract. |
| `src/evidence` → `src/verification` | CONTRACT GAP: status.ts consumes claimKey and readJsonOrRefuse. Neither is a declared boundary here. Existing grammar identity and malformed-vs-absent JSON tests are candidates; root refusal and vanished-oracle guarantees do not describe this use. |
| `src/lifecycle` → `src` | TYPE-ONLY: every canonical file edge imports types from src/types.ts. There is no runtime consumer contract to attach to the CLI singleton-flag guarantee. Derive a distinct type-reference edge or exclude it from runtime gravity. |
| `src/readings` → `src` | TYPE-ONLY: every canonical file edge imports types from src/types.ts. There is no runtime consumer contract to attach to the CLI singleton-flag guarantee. Derive a distinct type-reference edge or exclude it from runtime gravity. |
| `src/readings` → `src/diagnostics` | CONTRACT GAP: context/index/panel consume Git change/churn, structural diffs and arrow/spark trend helpers. Diagnostics guarantees currently concern different instruments. Define the graph-at-ref/delta grade and trend policy separately; a sinks or calibration claim would be false decoration. |
| `src/taxonomy` → `src` | TYPE-ONLY: every canonical file edge imports types from src/types.ts. There is no runtime consumer contract to attach to the CLI singleton-flag guarantee. Derive a distinct type-reference edge or exclude it from runtime gravity. |
| `src/verification` → `src` | TYPE-ONLY: every canonical file edge imports types from src/types.ts. There is no runtime consumer contract to attach to the CLI singleton-flag guarantee. Derive a distinct type-reference edge or exclude it from runtime gravity. |
| `src/verification` → `src/diagnostics` | ADVISORY DEPENDENCY: verify.ts consumes raiseFindings and Git churn helpers. No diagnostics boundary names finding dedupe/attribution or history rebasing. Pin those exact properties if they warrant a behavioral edge; do not borrow unrelated ratchet guarantees. |
| `test` → `src` | EVIDENCE EDGE: test code exercises and deliberately falsifies this component; it is not a production consumer promise. Retain as evidence/coverage navigation, not a guaranteed reliance. |
| `test` → `src/adapters` | EVIDENCE EDGE: test code exercises and deliberately falsifies this component; it is not a production consumer promise. Retain as evidence/coverage navigation, not a guaranteed reliance. |
| `test` → `src/coordination` | EVIDENCE EDGE: test code exercises and deliberately falsifies this component; it is not a production consumer promise. Retain as evidence/coverage navigation, not a guaranteed reliance. |
| `test` → `src/derivation` | EVIDENCE EDGE: test code exercises and deliberately falsifies this component; it is not a production consumer promise. Retain as evidence/coverage navigation, not a guaranteed reliance. |
| `test` → `src/diagnostics` | EVIDENCE EDGE: test code exercises and deliberately falsifies this component; it is not a production consumer promise. Retain as evidence/coverage navigation, not a guaranteed reliance. |
| `test` → `src/evidence` | EVIDENCE EDGE: test code exercises and deliberately falsifies this component; it is not a production consumer promise. Retain as evidence/coverage navigation, not a guaranteed reliance. |
| `test` → `src/lifecycle` | EVIDENCE EDGE: test code exercises and deliberately falsifies this component; it is not a production consumer promise. Retain as evidence/coverage navigation, not a guaranteed reliance. |
| `test` → `src/readings` | EVIDENCE EDGE: test code exercises and deliberately falsifies this component; it is not a production consumer promise. Retain as evidence/coverage navigation, not a guaranteed reliance. |
| `test` → `src/taxonomy` | EVIDENCE EDGE: test code exercises and deliberately falsifies this component; it is not a production consumer promise. Retain as evidence/coverage navigation, not a guaranteed reliance. |
| `test` → `src/verification` | EVIDENCE EDGE: test code exercises and deliberately falsifies this component; it is not a production consumer promise. Retain as evidence/coverage navigation, not a guaranteed reliance. |

## A connection the graph does not show

`src/lifecycle/hooks.ts` dynamically imports `../coordination/work.ts` in `assignedWorkInstructions` and calls `readWork`. There is **no lifecycle → coordination edge** in the canonical graph, so the v0 direct-import resolver refuses a reliance declaration there even though the call exists. The provider already has the predecessor/attribution work contract. This is an instrument gap, not missing application behavior. Dynamic diagnostics imports in the same file are also absent as file edges, but a static due.ts import already creates that component pair; the authored diagnostics declarations explicitly name their lazy call paths. Project-adapter module imports are configured runtime paths and need a declared unknown/configured grade, not invented static targets.

## Plan to reach a genuinely complete view

1. **Fix the dependency population first.** Preserve static value imports, type-only references and literal dynamic imports as distinct kinds. Include the observed lifecycle → coordination edge; keep dynamic/configured targets explicitly graded. Make runtime gravity ignore type-only and evidence edges. Acceptance: fixtures and the real repository demonstrate both the seven excluded type-only pairs and the recovered lazy work dependency without losing existing static consumers.
2. **Decide which helper edges belong in behavioral Scope.** Error carriers, terminal formatting and inspection-only query tables should not demand fake safety promises. Keep them available as structural detail, with their actual relationship kind. This is a presentation/ontology choice, not an oracle gap.
3. **Promote existing tests only where they cover the actual missing boundary.** Audit commands registry/lookup and loadConfig, readJsonOrRefuse and claimKey, readTraceDetailed, history/delta and advisory helpers. Give each adopted property a provider-owned invariant, named oracle and observed negative control. Current unit tests or atlas prose alone are not declared guarantees. Do not bundle unrelated helpers into one generic promise.
4. **Then finish the remaining real consumer declarations.** Include lifecycle → coordination once representable. Check each call path against the new provider contract. Re-run complete population accounting and require every remaining unlabeled runtime edge to have an intentional reason.
5. **Treat taxonomy completion separately.** Reassess relocated/stale subjects, review each activated obligation and map only the part an oracle actually addresses. The current schema can record a narrow mapping, not prove semantic adequacy. Verification receipts and explicit satisfaction assessments remain separate work.

## Reproduction and limits

Validation of this pass:

- `guarantees --check`: 118 total declarations (115 relies + three addresses), all current, zero link issues; still 83 canonical boundary claims.
- Audit population assertion: each of the 56 canonical directed connections appears exactly once in the two tables above.
- Typecheck and 11 focused guarantee/Scope tests passed. Deterministic docs, atlas, mass and why-lint checks passed. WebKit exercised the populated connection inspectors.
- The actual live opening view has four connections: three now have named guarantees; adapters → core still says no guarantee linked because it is exclusively a type import. This pass intentionally does not disguise that graph-modeling defect.
- Full verification returned 98/101. The fresh-clone, WASM-heap and concurrent-status guards failed with anomalous reported durations (approximately 17 minutes, 27 minutes and 26 seconds). Each passed on an individual rerun; the WASM rerun still reported roughly 15 minutes. Host interruption/contention is a hypothesis, not a demonstrated cause. Conjecture `d-9ee0c5d6` remains open, and the last full report remains failed rather than being manually rewritten. Re-run the full gate in a stable execution window before committing this adoption pass.

Existing test candidates for the next contract pass (not automatically promoted):

| Proposed boundary | Existing evidence to review | Remaining work |
| --- | --- | --- |
| `commandFor` / command registry | `test/commands.test.ts`: registry/dispatch totality; flag guards survive aliases | Separate lookup metadata from dispatch completeness; anchor only what each guard observes. |
| `loadConfig` | `test/floor.test.ts`: unreadable configuration refuses instead of degrading to defaults | Root-owned invariant, explicit scope of missing versus damaged configuration, negative control. |
| `readJsonOrRefuse` | `test/floor.test.ts`: absent is null; unreadable throws Unrunnable naming the file | Verification-owned storage boundary; do not imply schema validation of parseable JSON. |
| `claimKey` | `test/status.test.ts`: crossing annotations preserve claim history | Pin verdict lookup identity separately from stricter guarantee-reference identity, which intentionally includes the crossing. |
| `readTraceDetailed` | `test/activity.test.ts`: trace scope, bundle provenance, legacy rows and damage stay distinct | Inspect the actual reader's malformed-row and attribution behavior; activity-row validation is not a substitute. |
| `diffGraphs` / history readers | `test/structural.test.ts`: removed/rewired anchors; `test/evolution.test.ts`: path rebasing, window and memo limits | Name the declared historical/delta grade and its omissions; do not assert full runtime change detection. |
| `raiseFindings` | `test/raise.test.ts`: stable finding identity, opt-in writes, bounded volume, dismissed versus resolved | Choose independent guarantees for identity, write authorization and presentation of unanswered questions rather than one omnibus claim. |
| Terminal helpers | `test/panel.test.ts`: wrapping and human-age examples | Width examples do not establish terminal safety or all Unicode behavior; first decide the required contract. |

- Inventory and structural check: `node src/cli.ts guarantees --check --json`. Count unique owner/provider pairs among current relies links, not individual declaration rows.
- Import evidence: canonical `public/graph.json` file edges, checked against actual source import declarations and call paths. Type-only means every cross-owner file import in that pair is `import type`; it is not inferred from the component label.
- Dynamic probe: `rg -n 'import\(' src/lifecycle/hooks.ts`; compare with lifecycle source edges in graph.json.
- Shared status guarantee: `test/status.test.ts` explicitly runs atlas, mass, verify, drift and economy writers concurrently with readStatus. Linking diagnostics/readers to that contract is grounded in the same tested publication path, not mere co-location with recordVerify.
- Signal guarantee: coordination directly consumes signalState; SubagentStop consumes formatSignal, which uses the same predicate. The existing oracle guards that predicate even though its spec anchor is signal.
- All declarations are caller-assessed. No relation was inferred from an oracle passing or from matching trust zones. Graph completeness and semantic entailment remain different questions from link integrity.
