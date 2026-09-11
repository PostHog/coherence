# Adversarial receipt review

Reviewed September 11, 2026 against the shared development tree, independently from the implementation discussion. Product code and existing tests were not edited. Fixtures and complete outputs remain under `/tmp`; repository decision/defect/experiment journals were appended as required. The implementation was changing concurrently, so findings below describe the bytes exercised, not an assertion that subsequent repairs remain defective.

## High — skipped and TODO serial tests become eligible executed passes

**Reproducer:** `node /tmp/coherence-receipt-adversarial-probe.mjs`. Complete CLI results, fixture paths and receipt identities: `/tmp/coherence-receipt-adversarial-probe.json`. Raw runner output: `/tmp/coherence-receipt-{normal,skip,todo}-tap.txt`.

The fixture copies the serial runner configuration already used in `test/receipts.test.ts`: `test: [node, "--test", "--test-reporter=tap", "--test-name-pattern"]`, `testMatch: "ok [0-9]+ - receipt executable control"`, `oracleExecution: "serial"`. With the sole named test changed to `test.skip(..., () => assert.equal(42,99))`, Node exits zero and reports `ok 1 - receipt executable control # SKIP`, pass 0, skipped 1. With `test.todo` the assertion actually fails and Node reports `not ok 1 - receipt executable control # TODO`, pass 0, todo 1, exit zero.

Both public `verify --receipt --work wrk-review` runs record `{kind:"pass", executed:true}` and `receipts <id> --json` returns `problems: []`, exit zero. Closing the work and adding an explicit `verifies` edge produces `orient --json` with `unverifiedCompletedWork: []`. The normal passing test also clears the same obligation, confirming the journey itself works.

**Affected:** `src/verification/phrasebook.ts:147-164` (`oracleChecked` signals entry; serial success is exit status plus caller regex), `src/verification/verify.ts:795-798` (entry becomes witnessed execution), `src/evidence/receipts.ts:223-232` (eligibility), `src/coordination/orient.ts:305-306` (credit). The TODO line also matches the unanchored `ok` regex inside `not ok`.

**Trust:** No receipt forgery, malicious executor, changed inputs or dishonest result objects are needed. This uses a standard runner and the repository's own fixture configuration. The assessor's judgment cannot compensate for incorrectly reported execution status. Receipt mode needs sufficient observed execution evidence, or an explicitly weaker/ineligible serial grade where runner output cannot establish it. Journal: `def-b99563450031`.

## High — recent historical batch output is attributed to a failed new run

**Reproducer:** `node /tmp/coherence-receipt-batch-probe.mjs`; complete output `/tmp/coherence-receipt-batch-probe.json`.

Configure `testBatch: [node, "broken-runner.js", "--outputFile=report.json"]` and Vitest JSON format. The runner only prints an initialization failure and exits 1. Seed `report.json` with a previous passing named-test result immediately before invoking `verify --receipt`. The command exits zero and emits a receipt with `imported:false`, `{kind:"pass",executed:true}`, and `problems: []`. No test executed in that invocation; the runner did not touch the report. Aging the identical report ten seconds before rerunning causes the claim to skip, proving report age is the discriminator.

**Affected:** `src/verification/test-batch.ts:394-435`, especially `mtime < startedAt - 2000`, plus receipt conversion in `src/verification/verify.ts:795-798`. The comment that two seconds of slack “cannot admit a report from a previous run” is refuted. Report freshness needs per-invocation ownership/publication rather than only a tolerant wall-clock comparison. A unique run output also prevents concurrent runs from borrowing each other's shared report path.

**Trust:** The fixture simulates an ordinary initialization failure after a recent successful run; it does not fabricate addressed receipt files. Input bytes remain identical, so before/after input hashing correctly detects no change and cannot repair the false execution attribution. Journal: `def-350f69ffa4ef`.

## Low — pending namespace hides a surviving incomplete start

**Reproducer:** `node /tmp/coherence-receipt-storage-probe.mjs`; complete output `/tmp/coherence-receipt-storage-probe.json`.

Call `beginReceipt`, then rename `starts/<run>.json` to `starts/.pending-<run>`. `listReceipts` changes from one incomplete run to `{completed:[], incomplete:[]}`, although the valid start bytes survive. `corpus()` unconditionally ignores every `.pending-*` filename (`src/evidence/receipts.ts:194-203`). Genuine interrupted temporary publications need a policy, but they and displaced evidence currently disappear from inventory without any diagnostic.

**Trust/impact:** Requires filesystem damage or a writer with rename authority. It loses incomplete-run visibility; it does not grant a pass. An addressed completed receipt with missing required start/seal still refuses. This is a bounded inventory weakness, not authenticated tamper resistance. Journal: `def-29ace822df5d`.

## Confirmed positive controls

- Existing receipt suite: 10 tests passed, 0 failed. This includes sticky-dashboard separation, full selected-file clone reconstruction/work integration, changed source/index/configuration, invalid/empty/imported observations, missing/torn dependencies, killed verifier, competing terminals, symlink containment, malformed hashed results and concurrent finishers.
- Independent public CLI concurrency fixture: three simultaneous receipt runs all returned distinct addresses, survived listing and remained eligible; no terminal was overwritten.
- Independent damage fixture: removing a terminal's final newline exits 2 with `noncanonical/torn evidence`; removing its seal exits 2 with `receipt missing or run incomplete`.
- Ordinary passing serial control produces valid evidence; skipped/TODO cases differ only in the named test declaration and failing assertion.

