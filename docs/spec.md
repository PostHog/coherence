# The spec

A component is any folder with a spec file, `<Name>.spec.md`. Folders without
one are transparent; a super folder becomes a component when a relationship
invariant about its children needs a home. The spec holds a title, a one-line
intent, `## trust levels` in the entry spec only, `## entrances`, and
`## invariants`. No other section: the parser refuses the reference's sections
by name and says what replaced each.

## Entrances

An entrance is where work enters the system from outside it: a command, a host
event, a route, a tool. The component that receives it declares it, one bullet
each, with a one-line meaning and the handler that receives the work:

```markdown
## entrances
- run: an agent verifies the invariants and appends the run record
  handler: runCommand in src/enforcement/cli.ts
- SessionStart: the agent host starts a session
  handler: runHook in hook.ts
```

The handler is a symbol, or a symbol in a file read relative to the
component's folder and then to the root. The model checks that some file
declares it at its top level; a handler it cannot find is a spec problem, so a
declared entrance cannot rot unseen. Structure resolves the handler again
through the language adapter and starts the entrance's flow at the component
that holds the handler; when that is not the declaring component (the root
dispatcher declares each command family, and the family's handler lives where
the work is done), the component interface from the declaring component must
carry the handler, or the entrance is shown as unreachable.

```sh
node src/cli.ts spec --check [root]   # components, invariants with state, problems; exit 1 on problems
node src/cli.ts spec --json [root]    # the model
node src/cli.ts scaffold component <folder> "<intent>"
node src/cli.ts scaffold invariant <folder> "<sentence>" --kinds a,b [--chokepoint|--totality-oracle] [--crossing "a -> b"] [--preview] [--write]
```

## The bullet

Every bullet is an invariant. Its first line is the name and the sentence,
the abstract behavioral requirement; indented `key: value` lines carry the
rest. A value still in `<angle brackets>` is a placeholder: it parses, counts
as absent, and is listed as unfilled, so a scaffolded bullet can be written
first and filled second.

`--preview` requires a declared `--crossing "<level> -> <level>"`. It builds a
self-contained Scope page in a private system temporary directory, opens on
Structure, and adds the proposed crossing as a dashed, unverified edge. The
command prints the generated page path. The proposal is not run evidence: it
has no grade, lifecycle state, verdict, or reliance sites, and it does not
change the component spec. Add `--write` explicitly to append the same
scaffolded bullet, including the crossing, after preview validation succeeds.
`--kinds` and `--chokepoint` or `--totality-oracle` keep their ordinary
scaffold meanings; when omitted, the existing placeholder/default behavior
is unchanged.

Enforcement takes one of two forms, and a bullet may carry both as separate
evidence paths. The chokepoint form names the protected thing (a symbol or a
module) and the chokepoint every reference passes through:

```markdown
## trust levels
- storage: the rows beneath everything
- public-egress: what leaves in the clear

## invariants
- digest-only egress: A secret leaves storage only as its digest.
  protects: SECRET_COLUMNS
  chokepoint: seal
  because: a read of a leaked row must disclose no usable bearer
  crossing: storage -> public-egress
  refuted: removed the seal call from the row renderer -> the check went red naming the column (2026-09-17)
  kinds: credential, output
  checklist: redaction declared as digest-only egress
  checklist: encrypted-storage dismissed: the digest is the stored form; nothing is decrypted
```

The totality oracle form, the compromise where structure is not practical,
names the whole set the detector is total over and the test:

```markdown
- write-class totality: Every kernel pattern resolves to a declared write class.
  over: every pattern in KERNEL_TABLES
  via: write-policy totality
  because: an unclassified pattern must fail closed rather than become writable
  crossing: agent-mcp -> storage
  refuted: unclassified _members -> write-policy totality failed by name (2026-08-20)
  kinds: storage
  checklist: scoped-reads dismissed: reads are the capability invariant's
```

