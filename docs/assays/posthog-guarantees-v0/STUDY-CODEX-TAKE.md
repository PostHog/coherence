# Guarantee vocabulary v0: breadth and curation — Codex's take

2026-09-09. Candidate release, not universal-family admission.

## Package

The v0 has exactly **36 definitions**. Read the [complete catalog](CATALOG-CODEX-TAKE.md)
or run `node src/cli.ts guarantees catalog [guarantee:ID] [--json]`.
The shipped source is `src/verification/guarantee-catalog.ts`; the CLI and this
generated document project that same data. No new runtime dependency is required.

Each definition names one scoped promise, applicability conditions, required binding
parameters, exclusions, a concrete falsifier, an observation that would demote or revise
the definition, and a distinction from a neighboring definition. Applicability stays
caller-assessed. A defective implementation can still be a useful example of a contract;
it does not, by itself, refute the definition's representational usefulness.

## How broad was the search?

The pinned PostHog commit remains `c54fec2163ad9455fd23a947f86a9034c1df9388`.
The [evidence manifest](evidence.json) inventories **287 directory areas** under products,
Rust, services, Python core, Node, frontend, common code, enterprise code, packages,
tools, protocol definitions and CI. The selected examples cite
**51 distinct implementation/test files across 18 named source areas**.

This includes scoped ORM reads, recording-service authorization, ingestion scheduling,
cache publication, Rust capture routing and flag evaluation, query optimization,
deletion, batch exports, deferred tasks, approvals, workflow versioning and webhooks,
encrypted fields, replay scrubbing, the Hog interpreter, egress limiting, gateway
readiness/circuit decisions, and Kafka consumer fencing.

Inventory is not examination. The manifest lists every inventoried area, including
areas that supplied no selected reference. This was a broad, author-selected survey,
not an exhaustive read of PostHog or an independent held-out portability assay.
Billing arithmetic, statistical inference, symbolication, mobile SDKs, and every product's
specific permissions were not exhaustively assessed. The 36 entries are not coverage
of those areas by implication.

Seven supplemental source inspections are pinned separately in the manifest. Billing
provides a promising second supersession case: a quota cron must recount live usage
instead of overwriting it with its stale snapshot. Statistical code deliberately marks
undefined quantities as NaN, suggesting a future uncertainty-preservation candidate;
its `tests.py` contains statistical-test implementations, not unit-test evidence.
Error-tracking cleanup exposes retention eligibility, another deferred direction.
The access-control `logic.py` entry point is only a scaffold docstring, a useful warning
against classifying a component by its name. Tooling and CI reads supplied verdict and
registry examples without establishing additional end-to-end guarantees.

Reproducible search routes included:

```sh
git ls-tree -r --name-only HEAD
rg --files products posthog nodejs rust services common
rg -n 'self_approve|select_for_update|version|stale' products/approvals/backend
rg -n 'HogFlowRevision|_append_revisions' products/workflows/backend
rg -n 'signature|verify_sns_message' products/workflows/backend
rg -n 'MultiFernet|get_prep_value' posthog/helpers
rg -n 'scrub_text|redact_emails' rust/replay-anonymizer
rg -n 'Memory limit|maximum number of async steps' common/hogvm
rg -n 'budget|window|priority' posthog/egress
rg -n 'readiness|failure_rate|missing_table_privileges' services/llm-gateway
rg -n 'dispatchEpochs|partitionEpochs|fenced' nodejs/src/common/kafka
```

These searches locate subjects; inspecting implementations and assertions determines
the candidate's scope. The audit script separately checks that referenced paths are
tracked, their bytes equal the pinned commit, anchors exist, and retained run artifacts
match captured hashes. That mechanical check does not judge contract semantics or prove
that a source substring is a runtime-owned test name.

## Evidence grades

| Grade | Entries | Meaning |
| --- | ---: | --- |
| Mutation-tested example | 4 | Scoped filtering, supersession cleanup, already-applied retry recognition, acknowledgment settlement; R2/R3 retain original baseline, mutant and restoration results. |
| Test-inspected example | 30 | Implementation and relevant test assertions were inspected. No new execution or negative-control result is claimed for that definition. |
| Source-inspected example | 2 | Destination confinement and separation of duties have implementation evidence, but a focused negative oracle was not established in this search. |

Even the four mutation controls are local: the cache supersession mutant fails first on
cleanup, not the later value assertion; the acknowledgment mutant is detected by settlement
bookkeeping and an independent-settlement case. The catalog preserves those ceilings.
Some other assertions ran incidentally in R2's enclosing Node suite; they are deliberately
not promoted to independently challenged guarantees here.

