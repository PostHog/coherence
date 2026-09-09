# Scope populated storyboards — Codex's take

Design review draft, 2026-09-09. **Static drawings, not another Scope view or implementation.**
The figures are states of one proposed main map, not additional tabs. Product code,
the preview server and its default artifact were not changed in this work.

## Start here

1. [Project overview](01-project-map.png) ([vector](01-project-map.svg)): all ten actual
   assemblies, canonical center `src`, 89 individually identified local guarantee marks,
   and the repository/test context. Purpose is an exact spec excerpt with visible ellipsis;
   invariant titles are exact, not newly authored summaries. Three declared consumer links
   have full promise callouts. Imports are hidden, not relabeled as guarantees.
2. [Expansion in place](02-expand-in-place.png) ([vector](02-expand-in-place.svg)):
   Diagnostics expands into free space while the other nine assemblies retain the same
   coordinates. Its existing guarantee marks remain; selected enforcement anchors appear
   below. This is a space-allocation storyboard, not an implementation of expansion.
3. [Real commit review](03-real-diff-overlay.png) ([vector](03-real-diff-overlay.svg)):
   the same geography shows direct implementation edits, a new promise, new reliance
   declarations and applicability changes. No previous passing records are backfilled.
4. [Broader PostHog discovery](04-posthog-discovery.png) ([vector](04-posthog-discovery.svg)):
   an inventory of eight inspected source units, **not eight adopted Coherence components**.
   It separates candidate associations from the two adopted query-cache assay bindings.
5. [Synthetic density](05-synthetic-density.png) ([vector](05-synthetic-density.svg)):
   36 invented components represented inside six containing regions. This explores the
   collapsed information budget only, not a real project or a successful dense-edge layout.

The primary design choice is visible in the first three drawings: the map is stable;
detail and review alter what it says, not which project it displays. The drawings use
rectangular neighborhoods around the canonical center as a legibility sketch. They do
not settle the eventual library's constrained radial placement or claim concentric rings.

## Inventory and provenance

[inventory.json](inventory.json) freezes the current canonical component/guarantee
inventory and the historical boundary populations used here. Current projection came
from `projectGuarantees(await loadConfig(process.cwd()))` at HEAD `1979969` with the
existing dirty worktree. The drawings contain no live verification statuses: neutral
squares mean addressable declarations, not unknown tests or passing components.

| Current component | Local guarantees |
| --- | ---: |
| Harness core | 1 |
| Source adapters | 3 |
| Source derivation | 5 |
| Coordination | 16 |
| Diagnostics and ratchets | 11 |
| Durable evidence | 11 |
| Agent lifecycle | 11 |
| Reading surfaces | 6 |
| Taxonomy | 8 |
| Verification | 17 |
| Repository frame / Executable contracts | 0 / 0 |
| Total | 89 |

Distinct anchors sharing an invariant are distinct marks. Only the first exact invariant
title per component is expanded in this ungraded storyboard; a real evidence/review
projection will select titles under the policy in the reconception plan. The marks retain
their canonical IDs in SVG metadata. Counts are declarations, never subject coverage.

Taxonomy text intentionally exposes stale or absent exact-owner assessments. It does
not silently repair old classifications whose subjects now belong to another component.
Actual role chips and their overflow treatment still need a detailed visual pass.

## Frozen real review example

Before: `ac70b9580cbaa9cb5f1fe5424f7ba60d898e37ee`.
After: `197996912f0eef645f47d938bc6d7a9575dd191f`.

This is an exact commit-to-commit comparison, not a merge-base comparison and not the
current dirty worktree. Source was inspected with `git diff --no-ext-diff --no-textconv`
over those endpoints. Boundary populations were read from each revision's tracked specs,
using the current boundary parser without executing historical configuration or tests.
That is a direct authored-boundary inventory grade, not a complete historical Scope run.

Observed expectations, frozen before any review engine implementation:

- Local boundary population: **82 → 83**, one added, none removed.
- Added invariant: **explicit guarantee links expire with their premises and never prove
  satisfaction**, owned by Verification. Exact identity is retained in inventory.json.
- Three added `relies` declarations: Lifecycle → Evidence, Readings → Derivation,
  Verification → Evidence. Their provider promises already existed.
- Three added `addresses` declarations: one in Derivation, two in Evidence. These change
  applicability/mapping, not the underlying provider invariant wording.
- Direct production-source edits belong to Harness core, Derivation, Lifecycle,
  Readings and Verification. Evidence changes its spec, not its implementation files.
- Adapters, Coordination, Diagnostics and Taxonomy have no directly edited implementation
  in this range. This is **not** a finding that downstream effects are impossible.
- Configuration, project hooks, tests, taxonomy/evidence ledgers, docs and generated
  artifacts also change. The review footer keeps them visible instead of treating all
  non-implementation changes as noise.

