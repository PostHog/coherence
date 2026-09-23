# Terra: distill feature-parity review

Date: 2026-09-18. Review only; no implementation, journal writes, commits, hook trust changes, or reference-code transplantation.

## Verdict and distilled goal

**The reduced capabilities are substantially implemented, but end-to-end TypeScript parity is not established.** Decision **d-339301dc** claims that every kept capability exists after the Scope merge. Counterexamples below show missing delivery, attribution, enforcement continuity, and reliance workflows, not a need to restore the reference's command count.

The goal is to rebuild from zero, using the preserved reference as a **behavioral oracle and source of rejections, never a source of code** (**d-5649f59e**). Glossary-first delivery and Mnemion adoption are explicit (**d-0ca70709**); rejected mechanisms belong in the retirement record, not every adopter's vocabulary (**d-bf0fd77b**). `docs/glossary.json` and `docs/retired.md` govern what survives. In particular:

- Keep the spec tree, requirements becoming invariants through enforcement and witnessed refutation, runs, computed reliance, journal/work context, human and agent readings, and automatic orient/regulate.
- Do not restore atlas/zone placement, authored guarantee links, work authority/permission machinery, command classes, mass ratchets, or the retired diagnostic collection. See `docs/retired.md:5-85`.
- Retiring per-tool activity telemetry **expressly retains one session row proving that the hook reached its body** (`docs/retired.md:95-99`).
- Keep the distinction between historical verification and what the current session actually owes. A work order supplies context, not authority.

The journal was read with `node src/cli.ts journal`, followed by `--json` filtering and `work inspect`. The five open Structure/reference-site work orders are real pending work, not inferred from absent command names.

## Exact comparison baselines

References were already fetched by the main agent. Full identifiers were resolved locally:

| Label | Baseline | Exact SHA |
|---|---|---|
| C | Current local distill implementation | `d16e0affd3dbabe4362c9a4fc3691e6850a11806` |
| R | `origin/feat/totality-enumeration-gate` — the remote reference branch | `5cab171bfbfa6296132d8a358981c2d60dd60f8b` |
| M | `origin/main` | `0094133c6e07b28aa0ad646f6048710be412fa30` |
| F | Frozen local behavioral oracle designated in d-5649f59e | `645d928e004698282d3f99fef4d1ed64a7a94f41` |

Initial distill HEAD was `6811ae2d86e30667aad13d56da819aac9984629f`; the main agent then committed the Python workspace-enumeration repair as C. **That Python defect is not open in this review.** The uncommitted hook/read-command fix from **d-4e3b2fab** is included in the current behavior reviewed here and is not counted as missing. The main agent subsequently completed and tested the uncommitted pytest setup and truthful-refutation fixture repairs; these are also fixed locally, not outstanding findings (details below).

**These reference labels are not interchangeable.** M is four reachable commits ahead of R; F is nineteen ahead of R and fifteen ahead of M. M adds the human-escalation merge and a visible cancellation exit (`M:src/commands.ts:155-161`). F additionally contains automatic peer-journal delivery (`F:src/lifecycle/hooks.ts:348-366`) and the later declarative Structure implementation (`F:src/readings/scope/app.jsx:213-251`). Neither was attributed to R simply because it exists in F. R already has computed cross-component reliance and hook delivery observation.

Evidence notation below is `label:path:line-range`; unprefixed paths mean C plus the stated local hook overlay. Reference trees were inspected with Git and isolated temporary exports, without checking out/resetting this workspace.

## Capability matrix

“Replaced” means the retained behavior has a different implementation; it does not certify every edge case.