An inspected test may cover only part of a candidate. For encrypted storage, the persistence
hook exists but the cited test exercises encryption helpers, not a raw database read.
For legal state transitions, the oracle mocks the changed locked row rather than racing
two physical transactions. These are explicit next-test obligations, not hidden passes.

## Curation decisions

- Merged queued and resumed authority into **current authority**; credential replacement
  is an implementation context, not another name needed to reach 36.
- Kept **retry recognition** separate from **duplicate suppression**: dropping an own
  redelivery can lose downstream work whose earlier attempt did not complete.
- Kept **canonical encoding** separate from suppression: stable identity is a prerequisite,
  not evidence that the deduplication mechanism acted.
- Kept **commit-ordered effects** separate from **durable dispatch intent**: an after-commit
  callback can satisfy the first and still lose committed work if the callback vanishes.
- Kept **bounded admission**, **fair admission**, and **cancellation release** separate:
  each can regress while the others remain correct.
- Kept **readiness evidence**, **declared-target coverage**, and **completion evidence**
  separate: current serving prerequisites, population traversal, and observed outcomes
  answer different questions.
- Did not add general exactly-once, universal anonymization, whole-application tenant
  safety, unconditional eventual delivery, or permanent deletion/no-resurrection claims.
- Tightened optimistic labels: memory budget means accounted VM allocations, not RSS;
  circuit policy means an open/bypass decision, not zero transport traffic; revision
  preservation means the publishing API appends history, not an immutable database.

The nearest-neighbor distinctions are a curation argument, not a measured proof of
minimality. If a future binding pair cannot demonstrate an independent violation, merge
the redundant entries even if that reduces the catalog below 36. The requested number
is a v0 target, not a permanent incentive to manufacture distinctions.

## Integration boundary

This release ships inspectable reference data and a CLI, not automatic adoption.
It does not change the taxonomy V1/V2 digests, introduce new mandatory obligations, bind
the candidates to every component, alter Scope's displayed satisfaction, or create receipts.
Current role/facet-triggered lab suggestions remain a compatibility surface, not a second
copy of these definitions. Existing `guarantees --check` retains its link-integrity meaning.

The intended end state is one resolved vocabulary with explicit migration of legacy
suggestions and scoped links to existing spec claims. Local boundary claims remain the
enforcement anchors and evidence subjects; they should not become a permanently competing
generic taxonomy. Project-specific definitions should eventually use the same schema under
an explicit namespace. Neither migration nor executable extension loading is smuggled into
this reference-only v0.

The read-only catalog is intentionally omitted from bounded lifecycle startup text.
It changes no work-owner action or obligation; both host instruction bodies stay unchanged.
README/help expose the lookup. Catalog lookup dispatches before configuration loading so
even damaged project configuration cannot block this project-independent reference.

## Verification and next gate

The Coherence tests check complete list/detail projection, stable JSON, qualified evidence,
valid references, retained artifact hashes, strict unknown/unsupported argument refusal,
and absence of project reads or writes. A negative control first observed the public
lookup fail on poisoned configuration; the early-dispatch repair makes that test pass.
The packaged-consumer smoke checks that the catalog ships without PostHog or the lab.
These tests verify the catalog implementation, not 36 PostHog guarantees.

The npm artifact includes this study plus the R2/R3 evidence directories, so retained
run references resolve offline in an installed package. Temporary environment paths in
the reproduction scripts describe the original assay machine and must be adapted for
a new run; they are not runtime requirements for reading the catalog.

Completed checks: all 38 focused catalog/guarantee/taxonomy/command tests passed, the
full repository Node test suite passed, typecheck and build passed, both host lifecycle
checks reported PRESENT, and existing `guarantees --check` reported zero issues for its
six links. The evidence generator's byte check passed. These results do not supersede
the repository's separate previously failing full verification report or certify its
pre-existing dirty generated Scope artifacts.

Regenerate or byte-check the reference projections against the pinned local checkout:

```sh
node scripts/guarantee-v0-evidence.mjs /path/to/pinned/posthog
node scripts/guarantee-v0-evidence.mjs /path/to/pinned/posthog --check
node --test test/guarantee-catalog.test.ts test/guarantees.test.ts test/taxonomy.test.ts test/commands.test.ts
```

The offline inventory initially hit Node's default output cap and refused before writing
results. Its explicit 32 MiB cap now accommodates this pinned repository; an over-cap
repository still refuses rather than producing a partial inventory.

Next: freeze scoped bindings for the four negatively controlled examples, challenge each
with another implementation context, and then test whether Scope readers understand them
better than the original comments/test titles. Run focused controls for the two missing
oracles and partial-oracle cases. Cross-project promotion still needs the independent
representation, activation, and reader-benefit gates from the product plan.
