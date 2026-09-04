# Scope: Claude's take

Date: 2026-09-04

Status: design discussion; no implementation

Provenance: composed from a reading of `src/derive.ts`, `src/index-model.ts`, `src/render-index.ts`, `src/panel.ts`, `src/decisions.ts`, `src/hooks.ts`, `src/types.ts`, `src/sidecar.ts` and the `.coherence/` state layout, plus `COHERENCE-REVISION-BRIEF-TAXONOMY-SOCRATIC-HOOKS.md`. Written before reading `SCOPE-CODEX-TAKE.md`; a review of that document is a separate artifact.

## Thesis

The write path is the product. The canvas is its addressing scheme.

Scope's genuinely new capability is not another picture of the graph — it is the first human → disk → agent path this harness has ever had. Everything today flows agent → disk → human. A canvas is what makes a human mark *addressable*: you can only flag a boundary if something has drawn it and given it a stable identity. That ordering should drive the build order, and it inverts the obvious one.

## The first question is not rendering

This repo already emits four HTML artifacts and a TUI. `src/index-model.ts` opens by naming the exact failure Scope is positioned to repeat:

> Every other browser artifact this harness emits is a DUMP OF EVERYTHING AT ONE MOMENT: `_graph.html` is 364KB of outline, `_overview.html` is every component's prose, `_contract.html` is the whole promise network. They are complete, they are correct, and they go unread — because a complete picture has no attention budget in it and no delta.

`_index.html` already draws regions, guarded arrows, tier as line treatment and heat as line weight. So the design risk is not "will the canvas look good." It is that Scope becomes the fifth complete dump with better typography.

Four things Scope can own that nothing currently does:

| | What it is | Data that already exists |
| --- | --- | --- |
| **Provenance** | components *as they were written* — which session authored this, at which commit, witnessed or not | `DecisionRecord.commit/dirty/agent/session`, `.coherence/read-traces/`, `.coherence/activity/` |
| **Time** | the canvas moving, not a snapshot with a trajectory tab | `structural.ts:graphAtRef`, `diffGraphs`, `evolution.ts` churn |
| **Extension** | project-specific inspection catalogs | nothing above the language/platform adapter layer today |
| **Write path** | a human placing attention back into the record | nothing |

Provenance is the strongest differentiator available and the cheapest: colouring a component by *which agent session last touched it* and *whether its guarantees were witnessed at that commit* is not in any existing artifact, and requires no new derivation.

## Architecture: the model/render split is already law

`render-index.ts` line 1 — "IndexModel → one self-contained `_index.html`. A PURE FUNCTION OF THE MODEL." `index-model.ts` rule 1 — "DERIVE NOTHING NEW."

Scope obeys both or it is a second spelling of the domain, which this repo has killed four times by its own count.

```text
scope-model.ts   -> scope.json    pure projection; no clock, no absolute paths, no disk
render-scope.ts  -> _scope.html   pure function of scope.json
scope adapters   -> catalog data  project code, data-only, never markup
```

Every figure in `scope.json` comes from a derivation that already exists: `buildGraph`, `buildPromiseModel`, `readStatus`, `readJournal`, `parseBoundary`, `cfg.atlas`, `diffGraphs`. Where a reading is owned by a command that writes a record — `drift`'s windows, `atlas`'s tier grades — Scope reads the record that command filed and never recomputes it. That is the rule `index-model.ts` already follows, and the newest instrument is the worst place to reintroduce a second spelling.

## The network invariant is the pivotal decision

`render-index.ts` states it flatly: **no network, ever — one file, no second request, nothing to fetch.** A live journal stream and a write-back channel both violate that on their face. Three resolutions:

**(a) Stay static.** `_scope.html` is a snapshot; the "stream" is the last N entries at generation time; a mark works by the page showing a `coherence mark …` command to copy. Preserves every invariant, costs nothing, genuinely usable. But copy-paste as a write path will not survive contact with use.

**(b) A localhost daemon.** `coherence scope --serve` watches, serves `scope.json`, accepts writes. Real product, new trust surface.

**(c) Hybrid — the recommendation.** The static file stays canonical and is what `docs --check` gates. `--serve` is opt-in, uses the *same model and the same renderer*, and only re-fetches `scope.json` and enables the write affordance. The binding constraint: **the served page must not be able to show anything the static page cannot.** The moment the live view has a panel the static file lacks, there are two spellings again.

Two consequences that are easy to miss:

