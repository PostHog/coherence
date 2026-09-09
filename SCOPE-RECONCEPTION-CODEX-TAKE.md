# Scope reconception — Codex's take

Status: bounded implementation authorized, 2026-09-09.

## Latest direction — overrides the storyboard geometry

Enhance the existing fluid gravity canvas, not the static tiled storyboard. Keep
the canonical project center spatially legible. Rings are optional, not an invariant.
There is one Structure map, with all assemblies initially visible and a temporary
inspector. No Region / Paths / Assemblies switch.

Semantic zoom changes content, never component positions: overview shows names and
scoped attention; intermediate shows purpose, taxonomy and selected guarantees;
close restores full readings and allows inline expansion of declared subjects.
Local centrality is explicitly graded by guarantee incidence among declared subjects,
including ties; it is not a claim about the undiscovered internal call graph.
Import context is visually subordinate to directed, authored guarantee reliance.

This pass tests stable geography, population parity, readable zoom levels, local
expansion and live evidence changes in WebKit. Diff/review analysis remains the
next increment; evidence staleness must not masquerade as a Git change overlay.

The older storyboard below records the information requirements, not an approved
layout. Its tiled geometry was rejected by the user.

Supersedes the competing Structure presentations as the intended product direction.
Existing previews remain experiments, not acceptance evidence for this reconception.

The first populated [static storyboard packet](docs/design/scope-reconception/README-CODEX-TAKE.md)
is available for review. It does not pass the design gate by existing; its unresolved
layout, interaction and broader PostHog adoption limits are recorded explicitly.

## The product

**One project map of components and guarantees, with change review as an overlay.**

At a glance: what are the major parts, what do they promise, what changed, and which
promises deserve attention? Selecting or expanding something adds detail to this map;
it does not replace the project with a different view.

The previous attempts failed this test. The assembly canvas privileged imports; path
cards replaced geography with a reading list; the region experiment privileged one
component and two functions. None is a satisfactory main Scope view. Do not add a fourth
Structure switch. Replace these experiments with one coherent surface after design approval.

## What the code audit establishes

Read-only measurement against Coherence's current worktree: **12 canonical components,
89 local guarantees, 56 import-derived relations, 6 declared guarantee links, and zero
catalog bindings**. Components include a project frame, ten assemblies and one evidence
surface. The query-cache assay has five components, two local guarantees and two bindings.

These counts were obtained from `projectGuarantees(await loadConfig(process.cwd()))`,
counting its nodes, guarantees, relations, guaranteeLinks.links and catalogBindings.items.
They are observations of this worktree, not permanent expected totals.

Consequences:

- The main map must work with local spec guarantees, not require catalog adoption or `flow`.
- A binding enriches a local guarantee; it is not another guarantee to count or another node.
- The tiny PostHog slice is an interaction fixture, not a sufficient project-overview test.
- Structural history already exists. Its implementation needs careful extension, not a
  parallel browser diff engine.

## One screen and its information budget

```text
Scope / project        Compare: Current | Working changes | A → B    Find
───────────────────────────────────────────────────────────────────────
Review frame, when active: exact endpoints · expected scope · limitations
───────────────────────────────────────────────────────────────────────
                                                                       
                  PROJECT MAP — the primary surface                     
                                                                       
    [component region] ── declared consumed promise ── [component region]
       purpose                                                purpose  
       internal guarantee marks + selected titles             marks    
                                                                       
              [expanded component, in its existing place]               
                  subjects and internal guarantees                     
                                                                       
    [unchanged region]                   [removed region, in review]    
                                                                       
───────────────────────────────────────────────────────────────────────
Attention: contract edits · changed evidence inputs · unknown reach      
                                                                       
Selection opens a temporary inspector at the side; the map stays mounted.
```

The map gets almost the whole screen by default. No permanent evidence sidebar,
two-function centerpiece, or prose catalog. Hooks, Journal and Taxonomy retain their
existing tabs; Structure has no alternate map/path/region selector.