| Capability / workflow | State | Distilled replacement or remaining issue |
|---|---|---|
| Glossary, two-layer injection, rejected-name checking | Kept | Implemented; current start text now includes journal reads. |
| Journal choices, conjectures, refutations of decisions, experiments, escalations | Kept / replaced | Append-only session records and answer records; escalation parity is with M/F, not R alone. |
| Peer journal updates | Replaced, attribution gap | Subject/cursor feed exists (`src/journal/feed.ts:65-104`); child identity is wrong in hook delivery, finding 1. F is the relevant automatic-feed baseline. |
| Work create/inspect/move/owner/close/cancel; inferred record binding | Replaced | `work inspect` without an ID lists orders. Cancellation survives via `work move … cancelled`; do not call it missing because the old close syntax changed. Boundary attribution remains a question below. |
| Spec grammar, checklist, run/refute, TypeScript/Python enforcement | Replaced, continuity gaps | Real implementation, but old green state and disappearing surfaces can escape current verification, findings 3–4. |
| Host installation and execution discovery | Partial | Both hosts now wired locally; configuration presence is not observed delivery, finding 6. |
| Cross-host edit-time revelation | Partial | Single-path edits work; structured Codex patches are not recognized, finding 2. |
| Start/stop readings | Partial | Some start state and stop debts exist; startup omits known structural defects and a derived heading, finding 7. |
| Adopter/subdirectory lifecycle | Missing case | A valid in-project subdirectory is treated as an independent project root, finding 5. |
| Computed reliance | Missing completion | File lists/bypasses do not answer who calls a chokepoint, finding 8. |
| Scope and agent queries | Replaced, partial | Six human views and fixed agent questions exist, with shared derived state. Security-spine picture/text/preview remain explicit work, finding 9. |
| Economy, calibrate, mass | Kept as commands | Implementations exist under `src/economy`; no demand to restore retired mass-growth failure. Complete host read coverage was not certified. |
| Atlas, zone topology, authored reliance links, authority/work permissions, retired diagnostics | Retired | Not findings. Retained intent must use components, crossings, computed references, and context. |
| Ruby/custom-adapter compatibility; published-adopter bootstrap | Uncertain | R advertised more languages and an installation path; current goal and distribution expectations need clarification, below. |

## Prioritized findings

### 1. P1 — Subagents are assigned the parent's journal/work/feed identity

**Current evidence:** `src/lifecycle/hook.ts:109-115,170-175,245-255` accepts arbitrary payload fields but obtains identity only from `session_id`. The same helper supplies work ownership and unable attribution (`:179-183,204-210`), and the event handler uses it for feed initialization (`:475-491`). Tool reads and stop snapshots also use `input.session_id` directly (`:486,497`).

**Reference evidence:** R chooses `agent_id`/`agentId` before the parent session (`R:src/lifecycle/hooks.ts:265-287`). For a child stop without an exact child ID it explicitly names the attribution limit instead of charging the parent (`:365-380`). R's trace parser follows the same child-first identity rule (`R:src/lifecycle/read-trace.ts:103-108`).

**Observed reproducer:** Call `sessionBlock(root, {session_id: 'parent', agent_id: 'child-A', agent_type: 'Terra'})`, then repeat with `child-B`. Both yield `Session: parent` and journal instructions using `--session parent`. This was executed against a temporary adopter fixture.

**Impact / acceptance:** Siblings can share cursors, exclude each other's records as their “own,” bind to the parent's order, and use the parent's unable records. Normalize host identity once; distinct explicit child IDs must produce distinct write identities, work lookups, cursors, runs, and traces. Missing child identity must be disclosed rather than asserted as precise parent-owned work.

**Why retained:** Sessions remain the unit of provenance and inferred work ownership; authority retirement does not retire accurate attribution.

### 2. P1 — Structured Codex patches bypass edit-time revelation

**Current evidence:** `writtenFile` accepts one `file_path`, `notebook_path`, or `path`, and nothing from the patch body (`src/lifecycle/hook.ts:356-366`). `editContext` immediately returns without checking anything when that lookup fails (`:373-380`). Multi-file edit delivery has no representation in this interface.

**Reference evidence:** R parses canonical `apply_patch` Begin/End envelopes and Add/Update/Delete/Move headers, including multiple paths (`R:src/lifecycle/read-trace.ts:65-93,109-119`); its Codex event registration explicitly includes `apply_patch` (`R:src/lifecycle/control.ts:27-29`). This reference behavior is **structured edit awareness**, not a claim that R already performed distill's new immediate chokepoint check.

**Observed reproducer:** With `tool_name: 'apply_patch'` and `tool_input.command` containing an Update File header for `widget.ts`, `writtenFile` returns `undefined`; an `Edit` payload naming the same file returns `widget.ts`.

