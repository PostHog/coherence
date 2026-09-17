# Coherence (rebuild)

This branch rebuilds Coherence from zero. The previous implementation is the
reference: it is reachable at branch `feat/totality-enumeration-gate` (commit
645d928) and is used as an oracle and a source of rejected alternatives, never as
a source of code.

The vocabulary is settled in `docs/glossary.json`. Every concept there carries its
definition, the names rejected for it and why, and the reference mechanisms it
replaces. Nothing in this tree may introduce a name the glossary rejected.

Guiding artifacts kept from the reference:

- `docs/glossary.json` — the settled vocabulary (38 concepts, 15 retirements).
- `docs/glossary-inventory.json` — the raw 206-concept sweep the glossary was distilled from.
- `docs/checklist-seed.json` — the 36 invariant shapes for the decomposition checklist.
- `docs/authority-evidence.md` — transcript evidence on why work authority was retired.
- `docs/scope-structure-thesis.md` — design thesis for the Scope reading.
- `docs/data-is-destiny.md` — "Data is destiny" (Danilo Campos, CC BY-SA 4.0), the essential input for the Scope shell.

First slice: the glossary, the hook that injects it, and the drift check at
regulate. Mnemion is the first adopter.

## Settled before code

- Runtime and language are preserved from the reference: TypeScript on Node.
- Supported platform is Apple Silicon (M-series) only. That makes a local embedding
  service practical with no API key and no network.
- The drift check matches exact strings first. A similarity seam stays open for a
  local embedding pass (alias suggestion, overload detection); similarity improves
  the question, never decides it. Backend options are under survey.
- Mnemion is the first adopter; its domain glossary lives in its own repository.
