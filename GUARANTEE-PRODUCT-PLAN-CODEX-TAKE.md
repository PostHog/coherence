# Reusable guarantees as a Coherence product — Codex's plan

2026-09-09. Revised after review. Planning only; no implementation, assay execution or
rollback is performed by this document. The portability premise remains unproven.

## Outcome

The hypothesis is that Coherence can supply a useful portable vocabulary of guarantees.
A reader encounters **Input validation**, **Deterministic output**, or **Projection
fidelity**, not a different set of implementation-specific sentences in each repository.
Projects supply the subjects, scope and evidence that make those contracts concrete.

The useful chain is:

**Taxonomic assessment → applicable standard guarantee → scoped project binding → oracle evidence.**

These are distinct facts. A definition is not a promise already fulfilled, an assessment
is not proof of applicability, and a passing project test is not proof of the entire
standard guarantee. A guarantee need not describe a connection: many are properties of
a subject. Filling every import arrow is not the adoption criterion.

## What exists, and what we retain

The current `src/taxonomy/taxonomy-catalog.ts` contains 25 roles, 27 facets and 53 guarantee
suggestions: **17 core and 36 simulation-specific**. Core entries currently have only
`id`, `pack`, `level`, `when` and `text`. The classifier activates them by an exact selected
role/facet match. Eight core roles have no role-specific suggestion; that is an audit
finding, not permission to invent eight more guarantees—facets may already cover them.

Useful foundations already exist:

- Evidence-addressed file/symbol assessments and explicit caller attribution.
- Content-addressed revisions, predecessor checks and stale/damaged-history handling.
- Stable project boundary references and explicit `addresses` bindings.
- One resolver shared by CLI and Scope, with oracle evidence kept separate.
- Live Scope updates and retained camera/layout state.

The mistake was promoting local boundary statements into the primary guarantee vocabulary.
The current 83 project boundary claims are concrete contracts, not evidence by themselves;
their oracles and recorded outcomes provide evidence. The 115 consumer declarations from
the subsequent adoption pass are not a reusable guarantee catalog.

## 0. Test the premise before building the product

The lab's [Terra assay](../../simearth-bakeoff/coherence-lab/results/component-classification-terra-all-projects-v1/SYNTHESIS.md)
scored 9/17 against a 14/17 gate, recovering 8/14 expected roles and 6/12 projects.
The [hybrid repeat](../../simearth-bakeoff/coherence-lab/results/component-classification-hybrid-all-projects-v1/SYNTHESIS.md)
reached 12/17, emitted 16 results and regressed one control. These are classification
results, not measurements of guarantee portability. They nevertheless rule out assuming
reliable taxonomy-driven activation. The 17 `core` labels and 36 `simulation` labels are
provenance, not demonstrated domain boundaries. Audit all 53 for misplaced generality,
domain assumptions and duplication; promotion and demotion can cross that partition.

### Frozen rejection assay — entry criterion for product implementation

This is a proposed preregistration, not a completed test or a statistical universality claim.
Do not implement new catalog, binding or UI machinery to run it: use candidate documents,
source dossiers and a scored matrix. The original three authored fixtures become later
regression tests only; they cannot establish portability.

1. Retain all 17 existing lab cases as a known stress set, including its weak families.
   Do not call them held out. Before drafting candidate contracts, a curator other than
   their author freezes additional real-project subjects, repository revisions, selection
   reasons, source dossiers and expected relevant properties. Selection starts from
   observed responsibilities and failure modes, not matches to proposed guarantee text.
   If an independent curator/reviewer is unavailable, report the assay blocked; do not
   quietly substitute the author's examples.
2. For each family proposed for promotion, require at least six relevant subjects across
   three projects and two application domains, plus three non-applicable near-neighbors
   from at least two projects. This is a minimum heterogeneity screen, not a confidence
   estimate. Insufficient population means **defer**, not pass. Freeze every case and its
   inclusion before inspecting candidate outcomes; no deletion of awkward cases.
3. Freeze definition, applicability rule, scope-parameter schema, clauses and falsifiers.
   Two separately working reviewers map the dossiers to it without changing those bytes.
   A passing positive preserves the observed local property using only declared parameters,
   without bespoke clauses, prose escape hatches or weaker falsifiers. Each mapping must
   distinguish a concrete conforming and violating observation. Disagreement, missing
   evidence and no result stay in the denominator as **unknown**, not success. A project
   violating a faithfully represented contract is a successful representation, not a
   failure of portability; needing to change the contract's meaning is the failure.
