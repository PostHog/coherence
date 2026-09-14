# Structure first gate: implementation plan

2026-09-14. This implements the first gate from
[the thesis](scope-structure-thesis.md): **Structure tells the story of Coherence itself**.
The implementation stays local on `wip/scope-declarative` in `coherence-scope-local`.
No runtime changes are to be pushed to main.

## Outcome

A reader can use the current-state Structure map and sidebar to explain Coherence's
purpose, human and agent entrances, major responsibilities, meaningful relationships,
and selected promises with their evidence limits. An interactive prototype and a
source-attributed walkthrough are the deliverables. Automated checks support that
review; the human comprehension gate remains awaiting user assessment.

Comparison identity and MCP remain design requirements, but implementing comparison,
ghosted removals or an MCP service is outside this first prototype. Preserve room
for those capabilities through stable semantic IDs and separate navigation state.

## Inventory and started work

The local checkpoint has 12 component specs, 80 named invariants, three explicit
`relies on` declarations and 61 atlas transitions. Its root intent describes repository
ownership and supplied no named architecture entrances. These counts refer to the
local checkpoint, which intentionally excludes unrelated journal-feed development.

Main started an `## architecture` JSON-bullet section containing a project purpose,
two entrances and twelve assessed responsibility relationships. Main also started
canonical parsing/resolution and catalog capture. This work is uncommitted and has
not been validated. Sol must review it against source, correct it, and can revise
the grammar or declarations when the evidence warrants. It is not a frozen semantic
answer merely because code has already been written.

## Shared contract

[`structure-contract.ts`](../src/readings/scope/structure-contract.ts) is owned by Main.
Changes require a message and coordinated update, not competing edits.

Sol exports `buildStructureModel(catalog: Catalog): StructureModel` from
`src/readings/scope/structure-model.ts`. This is a pure projection with no filesystem,
clock, browser or project-specific code. Terra imports that function and the shared
types. All IDs exposed by the projection retain catalog identity; unresolved addresses
remain explicit. The contract separates components, guarantees, declared relationships,
source availability and project-level purpose/entrances.

Terra adds `renderer: "structure"` and an optional validated `structure` options object
to the ordinary view configuration. Options are `summaryGuarantees`, `tileZoom`,
`detailZoom`, and `columns`; defaults are exported by the contract. The default view
uses this renderer through the same configuration path available to projects. No
Coherence names, source paths or narrative text belong in the renderer.

Spec density exposes its components, without counting an invariant and its rendered
guarantee as two independent promises. Labels and counts must disclose their scope.
Missing or stale evidence does not become a passing verdict or a low-risk score.
Integration adds `taxonomy.states` for exact-owned assessment-state counts and
`StructureGuarantee.evidence` for the separate canonical oracle-reading assets; a
mixed aggregate must not erase the individual readings.

## Workstream A — Sol: meaning and projection

Own these paths:

- `coherence.spec.md`, `src/types.ts`, `src/derivation/`
- `src/readings/scope/catalog.ts`, `src/readings/scope/capture.ts`
- `src/readings/scope/structure-model.ts`
- `test/structure-semantics.test.ts`, `test/scope-capture.test.ts`
- `docs/scope-coherence-inventory.md`

Tasks:

1. Verify the real purpose, entrances and each authored relationship against source;
   record the supporting addresses and missing semantics in the inventory.
2. Finish strict canonical architecture parsing and owner/anchor resolution. Handle
   malformed, duplicate, ambiguous and fenced pseudo-declarations explicitly.
3. Capture stable assets and relationships with source provenance. New architectural
   meaning must be visible in canonical graph/spec data, not privately parsed by React.
4. Build the shared Structure model. Include declared invariants even without a
   passing oracle, resolve existing guarantee dependencies without guessed consumers,
   and report source failures independently of presentation filters.
5. Summarize exact owned taxonomy subjects without inventing component classifications;
   preserve stale/candidate/unavailable distinctions. Associate boundary/resource cards
   only where canonical relationships support their ownership.
6. Add meaningful semantic tests and pin the canonical contract in the appropriate
   owning spec. Report commands and remaining uncertainty to Main.

Do not edit the UI, configuration validator, shared contract, public artifacts, or
other sessions' ledgers. Do not repair the existing unrelated experiment ordinal gap.

## Workstream B — Terra: visual explanation

Own these paths:

- `src/readings/scope/app.jsx`, `src/readings/scope/style.css`
- `src/readings/scope/configuration.ts`
- `src/readings/scope/structure-renderer.jsx`, `src/readings/scope/structure-layout.mjs`
- `test/scope-configuration.test.ts`, `test/structure-layout.test.ts`

