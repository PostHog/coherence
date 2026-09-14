# Reviewing Structure through Coherence

This is the first current-state prototype from the [Structure thesis](scope-structure-thesis.md).
Its acceptance question is: **can a reader use the map to explain what Coherence is,
how it is entered, which responsibilities compose it, and what supports its promises?**
Passing automated checks cannot answer that question for the reader.

Implementation is local in `coherence-scope-local` on `wip/scope-declarative`. The
source-supported declarations are listed in [the inventory](scope-coherence-inventory.md).
The renderer contains no Coherence component names or paths.

## Open the prototype

From the local Scope worktree:

```sh
npm run build
node src/cli.ts scope
open public/_scope.html
```

The generated HTML is an offline snapshot. To inspect changes as they arrive, use
`node src/cli.ts scope --serve` and open its printed loopback URL. Scope reads existing
observations; opening the viewer does not run the project's tests.

## Read the project story

1. Read the purpose above the canvas. Coherence turns authored responsibilities and
   promises into a shared source model, checks declared claims, and retains evidence
   for the next person or agent. The root component's narrower repository-reading
   responsibility is different from this project purpose.
2. Select **Explore or check a project**. This entrance belongs to **Harness core**.
   Follow **Requests the project model** to **Source derivation**, then
   **Delegates language interpretation** to **Source adapters**. These relationships
   explain the delegation of responsibility. They do not assert that every command
   derives a graph or that a syntactic import proves behavior.
3. Follow the graph's consumers: **Verification** receives subjects and claims;
   **Diagnostics and ratchets** combine graph subjects with observations and baselines;
   **Taxonomy** addresses subjects for classification; **Reading surfaces** make the
   model navigable. Select a connection to read its authored rationale and participants.
4. Follow **Records scoped verdicts** from Verification to **Durable evidence**, then
   **Informs the next action owed** to **Coordination**. Evidence contributes to a
   decision about what action is owed; it does not itself authorize that action.
5. Select **Start an agent session**. **Agent lifecycle** receives assigned work
   context from Coordination and preserves session continuity with Durable evidence.
   This is the other entrance into the same project, not a second implementation of it.

## Open the architectural detail

Unfold **Source adapters** and inspect **a parse's heap is returned before the next
file**. This promise describes the tree lifetime owned by `withTree`; its enforcement
references, recorded result and refutation belong to that promise. A nearby passing
result must not color the entire component as safe.

Unfold **Source derivation** and **Reading surfaces**. The explicitly declared reliance
on **spec containment follows declared ancestry without inventing dependencies** is
more precise than the general **Makes architecture navigable** relationship. The
consumer relies on this specific provider promise. Expansion should make that precision
visible while preserving the enclosing stack relationship.

Zoom out to tiles and back into detailed cards. The component identity, explicit
expansion state and selection should survive. Extra detail should answer architectural
questions: promises, owned boundaries, named entrances and resources. Files belong in
evidence references and IDE navigation, not as a fallback population on the map.

Inspect taxonomy in the component sidebar as observations about exact owned subjects.
Stale, candidate and unavailable states are not applied component classifications.
Inspect separate oracle readings when one invariant has several enforcing claims.

## Evidence limits visible in this checkout

The local branch inherits an experiment ledger whose session
`01a08c58-88ce-7850-b89a-706cfe57c262` begins at ordinal 5. Its strict reader refuses
rather than interpreting the surviving population as complete. Scope must show the
experiment source as unavailable while retaining other readable architecture. This
prototype does not repair that unrelated historical gap.

Changes in the local checkout also make several previously recorded guarantee and
taxonomy readings stale. Those readings are useful history, not current verification.
The first prototype has no comparison mode or Scope-control MCP yet. Ghosted removals,
broken connections and change-story navigation remain required later work.

## Review evidence

`node scripts/scope-structure-check.mjs` captures this checkout and a differently named
Orchard dispatch fixture. It retains offline HTML, overview/detail/relationship screenshots
and a JSON report in a temporary review directory printed on completion. Set
`SCOPE_REVIEW_DIR` to choose that directory. These checks cover rendering, selection,
zoom/expansion independence, declared edges and offline behavior. Generic graph and
live-update coverage remains in `scripts/scope-browser-check.mjs`.

The user review remains open: does this map explain Coherence, and which step of the
story still requires knowledge that the map fails to supply? Record that answer before
calling the first comprehension gate complete.

## Validation record — 2026-09-14

The integrated semantic, capture, configuration, renderer, layout, derivation and
promise-model suite passed 31 focused tests. Typechecking and the production bundle
build passed. The generic graph browser checks also passed offline configuration,
inspector, live updates, pause/resume, damage recovery, HTTP-boundary and mobile checks.
The generated navigation maps were rebuilt and `docs --check` reported current.
`guarantees --check` returned nonzero for three expired caller-assessed `addresses`
mappings. All three declared consumer `relies on` links remain current. The existing
assessments were not refreshed merely to make the check green; Scope preserves their
stale state.

Review screenshots led to corrections for purpose/entrance text, bubbling selections,
clipped previews, per-oracle inspection, relationship labels and focus, missing detail
navigation, and tab-switch zoom restoration. The final Structure browser run checks
the real project and fixture, including two opened guarantee-connected stacks and
selection/expansion continuity. The user comprehension assessment remains pending.