### The component region

Every region has a readable title, a short purpose from the existing spec, compact
monospace taxonomy metadata when assessed, and its guarantee population. No new briefing
field, generated synopsis or manually maintained short guarantee title.

Every local guarantee has an individually addressable mark in its owning region. A
bounded set of exact invariant titles accompanies those marks: changed/affected first
in review, otherwise failed, stale or unavailable evidence first, then stable canonical
order. State how many titles are not expanded. The full invariant is accessible by
keyboard selection and inspector, not only hover. Marks are navigation, not progress bars.

There is no component-health percentage, green component fill, or ratio of evidenced
subjects to all subjects. A neutral region with two observed passes and many unexamined
subjects remains neutral. An empty guarantee population says “no declared guarantees.”

At larger scale, collapse along canonical containment. A collapsed parent retains its
descendant component population and separate attention indicators; it does not silently
absorb their guarantees as promises of the parent. Expanding reveals child regions in
place. A component with owned code and child components retains its own promises in its
header band, distinct from descendants. Grouping is not new ownership.

At Coherence's measured scale, all ten assemblies must be represented in the initial
map. Do not force them behind a single `src` tile or a one-assembly dropdown. At greater
scale, every component must still have an addressable containing region; no arbitrary
three-provider or two-path pagination of the project's topology.

### What goes on an edge

An internal invariant belongs in its component. It does **not** require an arrow.
Only an explicit declared interaction can carry an edge guarantee:

- Existing `relies` declarations connect a consumer to a provider's local guarantee.
  Label the direction as reliance; do not imply that it is runtime data flow.
- Explicit binding `flow` endpoints reveal internal subject interactions on expansion.
  Their direction and role labels remain caller-assessed.
- Imports are optional, subdued, dashed background connections. No missing-guarantee
  warning is plastered over every import. They establish neither promise consumption
  nor propagation of a failure.

Multiple promises on the same connection are individually addressable in its bundle.
Show the selected/review-relevant promise title and the remaining count; expanding that
bundle stays on the map. Do not duplicate a symbol for each role or duplicate a guarantee
when several consumers depend on it.

### Position, expansion and continuity

The canonical center of gravity anchors the project, not the selected card or the newest
change. Arrange component regions in neighborhoods around it; disconnected areas stay
explicit. Region area follows readable content and containment, not a fictitious health
score. Preserve the gravity concept without requiring geometry that makes text unreadable.

Expanding a region reallocates nearby space while retaining surrounding component
headers and connections. Do not solve expansion by zooming until the selected component
fills the screen. If all detail cannot fit, retain a project-context overview and reduce
internal detail, with explicit counts; do not erase the neighboring components.

The inspector opens on explicit selection and preserves the camera. Closing it restores
the same map. Evidence-only changes never trigger layout. Structural changes preserve
unchanged positions as far as possible, with an explicit “Rearrange” action. Review pins
baseline geography so removals and a moving center do not reshuffle the evidence.

## Change review: the same map, a selected comparison

### Exact comparison meaning

| Selection | Meaning |
| --- | --- |
| Current | Present project; no implied comparison or expected scope. |
| Working changes | HEAD versus current tracked working-tree contents, plus non-ignored untracked paths. Staged and unstaged presence is also reported separately. A staged edit canceled in the worktree is disclosed, not silently lost. |
| Staged | HEAD versus the index snapshot, without unstaged contents leaking into it. |
| A → B | Two resolved immutable Git revisions; exact commit/tree identities shown. |
| Branch review | Explicit merge-base(base, head) → head, with the resolved merge base shown. Never silently substitute this for A → B. |

Git-less projects still have Current. Unborn HEAD offers an explicitly labeled empty
baseline for adoption; it is not an existing historical project. Bad refs, missing
history, unsupported configurations and failed reads are unavailable comparisons,
never “nothing changed.” Commit comparisons stay pinned; working comparisons update live.
An external patch without resolvable trees is outside v0: a patch alone does not supply
the full ownership/spec population needed to render the two sides honestly.