- **The listener is a trust crossing and belongs in `cfg.atlas.transitions`.** A localhost socket that can append to a committed record is exactly the chokepoint the atlas exists to grade. Leaving it undeclared means the harness's own instrument cannot see the harness's newest attack surface.
- **`--serve` must not re-derive in process.** `panel.ts` solved this already: it spawns the CLI, lets the child file its report, and re-reads the record — "that keeps judge and notary separate." A server calling `buildGraph` inside a request handler collapses that separation.

## Determinism is a hard constraint, not a preference

This is the single most consequential implementation fact, and it eliminates most of the obvious tooling.

`docs --check` compares generated artifacts byte-for-byte with zero normalisation. `commands.ts` records why the block it owns carries no timestamp: *"every normalization a freshness gate needs is a hole in that gate."* The project has already eaten a false-positive detour from the `Config.name` basename fallback — see the comment in `src/types.ts`, which is four times longer than the field it documents for exactly that reason.

**So the layout must be a pure function of the graph.** A canvas that reflows on regeneration turns the one gate whose job is detecting real drift into a noise generator, and the gate gets disabled rather than the layout fixed.

That rules out force-directed layout, anything seeded by insertion order that is not itself stable, and any layout engine whose determinism is a property you would have to audit rather than one you own.

What survives:

- **Layered (Sugiyama-style) over the import DAG.** Rank by longest path; order within rank by barycenter with a *fixed* iteration count and stable-id tiebreak; route orthogonally on the existing 8px grid. Integer arithmetic throughout, fully reproducible. Hand-rolled this is roughly 300 lines, and worth it against auditing a dependency for hidden nondeterminism in a repo whose renderers currently have zero runtime dependencies.
- **Squarified treemap** for mass (files × lines × symbols) — deterministic given a stable sort, and the right form if "as written" should carry authorship weight.
- **Fixed-slot region diagram** — what `readMap`/`diagram` (`render-index.ts:251-683`) already does. If Scope's top level is regions, reuse that figure rather than drawing a second picture of the same crossings.

### Rendering technology

Server-side inline SVG with a **client-side viewport transform only** — pan and zoom by mutating one `<g transform>`; layout never runs in the browser.

This keeps print and greyscale legibility, keeps the page checkable against `scope.json`, and preserves the rule `render-index.ts` already commits to: scripting off degrades to "no highlight", never to a page that hides its content.

Canvas2D or WebGL buys 10k+ nodes and costs print, greyscale, and checkability. Solve scale with level of detail instead — and **precompute the LOD tier per node in the model**, so the renderer makes no judgment calls. This matters at real scale: the foundry surveyed 49,122 files. Components always drawn; files on zoom; symbols only in the drill panel.

### Hoist the visual language

`U = 8`, `DASH`, `TIER_NAME`, `BOX_H`, the orthogonal router and the greyscale rules are private constants in `render-index.ts:172-251`. If Scope re-declares them, `coherence redundancy` will flag the pair and be right. Extracting a shared `render-grid.ts` is a prerequisite refactor, not part of Scope.

## Guarantee marking: reuse the honesty semantics or don't ship

`panel.ts` already encodes the expensive lessons: a verdict from another commit degrades to STALE *with its age* and is never re-badged green; a tier-skip renders "not run", not health; dialect-gap skips get their own mark so a typo'd verb cannot vanish; `via guard` rows carry "needs human eye" because the meta-oracle never analysed them. That is `LightKind = "pass" | "fail" | "stale" | "skip" | "none"` plus `gap`.

A fifth spelling of "green" in this codebase is a category error. Hoist `Light`/`LightKind` and its derivation out of `panel.ts` into a shared module and have Scope consume it. Then a component's colour on the canvas is worst-light-wins over the same rows the TUI shows — by construction, not by agreement.

**Corollary — the `floor.ts` rule applied to pixels: a region with no guarantees must not render as calm.** Undeclared has to look different from clean. `_index.html` handles this with `UNMEASURED` and `total: null`; the canvas equivalent is a distinct hatch or fill for "no claims here", never the pass colour. Green-by-absence is the defect this project spent a day eliminating; a canvas is the easiest place in the world to reintroduce it.

## Bespoke catalogs: the adapter contract is where this goes wrong

The pattern exists twice already — `LanguageAdapter` and `PlatformAdapter` in `src/types.ts`, resolved in `derive.ts` with `adapterShapeProblem` naming the wrong field, and an unknown bare name **refusing rather than falling back**. Copy it wholesale, including the refusal text's reasoning.

