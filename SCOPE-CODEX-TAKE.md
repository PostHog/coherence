# Scope: Codex's take

Date: 2026-09-04

Status: design discussion; no implementation

## Thesis

Scope should be a live projection of Coherence's machine-readable state, with a narrowly controlled path for human observations to return to the append-only record.

It should reveal:

- the active project's components as they were authored and derived;
- boundaries, assemblies, guarantees, and their evidence state;
- the live journal and its settled history;
- deterministic, project-specific inspection catalogs;
- human notes and flags attached to stable project subjects.

Scope must remain a reading surface and control interface, not a second source of architectural truth or a second verifier.

```text
repository + records
        |
        v
 canonical Coherence models
        |
        v
  Scope projection
        |
        +-- visual state
        +-- catalog views
        +-- human annotations --> CLI-owned append-only record
```

The browser should never directly edit specs, configuration, generated graph files, or journal JSONL.

## Existing integration points

Scope does not need another repository walker.

- `buildGraph` in `src/derive.ts` is the canonical structural ingress. Its graph already contains components, files, symbols, imports, external modules, infrastructure, claims, invariants, and refutations.
- `GraphNode` and `GraphEdge` in `src/types.ts` are the natural canvas substrate.
- `buildPromiseModel` in `src/promise.ts` joins guarantees, chokepoints, grades, reliance, and recorded verification.
- `buildIndexModel` in `src/index-model.ts` performs useful human-facing joins across components, crossings, journal state, change frames, darkness, and trajectory.
- `tailJournal` in `src/journal.ts` already provides a compaction-safe, exactly-once live feed.
- `readJournal` in `src/decisions.ts` provides settled history.
- `contextFor` in `src/context.ts` is the downstream seam for turning selected visual subjects into bounded agent context.
- `runPanel` in `src/panel.ts` provides precedent for a live operator surface over graph and status changes.

Introduce a pure `ScopeModel` composed from those existing models:

```ts
interface ScopeModel {
  project: ProjectIdentity;
  revision: RevisionIdentity;
  subjects: ScopeSubject[];
  relations: ScopeRelation[];
  guarantees: ScopeGuarantee[];
  evidence: ScopeEvidence[];
  annotations: ScopeAnnotation[];
  catalogs: ScopeCatalogResult[];
  sources: SourceReading[];
}
```

Every visual item should carry a stable subject identity, source provenance, observation revision, freshness, and applicable confidence or grade. It should also say whether it is authored, derived, recorded, or merely a visual grouping. “As written” must not blur authored components with inferred relationships.

## Canvas technology

For an initial implementation, use React Flow with a deterministic layout engine such as ELK.

React Flow supplies selection, dragging, zooming, custom nodes, handles, and edge interaction while leaving Scope's semantics to Coherence. That suits components that open inspectors, receive flags, and expose guarantee badges.

Alternatives have narrower fits:

| Library | Best fit | Scope tradeoff |
| --- | --- | --- |
| React Flow | Interactive architecture canvas | Best product ergonomics; layout remains Scope's responsibility |
| Cytoscape.js | Graph-first visualization and compound graphs | Strong topology and layout model; less natural for rich application cards |
| Sigma.js | Thousands or tens of thousands of nodes | Excellent WebGL scale; less suitable for document-like component nodes |
| tldraw | Freeform collaborative whiteboard | Excellent spatial interaction; Scope would need to build graph semantics and routing itself |

The preferred initial combination is:

- React Flow for component and boundary exploration;
- ELK for reproducible layouts;
- a virtualized list or table for symbol-scale populations;
- no persistent user-authored geometry in the first version.

The same model and layout configuration should produce the same initial positions. A changed picture should indicate a changed project, not a physics simulation settling differently.

## Visual language

### Components

Components are the primary nodes. A component card can show:

- name and authored intent;
- file and symbol counts;
- passing, failing, stale, and unknown guarantee counts;
- whether it owns a boundary;
- recent journal activity;
- unresolved human flags.

