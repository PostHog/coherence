# The Scope shell

Scope is the reading: one surface that projects the model for a human, in
views. Six views ship: Glossary, Components, Invariants, Reliance, Runs, and
Journal.

## Structure

The shell is a function of one state value. `src/readings/scope/model.ts`
holds the model: a glossary (concepts, metaphors, and, per project, rejected
names, trust levels, rulings, candidate overloads, uncertain terms), a layer
(a glossary present, or an absence with its reason), the spec model as
`loadSpecModel` returns it (components, invariants with their lifecycle
state, latest verdicts, counts, and the adapter's grade ladder), the run
records, the journal records with the work orders when `.coherence/work`
exists, and per view the reader's query and filters.

`build.ts` loads those truths once and embeds the state as JSON in
`public/_scope.html` with the styles and one inline script. Same files in,
byte-identical page out. With `--root <project>` it builds over another
project: that root's specs, runs, journal, and glossary (named under
`glossary` in `coherence.config.json`, else `glossary.json`) become the
domain layer beneath Coherence's own.

In the browser, `page.ts` renders the embedded state with `renderShell`, a
pure function from state to markup. Every reader change is a state change
followed by a render; nothing shown is stored. The latest verdict per
enforcement, the kept-from-an-earlier-run marks, reliance, open escalations,
and every count are derived in `derive.ts` on each render, never embedded.

## The views

**Components** is the tree with intent, counts per lifecycle state, and a
mass line reserved for the economy's measurement (`mass: not measured` until
it exists). Selecting a component shows its invariants.

**Invariants** shows every bullet: state, enforcement form with its latest
verdict, the chokepoint grade with the rung's enforcer, crossing over the
declared trust levels, because, refutation (witnessed, automatic from the
run, or missing), checklist, and what it lacks. A structural defect shows
its bypass sites and the two honest options: route through the chokepoint,
or escalate a retirement. Filters by state and component.

**Reliance** is computed from the latest chokepoint check's files: the
components that reference the protected thing, owner first. The view says
what the run record lacks (per-site symbols, references to the chokepoint
symbol itself).

**Runs** lists the records latest first with session, agent, commit, dirty
flag, and counts; the verdicts one click away; on the latest, what the status
view keeps from earlier runs.

**Journal** is the merged timeline with kind glyphs, escalations awaiting a
human pinned at the top, a decision's rejected alternatives in the open, and
work orders when present. Filters by kind, agent, and session.

## Deep links

Every card id carries its view as a prefix (`component-`, `invariant-`,
`reliance-`, `run-`, `journal-`, `work-`, and the glossary's `coherence-`
and `domain-`). A hash resolves to its view by that prefix, or names a view
alone (`#runs`). `resolveHash` in `derive.ts` is the one place this is
decided.

## The agent query

`node src/cli.ts query <question> [args]` answers a fixed set of questions
from the same state through `buildScopePage`: `invariants <path...>`,
`relies-on <chokepoint>`, `status`, `component <folder>`, `order`. Plain
text, a few hundred tokens at most, no query language.

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