Three constraints on `ScopeAdapter`:

1. **Adapters return data, never markup.** `catalog(root): Promise<Catalog>` where `Catalog` is `{ id, title, columns, rows }` and every row carries a `node` field that must resolve to a real graph node id. An adapter that emits HTML has been handed the render surface, and determinism, the greyscale doctrine and escaping are all lost at once.
2. **An unresolvable node id is a refusal, not a dropped row.** Same reasoning as the empty-scope handling in `verify.ts:475-486` — a fabricated address must be loud. A catalog that silently omits what it could not resolve is a shortened list that looks complete.
3. **Enforce determinism mechanically: `coherence scope --check` runs each catalog adapter twice and diffs the output.** Five lines, and it catches clocks, `Math.random`, absolute paths and directory-order leaks — precisely the class the `Config.name` comment describes. A measured negative control, which is the form of evidence this project already believes in.

And declare it. `derive.ts` states that importing a project module executes project code, and that this is the trust already declared at the `loadConfig` crossing. Scope adapters *extend* that surface; that extension belongs in the atlas rather than being silently inherited.

## The back-channel, and what the evidence says it should carry

The revision brief supplies the decisive finding, and it argues against the obvious design.

A hook delivering an addressable, relevant obligation as a **notice**: 0/8 recovery, +58.6% total input tokens. The same agents given a **concrete failing observation**: 6/6. The brief's own conclusion was that the programme "over-invested in feedforward and under-built feedback."

A sticky note on a component is feedforward. So marks should come in three kinds, not one:

- **`note`** — advisory context. Cheap, renders dim, honest about being weak.
- **`flag`** — contested. This component or boundary is suspect. Renders alarm on the canvas, appears in `due`, and has no path to disappearing except an agent resolving or dismissing it. Its value is that it cannot be silently ignored, because unresolved counts render first — the discipline `decisions.ts` already enforces for open conjectures.
- **`falsifier`** — a claimed counterexample: *this claim is false, here is the input.* This is the kind the evidence says actually moves behaviour, and it is the natural bridge to the revision brief's Increment 1: a human-authored falsifier the CLI can bind to an oracle is the cheapest possible version of `qualify`.

### Storage: extend `DecisionKind`, don't build a second ledger

A separate `.coherence/marks/` store means a second spelling of a domain the journal already models. Extending `DecisionKind` inherits, for free: dedupe by content hash, `resolve()`, the open/dismissed/resolved distinction that `decisions.ts` refuses to blur, per-session files that merge cleanly across branches, the index's journal tab, and hook delivery.

Set `agent: "human"` and let `derivedSessionId` fold same-branch/same-day marks into one file — which is exactly right for a person clicking things, and is the fallback that file already chose for a human typing a command.

The cost to weigh: it dilutes "a decision is a point where the work could have gone more than one way" and mixes human marks into agent-attribution statistics. That is a real objection and the reason to make `kind` carry the distinction explicitly rather than relying on `agent`.

### Addressing must be structural, and marks must stale

The revision brief's §12 lesson — free-form symbol strings should disappear — applies directly. The canvas holds a real graph node id, so the CLI mints the mark *from* it: node id, path, line, and **a content digest of the target region.**

When the digest changes, the mark goes stale rather than silently pointing at moved code. A note that survives its subject's rewrite is worse than no note; it is a confident wrong pointer. This is also the cheapest place in the whole product to prove out the brief's freshness-digest machinery, because a mark is low-stakes — nothing closes on it.

### Delivery rides the path that exists

`hooks.ts` already composes SessionStart text from `readDue`/`formatDue`, read-traces and experiments. An open human flag on a component in the current change set is the most relevant payload that mechanism could carry — and it is a *real* relevance signal, not one inferred from a dependency graph.

Which produces a claim worth testing: **Scope's back-channel is a cheaper test of the revision brief's Increment 4 than Increment 4 is.** Increment 4 proposes to select relevant unresolved obligations from changed symbols and dependency edges. A human flag skips the selection problem entirely — someone already said this is the relevant thing.

## Integration points