4. Promotion requires all six or more frozen positives representable and all three or more
   negatives correctly excluded, with agreement on scope and clause meaning. These deliberately
   strict small-sample thresholds limit premature promotion; they do not establish universal
   validity. Any counterexample rejects the current revision. A revised candidate needs a
   new frozen round retaining prior failures and adding fresh cases; no post-hoc gate edits.
5. Score activation separately: supply reviewed roles/facets to test the rule, then use
   agent-produced assessments on the same dossiers to test the end-to-end path. Every case
   must produce a result or explicit unknown; false activation or missed applicable cases
   blocks claiming dependable taxonomy-driven suggestion for that family. A definition
   may remain usable through explicit attributed selection if the contract passed but
   activation did not. Do not average definition success over classifier failures.
6. Test usefulness, not just representability: on a frozen scoped-comparison task per
   positive case, separate readers use either local contracts alone or local contracts plus
   the candidate definition. Freeze questions and correct scope/falsifier answers first;
   alternate condition assignment and keep readers from seeing both versions of a case.
   Promotion requires at least two corrected answers in different projects, no previously
   correct answer made incorrect, and no new whole-component safety inference. Record
   reading time and disagreements descriptively. No improvement means retain as a candidate,
   not promote because the same ID could be printed everywhere.

The product premise fails for this slice if none of the candidate families passes both
representation and usefulness. Stop the universal-vocabulary implementation and report the
counterexamples; retain local contract navigation. If only some pass, ship only those and
name the tested limits. Four families is a test queue, not a shipping quota. Future promotion
uses this same rejection protocol, not an existence proof from one cross-project example.

## 1. Make the existing core catalog substantive

Use one resolved catalog for taxonomy and guarantees. Separate source files are fine;
independent copies of definitions, activation rules or status derivation are not.
The taxonomy classifier's suggestions and the guarantee reader must project that same
catalog. Preserve existing IDs where meanings survive.

Each core guarantee definition needs:

- Stable identity, revision, short readable title and a precise statement.
- A bounded applicability rule over registered roles/facets.
- Scope requirements: what input domain, state authority, observable output or boundary
  must a project name before the contract has a determinate meaning?
- Individually addressable clauses, each with a falsifying observation and an evidence
  recipe. Recipes state what an oracle must exercise; they are not shell commands.
- Explicit limits and non-goals, including properties this definition does not establish.

Do not turn compound prose into a single green badge. For example, persistence currently
combines authority, rebuildability and recovery. An oracle demonstrating recovery must
not silently discharge the other clauses. A binding can address one clause or part of it;
that limitation must survive rendering.

### Initial editorial pass

Audit all 17 existing core families rather than start a new speculative catalog:

| Family | Portable question the definition must settle |
| --- | --- |
| Boundary | What is accepted, what is rejected, and what happens on rejection? |
| State / registry | Who may change authoritative state, and how are invalid or stale references handled? |
| Concurrency | Which ownership, ordering or exclusion property must concurrent operations preserve? |
| Persistence | Which data is authoritative, which is rebuildable, and what recovery is promised? |
| Lifecycle / session | What are the identities and legal start, stop, cancel, reconnect and recovery transitions? |
| Determinism / pure decision | Which effective inputs and observable outputs are compared, and which side effects are allowed? |
| Parser / projection | Which population and meaning must survive, and how are unsupported input or omissions reported? |
| Factory | When is construction complete, and what becomes visible if it fails? |
| CLI / public API | Which caller-facing inputs, outputs, failures and compatibility rules are contractual? |
| Extension | What is admitted, what compatibility is required, and how is failure contained? |
| Presentation / observability | How are unavailable/empty/failed states distinguished, and how are emitted signals bounded and attributable? |

These are grouping labels for the audit, not additional catalog identities. Distinguish
overlapping families by scope; consolidate genuinely redundant clauses instead of making
users attest to the same property twice. Existing simulation content stays opt-in while
the claimed partition is tested, not certified by its current label.

### Per-family demotion observations

These reject a definition or its claimed applicability, not a project for failing its contract.
One observed case is enough to reopen the candidate revision. Preserve the case and the
reason when moving mature → candidate/domain-only, candidate → defer, or merging duplicates.
An activation-only failure removes automatic suggestion, not an otherwise useful definition.

