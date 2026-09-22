# The Scope shell

Scope is the reading: one surface that projects the model for a human, in
views. Six views ship: Glossary, Components, Structure, Invariants, Runs, and
Journal.

## Structure

The shell is a function of one state value. `src/readings/scope/model.ts`
holds the model: a glossary (concepts, metaphors, and, per project, rejected
names, trust levels, rulings, candidate overloads, uncertain terms), a layer
(a glossary present, or an absence with its reason), the spec model as
`loadSpecModel` returns it (components with their entrances, invariants with
their lifecycle state, counts, and the adapter's grade ladder), the run
records, the journal records with the work orders (folded by the journal's
own loader from their records, so each carries its current state) when
`.coherence/work` exists, the component interfaces as the language adapter
read them, and per view the reader's query, filters, and selection.

`build.ts` loads those truths once and embeds the state as JSON in
`public/_scope.html` with the styles and one inline script. Same inputs in,
byte-identical page out. With `--root <project>` it builds over another
project: that root's specs, runs, journal, and glossary (named under
`glossary` in `coherence.config.json`, else `glossary.json`) become the
domain layer beneath Coherence's own.

The page embeds a bounded window of the two stores that grow every session:
the latest run records plus every run holding some enforcement's latest
entry, and the latest journal records plus every open escalation and what
those records point at. Every verdict derived from the window equals the one
derived from every record, and the count left out is shown; the whole journal
is one `journal` command away. The agent query builds without the window.

In the browser, `page.ts` renders the embedded state with `renderShell`, a
pure function from state to markup. Every reader change is a state change
followed by a render; nothing shown is stored. The latest verdict per
enforcement, the kept-from-an-earlier-run marks, reliance, open escalations,
the Structure map, and every count are derived on each render, never
embedded.

## The views

**Components** is the tree with intent, counts per lifecycle state, and a
mass line reserved for the economy's measurement (`mass: not measured` until
it exists). Selecting a component shows its invariants.

**Structure** is one map of what the system is made of and how work flows
through it. `flowOf` in `structure-flow.ts` is the one pure derivation, read
by the SVG in `structure-flow-view.ts` and by `query structure`.

- Evidence. The map states what it stands on: static and computed, resolved
  references through the language adapter, declared entrances, and
  invariants. Observed runtime behavior is not shown. When the page was built
  without the adapter (a test, a scaffold preview, `--no-interfaces`), only
  the references the latest runs recorded to chokepoints and protected things
  are known, and the map says plain component interfaces are unknown.
- Component interfaces. `component-interfaces.ts` resolves every exported
  top-level declaration of every non-test source file and asks the adapter
  for its references; each non-test site in another component adds that
  symbol to the component interface from the caller to the callee. Every
  component interface is drawn, as an arrow from caller to callee; none is
  implied away.
- What an interface reveals comes from the invariants, never authored: the
  chokepoint that stands on it (a chokepoint symbol among its symbols), that
  invariant's crossing when trust changes there, and the classes of data that
  pass (the trust levels of its crossings). Such an interface is
  load-bearing, drawn strong; a plain one is quiet. A bypass the latest run
  classified on the pair draws it broken, with its count, and its inspector
  names the bypass sites and the two honest options. The label reads what
  the interface reveals in that order, else its most-referenced symbols;
  never a verb. Labels show on selection and focus.
- Entrances. Each is declared in a spec's `## entrances` (see
  `docs/spec.md`) and resolved again through the adapter; its flow starts at
  the component holding the handler, and a dispatcher's entrance is
  unreachable unless the component interface from the declaring component
  carries the handler.
- Stability. Positions are never stored, and each component is placed by its
  own facts alone: its column is its place in folder order among the visible
  components, its row one of five fixed bands from its share of incoming
  interfaces (callers high, callees low), a component that declares an
  entrance in the top band, and a component no interface touches in a band of
  its own. Adding one component interface moves only the two components it
  joins.
- Zoom. One level of the component tree at a time: the top level is open,
  and a component with children opens in place (its node stays for its own
  code). A closed component carries its children's interfaces at its edge.
  Source in no component's folder is its own labelled mass.
