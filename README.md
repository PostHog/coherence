# Coherence

Coherence keeps a project's invariants explicit and enforced while agents write
the code.

## Quick setup: paste this into your agent

```text
Set up Coherence (github.com/PostHog/coherence) in this project, then tell me
what it found.

1. Run `npm install -D github:PostHog/coherence` (with pnpm, first add
   `onlyBuiltDependencies: ["@posthog/coherence"]` to pnpm-workspace.yaml so
   it may build, then `pnpm add -D github:PostHog/coherence`). The command is
   `npx --no coherence`.
2. Write coherence.config.json at the root with "name" and "language"
   ("typescript" or "python"), plus "ignore", "typecheck" and "test" if the
   project has them.
3. Run `npx --no coherence hooks install --host claude`
   (use `--host codex` on Codex).
4. Run `npx --no coherence scaffold component . "<what this project does>"`,
   then scaffold one spec per major component folder.
5. Run `npx --no coherence spec --check` and `npx --no coherence scope`, and
   report what they show.

Then continue with "Full setup" in the Coherence README: the lexicon, trust
levels, invariants and enforcement.
```

It needs Node 22.18 or newer on macOS (Apple Silicon) or Linux. Until
`@posthog/coherence` is on npm, this installs from the GitHub repository,
which builds the package as it installs. A checkout kept beside the project
as ../coherence (or named by COHERENCE_HOME) also works, and the hooks prefer
it.

## What it is

Coherence settles the project's vocabulary in a lexicon, declares each
component's invariants in a spec, checks them through the language server,
records every decision in a journal, and shows the whole system live in Scope.