**Acceptance:** An explicit patch that introduces a bypass must recheck all affected files and report the defect in that event; deletion/move headers must not disappear merely because the old path no longer exists. No speculative parsing of arbitrary shell commands is necessary.

**Why retained:** The retained run/revelation workflow is host-delivered, and both hosts are installed. Wiring the event name without understanding that host's structured edits is not reduced-form parity.

### 3. P1 — Removing the entire spec surface turns a remembered failure into a successful zero-check run

**Current evidence:** `loadSpecModel` derives only currently discoverable specs (`src/spec/model.ts:146-173`); stop debt returns empty when there are no components (`src/lifecycle/hook.ts:300-304`). `run` reports zero checks but returns success unless an entry failed or the instrument died (`src/enforcement/cli.ts:70-78,150-155`). There is no remembered-surface comparison on this path.

**Reference evidence:** R explicitly refuses an empty verification surface when earlier verification remembered claims (`R:src/verification/floor.ts:112-132`, called by `R:src/verification/verify.ts:319-324`). This is not the retired mass ratchet.

**Observed reproducer:** In an isolated fixture, a complete spec plus a readable failing run produced one structural defect. Delete that spec, leaving the run untouched: the model reports zero components/bullets/problems, stop reports `owed: 0`, and `run --session zero-probe --agent Terra` exits **0**, recording `0 enforcements, 0 pass, 0 fail`.

**Acceptance:** A previously nonempty surface cannot become a clean zero-check success without an explicit accounted-for removal. Also surface individual invariant removals for the intended human acknowledgement. Preserve a legitimate first-adoption empty state; do not restore old claim forms or catalog IDs.

**Why retained:** Invariant removal requires human acknowledgement (`docs/glossary.json:64`), and a structural defect is supposed to stand until repair or acknowledged retirement (`:115-119`). R had a narrower but concrete safety check that distill has lost.

### 4. P1 — Historical green evidence is reused after edits, even for a different enforcement target

**Current evidence:** Run/refutation lookup keys are only component, bullet name, and enforcement form (`src/enforcement/record.ts:199-239`). `loadSpecModel` joins these historical entries into today's bullets (`src/spec/model.ts:152-155`); `deriveState` consumes the earlier verdict/refutation without checking whether today's target or source was verified (`src/spec/state.ts:67-95`). Stop debt examines existing problems/defects and changed requirement specs, not an invariant touched without a run (`src/lifecycle/hook.ts:300-324`).

**Reference evidence:** R distinguishes `never`, `failing`, `stale`, and `current`; missing/mismatched provenance and dirty source cannot establish current verification (`R:src/coordination/orient.ts:103-145`). It selects a verification heading for stale/failing evidence (`:347-352`). The retained regulate definition specifically names an invariant touched without a run (`docs/glossary.json:895-897`).

**Observed reproducer:** A fixture with one witnessed passing chokepoint remains an invariant with no stop debt after modifying its source. More decisively, replacing `chokepoint: widget` with `chokepoint: noSuchSymbol`, keeping the bullet name, still yields `state: invariant`, `owed: 0`, with no new check.

**Acceptance:** Keep old dated verdicts as history, as the glossary requires, but distinguish them from verification of the current enforcement. Repointing the enforcement must not inherit its predecessor's witnessed proof; edits needing a new pass must become visible debt/stale evidence at the next practical boundary. Do not fail every unrelated dirty file or erase historical runs.

**Why retained:** This is verification continuity, not restoration of work receipts, authority, or a requirement to remember a final command.

### 5. P1 — Nested working directories silently change which project the hook reads

**Current evidence:** The hook finds an installed root and validates containment, then nevertheless sets `root = given` from payload `cwd` (`src/lifecycle/hook.ts:466-477`). Glossary lookup resolves the config only under that supplied root (`src/lifecycle/project.ts:98-113`); journal/runs/work likewise read root-relative stores. Installation emits a plain command prefix with no root normalization (`src/lifecycle/install.ts:68-73`).

**Reference evidence:** R's launchers resolve the installed Coherence root, change directory, and export it (`R:src/lifecycle/control.ts:43-57,65-78`). Its hook entrypoint loads that root explicitly (`R:src/hook-cli.ts:12-16`). Restoring those exact scripts is not required.