| Existing candidate | Observation that prevents or reverses promotion |
| --- | --- |
| G-BOUNDARY | A relevant boundary needs partial acceptance or side effects on rejection that cannot be represented without rewriting a clause: narrow the scope or defer the omnibus definition. |
| G-STATE | Legitimate replicated or multi-writer authority is classified as a defect merely for lacking one writer: demote the single-authority formulation. |
| G-LIFECYCLE | A relevant resource's legal transitions cannot fit without adding bespoke transition semantics outside declared parameters: narrow or defer. |
| G-CONCURRENCY | Mappings must invent incompatible ordering/exclusion promises rather than instantiate named clauses: split only on measured recurring subjects, otherwise defer. |
| G-PERSISTENCE | Append-only, best-effort or transactional storage requires silently dropping a required recovery/rebuildability clause: reject the compound formulation. |
| G-EXTENSION | Admission and failure-isolation meanings differ across tested host boundaries in ways the declared scope cannot express: narrow or move domain-specific clauses out. |
| G-PRESENTATION | Reviewers cannot identify the same observable misleading state without application-specific UX judgments replacing the falsifier: defer that clause. |
| G-OBSERVABILITY | A valid lossy/sampled signal is rejected by an implied completeness or attribution promise it never made: narrow activation/scope or demote. |
| G-PURE-DECISION | Every tested clause and falsifier is already represented by G-DETERMINISM plus explicit side-effect scope: consolidate, do not preserve a second badge. |
| G-CLI | CLI role alone produces contractual obligations contradicted by legitimate interactive, streaming or pipeline behavior: remove role-wide activation and narrow the family. |
| G-SESSION | All tested identity/transition properties are expressible by G-LIFECYCLE with no distinct falsifier: consolidate rather than retain role-specific repetition. |
| G-FACTORY | Valid staged/lazy construction requires changing what completion or publication means outside the declared scope: reject or narrow the definition. |
| G-API | Reviewers cannot derive a concrete compatibility obligation without inventing an undeclared compatibility policy: defer activation until policy is explicit. |
| G-DETERMINISM | Parameters can absorb any observed nondeterminism after the fact, leaving no counterexample, or declared deterministic subjects need incompatible output equivalence: reject that formulation. |
| G-PARSER | Legitimate recovery/partial parsing cannot be represented without weakening the unsupported-input or population clause: narrow or defer. |
| G-PROJECTION | Lossy transformations require bespoke preservation clauses that replace rather than instantiate the standard: move those clauses to a narrower/domain family. |
| G-REGISTRY | Its authority/reference properties duplicate G-STATE on every tested subject, or distributed naming requires incompatible authority assumptions: consolidate or narrow. |

All rows also inherit the representation, activation and usefulness rejection criteria above.
Do not preserve an unusable family by diluting it to “behave as specified.”

### Initial assay queue: four existing families

Assay boundary validation, determinism, projection fidelity and persistence first.
They exercise validation, pure comparison, population preservation and state/recovery
as a hypothesis, not established domain neutrality. Other existing entries
remain visible as **legacy suggestions**, not silently advertised as fully specified contracts.

After the assay, encode successful and failed cases as regression fixtures, including a
TypeScript request service, Python data tool and stateful library where applicable.
No custom pack can rescue a candidate's failed core-portability score.

## 2. Separate applicability, binding and evidence

An instantiated guarantee is addressed by the assessed subject, guarantee definition
revision and explicit scope parameters. Keep the current file/symbol subject grade for
the first release. A component card aggregates subjects **within** it; it does not inherit
a whole-component guarantee because one nested function has evidence.

Examples of the same definition across projects:

| Standard definition | Request service | Command-line data tool | Stateful library |
| --- | --- | --- | --- |
| Boundary validation | Reject malformed request before side effects | Reject malformed rows under a named batch policy | Refuse invalid arguments without a partial state change |
| Deterministic output | Same inputs and pinned policy produce the same decision | Same input dataset and options produce the same output | Same state and operation produce the same result |
| Projection fidelity | Response transformation preserves required identities | Conversion accounts for supported, rejected and omitted rows | A view preserves the named source identities and fields |
| Persistence | Recovery preserves the declared committed state | Interrupted output publication follows a declared recovery policy | Durable state and rebuildable caches have distinct authority |