| Source | What Scope takes | Note |
| --- | --- | --- |
| `derive.ts:buildGraph` | nodes, edges, parentage | the one walk — do not add a second |
| `index-model.ts` | `Capped`/`capList`, `sources`/`total: null`, the `news` frame | the withheld-tail and UNMEASURABLE discipline |
| `panel.ts` | `Light`/`LightKind` + derivation | **hoist to shared** |
| `render-index.ts:172-251` | grid unit, DASH/tier, heat, orthogonal router | **hoist to shared** |
| `promise.ts` / `boundary.ts` | graded gates; invariant → chokepoint → oracle | |
| `status.ts` | `readStatus`, `gitStamp`, per-claim verdicts, `scope` | freshness and staleness |
| `decisions.ts` | `readJournal`, `resolve` | the stream, and the mark write path |
| `cfg.atlas` | crossings, tier, security, enshrined | plus a **new** entry for `--serve` |
| `structural.ts`, `evolution.ts` | `graphAtRef`, `diffGraphs`, churn | "as they were written", over time |
| `read-trace.ts`, `activity.ts` | what the agent actually read | the provenance layer |
| `floor.ts` | `Unrunnable`, `readJsonOrRefuse`, `requireDeclaredRoot` | the refusal idiom |
| `commands.ts` | register the verb | the totality oracle in `test/commands.test.ts` fails otherwise |
| `config.ts` / `types.ts` | a `scope?: { catalogs, serve, lod }` block | |

## Traps

| | Trap |
| --- | --- |
| `!!` | **Green by absence** on the canvas — undeclared rendering as clean |
| `!!` | **Nondeterministic layout** against `docs --check` |
| `!!` | **A fifth spelling of "green"** — new light semantics beside `panel.ts`'s |
| `!` | **Adapter code in the render path** |
| `!` | **The fifth complete dump** — no attention budget, no delta, unread like the other three |
| `!` | **Marks that do not stale** — a confident wrong pointer |
| `!` | **`--serve` as an undeclared trust crossing** |
| `!` | **The canvas becoming the authority** — a component that *looks* guarded is not guarded; the receipt is |

## Implementation path

Smallest demonstrated mechanism first, in the increment style the revision brief adopts.

**0 — Prerequisite refactor.** Hoist `Light`/`LightKind` out of `panel.ts` and the grid constants out of `render-index.ts` into shared modules. No new behaviour; `docs --check` must stay green through it.

**1 — Static `coherence scope`.** `scope.json` + `_scope.html`. Component-rank canvas only, deterministic layered layout, guarantee lights consumed from the hoisted module, provenance colouring by last-writing session. No adapters, no marks, no server.
*Success criterion:* regenerating on an unchanged tree is byte-identical, and a component with no claims is visually distinguishable from one whose claims all pass.

**2 — Marks, CLI-minted.** `coherence mark <node-id> --note|--flag|--falsifier`. Digest-anchored, staleable, delivered through `due`. The page shows the command; no server yet.
*Success criterion:* a flag on a component survives an unrelated edit, and goes stale on an edit to its own target region.

**3 — `--serve`.** Loopback, atlas crossing declared, POST shells to the CLI, no in-process derivation.
*Success criterion:* the served page and the static page render from the same `scope.json` with no code path that only one can reach.

**4 — Journal stream** as a live tab over the same model.

**5 — Catalog adapters, last.** An extension point is the hardest thing to un-ship, and by then the shape catalogs actually want will be known.

Steps 1 and 2 are the ones expected to change how the tool feels. Step 5 is the one most likely to be a mechanism with no subjects — worth counting instances before building, per this project's own addendum to the ladder.

## Open questions

1. Does a mark belong in the decision journal, or does mixing human and agent actors corrupt the attribution statistics the journal exists to preserve?
2. What is the smallest content digest that stales a mark on a real edit to its subject and *not* on a reformat?
3. Should the canvas draw inferred edges (`imports`, `calls`) with the same weight as declared ones (`atlas` crossings), or is confidence a visual dimension?
4. At what population does the layered layout stop being readable, and what is the aggregation that replaces it?
5. Can `--serve` and the static file genuinely share one renderer, or does the first interactive feature fork them?
6. Is a mark that nobody delivered to an agent worth anything, and how does the record distinguish recorded from acted-on?
7. Does provenance colouring survive `git` history rewrites, or does it need its own durable record?

## The line Scope must not cross

Scope is a projection. A component that looks guarded on a picture is not guarded — the receipt is what says so, at a named scope, on a named commit. Every honesty rule this harness has bought expensively elsewhere (stale is not green, skip is not health, absence is not success, a shortened list states its tail) has to survive translation into pixels, where they are far easier to lose and far harder to notice losing.

Which is the argument for the whole design above: Scope should not compute anything, decide anything, or grade anything. It should draw what the records already say, and give a human one narrow, well-addressed way to say something back.