**Observed reproducer:** Temporary project root: config, project glossary, spec/run, and `.codex/hooks.json`; child directory `sub/`. Calling SessionStart with `cwd: root/sub` and fallback root `root` exits **0**, but loses `Widgetry vocabulary`, which appears at the real root. It emits the adopter's relative journal command for the wrong root as well.

**Acceptance:** An allowed descendant cwd must still read/write the installed project's glossary, journal, work, runs, and feed, while resolving tool-relative paths against the actual tool cwd. Rejected out-of-project paths should stay rejected. Verify that default launch commands work from a nested directory too.

**Why retained:** Adopter support and scoped cwd confinement survive; no retirement says each source subdirectory becomes a separate project.

### 6. P2 — “Installed” cannot establish that the current host/session received Coherence

**Current evidence:** `status` detects command-shaped settings entries (`src/lifecycle/install.ts:158-183`) and prints their presence (`:186-197`). Start handling produces context and optionally initializes the feed, but writes no host/session delivery observation (`src/lifecycle/hook.ts:475-481`). There is no equivalent to an observed/stale/unobserved current-session result.

**Reference evidence:** R distinguishes exact launcher/host/version observations from stale or manually invoked ones (`R:src/lifecycle/hooks.ts:567-574,616-657`). Its hook body records the observation (`:270-281`). The simplification decision explicitly preserves one row per session (`docs/retired.md:95-99`).

**Observed reproducer:** A fixture settings object made with `mergeHooks` and prefix `node /missing/coherence/src/cli.ts` is reported as **six installed events, zero missing**, despite the nonexistent executable and no host delivery. This is correctly a settings inventory today, but it cannot answer the user's “did the hook actually supply it?” question.

**Acceptance:** Preserve settings inventory, add a reduced host/session observation and a clear missing/stale/not-observed diagnosis. A direct diagnostic invocation must not masquerade as host delivery. Do not recreate per-tool activity telemetry or change user trust automatically. A separate body protocol is necessary only if there are actually two bodies to keep in step.

**Why retained:** This is the exact surviving consumer of the retired activity ledger, not a request to resurrect that ledger. The new journal-command installation repair is already locally present; fresh-session automatic delivery is still unproven.

### 7. P2 — Orient can omit a structural defect that regulate already knows about

**Current evidence:** Start context is escalation block + spec block + owned work + vocabulary/instructions (`src/lifecycle/hook.ts:412-418`). `specBlock` selects requirements and parser problems only (`:270-283`), whereas stop selects structural defects (`:305-318`). No derived next heading or unreached-mass reading is included at start.

**Reference evidence:** R provides a single deterministic orientation action/reason derived from state and includes failing/stale verification (`R:src/coordination/orient.ts:315-359`). M/F add human escalations to that family of readings. The distilled definition explicitly preserves known structural defects, unmet requirements, unreached mass, work, peers, and one heading (`docs/glossary.json:875-877`). Old authority-based priorities are not proposed for restoration.

**Observed reproducer:** With one complete invariant and a failing run, the fixture model has one structural defect and `specStopText` prints its exact bypass reason. `startContext` does not show that reason or a defect summary. The glossary's generic definition of a defect is not a reading of this failure.

**Acceptance:** A new/resumed session should see that known failure before acting and a reduced, state-derived heading; manual `query status` is useful but not equivalent to delivery. Large state may use an honest summary and drill-down command rather than overflow the budget.

**Why retained:** Orient is an expressly kept start-of-cycle workflow. d-339301dc cannot be validated merely by having a status query elsewhere.

### 8. P2 — Reliance omits legal callers of the chokepoint, not just reference-site detail

**Current evidence:** The check enumerates references to the **protected thing only** (`src/enforcement/check.ts:141-146`). The persisted run keeps file lists and bypasses (`src/enforcement/record.ts:54-69`; `src/enforcement/run.ts:181-191`). `relianceOf` groups those files and has located sites only for bypasses (`src/readings/scope/derive.ts:234-271`). The reading's warning is honest, but does not make it a computed reliance result.