These are scoped instances, not new project taxa or new guarantee definitions. Whether
each example applies must still be assessed; this table is not universal activation.

### Applicability rules

The actor is a named human or agent, not an anonymous “caller.” An agent may author a
proposal with subject revision, definition revision, evidence references, scope and reason.
The rule engine only derives **candidate** suggestions; an attributed applicability record
states what that assessor believes applies. It does not certify correctness or adopt a
project requirement. Inspection shows the assessor and whether any separate review exists;
a second run by the same agent is not independent review. Humans may author the same kind
of record without their authorship becoming proof either. Assay reference judgments require
separate reviewers; ordinary adoption does not silently inherit that review grade.

The distinction from satisfaction is the predicate being assessed, not who is infallible:
“this contract is relevant here” is recorded as a revisable judgment; “this contract holds”
is a stronger judgment for which this release has no satisfaction protocol. Neither becomes
a machine-established fact. Explicit project commitment additionally requires authorized
adoption in project policy/specs; agent applicability alone cannot impose it.

- Derive candidates from selected roles/facets, with the activating assessment and rule
  exposed. Do not guess from names, imports or an oracle passing.
- Use a closed declarative rule shape: alternatives of required role/facet IDs are
  sufficient initially. Do not add executable predicates or a general expression language.
- Unknown classification remains unknown applicability—not an empty healthy checklist.
  Unselected is not the same fact as assessed not-applicable.
- Current, evidence-backed facets may activate facet guarantees even while the terminal
  role is unresolved. The existing resolver's blanket classified/composite requirement
  must be narrowed accordingly; do not falsely promote the subject's role assessment.
- A stale assessment keeps its historical suggestions and separately adopted contracts visible, but cannot establish current
  applicability. Explicit exclusions, if added, require attributed reasons and freshness;
  no silent waiver or new near-duplicate decision-status ledger.

### Binding and evidence rules

Evolve `addresses` into a versioned binding that names the definition revision, subject,
assessment, scope parameters, addressed clause IDs and existing project claim references.
Keep those authored bindings in the spec, not in a second explanatory document.

**End state of the 83 local contracts:** do not maintain two parallel promise lists.
Where a standard fits, the existing spec claim becomes a scoped clause instantiation:
standard definition supplies shared meaning; the local claim owns parameters, concrete
chokepoint and oracle, with stable historical references. Eliminate separately editable
paraphrases after a reviewed semantic-equivalence migration. A partially fitting claim
keeps its unmatched local clauses explicit; never erase them to obtain a standard label.
Genuinely irreducible promises remain explicitly custom contracts, eventually expressible
through the extension schema. Those are different propositions, not duplicate vocabulary.
The migration must account for all 83 as mapped, partly mapped, custom or deferred, with
reasons. No 83/83 conversion quota, and no automatic claim-ID or oracle rewrite.

### Retire normative catalog `level`

Fifteen of the 17 current core suggestions say `mandatory`; that is inherited editorial
weight, not project authority. Freeze it in historical catalogs but remove normative `level`
from the new candidate-definition schema and live adoption labels. Do not rename it to
another severity scale. New suggestions are **candidates to assess**, not unmet requirements.
Only an explicit authorized project commitment can make named clauses required, and must
name scope and enforcement policy. Until a distinct enforcement mechanism is specified,
display “adopted contract; evidence …”, never claim mandatory compliance is checked.
`--check` continues to check references, not impose catalog recommendations as obligations.

Retain stable `g-…` references as **project claim references**, not standard guarantee IDs.
Existing bindings without clauses remain legacy, partial mappings. They cannot be upgraded
to complete coverage merely because a new definition introduced addressable clauses.

Render separate dimensions:

- **Applicability:** candidate, assessor-attributed applicable, unknown or stale.
- **Binding integrity:** current, missing, invalid or stale.
- **Clause mapping:** unbound, partial or all required clauses mapped.
- **Recorded oracle evidence:** pass, fail, stale or unknown, at its actual scope.

Do not add an overall “satisfied” state in this release. Even every clause having a passing
test is not automatic proof that the tests adequately establish the clauses. Verification
recipes make that judgment reviewable; immutable receipts and an explicit satisfaction
assessment protocol are subsequent work.

