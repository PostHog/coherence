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
| `language` | `typescript` | `typescript` or `python`: which language server the chokepoint check asks. |
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

A runner whose report is in none of those shapes (Playwright's JSON report,
for one) works through `test` and `testMatch` alone, one test per invocation.

## Not read

`typecheck` is named by older setup text but read by nothing yet (defect
df-b8084178); writing it does no harm and has no effect.

The spec grammar is in [spec.md](spec.md).
