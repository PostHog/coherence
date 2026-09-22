# Observation

An observation (glossary: observation) is a record of runtime behavior
captured from a named source, bound to a commit and a session. The first
source is the test pass: the batched totality pass the run already makes,
observed with per-test coverage. Observed behavior is its own labeled layer
of evidence beside Structure's static reading (glossary: structure,
evidence_tier); it is never blended into it unlabeled.

```sh
node src/cli.ts run --observe [--form totality-oracle] [--session <id> --agent <name>]
node src/cli.ts query observed [<component>]
node src/cli.ts query observed --failures [--since <commit>] [<component>]
```

## Capture: one invocation

`run --observe` is the ordinary batched pass with coverage added to its one
runner invocation (invariant: src/observation/one runner invocation). The
observer may add flags and environment to the command the config's
`testJson` names, and it is handed the report the runner wrote; it never
invokes the runner again. Without a `testJson` command there is no batched
pass, and nothing is observed: the run says so.

What each runner gives, measured on 2026-09-22:

| runner | attribution | how |
|---|---|---|
| node:test | per test | `src/observation/preload.ts`, loaded into every test child through `NODE_OPTIONS=--import`, takes V8 precise coverage (call counts, block detail) in the child's own isolate at a root `beforeEach` and `afterEach`. `NODE_V8_COVERAGE` writes one file per process, which is per test file; `--experimental-test-coverage` prints one table per run. Neither attributes to a test. |
| vitest | per run, or none | vitest attributes coverage to no test. With `@vitest/coverage-v8` or `@vitest/coverage-istanbul` installed, `--coverage.*` flags on the same command write istanbul JSON for the whole run, recorded as one region for the run. Without a provider, nothing is observed and the record says why. |
| pytest | per test | coverage.py runs the same pytest argv (`<python> -m coverage run --rcfile=<rc> -m pytest …`) with `dynamic_context = test_function`; the JSON export afterwards reads the data file and runs no test. Needs coverage.py in the interpreter the config names; without it, nothing is observed and the record says so. |

Per-test attribution is never fabricated (invariant: src/observation/
attribution never fabricated): a per-run region stays the run's.

The preload is inert in the runner's parent (no `NODE_TEST_CONTEXT`) and in
anything a test spawns: it deletes its variables once active, so a test that
runs `node` or `node --test` never observes itself. Its own hooks are
excluded from every region. What runs while a test file loads, before its
first test, belongs to no test and is dropped. Tests inside one file must
run one at a time for attribution to hold (node:test's default within a
file); a suite that runs a file's tests concurrently blurs them.

## Mapping: co-executed, never called

Executed code maps to the component whose folder is its nearest ancestor;
test files never count. The component interfaces are Structure's
(glossary: component interface): every exported top-level declaration,
resolved through the language adapter, with its references from non-test
code of another component. The observation keeps what the comparison needs:
each declaration's range and each reference site's position and form
(`src/observation/interfaces.ts`; when Structure's reading keeps sites and
ranges, this becomes a call to it).

A component interface `from -> to` is **crossed** in a test when a reference
site of one of its symbols sat in code of `from` that executed in that test
**and** the symbol's own body in `to` executed in the same test.

The limit, named: coverage records what executed, not who called whom. Both
ends ran in the same test; whether one called the other, coverage cannot
say. The record's `relation` is `co-executed`, and every reading says
co-executed, never called (invariant: src/observation/co-executed never
called). Two further limits follow from what executes:

- An import or re-export specifier is how a module reaches a symbol, not a
  use: never evidence. A site at a module's top level runs at load time,
  which no test owns: never evidence.
- A type has no runtime body, and a plain value has none either. An
  interface made only of those is reported as having no runtime body, never
  as never observed. Whether a declaration can execute is read from its
  keyword (and, for a constant, from the value's first token), never from
  coverage: after a reset V8 omits a function that has not run, so absence
  in coverage proves nothing.

Entrances (a spec's `## entrances`, on the Structure line) are exercised in
a test when their handler's body executed in it.

## Breakage

The same pass carries breakage. Per test the record holds its verdict
(pass, fail, skipped) and, for a failure, three separate facts
(invariant: src/observation/breakage kept apart):

1. **what broke**: the invariants whose totality oracle the test is;
2. **the likely site**: the first stack frame outside test files and inside
   the project, mapped to file, line, enclosing declaration, component, and
   the component interfaces that carry that declaration. It is labeled
   likely site: where a test failed is evidence about where the code broke,
   never proof;
3. **the region**: the components the test executed and the component
   interfaces it co-executed.

`query observed --failures --since <commit>` adds the suspect set: the
component interfaces the failing test co-executed whose declaration or
reference-site files the change set since that commit touched (the diff to
the working tree, and untracked files). A suspect is a place to look, not a
cause.

## Record and staleness

One line per observed pass in `.coherence/observations/<session>.jsonl`,
append only: `at`, `session`, `agent`, the work order binding, `commit`,
`dirty`, `source` (`test pass`, the runner, the attribution, a plain note),
`relation`, per test the verdict and region (and breakage), every component
interface known at capture with how many tests co-executed it, every
entrance, `totals`, and the latency of the pass and of the mapping. Every
known interface is listed, so "never observed" is a fact of the record.

The folder is transient under `.gitignore` (only journal, runs, and work
are durable): an observation describes one commit and is regenerated by
running again.

An observation whose commit is not the head, or whose tree was dirty when
it was captured, is **stale**, and every reader says so on every fact it
prints (invariant: src/observation/stale never current). The rule has one
home, `freshness` in `src/observation/record.ts`.

Dirty means the code differs from the commit: any change outside
`.coherence/`. The records there (journal, runs, work) are appended by every
session and by the run itself during the pass, and never execute; counted,
they would make every observation after a session's first run stale.

## The seam for the map overlay

`observedEvidence(records, head, from, to)` in `src/observation/record.ts`
is pure: from the observations and the head, what was observed about the
component interface `from -> to`: exercised (with the number of tests),
never observed, no runtime body, or no observation; its commit and
freshness; the attribution; the failing tests that co-executed it; and the
failing tests whose likely site lies on a symbol it carries. Scope draws
nothing from it yet.