Use the existing named-oracle verification machinery. The first release supplies reusable
contracts and rigorous evidence recipes, not universal executable tests for arbitrary
programs. Where several real projects need the same executable checker, later add one
core-owned checker with an explicit input/output protocol. Do not start with project
adapter code or silently execute it during a read command.

## 3. Make Scope and the CLI speak the common vocabulary

### Scope

- Add a project-level **Guarantees** tab beside Taxonomy. Group by reusable guarantee
  family, with subject, applicability, unbound clauses and recorded evidence accessible.
- Structure cards lead with common titles such as “Input validation” and “Projection
  fidelity.” Show a bounded list and an explicit remaining count; retain Description
  access and readable typography. Local boundary prose, chokepoints and test names move
  into the evidence detail for a selected guarantee.
- A card has no roll-up health color, percentage, completion ring or “2/40 covered” badge.
  For a component with 40 enumerated subjects and oracle records on two, render a neutral
  heading **Selected subject evidence — no component verdict**, then name each subject,
  clause and its actual oracle reading. Place **Other subjects: not assessed here** beside
  that list, not behind a tooltip; the inventory drill-down may report “40 indexed subjects;
  38 have no linked oracle record,” explicitly as a record inventory, never a denominator
  of required guarantees. If inventory is incomplete, name its grade and do not invent 38.
  With no component-scoped contract, the component verdict remains unavailable even if all
  40 have passing subject tests. Only a subject-level row may show a scoped pass mark.
  Failures and staleness are surfaced as named observations, not a component score.
- Empty and unassessed projects get an adoption explanation, not green marks or a wall
  of “No guarantee linked.” A library-wide catalog remains browseable without adopted specs.
- Imports stay structural context, not a demand for a guarantee on every arrow. Distinguish
  an explicitly declared consumer contract from a source import. Existing `relies on`
  links remain advanced project-evidence navigation; do not auto-convert them into
  standard guarantee dependencies.
- Prioritize changed/stale evidence and outstanding clauses, with deterministic ordering,
  caps and visible omitted counts. Do not dump every complete catalog onto the canvas.
- Share the canonical model between saved HTML/JSON and live views. Updates to assessments,
  catalog definitions or evidence must preserve the selected subject and camera; metadata
  changes must not trigger layout recomputation. Keep non-color status cues.

The known type-only/dynamic-import graph defects need their own bounded repair before
claiming runtime-complete dependency views. They must **not block shipping useful
node-level standard guarantees**, nor be “fixed” by invented guarantee associations.

### CLI

Proposed surface, extending the existing `guarantees` command rather than adding synonyms:

```text
coherence guarantees catalog [ID] [--json]
coherence guarantees inspect <file[#symbol]> [--json]
coherence guarantees [--check] [--json]
```

Catalog browsing works without a declared project. Project inspection uses the same root
and subject checks as taxonomy. The default view becomes instantiated standard guarantees
and adoption needs, with local claims available as evidence rather than the headline count.

Keep `--check` an integrity check, not a new hidden satisfaction/coverage gate. Version the
JSON shape explicitly: definitions, instances, project claims and bindings are separate
populations. Preserve recognition of existing claim IDs and legacy bindings. The old
`taxonomy catalog` guarantee lookup should delegate to the same catalog, not diverge.

Any command changes require the existing maintainer procedure: review global and assigned
hook instructions, explicitly decide startup exposure, bump the hook protocol if meaning
changes, regenerate both hosts, update README/docs and test the packed consumer.

## 4. Add a declarative extension escape hatch

Use the language-adapter mechanism as the usability model—built-ins plus explicit local
configuration—not as a reason to execute code for a vocabulary extension.

Propose a local JSON pack containing the same roles, questions, facets and guarantee
definitions used by the built-ins. Configure project-relative pack paths explicitly.
The admitted core ships by default; simulation remains an explicit domain pack. Project packs have
their own namespace and cannot shadow, weaken or replace core IDs. A project-specific
guarantee can coexist with a core guarantee but cannot satisfy or waive an adopted core
contract merely by defining a different one.

One resolver validates both built-in and project packs:

- Unique namespaced IDs and resolvable activation/definition references.
- Compatible schema versions and deterministic merge/order semantics.
- Required clauses, scope requirements and evidence recipes under the same standards.
- No scripts, shell commands, arbitrary network resources or executable applicability.
- Bounded contained regular-file reads; refuse malformed, missing, conflicting or
  redirected packs with an explicit catalog-unavailable reading. Do not silently fall back
  to core and present an incomplete project catalog as complete.