It was rebuilt from zero on the `distill` branch (merged into `main` on
2026-09-23; see pull request #1). The previous implementation is preserved at
commit 645d928 on the reference branch named in `docs/retired.md`; it was used
as a check against the new work and a source of rejected alternatives, never
as a source of code.

## Full setup: paste this into your agent

Until `@posthog/coherence` is on npm, this installs from the GitHub
repository. It needs Node 22.18 or newer on macOS (Apple Silicon) or Linux.

```text
Set up Coherence in this project. Work through these steps in order, and
report what each one found.

1. Install. Run `npm install -D github:PostHog/coherence`, which builds the
   package as it installs. With pnpm, first add `onlyBuiltDependencies:
   ["@posthog/coherence"]` to pnpm-workspace.yaml (pnpm runs no dependency's
   build script without it), then `pnpm add -D github:PostHog/coherence`. Do
   not `npm link` a checkout into the project. The command is
   `npx --no coherence` (call it `coherence` below); `--no` keeps npx from
   fetching an unrelated package if the install is missing. Check it with
   `coherence spec --check`. Teammates get it from the lockfile.

2. Config. Write coherence.config.json at the project root with: "name";
   "language" ("typescript" or "python"); "ignore" (folders that are not this
   project's code or prose: vendored code, generated output, fixtures, promo
   material); and, where the project has them, "typecheck" and "test" (an argv
   array the test-name filter is appended to, or a string containing
   {filter}), "testMatch" and "testJson". Read the usage that any unknown
   `coherence` command prints for the full surface.

3. Hooks. Run `coherence hooks install --host claude` (or `--host codex`).
   From the next session on, every session starts with Coherence's vocabulary,
   the project's open requirements, and the exact journal command, including
   the session id to pass with --session. The installed hooks look for
   Coherence at $COHERENCE_HOME, then ../coherence (also beside the main
   checkout of a git worktree), then the installed package; where none
   is found, each hook prints one line saying how to install it and exits 0.
   To add the project's own words to an event, write
   `.coherence/hooks/<Event>.append.md` (it follows what the hook says) or
   `.coherence/hooks/<Event>.override.md` (it replaces it; an empty one
   silences the event), where `<Event>` is SessionStart, SubagentStart,
   UserPromptSubmit, PostToolUse, Stop or SubagentStop. `{{session}}`,
   `{{agent}}` and `{{cli}}` are filled in; a refused subagent stop keeps its
   reason whatever the override says.

4. Lexicon. Run `coherence lexicon coverage` to see the recurring terms that
   lack a definition. Declare the ones that carry the project's domain
   meaning: `coherence lexicon propose declare <term> --definition "<one
   sentence>" --because "<why>"`, then `coherence lexicon apply <proposal id>
   --because "<why>" --over "<the alternative>" --session <id> --agent <your
   name>`. The first apply creates lexicon.json. Settle contested terms from
   the project's own history (commit messages and pull request discussions),
   and record your tie-breaks with `coherence decide`.

5. Specs. Run `coherence scaffold component . "<one-line intent>"` for the
   entry spec, then add its `## trust levels`: one bullet per level, written
   `- name (outside): meaning` for a level whose data or caller comes from
   outside the system's control. Scaffold one spec per component folder.
   Declare each entrance (command, route, event, tool) in the spec of the
   component that owns its handler, with `trust: <level>`. Add the few
   invariants that matter most (security, tenant isolation, data integrity)
   with `coherence scaffold invariant <folder> "<sentence>" --kinds <a,b|none>
   --chokepoint` (or `--totality-oracle`) `--write`, fill every placeholder,
   and answer the decomposition checklist it prints.

6. Enforce. Run `coherence run --session <id> --agent <name>`. For each
   bullet, stage a real break, run `coherence refute <component>/<name>
   --broke "<what you changed>"`, restore the code, and run again. A broken
   chokepoint is a finding, not a failure: report its bypass sites. Continue
   until `coherence spec --check` reports 0 problems.

7. Baseline, record and show. Run `coherence lexicon --check`, declare what it
   names that carries the project's meaning, then run `coherence lexicon
   baseline --session <id> --agent <name>`: the findings the project already
   held are recorded in the journal, and the check fails only on new ones.
   Commit coherence.config.json, lexicon.json, the specs, the
   hook settings, and .coherence/journal, .coherence/runs and .coherence/work.
   Run `coherence scope` and report what the reading shows: health, broken
   chokepoints, entrances whose trust comes from outside with no traced
   control on their route, and components no enforcement covers. "No traced
   control" means Coherence could not trace one, not that none exists: close
   each with `guard:` where a verified chokepoint wraps its handler, an
   invariant whose crossing enters from its trust, or `control: none —
   <reason>` where it needs none (`coherence scaffold control <entrance>`
   proposes which).

Record every non-obvious choice with `coherence decide "<chose>" --over
"<rejected>" --because "<why>" --session <id> --agent <name>`. Never use a name
the project's lexicon rejects, nor one Coherence rejects where you name
Coherence's own concepts (records, spec grammar); the project's own words keep
the project's sense. `coherence lexicon --check` finds them.
```

The vocabulary is settled in `docs/lexicon.json`. Every concept there carries its
definition, the names rejected for it and why, and the reference mechanisms it
replaces. Nothing in this tree may introduce a name the lexicon rejected.

Guiding artifacts kept from the reference:

- `docs/lexicon.json` — the settled vocabulary (40 concepts). Vocabulary fields are injected; `detail` and `provenance` are shown in Scope only.
- `docs/lexicon.md` — why the lexicon is first-class: building, maintaining, and validating it, with the evidence.
- `docs/retired.md` — the reference mechanisms retired during the lexicon pass, with reasons, and the reference branch name.
- `docs/reference/` — documents written in the reference's vocabulary; the vocabulary check does not read them.
- `docs/reference/lexicon-inventory.json` — the raw 206-concept sweep the lexicon was distilled from.
- `docs/checklist-seed.json` — the 36 invariant shapes for the decomposition checklist.
- `Coherence.spec.md` — the entry spec: the five trust levels and the project-wide invariants, in Coherence's own grammar.
- `src/journal/Journal.spec.md`, `src/lifecycle/Lifecycle.spec.md`, `src/spec/Spec.spec.md`, `src/scaffold/Scaffold.spec.md`, `src/enforcement/Enforcement.spec.md`, `src/adapters/Adapters.spec.md`, `src/readings/scope/Scope.spec.md` — one component spec per unit; every bullet names a real test as its totality oracle and, where the structure holds, a real chokepoint.
- `coherence.config.json` — the config the run reads for Coherence itself: language, the test commands, and the node:test reporter the batched totality oracle pass needs.
- `docs/reference/work-permissions-evidence.md` — transcript evidence on why the reference's work-order permissions were retired.
- `docs/reference/scope-structure-thesis.md` — design thesis for the Scope reading, in the reference's vocabulary.
- `docs/reference/data-is-destiny.md` — "Data is destiny" (Danilo Campos, CC BY-SA 4.0), the essential input for the Scope shell.

First slice: the lexicon, the hook that injects it, and the drift check at
regulate. Second slice: the spec grammar and the spine (`docs/spec.md`), with
the scaffold that makes the complete shape the cheapest thing to produce.
Third slice: enforcement (`docs/enforcement.md`): the language adapter seam
over the language server protocol, the chokepoint check with its grade
ladder and automatic refutation, the totality oracle pass, the run, and
revelation at the edit through a warm per-project server.
Mnemion is the first adopter.

```sh
node src/cli.ts journal                   # merged project history across every session
node src/cli.ts journal --subjects        # subjects and a cursor; --since <cursorOrIso> reads what followed
node src/cli.ts lexicon                  # the compact form the hook injects; token estimate on stderr
node src/cli.ts lexicon --check [paths]  # rejected names and unknown nouns; exit 1 with findings
node src/cli.ts spec --check [root]       # components, invariants with state, problems; exit 1 on problems
node src/cli.ts spec --json [root]        # the spec model
node src/cli.ts scaffold component <folder> "<intent>"
node src/cli.ts scaffold invariant <folder> "<sentence>" --kinds a,b [--chokepoint|--totality-oracle] [--write]
node src/cli.ts run [--session --agent]   # the chokepoint check and the totality oracle pass, one run appended; exit 1 on a structural defect
node src/cli.ts run --status              # the latest verdict per enforcement, a view over every run
node src/cli.ts serve                     # the warm language server for this project (spawned on demand otherwise)
node src/cli.ts hook <event>              # answer one harness event (event JSON on stdin)
node src/cli.ts hooks install --host claude|codex [--command "<prefix>"]
node src/cli.ts hooks uninstall --host claude|codex   # removes only Coherence's commands; other hooks and settings stay byte for byte
node src/cli.ts hooks --check --host claude|codex     # exit 1 naming each event missing, stale, or extra against what install would write
node src/cli.ts hooks status                          # the wiring per agent host, and what each event delivers for this project
npm run spec:check                        # the spec check alone
npm test                                  # typecheck, tests, vocabulary check, spec check; any one failing fails the tree
```

A project names its own lexicon under `lexicon` in `coherence.config.json`
(default: `lexicon.json` at the root). A project still carrying the file under
the concept's retired name is refused with the one-line `git mv` that migrates
it; the old name is never read. SessionStart and SubagentStart inject
both layers with a short instruction, the journal read command, and a decision
write template. This checkout carries hooks for both Claude Code and Codex;
`node src/cli.ts hooks status` reports their installation and what each event
carries here (orient at the starts, the peer feed at prompt and tool boundaries,
regulate at the stops), and `hooks --check` is the CI form. Stop reports the check
over changed files; SubagentStop refuses the stop (exit 2, reason on stderr) while findings remain.

## Lexicon workflow

Coverage, preview/apply maintenance, sense review, drafting, incremental checks,
and optional local similarity are described in [Lexicon operations](docs/lexicon-operations.md).
Run `node src/cli.ts lexicon help` for the command surface. Coverage counts
observations and unresolved questions; it is not a semantic-completeness score.

## Test setup

Use Node 22.18 or newer and Python 3.10 or newer. From the checkout root:

```sh
npm ci
npm run test:setup
npm test
```

`test:setup` creates `.venv` and installs the pinned pytest version from
`requirements-test.txt`; it does not change the system Python. Run it again
when that file changes. The environment is ignored by git. Tests themselves
never install dependencies or need a network connection.

`npm test` includes the real pytest integration, not just its report reader.
A missing interpreter or pytest is a failure with setup instructions, not a
skip. `npm run test:python` runs the Python adapter tests alone.

The tests find `.venv/bin/python` relative to this checkout, even when their
working directory differs. Set `COHERENCE_PYTHON` to use another interpreter
with pytest; an invalid override fails instead of falling back silently.
During `test:setup`, the same variable selects the Python that creates `.venv`.

## Releasing

The package is `@posthog/coherence` on npm. `npm run build` compiles `src`
into `dist` (Node will not strip types under node_modules) and carries the
files the compiled modules read: data, the stylesheet, the Scope browser
sources already stripped, and the one font file with its license. The build
runs as `prepare`, so `npm ci`, `npm pack` and an install from the git
repository all build. `node-llama-cpp` is an optional peer: a project that
wants the local embedding pass installs it beside Coherence.

To release, bump `version` in package.json on main, then run the Release
workflow from the Actions tab. It publishes through npm trusted publishing
from `.github/workflows/release.yml` in the `Release` environment, with
provenance and no stored token, and refuses a version npm already has.

## Settled before code

- Runtime and language are preserved from the reference: TypeScript on Node.
- macOS on Apple Silicon is the primary platform and Linux is supported; Windows
  is not. The optional local embedding service runs on Apple Silicon only, with
  no API key and no network; elsewhere exact matching still works.
- The drift check matches exact strings first. A similarity seam stays open for a
  local embedding pass (alias suggestion, overload detection); similarity improves
  the question, never decides it. Backend options are under survey.
- Mnemion is the first adopter; its domain lexicon lives in its own repository.