The figure does not claim a complete guarantee-input impact set. These historical local
boundaries did not have the new explicit binding input maps, and name/ownership matches
alone cannot prove transitive effects. Nor is there a supplied expected-scope declaration:
“unexpected changes” cannot be inferred from the actual patch or its commit message.

## Controlled review examples to freeze before coding

These are proposed mutations of disposable fixture data, **not changes applied to either
repository**. Expected reading is independent of the future renderer.

| Counterexample | Required observation / falsifier |
| --- | --- |
| Remove one existing local boundary | Its baseline mark survives as removed; before/after population differs by exactly one. Hiding it fails. |
| Change a named oracle while retaining invariant and anchor | Contract/anchor wiring edit, old and new IDs preserved; no inherited input-bound support. |
| Delete the named oracle implementation only | Contract text unchanged; oracle input removed/unresolved; never a fresh pass. |
| Edit an explicitly pinned helper | Supporting-input change identifies the exact pin match. Omitting that reason fails. |
| Edit an unpinned sibling file in the same component | Component implementation changed; no fabricated direct guarantee dependency. Reach remains unassessed. |
| Repeat invariant text at another anchor | Both anchors survive comparison; no dictionary-key collapse. |
| Move a component or split a file | Preserve old/new ownership and label the rename/pairing basis. An ambiguous split is not proven continuity. |
| Add a non-ignored untracked source file | Working comparison includes it, mapping ownership or explicitly reporting unmapped. |
| Stage an edit, then restore worktree bytes | Working net diff can be empty while staged state remains changed. Staged comparison must use index bytes. |
| Edit root runner/configuration | Broad input or derivation change is visible; not automatically attributed to every guarantee's behavior. |
| Missing historical config, ref or unreadable source | Unavailable comparison, never an empty successful diff. |
| Supply expected components, then touch another | Explicit out-of-expectation mark; preserve assessor and endpoints. Without that input the category is unavailable. |

## PostHog breadth: observations versus adoption

Pinned source revision: `c54fec2163ad9455fd23a947f86a9034c1df9388`.
[posthog-source-pins.json](posthog-source-pins.json) records hashes of the nine files read
for the eight-unit drawing. The inventory draws on the existing
[catalog study](../../assays/posthog-guarantees-v0/STUDY-CODEX-TAKE.md) and the current
[candidate definitions](../../../src/verification/guarantee-catalog.ts), with additional
source inspection in the pinned checkout. No PostHog source or spec was changed.

Concrete interactions inspected:

- Ingestion's `settleAndAck` awaits `completed.settled`, then releases capacity and calls
  `ackCompleted`. This supports the existing bounded acknowledgment-barrier discovery;
  it is not a proof of Kafka durability or an adopted cross-component guarantee.
- Task creation retains pending dispatch data and schedules after commit. `create_dispatch`
  refuses outside an atomic block and persists a pending row. The dispatcher checks active
  user/team authority, with an explicit `skip_user_check` exception. These give a useful
  creation → stored intent → dispatcher chain to adopt and assess later.
- Event deduplication uses a Redis pool; query cache uses Redis publication; the outbound
  limiter delegates to its backend. Shared Redis context does not prove a shared keyspace,
  one Redis deployment, or a guarantee flowing between those consumers.

The broader PostHog entry gate is therefore **not passed yet**: source-level subjects and
candidate promises exist, but their larger spec-owned component inventory and explicit
consumed-guarantee mappings are not adopted. The discovery sheet names this limit rather
than inventing contracts or a project center to make a graph look complete.

## What has and has not been checked

WebKit rendered all five static SVGs. Overview and expansion contain ten assembly groups
and exactly 89 guarantee marks; historical review contains ten groups and 83 marks.
Component positions are identical across the three storyboards. Source/spec inventories,
not an invented sample of convenient guarantees, supply those marks.

This is not usability acceptance. Remaining issues to settle before implementation:

- The promise callouts occupy gaps rather than an approved library-routed edge-label
  arrangement. Their attachment and scanning order need review.
- Expansion into available space is illustrated, not the harder case where neighboring
  regions must move. Multiple simultaneous expansions remain undesigned.
- Drawings are 1600px wide. Effective 14px text at 1440×900, responsive reflow, keyboard
  traversal, real taxonomy chips and long-title behavior are not yet validated.
- Evidence-state and change-state glyphs need a greyscale-accessible detail pass. Review
  currently emphasizes direct edits and the one added promise; full supporting-input
  attention cannot be faked until the shared projection is designed and tested.
- The density sheet has no dense routed links. It cannot satisfy the dense-edge or
  performance criteria. No framerate result is claimed for static drawings.
- Reviewer comprehension and the 30-second tasks have not been measured.

The next decision is whether this **single project composition** is the right direction.
If so, refine these same storyboards to close the above design gaps, including removal and
expected-scope states. Do not respond by making a new executable view. Implementation
remains paused until the wireframe and fixture entry gates are actually accepted.