No remote package registry, dynamic plugin loader or arbitrary inheritance/override system
in this increment. Test the seam using the already-existing core/simulation split and one
local extension fixture; do not invent production custom taxa just to exercise it.

### History is part of the extension feature

Today `taxonomyCatalogFor` recognizes only the frozen lab and current built-in digests.
Simply changing `TAXONOMY` or loading a local file would make old assessments unreadable.

Before changing definitions, freeze the current v2 catalog alongside the lab version.
Introduce canonical catalog serialization and a versioned record format without changing
legacy digest interpretation. On an explicit assessment write, retain the validated
resolved catalog snapshot by content address in project-owned history; read commands do
not create caches or records. A record points to the exact catalog it assessed.

Current reads compare that snapshot with the configured catalog and mark changes stale.
Historical reads use the retained definition, even if the local pack has been edited or
removed. Missing or corrupted historical catalog material is unavailable evidence, never
permission to substitute today's meaning. Keep content addressing's limit explicit:
it detects inconsistency, not a malicious rewrite with recomputed IDs; Git remains the
existing external history witness.

Retain conservative source/manifest freshness initially. Narrowing the current whole-file
digest strategy is separate work, not a shortcut to keep migrated bindings looking current.

## Delivery sequence and acceptance gates

### Increment 0 — preserve history and stop the detour

Keep implementation commit `1979969`. During this planning turn leave all annotations
untouched. The next implementation starts with **extract, reconcile, then delete** the
112 exploratory additions; keep the three baseline reliance declarations and three
baseline taxonomy bindings. No optional branch to retain the exploratory prose in production.
Do not reset the worktree or touch unrelated journals.

Before deletion, extend the bounded adoption report with a reproducible machine-readable
inventory and an archived patch keyed to baseline and working-tree content digests:

- All 112 additions, with consumer, provider, project claim, rationale and source location;
  separate the three baseline declarations. Reconcile to 115 total relies and 83 claims.
- Incoming link counts for **every** local claim, including zero, and consumer/provider
  counts for every component, including zero; publish distributions and concentration,
  not just a total. State the source/spec population and how it was derived.
- Reconcile the existing 56 directed pairs: 30 linked, seven type-only, ten evidence,
  nine representation/contract gaps; retain the missing dynamic-import finding separately.
- For each addition, record whether an existing standard candidate can express the consumed
  property unchanged, only partly, or not at all, with a concrete mismatch for the latter
  two. This new retrospective mapping is attributed analysis, not something the original
  annotation run measured. Count required custom clauses and unexpressible relations.
- Recover authoring effort, rewrites and rejected forms only where traces support them.
  Otherwise record unavailable. One agent's link-filling task measures neither adopter
  demand nor general usability; do not infer popularity from link frequency. In particular,
  112 consumer links did not exercise 112 standard-guarantee bindings.

Store exact records once as historical assay material, not as another live promise ledger.
Verify the archived patch and inventory reproduce the counts before the targeted deletion.
The existing report already accounts for edge gaps, but does not establish per-family
adoption friction; extracting that missing finding is required, not asserted complete here.

Freeze v2 catalog semantics and enumerate all 17 core families with an explicit disposition:
mature now, retain as legacy, consolidate or defer. Do not mutate historical records.

**Gate:** reproducible adoption inventory and archived diff exist before deletion; every
addition and zero-link population is accounted for. Old taxonomy records and original
bindings remain readable with their meanings; changed definitions cannot upgrade them.

### Increment 1 — rejection assay, no product implementation

Run the frozen protocol in section 0 on candidate definitions as documents. It is the
**entry criterion** for implementing a family, not a check after building four of them.
Measure the existing core/simulation partition rather than preserving it by assumption.
Record each family's promote, revise, consolidate, domain-only or defer disposition with
its failures and unknowns. No catalog, binding, CLI or Scope feature work in this increment.

**Gate:** frozen case matrix, raw reviewer outputs and separate representation, activation
and usefulness scores satisfy the stated thresholds for each promoted family. Zero passing
families means stop and revise the product premise. An unavailable population/reviewer or
unrun assay is unknown, not a reason to proceed to implementation.

### Increment 2 — implement only admitted families, CLI and Scope