### Three separate questions

| Mark | Evidence for marking it | What the reader must consider |
| --- | --- | --- |
| Implementation changed | Changed file belongs to this component on either side. | Does this edit preserve its responsibilities? |
| Contract changed | Local declaration, anchor, oracle, crossing, binding scope/parameters, catalog definition or consumed-guarantee link changed. | Was the promise or its enforcement intentionally changed? |
| Supporting input changed | A changed path is an explicitly pinned input, resolved enforcement source, or resolved oracle source. | What evidence is needed for the changed input set? |

A prose-purpose or taxonomy change is also shown as metadata/applicability change,
not mislabeled as implementation or behavioral-contract change. A verification record
change alone is evidence-publication news, not an implementation edit.

Marks compose: one guarantee may have changed its contract and supporting inputs.
Review markings are independent of recorded pass/fail/stale/unverified states. Keep
their legends and shapes distinct, usable in greyscale. “Changed since base” remains
true after a rerun; an exact supported target run can satisfy the renewal question
without concealing that the guarantee changed.

### Which guarantees need attention

Each attention item carries a navigable reason: changed path and hunk, before/after
declaration, pinned input match, resolved chokepoint, named test location, or explicit
consumer link. Default order: removed/changed contracts; direct supporting-input edits;
declared consumers of changed contracts; changed components with incomplete input maps.

Do not recursively flood the import graph. An explicit consumer of an altered contract
gets “review this reliance,” not “consumer guarantee failed.” An edited file elsewhere
in the same component establishes component change but not direct guarantee impact.
Where there is no dependency map, show “guarantee impact unknown in this changed component.”
No direct match means “no direct match found,” not “unaffected.”

Pinned-input changes are whole-file observations at the current grade, even for a
comment-only edit. Hunk overlap may prioritize an item but cannot override the verifier's
freshness rules. Root config, grammar, runner and definition changes name their broader
input effect. Unsupported/dynamic oracle resolution remains unknown.

The current PostHog assay pins a broad file set into both bindings. A change to any
such file can affect both readings. Show that explicit breadth; do not pretend this
fixture proves precise semantic impact analysis. Improving pins is a separate assessment.

### Additions, removals and matching across revisions

Render the union of both endpoint populations. Added regions enter beside their owners;
removed regions and guarantees remain as struck/outlined baseline objects with their
old relationships. Ownership moves mark both old and new owners.

Existing guarantee references hash owner, invariant, anchor, oracle and crossing.
Binding IDs also change when their declaration changes. Therefore identity equality
alone cannot detect “the guarantee was edited.”

First preserve exact matches. Then compare full per-owner populations using unchanged
invariant text and unique anchor/oracle correspondences to propose bounded pairings.
Label the matching basis. Ambiguous or simultaneous identity changes remain explicit
removed/added declarations with an unresolved pairing; never guess silently or transfer
passing evidence through a guessed match. Matching is review metadata, not a new evidence ID.
Do not key components by title or collapse several boundaries sharing an invariant.

Path moves use Git rename evidence as a labeled heuristic, not guaranteed semantic
identity. Splits, copies, duplicate titles, and unmatched removals must conserve both
populations. Files outside modeled ownership stay visible as unmapped changes.

### Expected scope

Expectation is optional, caller-supplied data: component/guarantee addresses, who selected
them, why, and which review endpoints they concern. Explicitly selected work-order scope
can be offered as an input, never guessed from the nearest session or the resulting diff.

Overlay expected-and-touched, touched-outside-expectation, and expected-but-not-touched.
The last is a review question, not proof of incomplete work. Expired/missing expectation
addresses remain visible. Default is “expectation not supplied.”

