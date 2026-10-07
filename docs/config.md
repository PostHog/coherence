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

## Adopting one folder of a monorepo

The project root is the folder holding the config. In a monorepo, put the
config, the specs and `.coherence/` in the folder you adopt, say
`apps/billing`, and nothing at the repository root:

- **Hooks.** Run `hooks install` from the folder. It writes the host's
  settings at the repository root, where a host started there reads them,
  and in the folder, for a session started there. `.coherence/.gitignore`
  goes in the folder only. `hooks --check` and `hooks uninstall` cover both
  settings files. The settings at the root reach every engineer who works in
  the repository. To adopt for yourself alone, run `hooks install --host
  claude --local`. It writes `.claude/settings.local.json` at the repository
  root instead, which Claude Code reads wherever in the repository it is
  launched and which is never committed.
- **Which project an event belongs to.** An edit belongs to the folder
  holding the nearest config to the file it writes. A command, prompt or
  stop belongs to the folder nearest its working directory. At the
  repository root, it belongs to the one project below. If there are
  several projects below, the hooks stay silent until the session works
  inside one of them.
- **Orient waits for the project.** A session started at the repository
  root hears one line at its start naming the adopted folder. Its prompts,
  stops and work elsewhere hear nothing. The first edit or command inside
  the folder carries the project's orient, once per session, and from then
  on the session's events are the project's.
- **Outside the project.** An edit, command or prompt elsewhere in the
  repository gets no answer. It reads no spec, walks no corpus and writes
  nothing. A command run at the repository root, such as an `enact` or
  `decide` the hooks printed, acts on the one project below it.
- **Paths.** Every path is relative to the folder, including the `ignore`
  list, `entryDir` and the files git reports as changed.
- **Language servers.** The language server is started on the folder. For
  Python, the repository root is added to Pyright's import search, so
  `from products.billing.models import ...` resolves. No file above the
  folder is indexed.
- **Chokepoint verdicts.** By default a verdict covers the folder alone. It
  says "references searched inside apps/billing only: callers elsewhere in
  the repository were not read" in the reason the run records. The
  `references` key widens the search. A reference found in a folder it names
  is classified like any other and named from the project root
  (`../../posthog/api/search.py:26`). The edit-time check runs only for edits
  inside the project, so a bypass added in another folder is found by the
  next `run`.

With the config at the repository root, nothing here changes.

## The project

| Key | Default | Meaning |
|---|---|---|
| `name` | the folder's name | The project's name, as Scope and the lexicon's project layer show it. |
| `language` | `typescript` | `typescript` or `python`: which language server the chokepoint check asks. A list (`["python", "typescript"]`) for a project that spans both; see [More than one language](#more-than-one-language). |
| `entryDir` | `.` | The folder holding the entry spec, the one that declares the trust levels. |
| `ignore` | none | Folders that are not this project's code or prose: vendored code, generated output, fixtures, promo material. A name matches that folder anywhere; a path matches from the root. Every walk (the spec, the lexicon check, the reading) leaves them out. |
| `lexicon` | `lexicon.json` | The project's lexicon file, relative to the root. |
| `wellKnown` | none | Names the project vouches for as well known (its vendors, its own product names), so the lexicon check does not nominate them as nouns to declare. |
| `references` | `"project"` | Where a chokepoint check searches for references: `"project"` (the project alone), `"repository"` (the whole repository), or a list of folders relative to the repository top (`["posthog/api", "ee"]`), searched beside the project. A verdict over less than the whole repository names every folder it searched. Each folder adds to the language server's work: on PostHog, `products/notebooks` with `["posthog", "ee"]` took 15.5 s and 1.1 GB for one check, against 4.8 s and 380 MB for the project alone. |
| `chokepointFrom` | `anywhere` | Which references a chokepoint governs when its bullet has no `from:` line: `anywhere`, `outside the component`, or `outside <folder>`. A bullet's own `from:` overrides it, and every run entry records which governed and who said it. Any other value is refused. See [spec.md](spec.md#which-references-a-chokepoint-governs). |
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