Implement the shared definition/applicability model, catalog/subject CLI readers, versioned
clause bindings and Guarantees tab/card projection for admitted families only. Preserve
legacy project claims as concrete contracts with oracle drill-down and migration disposition.
No extension loader or receipt system is required. Port the assay cases into regression
fixtures; curated examples supplement, never replace, the rejection assay.

**Required correctness gates — individually reported, never waived as a bundle:**

- **Population parity:** identical canonical definition, subject, instance, binding and
  oracle-record populations in CLI, saved snapshot and live Scope, including unknowns.
- **Authority and evidence:** partial mapping never implies completeness; assessment
  attribution survives; stale inputs and missing oracles stay visible; scoped failures
  remain attached; no subject result becomes a component verdict or catalog obligation.
- **Artifact and update contracts:** deterministic saved output, offline reading, live
  update consistency, and retained selection/camera follow their existing tested contracts.
- **Compatibility:** frozen history retains its meaning and original claim references.

**Informative quality checklist — reported separately, not a parity pass/fail:**

- Readable common titles and subject detail at the default viewport with diagram context.
- Greyscale distinction, bounded lists and useful absence explanations.
- Frame time and interaction latency measured against the existing view on a named browser,
  device, dataset and viewport; record regressions rather than invent a threshold afterward.
- A cold-reader interpretation check: ask what the 40-subject/two-record card establishes.
  A safety/progress interpretation is a concrete design failure to fix, not “40% completed.”

Quality findings may justify an explicit release hold or design revision, but cannot change
a correctness verdict. Conversely green parity does not establish usable rendering. There
is no imports-to-labels completion quota in either set.

### Increment 3 — local packs and durable catalog history

Ship the shared pack schema, explicit configuration, namespacing and content-addressed
catalog history. Replace the hard-coded simulation-only domain allowlist through this
same resolver, preserving explicit opt-in behavior.

**Gate:** one local pack contributes a taxon and a guarantee without harness edits;
collisions, malformed packs and missing history refuse; changing/removing the pack never
reinterprets an old assessment; a fresh clone reproduces the reading. Core and project
definitions have the same validation and no different evidence authority.

### Increment 4 — mature the remaining core, then verification depth

Use the same preregistered rejection assay and adopter counterexamples to test remaining
families, including candidates currently labeled simulation. Finish or demote, not only expand.
Only then prioritize shared executable checkers, receipt-backed freshness and explicit
satisfaction assessment from measured recurring needs. Do not promise every core property
is mechanically decidable or every project already satisfies it.

**Gate:** each promoted revision passes the frozen multi-project positive/negative matrix
and usefulness comparison, retaining previous failures and adding fresh cases. A single
cross-project example is insufficient. Newly observed demotion conditions reopen mature
families too. Additional verification mechanisms must demonstrate real reusable subjects.

## Implementation seams

| Existing surface | Planned change |
| --- | --- |
| `src/taxonomy/taxonomy-catalog.ts` | Preserve legacy versions; resolve one core/domain/project catalog with richer guarantee definitions. |
| `src/taxonomy/taxonomy.ts` | Shared applicability rules, explicit scope requirements and revision-aware catalog resolution; preserve subject grade. |
| `src/taxonomy/taxonomy-ledger.ts` | Versioned catalog references and retained snapshots on explicit writes; no automatic reassessment. |
| `src/verification/guarantees.ts` | Clause-aware binding integrity and separate project-claim evidence, not satisfaction inference. |
| `src/verification/guarantees-cli.ts`, `src/commands.ts` | Catalog/inspect operations and explicitly versioned output populations. |
| `src/readings/scope-model.ts` | Canonical standard-guarantee instances; component aggregation without whole-component authority. |
| `scripts/scope-preview/` | Guarantees tab, common-title cards, evidence detail, bounded attention and live parity. |
| `src/config.ts`, `src/types.ts` | Explicit local catalog-pack configuration and validated resolved-catalog types. |
| `src/lifecycle/`, package smoke, docs | Keep public capability instructions and both installed hosts aligned. |

The recommended next work is **increments 0–1 only**: preserve and extract the adoption
measurement, then attempt to reject candidate portability and usefulness. Increment 2 is
conditional on those findings, not authorized by writing this plan. Design extension
compatibility now; do not make a plugin framework or receipt engine prerequisites for
testing whether this product should exist in the proposed form.