Initial selection is local, read-only UI state. Saving or sending a review to an agent
uses an existing attributable CLI/journal path; do not introduce a browser writer or
an automatic approval ledger. A specific counterexample retains its guarantee and
comparison addresses. Recorded and delivered remain separate facts.

## Implementation seams and missing work

| Existing home | Reuse | Required work / limit |
| --- | --- | --- |
| [scope-model.ts](src/readings/scope-model.ts), [promise.ts](src/readings/promise.ts) | Canonical components, purpose, containment, gravity, local guarantees and recorded verdicts. | Add a separate review projection; do not create another authority in JSX. Preserve every local guarantee, including unbound ones. |
| [guarantees.ts](src/verification/guarantees.ts), [guarantee-bindings.ts](src/verification/guarantee-bindings.ts) | Explicit consumption, applicability, flow endpoints and input-bound observations. | Separate declaration changes from live evidence changes; index explicit inputs for review reasons. These are not complete dependency maps. |
| [structural.ts](src/diagnostics/structural.ts) | Historical tree access, ownership helpers and structural comparison. | Current ledgers key components by title and boundaries by invariant, losing multiplicity. Review needs full canonical populations. Filename lists are newline-split and some Git failures become empty output; require checked, NUL-delimited records. Extend the shared mechanism with compatibility tests, not a divergent diff implementation. |
| [context.ts](src/readings/context.ts) | Changed/staged selectors and focused source context. | Its heuristic test relevance and one-hop imports cannot become direct guarantee impact evidence. |
| [index-model.ts](src/readings/index-model.ts) | Explicit attention budget, unavailable sources and withheld-tail discipline. | Reuse those conventions without importing a second health score or separate review page. |
| [server.mjs](scripts/scope-preview/server.mjs), [live.jsx](scripts/scope-preview/live.jsx) | Read-only live transport, pause/resume and damage disclosure. | Publish a versioned comparison packet; cache the immutable baseline, refresh the working target coherently, preserve the last successful frame as visibly stale on errors. |
| React Flow and layout dependency | Rendering, compound nodes, selection and edge routing. | Replace view-specific scenes with one hierarchical map and semantic detail levels. Select layout parameters against approved fixtures; no bespoke collision/routing engine. |

Two historical worlds must be derived using their own source, specs and configuration,
but the selected current Coherence implementation. Record the derivation version and
unsupported configuration differences. Do not run historical tests or executable project
configuration/adapters merely because a reviewer opened a diff. The existing graphAtRef
path loads configuration in a temporary worktree; audit its trust crossing before reuse.
Use inert configuration and built-in adapters by default, explicit refusal otherwise.
Any separately authorized executable derivation occurs through the CLI with disclosure.

Keep repository reads and Git outside the pure review join and browser. Resolve refs
as data, use argument arrays and literal path handling, disable external diff/textconv,
bound blob and patch sizes, and treat symlinks, binary files and submodules explicitly.
No checkout of the user's working tree or arbitrary shell commands from the browser.
Working-tree capture is not transactional: detect conflicting reads and retry or report
unavailable. Render diff/source text as untrusted text and disclose exported local content.

The output is one canonical review packet containing endpoint identities, both subject
populations, correspondences, reasons, uncertainty and independently qualified evidence.
A saved self-contained HTML embeds that packet and layout; live serving is optional.
Identical frozen input must regenerate byte-identically. No render timestamps or hidden
browser evidence computation. Historical missing run records stay missing; today's record
cannot supply a historical pass or a stronger freshness claim than its recorded inputs.

## Acceptance before construction

### Design entry gate: populated examples, not another implementation

Prepare non-executable wireframes/storyboards using:

1. Coherence's actual 12-component / 89-guarantee population, including unbound guarantees.
2. The PostHog query-cache slice, proving internal guarantees need not all be external edges.
3. A broader inspected PostHog subsystem set, selected for multiple real ownership seams,
   shared resources and both internal and inter-component promises. Freeze its inventory
   and completeness limits before drawing; do not invent promises to fill the canvas.