Tasks:

1. Add the configured renderer and validated options; preserve other generic views.
2. Show project purpose and entrance controls, plus discoverable component stacks
   whose prominence can be understood from spec density.
3. Unfurl stacks into architectural cards and local relationships, keeping their
   owner region and external context legible. No file-card or import-arrow fallback.
4. Implement independent zoom detail (tile, summary, detail), explicit expansion and
   selection, and stable identity through relationship bundling and endpoint disclosure.
5. Build an architectural sidebar for cards and connections: purpose/promise,
   participants, evidence, rationale/refutations and source references. Raw attributes
   may remain secondary; they cannot be the main explanation.
6. Use React/Radix/React Flow/Cytoscape already installed. Preserve camera intent,
   make controls keyboard accessible, and distinguish absence, uncertainty and failure.
7. Test layout/option behavior using the contract fixture while Sol finishes the real
   projection. Supply Main with stable browser selectors and a walkthrough recipe.

Do not invent a second real-data projector, mutate canonical evidence, edit Sol's
paths, or build comparison/MCP. Temporary fixtures belong in tests, never in production
as hidden Coherence data. Read the evolving shared model module when available.

## Main — integration and review

Main owns this plan, the shared contract, the thesis, `docs/scope.md`, the reading
surface spec, `scripts/scope-structure-check.mjs`, `docs/scope-structure-walkthrough.md`,
generated reading artifacts and the real-project browser review. The integration supplement
`wrk-scope-story-compat` gives Main `test/scope-layout.test.ts` and
`scripts/scope-browser-check.mjs` to keep generic graph checks using explicit configuration. Main will not edit
agent-owned files while their owners are active.

Integration sequence:

1. Review the independently produced model and UI against the agreed contract.
2. Run the build and focused semantic/layout/configuration checks. Resolve integration
   failures with the relevant owner before taking over their paths.
3. Capture the real Coherence project and inspect screenshots of the initial map,
   an open stack, connected open stacks, zoom detail and the sidebar.
4. Exercise a differently named project fixture to detect hard-coded Coherence meaning.
5. Record the reader walkthrough, actual visible gaps and any measured readability
   problems. Produce a local artifact the user can inspect.

## Acceptance evidence

- Purpose and both real entrances are readable and lead to the correct responsibilities.
- Major components and their owned promises are discoverable without exposing files.
- Every visible inter-component arrow has spec-owned meaning; selection explains its
  direction, declaration and participants. Imports do not create these arrows.
- Opening stacks and changing zoom disclose detail without losing selection or
  misrepresenting relationship endpoints. Unsupported precision stays on the boundary.
- The sidebar distinguishes declaration, enforcement, recorded result and freshness.
- Unavailable architecture/evidence cannot appear as an authoritative empty success.
- The default is ordinary configuration and the renderer works on the generic fixture.
- The real-project walkthrough is ready for user review. This is not automatically
  equivalent to the user understanding Coherence or to a release-ready Scope.

## Coordination

The user explicitly authorized Sol and Terra delegation. Main coordinates the work;
the agents own the bounded paths above. Journal and work commands use the shared
repository at `/Users/daniloc/Documents/Dev/coherence`, session
`01a0912a-841d-7c70-8bbd-d10f421694e8`, with distinct agent labels. Source edits use the
local Scope worktree. Continue experiment `e-a5931667c9b7`; delegation revises how its
implementation action is executed, not its evidence requirements.

No commits, pushes, dependency changes, shared-worktree resets, or unrelated fixes are
part of the delegated tasks. Report blockers and contract changes promptly. Main will
reconcile journal records into the local branch after concurrent writes have stopped.

## Integration findings

The real capture now resolves 12 component stacks, one project purpose, two entrances,
12 authored architecture relationships and three explicit guarantee reliances. The
two new owning contracts bring the local named-invariant population from 80 to 82.
Multiple canonical oracle readings remain separate evidence for a single invariant.

Screenshot review exposed clipped detail, overlapping labels, parent-click bubbling,
raw guarantee hashes used as relationship labels, and inaccessible evidence/detail
selections. Those findings drove the integrated renderer changes. Relationship
selection now links the accessible list and sidebar to focused edges/endpoints; only
explicit guarantee reliance may move an endpoint onto a local promise card.

Structure's initial configuration customizes detail thresholds, preview count and
columns over the complete component population. Generic selection fields are explicitly
rejected rather than silently ignored. Arbitrary Structure filtering and packaged
third-party renderer loading remain later extensions. This bounded prototype is not
the complete extensibility, comparison or MCP implementation from the thesis.