Files and symbols should appear through semantic zoom or drill-down rather than as thousands of permanently visible nodes.

### Boundaries

Boundaries should be first-class edges and visually distinct from ordinary imports:

- ordinary dependency: thin neutral line;
- declared boundary: heavier directed line;
- trust or security crossing: colored or double-stroked line;
- unguarded reliance: dashed warning line;
- failed or stale evidence: interrupted or red line;
- inferred relationship: visibly lower-confidence style.

Selecting a boundary should reveal its contract, chokepoint, oracle, verdict, provenance, and dependent components rather than only its endpoints.

### Guarantees

A generic green shield would discard too much information. Guarantee state includes:

- declared versus proposed;
- anchored versus unanchored;
- oracle bound versus absent;
- qualified versus unqualified;
- passing, failing, stale, skipped, or unknown;
- claim scope and freshness scope.

A compact component halo can summarize the state, while the inspector preserves the complete evidence chain. Absence must never look like success.

### Assemblies

Assembly is not currently a canonical graph entity. Initially, treat it as a named projection over existing subjects:

```json
{
  "id": "request-ingress",
  "label": "Request ingress",
  "members": {
    "components": ["api", "auth"],
    "boundaries": ["authenticateRequest", "dispatchEvent"]
  }
}
```

An assembly hull must disclose whether it came from an authored project catalog, a deterministic structural query, or a transient user selection. These sources should not share identical visual treatment.

## Live architecture

`coherence scope` could start a loopback-only server with a small protocol:

```text
GET  /api/snapshot
GET  /api/events
GET  /api/subject/:id
POST /api/annotations
POST /api/annotations/:id/resolve
```

Use Server-Sent Events before WebSockets. The dominant live flow is server to browser; reconnection and event IDs are built in; annotations can use ordinary authenticated POST requests.

Events should announce invalidation rather than become another source of truth:

```ts
type ScopeEvent =
  | { kind: "snapshot-replaced"; revision: string }
  | { kind: "journal-appended"; recordId: string }
  | { kind: "verification-recorded"; claimId: string }
  | { kind: "annotation-appended"; annotationId: string }
  | { kind: "source-damaged"; source: string; reason: string };
```

On source changes, the server rebuilds the canonical model and publishes a content-addressed snapshot. Incremental UI updates are an optimization; identity still comes from snapshots and append-only records.

## Human feedback

Human notes are observations, not guarantees or verdicts.

```ts
interface ScopeAnnotation {
  id: string;
  subject: SubjectReference;
  kind: "note" | "question" | "concern" | "review-required";
  text: string;
  actor: HumanIdentity;
  at: string;
  revision: string;
  status: "open" | "resolved" | "superseded";
}
```

Subject references should support components, symbols, boundaries, guarantees, and authored assemblies. They need both a stable identity and enough repository-relative evidence to detect expiration.

The browser should submit an intent to the local server. The server should call the same owned operation exposed by a CLI command such as:

```text
coherence annotate <subject-id> \
  --kind concern \
  --text "Authentication must precede session lookup"
```

This retains schema validation, actor and repository attribution, path protections, append-only history, and resolvable rather than erasable notes.

A user flag should not automatically be called “delivered to the agent.” Scope can expose it through:

- the next bounded context packet touching that subject;
- SessionStart or post-edit hook payloads;
- an external orchestrator that explicitly supports active-session delivery;
- a visible “send to agent” action whose transport and result are recorded.

“Recorded” and “delivered” must remain separate states. Hooks remain delivery channels, not supervisors.

## Bespoke inspection catalogs

Catalogs should come in two grades.

### Declarative catalogs

Prefer project data interpreted by a core-owned query vocabulary:

```json
{
  "id": "request-lifecycle",
  "title": "Request lifecycle",
  "subjects": {
    "componentKinds": ["component"],
    "boundaryKinds": ["auth", "dispatch", "storage"]
  },
  "groupBy": "atlas.chart",
  "mark": [
    { "when": "guarantees.fail > 0", "style": "breach" },
    { "when": "evidence.stale > 0", "style": "stale" }
  ]
}
```

Unknown fields, selectors, or strategies should refuse rather than silently disappearing.

### Executable adapters

Add executable adapters only where the declarative grade proves insufficient. An adapter should be a deterministic function over a frozen, versioned `ScopeModel`. It should produce catalog results rather than read the filesystem or run commands itself.

Its output should name:

- adapter identity and version;
- input snapshot digest;
- result digest;
- declared approximations;
- diagnostics;
- no verdicts.

Running the same adapter twice over the same frozen input should be a parity check. Nondeterministic output should refuse publication.

Project-specific extractors that need files, subprocesses, or network access belong upstream in Coherence's established adapter or probe mechanisms. The visualization adapter must not quietly become another repository ingress.

## Security boundary

A browser that can cause repository writes is a new trust crossing. Even when bound to localhost, Scope should require:

- a random per-process capability token;
- exact origin validation;
- loopback-only binding by default;
- no arbitrary filesystem paths in requests;
- no arbitrary command fields;
- size and character limits for notes;
- terminal-safe and HTML-safe rendering;
- CLI-owned append operations;
- explicit disclosure when a project adapter executes code.

Opening a generated static HTML artifact is currently low-authority. Running Scope is materially different and should be presented as such.

## Implementation path

### Increment 0: static parity prototype

Render `Graph` and `PromiseModel` into a read-only canvas. Add a parity test proving that Scope's component, boundary, and guarantee populations equal the canonical models. Do not add a journal server, adapters, or annotations.

### Increment 1: live read surface

Add the loopback server, snapshot identity, source invalidation, and the existing journal tailer. Prove that journal entries appear exactly once across append and compaction.

### Increment 2: human annotations

Introduce one record type and two operations: append and resolve. Support component and boundary subjects first. Keep annotations outside verification and closure.

### Increment 3: agent-context integration

Extend bounded context selection so unresolved annotations attached to selected subjects appear with provenance. Measure whether agents see and correctly interpret them before adding active delivery.

### Increment 4: declarative catalogs

Introduce one catalog motivated by a real project need. Validate deterministic output and model parity before adding an extension API.

### Increment 5: executable adapters

Add these only after declarative catalogs encounter measured insufficiency. Their narrower output authority matters even if Node cannot fully sandbox project code.

### Increment 6: spatial authorship, if warranted

Persistent layouts, user-created assemblies, and collaborative cursors come last. They introduce canonical-state questions that the initial visualization does not need.

## Open design questions

1. Which subject identity remains stable enough across file and symbol moves to anchor an annotation?
2. Is an assembly authored project state, a catalog projection, or a user-local workspace object?
3. Which human identity mechanism is appropriate for a local-first tool?
4. Who may resolve another person's concern, and what does resolution mean?
5. Should annotations join the decision journal or inhabit a distinct append-only ledger with a merged reading surface?
6. What is the largest useful canvas population before Scope should aggregate or switch rendering strategies?
7. Which existing evidence states deserve visual prominence without manufacturing a misleading composite health score?
8. How does Scope distinguish a stale subject reference from a deleted subject that fulfilled its purpose?

## Central constraint

Scope should reveal Coherence's state without laundering presentation into authority.

A green visual mark means that the canonical evidence model reports a fresh pass at a named scope; it does not mean the canvas judged the code safe. A human flag means someone recorded a concern; it does not mean a claim failed. An assembly means subjects were grouped by a named projection; it does not necessarily mean the repository declares that architecture.

Maintaining those distinctions would make Scope the human control surface Coherence is currently missing: the graph explains what exists, the promise model explains what is protected, the journal explains why it changed, and annotations let a human place attention back into the system.