4. A clearly synthetic density fixture with 30+ components, dense links and long titles,
   for geometry only—not guarantee validity or portability evidence.

Freeze one real review diff and controlled counterexamples before implementing impact
logic. Include an unrelated edit, a changed pinned helper, oracle rename/deletion, local
contract removal, repeated-invariant boundaries, component move, new untracked file,
staged/unstaged divergence, root configuration edit, and missing historical configuration.
State expected populations and reasons independently of the proposed renderer.

If the wireframes still require choosing one component before understanding the project,
or the broad PostHog inventory cannot support the claimed relationships, this gate fails.
Revise the design or explicitly bound the data claim; do not advance by decorating it.

### Correctness gates — mandatory

- Both endpoint component/guarantee populations equal their canonical models, including
  deleted subjects, duplicate titles, malformed bindings and guarantees without bindings.
- Every marked item has a reproducible reason; every changed path is mapped or explicitly
  unmapped. No import-only edge becomes proved impact or a satisfied guarantee.
- Missing comparison data cannot emit “no change.” Unread evidence cannot emit a pass.
- Contract edits cannot inherit input-bound support via matching. Repeat-invariant
  boundaries survive as separate anchors. Broad input pins remain visibly broad.
- Index and worktree comparisons use their actual contents; staged reversals are visible.
- Frozen exports repeat exactly. Live evidence updates preserve geometry and camera.

Negative controls deliberately remove changed-input matching, suppress a deleted guarantee,
and collapse duplicate identities. The corresponding population/reason tests must fail.
Keep recorded refutations with the owning shared mechanism when implemented.

### Quality acceptance — separate from correctness

At 1440×900 and 1920×1080, inspect Safari/WebKit and Chromium with real content. At
Coherence's scale, all assemblies are represented initially; component titles and exposed
guarantee titles have at least 14px effective screen text. No clipped or covered labels,
forced single-component view, or vanished unaffected context after expansion.

Have the user or a reviewer not implementing the view answer: which components changed,
which promises changed versus only their supporting inputs, what disappeared, what was
outside the stated expectation, and what Scope cannot establish. Target each answer
within 30 seconds without leaving the map; any false assertion of safety is a failure.
This is an acceptance target, not a result already measured.

Measure initial readable render, pan/zoom frame times and live-update latency on the
actual hardware, including the 30+ component fixture. Target 60fps interaction, with
p95 frame time no worse than 20ms during a defined 10-second gesture. Report traces and
remaining gaps separately; do not waive correctness because layout looks good, or describe
the performance target as a portability guarantee.

## Sequence and stop points

1. **Approve this reconception and its populated wireframes.** No renderer, CLI or model
   changes before that. Resolve whether the default map actually answers the user's
   question, rather than treating the existing prototype as the layout baseline.
2. **Freeze comparison fixtures and expected readings.** Audit the existing historical
   reader, identity loss and evidence grades. Determine supported historical configuration
   scope before promising a review UI over it.
3. **Build the shared review projection, then pass correctness gates.** Plan exact CLI
   flags/schema with their owning command; review lifecycle instructions if new public
   agent-facing commands are introduced. No automatic verification or approvals.
4. **Replace Structure with the one map.** Reuse libraries, component content and inspector.
   Add expansion and the review overlay to that map. Remove the competing Structure
   switches and obsolete per-view layout/paging implementations after parity is proven.
   Preserve useful guards and historical experiment documents, not duplicate product modes.
5. **Run the review walkthrough and publish one default artifact.** Keep the live and
   offline forms equivalent. Report correctness, usability and performance independently.

Not included: automatic guarantee invention, semantic call-graph discovery, immutable
receipts, inferred author intent, automatic reviewer sign-off, or a new layout engine.

The next approval is for the main-view composition and review vocabulary above—not for
another implementation swing. The graph succeeds only if it explains the project first
and reveals the selected change within that context.