**Reference evidence:** R computes cross-component dependency adjacency from resolved import edges, including type-only consumers (`R:src/readings/promise.ts:140-150`). The new definition deliberately broadens the fact to code referencing the chokepoint **or** its protected thing (`docs/glossary.json:325-327`); declared reliance machinery, not the fact, was retired (`docs/retired.md:23-25,41-43`).

**Observed runtime reproducer:** A real temporary TypeScript project has private `hidden` and exported `door()` in `store/door.ts`; `client/use.ts` imports and calls `door`. The current language-server check grades it `visibility-choked`, passes, and returns `files: ['store/door.ts']`. A separate adapter reference query for `door` immediately returns both the client's import and call. Thus the missing consumer is available from the adapter; it is not an index-availability problem.

**Acceptance:** Record classified references to both endpoints, including legal chokepoint callers, then derive human/agent reliance from those sites. In that fixture, `client` must appear as a reliant without being called a bypass. Do not merely serialize the existing protected-thing sites; that would still omit it. Tests/definitions must remain distinguishable.

**Why retained / existing work:** Reliance is explicitly kept and already has open work **w-1a54ec05** (classified sites) and **w-7d42364c** (Structure reliance). This runtime example sharpens their acceptance criteria; it does not duplicate an unimplemented reference ledger.

### 9. P2 — The retained spine-reading workflow is still an explicit, unfinished slice

**Current evidence:** The human view registry contains Glossary, Components, Invariants, Reliance, Runs, Journal, with no Structure view (`src/readings/scope/shell.ts:19-27`). The current agent question set is documented in `src/readings/query/query.ts:7-14`. This is **not** inferred solely from names: `work inspect` records specific observable deliverables not yet implemented.

**Reference evidence:** R already presents spatial/component reliance (`R:src/readings/render-contract.ts:218-219,477` and `R:src/readings/scope-model.ts:33-40`). F, not R/M, contains the later declarative Structure renderer (`F:src/readings/scope/app.jsx:213-251`). The current glossary retains scope and agent readings (`docs/glossary.json:738-784`), while expressly retiring the old topology and promise apparatus.

**Observable acceptance / existing orders:**

- **w-d6a0ff44:** deterministic picture with declared trust levels as nodes and invariant crossings as labeled edges; no restored atlas/zone residence.
- **w-79168c7e:** `query spine` provides the same ordered crossing facts, grades/enforcers, state, and bypass count to agents.
- **w-5f9a3787:** scaffold preview shows a proposed crossing as a dashed edge before writing it.
- **w-7d42364c:** expand an edge into the site-derived reliance from finding 8.

**Why retained:** These are the owner's reduced-form assignments, not demands to recreate F's UI framework, all old view types, layout mechanisms, or command surface. In particular, preview is justified by the current work order; this review does not claim the exact new preview command existed on R.

## Ambiguities and adoption questions — not asserted regressions

### Work-boundary debt attribution needs an explicit policy decision

An isolated runtime test with a **clean worktree**, one existing failing invariant, and an active child order limited to `README.md` returned SubagentStop **exit 2** for the unrelated invariant. `specStopText` counts all project defects/problems (`src/lifecycle/hook.ts:300-324`); refusal uses that count without consulting the work boundary (`:498-513`). R explicitly distinguished shared patch signal from child attribution (`R:src/lifecycle/hooks.ts:354-380,451-454`).

This conflicts with the retained “must not be nagged” boundary statement (`docs/glossary.json:657`), but current instructions also explicitly say to record outside-boundary work as unable/defect/conjecture (`src/lifecycle/hook.ts:196-197`), and a matching **unable** makes debt advisory (`:178-194`). The open question is whether a compulsory unable record for every unrelated existing defect is the intended exemption or the old maintenance nag in reduced syntax. Also, boundary is prose, not a machine-readable write-scope list (`src/journal/work.ts:100-114`). Do not silently restore work-authority checks. A chosen policy should have a regression test for an unrelated pre-existing defect and a different test for a defect this session introduced.

### Pytest setup and the previously skipped refutation fixture: fixed locally

At committed C, the selected interpreter lacked pytest and the helper skipped the integration pass. That environment problem was not proof of a reference regression: R likewise expects an adopter-provided `.venv/bin/python -m pytest` and documents the report dependency (`R:README.md:632-647`). Optional npm Pyright supplies a language server, not a Python test runner.

