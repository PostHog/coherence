# dbt: a language adapter over the manifest

Status: slices 1 to 4 and the adapter's own invariants are built on branch
`dbt-adapter` (2026-09-28); access-choked (slice 5) and the full migration
(slice 6) are not. This began as the proposal for what the distilled Coherence
needs so that PostHog/revenue-model, which runs on Marce Coll's dbt layer over
the reference implementation, can move onto `main`. `docs/enforcement.md`
("dbt") describes what was built.

## What was built

- The seam: `Definition.members` (a folder module's files) and
  `ReferenceSite.testResource` (the instrument knows the referencing thing is
  a test). `classifySite` honours both; nothing else in the check changed.
- `src/adapters/dbt.ts`: resolve by model name, name in file, model file, and
  folder; one site per `depends_on` edge; reference-choked grading; the
  in-memory refutation; a stale manifest makes `ready` fail and every question
  throw; `dbt.parse` runs when the manifest is stale. It reads dbt's own
  `target/manifest.json`, or the reference's committed snapshot when
  `dbt.snapshot` names it, and every reason then says so.
- `src/adapters/composite.ts`: `"language": ["dbt", "python"]`, one owner per
  resolved name, ambiguity listed, ready only when every member is.
- The totality pass: `testFilterForm: "dbt"`, `{outdir}`, `run_results.json`
  mapped by unique id, `warn` passing with its warning, `testTimeoutMs`
  (project-wide and under `dbt`). The run routes each `via` to the dbt runner
  when the manifest holds that test once, to the project-wide runner
  otherwise, and to neither with the ids when the manifest holds it twice.
- Six invariants in `src/adapters/Adapters.spec.md`, each refuted by a staged
  break and witnessed green: every manifest edge is a reference, a stale
  manifest answers nothing, a module is its folder, a test resource is a test
  site, dbt results mapped by unique id, two instruments, one owner.

On revenue-model (local branch `coherence-distilled`, not pushed), with a
distilled config and two rewritten specs (`models/ledger/`,
`models/ledger/diagnostics/`) against a local Trino stack:

- `entry families cross the ledger` (protects `models/ledger/entries/`,
  chokepoint `ledger`): reference-choked, automatic refutation; 18 inside, 45
  test, 0 bypass. With `account_balances` edited to read `revenue_entries`
  directly, the adapter re-parsed and the run went red naming
  `models/ledger/balances/account_balances.sql:20 in account_balances`, exit 1;
  restored, green.
- `diagnostics never feed accounting truth` (the folder protects itself):
  reference-choked, automatic refutation; 1 inside, 39 test, 0 bypass.
- Five dbt tests ran in one `dbt test` invocation and one pytest test through
  the project-wide runner: 8 enforcements, 8 pass, 7.3 s.
- `ledger balances globally` was refuted for real: the ledger's union dropped
  the credit legs of credit purchases, the ledger was rebuilt, and
  `ledger_debits_equal_credits` went red; restored, rebuilt, green, witnessed.

## Decisions taken for the open questions

1. Snapshot: dropped as a checked-in artifact. The adapter reads dbt's
   manifest and parses when it is stale; `dbt.snapshot` remains as a labelled
   fallback for a machine without dbt.
2. `relationships`: out of scope; nothing was built for them.
3. `warn`: a pass, with "warned at severity warn" and dbt's message in the
   reason.
4. Row contracts: the test is the definition; no column check.
5. Test timeout: `testTimeoutMs`, project-wide and under `dbt`.
6. Access groups: not built. The ladder lists only reference-choked, so no
   chokepoint is credited with a refusal dbt would not make.

## Where the build differs from this proposal

- The site flag is `testResource`, not `test`: `ClassifiedSite` already
  carries a `test: boolean`.
- The config's `language` keeps naming the scan language for economy, mass,
  and observation; the instruments are a separate list read from the same
  key. A dbt-only project scans Python.
- A dbt runner is configured under `dbt` (`test`, `testJson`, `testMatch`,
  `testTimeoutMs`) rather than under a key per adapter.
- The warm server's fingerprint covers Coherence's code, not the project's
  config, so a server started before `language` changed keeps its old
  instruments until it idles out or is stopped.

The rest of this document is the proposal as written before the build.

Sources read:

- the fork: `MarceColl/coherence` at `76c168c` (2026-07-28), nine commits
  on top of the reference at `49c1ebf`: `src/adapters/dbt.ts`,
  `src/dbt-shadows.ts`, and the dbt branches of `boundary.ts`,
  `phrasebook.ts`, `verify.ts` and `structural.ts` (about 1,500 lines of
  source and 1,300 of tests);
- the adopter: `PostHog/revenue-model` at `8d434f7` (2026-09-28): 107
  models, 474 dbt tests, 27 sources, `coherence.dbt.json`, the committed
  `.coherence/dbt-manifest.json`, nine specs, `scripts/coherence_test.py`
  and `scripts/coherence_ci.py`.

Every count below was computed from that committed manifest.

## What the fork does

dbt contributes a graph and is never parsed as a source language. The fork
normalizes `target/manifest.json` into a committed snapshot, reads a sidecar
of project meaning (`coherence.dbt.json`), and adds dbt branches to the
reference's claim grammar and verify.

| Fork feature | What it checks | Use in revenue-model |
| --- | --- | --- |
| `coherence dbt [--check]` | writes the normalized snapshot; `--check` fails when stale | CI, every PR |
| `chokepoints` (sidecar) | a chokepoint model's upstream models become private; a model downstream of it may not read one directly; traversal stops at another chokepoint | 36 declared |
| `observers` (sidecar) | a diagnostic model may read private models but no model may read it | 8 declared |
| `via shadow` | the claim passes when the chokepoint's shadow has no bypass | 3 claims |
| `via dbt test "<name>"` | the test exists once in the manifest, depends on the model, then runs | 64 claims |
| `via dbt schema` | `unique(...)`/`not_null(...)` is an enforced model constraint | 0 claims (the Trino Iceberg catalog rejects NOT NULL DDL) |
| `passes test "<name>"` | the test it names runs green | 37 claims (pytest, Hypothesis) |
| `parities` (sidecar) | two models and one test that depends on both; the test runs | 24 declared |
| `rowContracts` (sidecar) | discriminator column, variants, required columns exist; the test depends on the model and runs | 2 models, 25 variants |
| `models.<m>.grain` (sidecar) | the columns are declared; nothing is executed | 41 models |
| `relationships` (sidecar) | the edge is a direct dependency; multiplicity and filtering are recorded, not checked | 69 edges |
| `roles` + `scope` (sidecar) | every model in scope carries at least one role | 23 roles |
| structural ledger (`log`) | diffs all of the above between two git refs | reviews |
| `verify-baseline.json` | a shrink-only list of accepted shadow failures, enforced by parsing verify's printed summary | empty |

## Findings that shape the port

### 1. All three `via shadow` claims are vacuous

A chokepoint's shadow stops at any other declared chokepoint. Revenue-model
declares 36, and 21 of them have an empty shadow, because every model they
read is itself a chokepoint. Among the empty ones are `ledger` (all nine
entry families are chokepoints), `unified_events` (`source_events` and
`invoice_traceability_bridge` are chokepoints), and `iwa_like` (it reads only
`unified_events` and `ledger`). Those are exactly the three models the specs
bind `via shadow`:

- `every financial consumer crosses the canonical ledger` at `ledger`
- `every downstream accounting fact crosses the event spine` at `unified_events`
- `legacy comparisons cross iwa_like` at `iwa_like`

Staged against the fork's own `dbtGraphFragment` and `dbtShadowReport` with
the committed manifest, four synthetic edges:

| Staged edge | Bypasses | Fork's report |
| --- | --- | --- |
| `account_balances` reads `revenue_entries` | `ledger` | nothing |
| `iwa_like_vs_original` reads `unified_events` | `iwa_like` | nothing |
| `daily_revenue` reads `source_events` | `unified_events` | nothing |
| `credit_pool_balances` reads `stg_billing_credits` (control) | `credit_events` | one violation |

The ledger spec's rationale says the shadow "makes entry producers and raw
billing sources private downstream". Declaring the entry families as
chokepoints later emptied it, and nothing said so. The distilled requirement
that every chokepoint refute itself, with a synthetic bypass that the check
must call a bypass, would have caught this on the day it happened. The dbt
adapter must keep that requirement: it is the single most valuable thing the
port adds.

### 2. Naming the protected thing removes the need for the directional rule

The fork computes the private set (everything upstream), which is too broad:
14 of the 36 private models are shared by more than one chokepoint, and 53
edges read a private model from outside its chokepoint. The fork allows
those only through the directional rule (a reader counts as a bypass only
when it sits downstream of the chokepoint) and the observer exemption.
The distilled check has no such rule, and it should not grow one. Its
classification is language-neutral and has three classes: inside, test, bypass.

Naming the protected thing explicitly, the distilled way, holds on the real
manifest with no directional rule:

| protects | chokepoint | model reads outside | observer reads | test references |
| --- | --- | --- | --- | --- |
| `models/ledger/entries/` | `ledger` | 0 | 0 | 45 |
| `models/events/sources/` | `models/events/` | 0 | 1 | 98 |
| `models/staging/` | `models/events/` | 0 | 11 | 92 |
| `source_events` | `unified_events` | 1 (`invoice_traceability_bridge`, an upstream peer) | 0 | 22 |

The last row is the only case where the directional rule does any work. Two
ways out, both already legal: make the chokepoint the `models/events/`
module (the bridge is inside it), or state the invariant about what the
bridge is for. With module chokepoints, this project's invariants reduce to
the ordinary check. The directional rule and computed shadows retire.

### 3. Observers are the one real extension

Twelve reads come from diagnostic models, all under `models/ledger/diagnostics/`
(8 declared observers plus 7 undeclared `diag_*` models in the same
folder). The fork gives them a read exemption paid for with a leaf rule.
Distilled Coherence can express both halves without a new class; see
"Observers" below.

### 4. The CI wrapper parses printed text

`scripts/coherence_ci.py` parses `verify`'s final summary line with a regex
(`✗ N coherence failure(s) — N claim · N broken · …`) to run its shrink-only
shadow baseline. Any change to that line breaks CI. Distilled records a run
as JSONL under `.coherence/runs/`, so the wrapper should read the record.
With module chokepoints (finding 2) and no shadow baseline, it may not be
needed at all.

### 5. Almost all of the evidence is totality oracles over dbt tests

64 `via dbt test` and 37 `passes test` claims all name a test. The work that
decides whether they are useful is running dbt tests and pytest in one pass,
not grammar.

## Where each fork concept lands

| Fork | Distilled | Note |
| --- | --- | --- |
| `boundary "<inv>" at M via dbt test "t"` | invariant bullet, totality oracle form: `over:` the rows the test is total over, `via: t` | `over:` must be written; 64 bullets |
| `passes test "t"` | the `via:` half of an invariant | retired as a bare form |
| `via shadow` + `chokepoints` list | invariant bullet, chokepoint form: `protects:` a model or folder, `chokepoint:` a model or folder | resolved by the dbt adapter; refutes itself |
| `observers` | a test folder, plus one leaf invariant; see "Observers" | |
| `via dbt schema` | a `via:` naming dbt's generated `unique_`/`not_null_` test | constraint-reading retires unused |
| `parities` | invariant bullet, totality oracle form: `over:` both models, `via:` the parity test | `parity` claim form retired 2026-09-17 |
| `rowContracts` | invariant bullet, totality oracle form; the variant table lives in the test | see open question 4 |
| `grain` | invariant bullet, totality oracle form over dbt's `unique_combination_of_columns` test (or equivalent) | only where a test exists; otherwise a requirement |
| `relationships` (multiplicity, filtering) | requirements until a test enforces them | recorded but never checked today |
| `roles` + `scope` coverage | components (folders with specs); unclassified models show as unreached mass | taxonomy retired 2026-09-17 |
| structural ledger / `log` | the run record and the journal | `log` retired |
| committed snapshot | the adapter's index, not a checked-in artifact; see "The instrument" | |
| `--fast` | none | tiers rejected; the run always runs what it names |
| `verify-baseline.json` | none: a known residual becomes a totality oracle that excludes a listed residual | ratchets retired |

## The dbt adapter

A `LanguageAdapter` (`src/adapters/adapter.ts`) whose instrument is dbt's
parsed manifest instead of a language server. It answers the same questions,
so the chokepoint check, the run, refutation, `run --status`, `spec --check`,
Scope's component interfaces, `query relies-on` and revelation at the edit
work unchanged.

### The instrument

- The manifest comes from `dbt parse`, run as a configured command
  (`dbt.parse`, an argv array; revenue-model: `uv run dbt parse --target ci`).
  `ready()` runs it or confirms `target/manifest.json` is newer than every
  file under the project's model, test, seed, snapshot and macro paths. A
  manifest older than the text is an answer the instrument cannot confirm,
  so the check reports not run, never pass.
- The committed snapshot existed so the structural ledger could rebuild the
  dependency structure at a git ref without dbt. `log` is retired, so the snapshot has no
  reader in Coherence. `scripts/coherence_test.py` still reads it to catch a
  test whose unique id changed; that check can read `target/manifest.json`.
  Proposed: drop the snapshot. See open question 1.
- The warm server holds the parsed manifest. `forget(files)` re-runs
  `dbt parse` (partial parse), then answers. The parse time on revenue-model
  has not been measured (no `uv` on this machine); revelation at the edit
  depends on it.

### Name forms

`parseName` is unchanged. A dbt model name is an identifier, so:

- `ledger` is a symbol: the model named `ledger`. More than one model with
  that name is ambiguous and returns candidates.
- `ledger in models/ledger/ledger.sql` is a symbol with its file.
- `models/ledger/ledger.sql` is a module: the one model in that file.
- `models/ledger/entries/` is a module: every model under the folder.

Sources (`source('stripe', 'charges')`) and seeds do not resolve in the
first slice. Protecting a source means naming the staging model or folder
that reads it.

### references

Every `depends_on.nodes` edge into the definition is one reference site. The
site is the consumer's file, at the line and character of the `ref(...)` or
`source(...)` call that names the definition in its raw SQL or YAML. When the
call is computed (Jinja) and no literal is found, the site is line 1 of the
consumer's file, with the consumer's name as `symbol`. No edge is ever
dropped: the manifest decides what depends on what, and the
text only locates it.

A generic test declared in a `schema.yml` under `models/` has a path that is
not a test path, so path rules alone would call it a bypass. There are 319
such tests in revenue-model. The seam needs one addition: `ReferenceSite`
gains an optional `test: true`, set by an adapter whose instrument knows the
referencing resource is a test (`resource_type: test`). `classifySite`
treats it like a test path. TypeScript and Python never set it. This is the
only change to the check.

### visibility and the ladder

| Rung | Enforcer | Fact the adapter verifies |
| --- | --- | --- |
| access-choked | dbt's parser | every protected model has `access: private` and is in the chokepoint's `group` |
| reference-choked | Coherence's check at the edit and in CI | every reference is inside the chokepoint |
| convention | nobody | a naming prefix (`stg_`, `int_`) alone |

dbt 1.5 and later refuse, at parse time, a `ref` to a private model from
outside its group. That is the language enforcing visibility, the dbt
counterpart of `visibility-choked`. Revenue-model declares no groups today,
so every chokepoint would grade reference-choked. The access rung matters
where one chokepoint owns its private models outright: of the 36 private
models the fork computes, 22 have one owner.

### refute

- **Reference-choked.** The adapter adds one synthetic consumer model to its
  in-memory model set, placed in a file beside the chokepoint that sits outside
  both the chokepoint and the protected module, and depending on the
  protected thing. For a module chokepoint it also stages a consumer
  downstream of the chokepoint. It reports the sites; the check must call
  each one a bypass. Nothing touches disk. Finding 1 is what this catches.
- **Access-choked.** The adapter copies the project to a temporary folder,
  adds a model outside the group that `ref`s a protected model, and runs
  `dbt parse` there. The parser's refusal ("… is not allowed because the
  referenced node is private to the … group") is the refutation, recorded as
  `refused by the language` with that text.

### testFilter and the totality oracle pass

- `testFilterForm: "dbt"`: filters are test names as written, joined by
  spaces for `--select`.
- `testJson` for dbt: `dbt test --select {filter}` followed by reading
  `target/run_results.json` (`results[].unique_id`, `status`, `failures`,
  `message`), mapped back by test name through the manifest. One invocation
  per run instead of 64 warehouse round trips.
- Status mapping: `pass` → pass; `fail` and `error` → fail; `skipped` → not
  run; `warn` → see open question 3. A test name the manifest does not hold,
  or that resolves to more than one unique id, is not run with the reason. A
  name that matches no result is `matched: 0`.

### Two adapters in one project

Revenue-model is both dbt and Python (`allocation/`, `dags/`), and 37 of its
totality oracles are pytest tests. Config today takes one `language`. The
port needs:

- `language` accepts a list (`["dbt", "python"]`). A name resolves through
  the adapter that owns its file (by extension), or through each adapter in
  order for a bare symbol; more than one answer is ambiguous.
- A test runner per adapter (`test`, `testJson`, `testFilterForm` nested
  under the adapter's key). A `via:` value routes to the runner whose
  instrument knows the name: the manifest's tests for dbt, collection for
  pytest. This replaces the dispatch in `scripts/coherence_test.py`.

## Observers

A diagnostic model reads what production models may not, and nothing may
read it. Both halves fit what exists:

1. The read: add `diagnostics` to `testDirs`. A diagnostic's reads are then
   test references, reported and never bypasses, which is what they are:
   detectors, not inputs.
2. The leaf: one invariant in the diagnostics spec, chokepoint form,
   `protects: models/ledger/diagnostics/`, `chokepoint: models/ledger/diagnostics/`.
   A diagnostic reading another diagnostic is inside the module. Any
   production model reading one is a bypass, and dbt tests stay test
   references.

The refutation stages a production consumer of a diagnostic. The 7
undeclared `diag_*` models become covered as a side effect. The fork left
them out because they are parity partners, and that still holds, since test
references never count as bypasses.

## Invariants the adapter owns

To be scaffolded in `src/adapters/Adapters.spec.md` (or a `dbt/` component),
each with a real test and a staged break:

- **every manifest edge is a reference**: every `depends_on` edge into a
  resolved model is reported as a site, whether or not its call text is
  found. Totality oracle over every edge of a fixture manifest; break: skip
  edges whose `ref` is computed.
- **a stale manifest answers nothing**: when any project file is newer than
  the manifest, and the parse is not run, every check through the adapter is
  not run. Break: let `ready()` pass on a stale manifest.
- **a module is its folder**: a folder name resolves to every model under
  it and nothing else, and a site in any of those files is inside the
  module. Break: resolve a folder to its first model.
- **a test resource is a test site**: a site whose referencing resource is a
  dbt test carries `test: true` wherever its file lies. Break: drop the flag
  for YAML-declared tests.
- **a dbt result maps by unique id**: one invocation's `run_results.json`
  maps each result to exactly the `via:` that named it, and a name matching
  no result reports `matched: 0`. Break: map by name suffix.

## Migrating revenue-model

1. Replace `coherence-harness` (the fork) with the distilled checkout, per
   the README: `../coherence`, run as `node ../coherence/src/cli.ts`.
2. Rewrite the nine specs: `## works when` and `## why` become bullets with
   `because:`; each claim becomes the `via:` of its invariant. `spec --check`
   currently reports 94 problems and 76 requirements.
3. Replace the 36 declared chokepoints with the handful of chokepoint-form
   invariants the specs actually state (finding 2). Most of the 36 exist to
   carve shadows, not to state invariants.
4. Write `over:` for each totality oracle. The 64 dbt tests mostly already
   say it in their names.
5. Refute: chokepoints refute themselves on the first run. Each totality
   oracle form needs one staged break and a `refute` against the sampled local
   Trino (`make sampled-local`). That is 101 staged breaks; budget for it or
   accept requirements until each is witnessed.
6. Delete `coherence.dbt.json`, the snapshot, `patches/` (the test-timeout
   patch; distilled's timeout is `refute --timeout`, and the run's needs a
   config key: open question 5), `scripts/coherence_ci.py` and
   `verify-baseline.json`.
7. Lexicon: the project keeps its own `ledger` (Coherence's lexicon rejects
   it only as a name for the journal) and its own `observation`
   (`legacy_invoice_observations`). Run `lexicon coverage` and declare the
   domain terms: event spine, entry family, allocation, settlement, seed,
   IWA.

## Open questions

1. **Snapshot.** Drop it (proposed), or keep it as the adapter's offline
   index for sessions without dbt installed? Keeping it needs a staleness
   invariant, and the stale case reports not run either way.
2. **`relationships`.** 69 declared multiplicities and filtering behaviors,
   none checked. Keep them as requirements, write tests for the ones that
   matter (27 are one-to-one/preserves, which one row-count test per edge
   decides), or drop them?
3. **`warn`.** `nonzero_invoices_claimed_by_ledger_path` is `severity: warn`
   by a ruling of 2026-08-11. dbt exits 0 on warn. Is a warning a pass (the
   ruling's intent), a fail, or a distinct verdict the run records?
4. **Row contracts.** The fork checks, from the manifest, that the
   discriminator and required columns exist and records variant changes.
   Distilled keeps the test as the only definition. Is losing the column
   check acceptable, or should the adapter verify that the columns a
   totality oracle's `over:` names exist?
5. **Test timeout.** The Hypothesis state machine needs up to 30 minutes.
   The pass has `TOTALITY_TIMEOUT_MS` (10 minutes) and no config key.
6. **Access groups.** Adopt dbt groups in revenue-model to earn
   access-choked where one chokepoint owns its models, or stay
   reference-choked?

## Order of work

1. `ReferenceSite.test` and the dbt adapter's `resolve`/`references` over a
   fixture manifest; `run` grades a chokepoint. Stage finding 1 as the first
   refutation test.
2. `refute` for reference-choked; the totality oracle pass with
   `run_results.json`.
3. Two adapters in one project, with a runner per adapter.
4. The instrument's `ready()`/`forget()` with `dbt parse`, measured on
   revenue-model; the warm server.
5. Access-choked and its refusal-based refutation.
6. Migrate revenue-model's specs, one component at a time, starting with
   `models/ledger/`.