`because` says why the invariant exists and what it protects against.
`crossing` is the security marker: two trust levels the entry spec declares.
`refuted` is the human account of a witnessed firing: what was broken, what
was seen, the date. It is an account, not the evidence. A chokepoint form is
refuted by the run itself; a totality oracle form is refuted by running
`refute <component>/<name> --broke "…"` while the break is staged, which
requires the totality oracle to fail and appends a refutation record to the
run store, and the refutation counts only once a later run finds that same
totality oracle passing again. Refutation is required per enforcement, so a bullet carrying both
forms needs both.

## Lifecycle states

The check derives each bullet's state from what it carries:

- **requirement**: enforcement is absent, or an enforcement's refutation has
  not been witnessed, or the decomposition checklist has an applicable shape
  neither declared nor dismissed. A missing `kinds` line means the checklist
  was never run. A requirement whose check is failing stays a requirement and
  is reported with its failing check, never promoted.
- **invariant**: enforcement is declared, every enforcement's refutation is
  witnessed, and every applicable shape is answered.
- **structural defect**: an invariant whose satisfaction has been removed —
  the bullet is otherwise complete and the latest run found a bypass, an
  unresolvable chokepoint, or a failing totality oracle.

With no run and no refutation record, every enforcement reports as declared,
unverified and every bullet is a requirement: nothing in the tree has been
seen to fire. A missing `because` is reported as a lack but does not change
the state.

## Coherence's own spec

Coherence carries its own spec in this grammar. `Coherence.spec.md` at the root
is the entry spec: it declares the five trust levels (project-source, harness,
record, reading, instrument) and the project-wide invariants. One component
spec sits in each real unit under `src/`: journal, lifecycle, spec, scaffold,
enforcement, adapters, and readings/scope. Every bullet is a rule the tests
already settle: its totality oracle is a real test title, and where the
structure holds, its chokepoint names a real protected symbol and the one site
that reaches it, so `run` grades it and refutes it. `npm test` runs the
typecheck, the tests, the vocabulary check, and `spec --check`, so the tree
cannot go green with a spec problem.

## The checklist rule

`kinds` names what the requirement protects (read, credential, storage,
message, output, state, queue, budget, deploy, identity, encoding, revision;
or `none` for an examined empty set). Each shape in `docs/checklist-seed.json`
carries its kinds; the shapes whose kinds intersect are applicable, and each
needs one line: `<shape> declared as <invariant name>` (the bullet itself may
be that invariant) or `<shape> dismissed: <reason>`. The scaffold prints one
placeholder line per applicable shape with the shapes' sentences beside it.

## Practices

A spec may have a sister: the practice file beside it, with the spec's stem
(`Enforcement.practice.md` beside `Enforcement.spec.md`). It holds the
component's methods, one bullet each, in the same grammar, with no headings:

```markdown
- oil the knob: A knob is oiled before it turns.
  when: command turn-knob | edit src/widget/**/*.ts adding knob | explicit
  step: wipe the knob
  step: oil the knob
    leaves: an oil record
  pitfall: a dry knob seized (d-1a2b3c4d)
  learned: d-1a2b3c4d, 3f2e1d0
  invariants: knob turns
  because: a dry knob seizes
```

`when:` names what fires the practice: a command's words, an edited path's
glob with the text the edit adds, or `explicit`. Steps are numbered in the
order written; `leaves:` under a step names the evidence it leaves. Every
pitfall cites the record or commit that witnessed it, and a practice that
cites nothing is a problem. `invariants:` names invariants of the sister spec,
or `<folder>/<name>` elsewhere. A practice file never stands without its spec.

The hook delivers a practice whole when a tool use is about to fire it; a
session records it carried out with `coherence enact "<practice>" --step
<n>=done[:<evidence>]|deviated:<why>|skipped:<why>` for every step. Once
enacted, a step or pitfall leaves the practice only with a decision citing an
enactment. `coherence scaffold practice <folder> "<name>" "<sentence>"`
prints the shape; `coherence query practice` lists every practice.
