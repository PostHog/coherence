# coherence.config.json

The project facts Coherence cannot derive, in one JSON object at the project
root. Every key is optional; an absent key takes the default shown.

```json
{
  "name": "widgets",
  "language": "typescript",
  "ignore": ["vendor", "generated", "fixtures"],
  "test": "npx vitest run -t {filter}",
  "testMatch": "Tests +[1-9][0-9]* passed",
  "testJson": "npx vitest run -t {filter} --reporter=json --outputFile={out}"
}
```

## The project

| Key | Default | Meaning |
|---|---|---|
| `name` | the folder's name | The project's name, as Scope and the lexicon's project layer show it. |
| `language` | `typescript` | `typescript` or `python`: which language server the chokepoint check asks. A list (`["python", "typescript"]`) for a project that spans both; see [More than one language](#more-than-one-language). |
| `entryDir` | `.` | The folder holding the entry spec, the one that declares the trust levels. |
| `ignore` | none | Folders that are not this project's code or prose: vendored code, generated output, fixtures, promo material. A name matches that folder anywhere; a path matches from the root. Every walk (the spec, the lexicon check, the reading) leaves them out. |
| `lexicon` | `lexicon.json` | The project's lexicon file, relative to the root. |
| `wellKnown` | none | Names the project vouches for as well known (its vendors, its own product names), so the lexicon check does not nominate them as nouns to declare. |
| `interfaceBudget` | `{ "seconds": 600, "memoryMB": 12288 }` | The most time and memory the Structure reading's interface pass may take; when it runs out, the reading says it is partial. |

## Tests: how a totality oracle is run

A totality oracle names a test (its `via:` line); these keys say how to run one.

| Key | Default | Meaning |
|---|---|---|
| `test` | none | The command that runs tests whose name matches a filter: an argv array the filter is appended to, or a string containing `{filter}`. Without it, a totality oracle cannot run. |
| `testMatch` | none | A regular expression the test output must match to count as a pass, for a runner that exits 0 when no test matched the filter. Without it, the exit code decides. |
| `testJson` | none | One invocation for every test the bullets name at once: an argv array or a string with `{filter}` (a combined name pattern) and `{out}` (where the runner writes its report). The report may be jest-shaped JSON (`testResults[].assertionResults[]` with `ancestorTitles`, `title`, `status`), pytest's JUnit XML, or pytest-json-report's JSON. Without it, tests run one per invocation through `test`. |
| `testFilterForm` | `regex` | How a name filter is written: `regex` (titles escaped and joined with `\|`, as jest, vitest and node:test read a name pattern) or `pytest` (a `-k` expression). |
| `testDir` / `testDirs` | `__tests__`, `test`, `tests` | A folder name, or a list, whose files are tests, beside the built-in ones. |
| `latencyBudget` | `3` | The latency budget: the most seconds a tool hook (PreToolUse, PostToolUse) may take, counted from its process's start. A tool hook over it says so in its own answer; regulate names the session's calls over it, and orient the last week's. These hooks run around every tool call, and a call cycle that feels sluggish is how a hook gets switched off. |

A runner whose report is in none of those shapes (Playwright's JSON report,
for one) works through `test` and `testMatch` alone, one test per invocation.

## More than one language

A product with a Python `backend/` and a TypeScript `frontend/` is one
project. List both languages, and give each runner its own test setup under
`tests`:

```json
{
  "language": ["python", "typescript"],
  "tests": [
    {
      "language": "python",
      "cwd": "../..",
      "test": "pytest -c pytest.ini --rootdir . products/widgets/backend -k {filter}",
      "testJson": "pytest -c pytest.ini --rootdir . products/widgets/backend -k {filter} --junitxml={out}",
      "testFilterForm": "pytest"
    },
    {
      "language": "typescript",
      "test": "npx jest -t {filter}",
      "testJson": "npx jest -t {filter} --json --outputFile={out}"
    }
  ]
}
```

**Which language a file is.** Its extension decides: `.py` and `.pyi` are
Python; `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs` and `.cjs` are
TypeScript (a `.d.ts` file is neither). The two never share an extension, so
there is no per-folder override. The first language listed is the primary
one.

**Which server a chokepoint asks.** One warm server per root and language.
A chokepoint is checked by the server of the language its protected thing is
written in: the language of a file either value names (`seal in
backend/store.py`); else the language the invariant's latest run graded it
with; else each language whose files the component holds, in the listed
order, until one resolves the protected thing. A server starts only when a
check needs it: an edit to a frontend file re-checks through the TypeScript
server alone. The primary language's server keeps the plain file names under
`.coherence/run/` (`server.json`, `server.lock`); another language's carry
its name (`server-typescript.json`). Only the primary server answers the live
Scope reading over HTTP.

**Which setup runs a test.** Each test setup takes the keys of the table
above (`test`, `testJson`, `testMatch`, `testFilterForm`, `testDir` /
`testDirs`), and three of its own:

| Key | Default | Meaning |
|---|---|---|
| `language` | none | The language whose test files this setup claims, by extension. |
| `files` | none | Globs of the test files this setup claims, relative to the root (`*` within a folder, `**` across folders), in place of `language`. |
| `cwd` | the root | The folder the runner starts in, relative to the root: `../..` runs a product's tests from the repository root, against its own configuration. |

A totality oracle's test runs through the setup whose test files define it (a
pytest `def` or `class` of that name, or a quoted title for any other
runner), else the first setup whose test files spell its name, else the first
setup. Every setup runs its tests in one batched invocation. Without `tests`,
the single keys are the one setup, run at the root, as before.

**What a run records.** In a multi-language project each entry carries the
`language` that graded it (a chokepoint) or whose setup ran it (a
totality oracle). The run's `instrument.language` is the language whose server
answered, or the languages joined with `+` when several did, each listed
under `instrument.languages`.

**What reads one language.** The economy prediction reads each given file in
its own language. The Structure reading (Scope, `query structure`) reads the
primary language alone and says which languages it left unread (df-56343a7c).
Mass, the entrance detection, observation and `scaffold control` read the
primary language alone too (df-f47a5c05).

The spec grammar is in [spec.md](spec.md).
