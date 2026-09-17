# Coherence (rebuild)

This branch rebuilds Coherence from zero. The previous implementation is the
reference: it is preserved at commit 645d928 on the reference branch named in
`docs/retired.md`, and it is used as a check against the new work and a source of
rejected alternatives, never as a source of code.

The vocabulary is settled in `docs/glossary.json`. Every concept there carries its
definition, the names rejected for it and why, and the reference mechanisms it
replaces. Nothing in this tree may introduce a name the glossary rejected.

Guiding artifacts kept from the reference:

- `docs/glossary.json` — the settled vocabulary (39 concepts). Vocabulary fields are injected; `detail` and `provenance` are shown in Scope only.
- `docs/glossary.md` — why the glossary is first-class: building, maintaining, and validating it, with the evidence.
- `docs/retired.md` — the reference mechanisms retired during the glossary pass, with reasons, and the reference branch name.
- `docs/reference/` — documents written in the reference's vocabulary; the vocabulary check does not read them.
- `docs/reference/glossary-inventory.json` — the raw 206-concept sweep the glossary was distilled from.
- `docs/checklist-seed.json` — the 36 invariant shapes for the decomposition checklist.
- `docs/reference/work-permissions-evidence.md` — transcript evidence on why the reference's work-order permissions were retired.
- `docs/reference/scope-structure-thesis.md` — design thesis for the Scope reading, in the reference's vocabulary.
- `docs/reference/data-is-destiny.md` — "Data is destiny" (Danilo Campos, CC BY-SA 4.0), the essential input for the Scope shell.

First slice: the glossary, the hook that injects it, and the drift check at
regulate. Second slice: the spec grammar and the spine (`docs/spec.md`), with
the scaffold that makes the complete shape the cheapest thing to produce.
Third slice: enforcement (`docs/enforcement.md`): the language adapter seam
over the language server protocol, the chokepoint check with its grade
ladder and automatic refutation, the totality oracle pass, the run, and
revelation at the edit through a warm per-project server.
Mnemion is the first adopter.

```sh
node src/cli.ts glossary                  # the compact form the hook injects; token estimate on stderr
node src/cli.ts glossary --check [paths]  # rejected names and unknown nouns; exit 1 with findings
node src/cli.ts spec --check [root]       # components, invariants with state, problems; exit 1 on problems
node src/cli.ts spec --json [root]        # the spec model
node src/cli.ts scaffold component <folder> "<intent>"
node src/cli.ts scaffold invariant <folder> "<sentence>" --kinds a,b [--chokepoint|--totality-oracle] [--write]
node src/cli.ts run [--session --agent]   # the chokepoint check and the totality oracle pass, one run appended; exit 1 on a structural defect
node src/cli.ts run --status              # the latest verdict per enforcement, a view over every run
node src/cli.ts serve                     # the warm language server for this project (spawned on demand otherwise)
node src/cli.ts hook <event>              # answer one harness event (event JSON on stdin)
node src/cli.ts hooks install --host claude|codex
node src/cli.ts hooks status
npm test
```

A project names its own glossary under `glossary` in `coherence.config.json`
(default: `glossary.json` at the root). SessionStart and SubagentStart inject
both layers with a short instruction; Stop reports the check over changed files;
SubagentStop refuses the stop (exit 2, reason on stderr) while findings remain.

## Settled before code

- Runtime and language are preserved from the reference: TypeScript on Node.
- Supported platform is Apple Silicon (M-series) only. That makes a local embedding
  service practical with no API key and no network.
- The drift check matches exact strings first. A similarity seam stays open for a
  local embedding pass (alias suggestion, overload detection); similarity improves
  the question, never decides it. Backend options are under survey.
- Mnemion is the first adopter; its domain glossary lives in its own repository.
