# Coherence (rebuild)

This branch rebuilds Coherence from zero. The previous implementation is the
reference: it is preserved at commit 645d928 on the reference branch named in
`docs/retired.md`, and it is used as a check against the new work and a source of
rejected alternatives, never as a source of code.

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

## Settled before code

- Runtime and language are preserved from the reference: TypeScript on Node.
- Supported platform is Apple Silicon (M-series) only. That makes a local embedding
  service practical with no API key and no network.
- The drift check matches exact strings first. A similarity seam stays open for a
  local embedding pass (alias suggestion, overload detection); similarity improves
  the question, never decides it. Backend options are under survey.
- Mnemion is the first adopter; its domain lexicon lives in its own repository.