## Declared limits respected

I did not classify locally fabricated, correctly hashed receipts as an authentication breach: the design explicitly declares local unattested testimony. Nor did I count mutable ignored dependencies, services/environment, excluded work/consequence files, or change-and-restore between samples as violations of snapshot guarantees; they are disclosed limits. Criteria coverage remains assessor-judged, and a bound but semantically irrelevant test cannot be ruled out by hashes alone. Power-loss directory persistence and hostile ancestor-symlink races were inspected but not reproduced; no stronger assurance is claimed for those cases.

## Repair validation — September 11, 2026, 16:10 UTC

The three original findings were independently rerun against the repaired tree:

- **Serial skipped/TODO false credit: repaired.** Both now return verify exit 1 with `kind:fail`, `executed:false`; receipts are ineligible and explicit work edges leave `wrk-review` unverified. The real passing control still returns an eligible receipt and clears work. Original probe scripts were rerun; their JSON files now contain repair results, while original fixture directories/receipt addresses named earlier remain on disk.
- **Recent stale batch report: repaired.** The original failed-runner probe now produces verify exit 1, `kind:skip`, `executed:false` and an ineligible receipt. A previous report cannot supply the new private path.
- **Pending rename inventory loss: repaired.** The same rename now throws `incomplete receipt publication survives; inspect before recovery`. Details: `/tmp/coherence-receipt-storage-repair-probe.{mjs,json}`.

Additional independent private-report controls are in `/tmp/coherence-receipt-batch-repair-probe.{mjs,json}`. For each case two public CLI verifiers ran concurrently. Real assertions plus fresh passing reports produced two eligible receipts, with distinct private report paths, both cleaned after use and the configured shared report path untouched. A report with one passing and one pending matching case was ineligible. A zero-exit runner producing no report and a nonzero-exit runner producing a fresh passing report were both ineligible. Three concurrent serial receipt runs also remained distinct and eligible; torn receipt and missing seal controls continued to refuse.

A new negative-evidence regression was found and repaired during review (`def-7ee51fa803ea`): positive-only execution callbacks initially marked an actual failed assertion `executed:false`. The latest rerun of `/tmp/coherence-receipt-serial-repair-probe.mjs` confirms `kind:fail, executed:true` with an assertion stack and runner exit 1. Unrelated filtered/skipped tests do not interfere with the valid named execution on Node 22.21.1.

The first repair-suite run was 13 pass / 1 fail because missing batch output still returned CLI exit zero despite an ineligible receipt. The subsequent CLI exit fix was independently confirmed using the original batch probe. This does not assert that the full latest suite has finished; final suite results are recorded separately below if available.

### Medium availability issue found during repairs — concurrent status temporary output stales a receipt (subsequently repaired)

During the paired public CLI probes, one receipt's after manifest gained exactly `.coherence/status-79f2fc73-fc7b-4bf3-aab7-c4db6cd046d0.tmp`; its seven source/configuration files were byte-identical before and after. The temporary file is another verifier's atomic status publication (`src/evidence/status.ts:189`). `captureReceiptInputs` treats it as a Git-visible input because receipt exclusions omit status scratch files. This causes `inputs changed during execution` solely from verifier-owned output. It can needlessly invalidate a concurrent successful run; it does not grant false credit.

Evidence: the `zero-no-output` case preserved in `/tmp/coherence-receipt-batch-repair-pre-scratch-fix.json`, fixture `/var/folders/v5/3k38g_ls55g6zhq2lxdqt7k80000gn/T/receipt-batch-repair-FLqvF5`, its before/after manifests. The specific observed run was already ineligible for missing output, but the additional fingerprint mismatch is directly attributable to the temporary file. `src/evidence/status.ts` already excludes its scratch namespace from its own Git dirty reading. Journal: `def-b6e6a35f6474`. The executor fingerprint fields were being extended concurrently; no stability claim is made about unreviewed subsequent changes.

### Final validation after receipt-source freeze

The scratch-output issue is repaired. The declared input exclusions now name status scratch and lock outputs; only UUID-shaped scratch names are excluded. The deterministic guard confirms `.coherence/status-policy.tmp` remains material. The final independent focused suite passed **16/16, zero failures**. An intermediate mixed-version suite failure (`invalid input manifest`) disappeared after source freeze and rerun, consistent with a long-lived test process reading a pre-edit schema while spawned CLI processes used a newer one (journal conjecture `d-62beabba`).

The final concurrency probes also passed: three simultaneous serial runs retained distinct eligible receipts; paired batch runs used distinct private output paths and cleaned them; all passing pairs remained eligible; mixed pending results, zero-exit/no-output runners and nonzero/fresh-output runners returned exit 1 and ineligible receipts. No final probe reported input changes caused by scratch output. Renamed pending evidence, torn terminal framing and missing seals continue to refuse. Details remain in `/tmp/coherence-receipt-storage-repair-probe.json` and `/tmp/coherence-receipt-batch-repair-probe.json`.

**Disposition:** all independently reproduced findings in this review were repaired and their relevant counterexamples rerun. No remaining false-verification-credit or storage-loss defect was reproduced within the reviewed local-unattested, before/after-input grade. This is bounded validation, not executor authentication, semantic-coverage proof, or a claim about power-loss behavior. No product code or existing tests were edited by this reviewer.