- One map. Selection is state (`state.structure.selected`, an id prefixed
  `structure--`) and lights one story while everything else dims: an
  entrance lights the interfaces the work can reach; a trust level lights the
  interfaces whose crossings carry that class of data (the security spine);
  a chokepoint lights every interface it stands on and lists its reliance,
  the classified reference sites of the latest run, owner first (a protected
  bypass is never a legal chokepoint reference, and an absent `sites` field
  is incomplete evidence, never zero); a component lights everything it
  reaches; an interface lights itself. The change selection is the diff's
  place: `compareFlows(before, after)` already measures entrance added or
  removed, interface added, removed, or widened, a chokepoint gaining a
  bypass, a crossing added or removed, and a data path gaining a branch;
  comparing with the previous commit, or one the agent names, is the next
  slice. The page writes the selection to the hash, and `followHash` reads
  it back.

**Invariants** shows every bullet: state, enforcement form with its latest
verdict, the chokepoint grade with the rung's enforcer, crossing over the
declared trust levels, because, refutation (witnessed, automatic from the
run, or missing), checklist, and what it lacks. A structural defect shows
its bypass sites and the two honest options: route through the chokepoint,
or escalate a retirement. Filters by state and component.

**Runs** lists the records latest first with session, agent, commit, dirty
flag, and counts; the verdicts one click away; on the latest, what the status
view keeps from earlier runs.

**Journal** is the merged timeline with kind glyphs, escalations awaiting a
human pinned at the top, a decision's rejected alternatives in the open, and
work orders when present, each the fold of its records (content, owner,
current state, history), never a state-change record shown as an order.
Filters by kind, agent, and session.

## Deep links

Every card or map id carries its view as a prefix (`component-`,
`structure-`, `invariant-`, `run-`, `journal-`, `work-`, and the glossary's
`coherence-` and `domain-`). A hash resolves to its view by that prefix, or
names a view alone (`#runs`). Links into the retired Reliance view
(`#reliance-…`) and the retired security-spine section (`#structure-<component>-<invariant>`)
land on the map's chokepoint selection, or on the trust level a crossing
leaves when there is no chokepoint. `resolveHash` in `derive.ts` is the one
place this is decided.

## The agent query

`node src/cli.ts query <question> [args]` answers a fixed set of questions
from the same state through `buildScopePage`: `invariants <path...>`,
`relies-on <chokepoint>`, `spine`, `structure`, `status`, `component <folder>`, `order`; and
`economy <path...>`, the economy prediction (what must be loaded to change
these files safely), which goes to the economy's own closure through the
warm instrument rather than to the page state. Plain text, a few hundred
tokens at most, no query language.

`query structure` reads the component interfaces through the language
adapter and formats `flowOf`: every interface with the label the map draws,
the entrances with where each starts or why it is unreachable, and the rows.
`query spine` lists the trust levels and every crossing-bearing invariant
from `structureOf`.

## Ephemeral Structure previews

`writeStructurePreview(root, preview, outPath)` in `build.ts` is the scaffold
bridge. `StructurePreview` is exported from `derive.ts` and carries only a
component, invariant name, crossing endpoints, and optional
chokepoint/protected-thing pairs. The bridge validates the component,
duplicate name, and crossing trust levels, selects Structure initially, and
writes a deterministic page with the proposal drawn dashed on its component,
unverified. It refuses an output path inside the project root so the
generated artifact cannot change the glossary or spec population between
otherwise identical previews. It changes no spec or run store, and the caller
cannot supply a grade, verdict, bypass count, lifecycle state, or reliance
evidence.

## Adding a view

1. Give the view a state type in `model.ts` and a field on `ShellState`.
2. Populate it in `loadState` in `build.ts`.
3. Write a pure render pair (tools and results) beside `glossary-view.ts`,
   with card ids under a new prefix registered in `resolveHash`.
4. List it in `VIEWS` in `shell.ts` and add its cases to `renderViewTools`
   and `renderViewResults`; add the file to `BROWSER_SOURCES` in order.
5. Top-level names are one name space across the browser sources; the
   builder refuses a duplicate by name.
6. Add what it must show to `check.test.ts`.