**The main agent has now fixed both local gaps**, uncommitted at report completion:

- `requirements-test.txt` pins pytest 9.1.1; `npm run test:setup` creates ignored `.venv` without modifying system Python (`package.json:20`, `.gitignore:2`, `README.md:64-84`). The helper locates the interpreter relative to the checkout, honors a strict explicit `COHERENCE_PYTHON` override, and fails rather than skips when pytest is missing (`src/adapters/python.test.ts:131-146,413-423`).
- Executing the formerly skipped test exposed an assertion expecting witnessed refutation without a refutation record. The fixture now observes missing proof, stages a real failure through `refuteCommand`, restores the source, verifies the witnessed passing run, and checks a missing-test failure (`src/adapters/python.test.ts:429-457`). This is a repaired test-evidence gap, not a remaining Python workspace-enumeration defect.

The main agent reports full `npm test`: **155 passed, 0 skipped, 0 failed**. I inspected the changed setup/helper/fixture sources but did not independently repeat that full run. These fixes improve test coverage; they do not invalidate the separate host and enforcement-continuity counterexamples above.

### Supported languages and distribution

R documents TypeScript/Python/Ruby and custom-adapter extension (`R:README.md:607-652`); current enforcement describes TypeScript/Python (`src/enforcement/config.ts:2-4`). Is Ruby/custom-adapter adoption intentionally out of this distillation's scope? The TypeScript parity decision alone does not answer that; absence was not promoted to a finding.

R's three-command published-package onboarding is explicit (`R:README.md:24-32,52-58`). Current package is private and README primarily documents source-tree invocation; **d-00b7afa1** records the deliberate reversible `npm link` Mnemion trial. Clarify whether the acceptance target is local linked adoption or distribution-ready installation. A minimal end-to-end adopter recipe is useful either way, but publication machinery was not assumed required. No adopter repositories were changed or migrated during this audit.

## Recommended next fixes

1. **Close the host delivery path first:** one child-aware identity normalization and one installed project-root resolution, then structured multi-file patch extraction. Test actual host-shaped payloads for both hosts, not just generic `Edit`/parent-session fixtures.
2. **Make current verification trustworthy:** remembered nonempty-surface refusal; enforcement identity/provenance that cannot transfer old refutation evidence to a new target; explicit touched-without-run debt while preserving dated history.
3. **Finish startup observability:** the retained one-row host/session observation and a reduced orient heading including known structural defects. Installation presence and observed delivery must remain separate.
4. **Finish the existing sites → reliance → Structure/text → preview work**, with legal chokepoint callers in the producer's acceptance test. Do not build the picture over today's incomplete file lists.
5. **Choose boundary attribution policy and preserve the now-passing local pytest setup in the next commit**, then run fresh Claude/Codex and fresh-adopter canaries. Neither unit success nor this source audit proves host delivery.

## Coverage and limits

- Read current journal, glossary, retirements, CLI dispatch, lifecycle/install/root handling, work/feed flows, spec state, enforcement records/checks, adapter seams, and human/agent reading derivation. Compared R, M, and F independently through Git and temporary exports.
- Executed isolated current-code probes for identity, Codex patch recognition, nested cwd, false installation confidence, stale/repointed enforcement, startup omission of a known defect, boundary attribution, and disappearing specs followed by a zero-check run. The enforcement-state probes used explicitly synthetic valid-shaped run/work fixtures, **not fabricated evidence in this project's stores**.
- Executed one real TypeScript language-server query/check in a temporary two-component project to demonstrate the missing legal caller. It passed enforcement while a separate reference query exposed the omitted consumer.
- The full reference implementations were inspected, not booted with their historical dependencies. No live host session, browser interaction audit, full suite rerun, Python pytest execution, or adopter migration was performed here. The main agent completed the Python repair and setup/fixture tests; its reported full-suite result is distinguished above from my own probes.
- At the reviewed baseline the project reports 79 invariants, no requirements, and no spec problems; that is a recorded-model result, not proof that the workflows above are complete. **d-339301dc should be qualified until these retained end-to-end paths are exercised.**
