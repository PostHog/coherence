# Enforcement

Enforcement turns a requirement into an invariant by detection. A bullet
carries it as a chokepoint (`protects:` and `chokepoint:`) or a
totality oracle (`over:` and `via:`).

```sh
node src/cli.ts run [--session <id> --agent <name>]   # both passes, one run appended
node src/cli.ts run --status                           # the latest verdict per enforcement
node src/cli.ts refute <component>/<name> --broke "…"  # the totality oracle with the break staged; it must fail
node src/cli.ts serve                                  # the warm language server, foreground
```

## The seam

The language adapter answers exactly the questions enforcement asks:
resolve a spec name to a definition; list every reference to it; say
whether the language enforces visibility and whether the thing is visible
outside its module; turn a `via` value into a test filter; and refute by
opening a synthetic reference.

A name resolves as a bare symbol (`writeClass`), a symbol in its file
(`KERNEL_WRITE_POLICY in policy.ts`), or a module path. Prose does not
resolve, and the check says so.

The first adapter drives `typescript-language-server` over the language
server protocol on stdio. Exportedness is not in the protocol, so the
adapter reads the declaration text. The second drives `pyright-langserver`
the same way; a package folder (`posthog/query_cache/`) resolves as a
module through its `__init__.py`.

## The ladder

Every reference to the protected thing is classified: inside the chokepoint
(the chokepoint symbol's range, or its module when the chokepoint is a
module), a test reference (reported, never a bypass), or a bypass. There is
no fourth class: every site the language server reports is a reference, an
import or re-export specifier included.

Two of those sites the language gives a form, and the form decides before
the range does (ruling `d-7abd1ba8`):

- A **plain import specifier** — type-only and namespace imports included —
  is **inside** when it sits in the chokepoint's own module. That one
  location is how the chokepoint reaches the thing, not a place the thing is
  used. The same import in any other module is a bypass.
- An **export-from specifier** or a **wildcard re-export** is a **bypass**
  wherever it stands, the chokepoint's own module included: it widens the
  thing's reach with no call at all.

Python's equivalents: `from x import y` or `import x` at the top of the
chokepoint's module is inside; the same import elsewhere is a bypass; an
import whose name the module's `__all__` lists is a re-export, and so is a
bare `from x import *`.

The adapter reads the form forward from the top-level statement the site
sits in, never backward for a terminator — the reading the dissolved import
heuristic could not make, which is why a bypass beneath a semicolon-less
bare import still grades broken. Neither language server reports a site for
a wildcard re-export (`export * from`, `from x import *`), so each adapter
scans its own source files for one, once per forget.

- **visibility-choked**: not visible outside its module, no bypass.
- **reference-choked**: visible, but every reference is inside the chokepoint.
- **broken**: a bypass exists, or the chokepoint cannot be resolved. A
  structural defect; each bypass names file, line, and referencing symbol.
- **not chokeable**: the protected thing is not a symbol or a module; the
  totality oracle form is the compromise.

The rungs are adapter-defined, each a fact the adapter verifies, and the
grade names who enforces it. TypeScript enforces visibility, so its top is
visibility-choked (the compiler). Python's ladder is in its own section
below.

## Refutation

Refutation is required **per enforcement**: a bullet carrying both forms
needs both.

A chokepoint refutes itself, and how it does depends on who enforces the
rung it earned.

**Coherence's own check is the enforcer.** The adapter stages the two
synthetic sites the import ruling could otherwise swallow, in one unsaved
pass: a use of the protected thing in the chokepoint's own module past the
chokepoint's range, and a re-export of it from a document beside it.
Nothing touches disk. The check then classifies each staged site with the
same function every other site goes through, and the refutation fires only
when it calls **every one** a bypass. A site the instrument could not see,
or one the check would call `inside` (the chokepoint covers everywhere the
language lets the thing be named) or `test` (the protected thing lives under
a test folder, so nothing can ever be a bypass), makes the check vacuous:
the run says which site and why, records not run, and the bullet stays a
requirement. A chokepoint named as a module has no inside that lies outside
its own range, so only the re-export is staged there, and the account says
so.

**The language is the enforcer** (`visibility-choked` in TypeScript,
`closure-choked` in Python). Coherence's check can never be made to fire
there: the compiler refuses every import of a thing the module does not
export, and the interpreter refuses every import of a name that is not a
module attribute. So the adapter stages the synthetic outside reference and
asks the language server for the diagnostic on it. A diagnostic that says
the name is not exported or not accessible **is** the refutation, recorded
as `refused by the language` with the diagnostic's own text (ruling
`rs-e93ecdd6`). Demanding Coherence's own firing there would leave the
strongest rungs weaker than the one below them.

A totality oracle is refuted by hand, and the refutation is a recorded
event, never a sentence. While the break is staged:

```sh
node src/cli.ts refute src/enforcement/"run appended never rewritten" \
  --broke "replaced the append in appendRun with a whole-file write" \
  [--session <id> --agent <name>]
```

It runs that bullet's totality oracle, **requires it to fail**, and appends a
refutation record beside the runs (kind `refutation`: the bullet, what was
broken, the failing verdict and its reason, at, session, commit, dirty). A
passing totality oracle appends nothing and exits non-zero. Then restore the
code and run `run`: the refutation counts as witnessed only once a run at or
after the record finds the same totality oracle passing again — red with the break, green
without it. The bullet's `refuted:` line stays as the human account and may
name the record; the account alone never satisfies the requirement.

## Python

Python enforces no visibility, so its ladder has four rungs, each a fact
the adapter verifies, and the grade names the enforcer:

- **closure-choked** (the interpreter): the protected thing is a
  function-local inside the chokepoint's body, never a module attribute,
  so nothing outside can import or name it.
- **checker-choked** (a checker the project runs): the name is
  underscore-prefixed and `pyrightconfig.json` or pyproject
  `[tool.pyright]` makes `reportPrivateUsage` an error; or, for a
  protected module, an import-linter rule in `.importlinter` or
  `[tool.importlinter]` names it. A project on mypy has no such rule, and
  the evidence says so.
- **reference-choked** (Coherence's check at the edit and in CI): the top
  rung when neither holds.
- **convention** (nobody): the underscore prefix or `__all__` exclusion
  alone; evidence, and the rung a vacuous refutation drops to.

Pyright indexes the whole workspace and the adapter never narrows it: a
Python reference can sit in any file, so a narrower root or include list
only proves the absence of a bypass inside what it sees, and Pyright
ignores a settings-level include under a project config anyway. On
PostHog (19,693 files) enumeration takes 2 s and 350 MB, the first
references query 3 s, later ones 0.5 s. `workspace/symbol` is never used
(30 s, 3.5 GB there); a bare name resolves by a text scan, then
`documentSymbol`.

The totality oracle pass runs pytest with `--junitxml={out}` and
`testFilterForm: "pytest"`: names go to `-k` joined with `or`, and the
JUnit report (or pytest-json-report's JSON) maps back by test name.

## dbt

dbt's parsed manifest is the instrument: dbt already resolves every `ref`,
`source`, and test attachment, so the adapter reads `depends_on` rather than
parsing SQL. A name resolves as a model (`orders`), a model in its file, a
model file as a module, or a folder of models as a module whose members are
every model file under it. Every `depends_on` edge into the definition is one
reference site, at the `ref(...)` or `source(...)` call that writes it, or at
the `name:` line of a test declared in YAML; an edge whose call no text search
finds (a ref the template computes) sits at line 1 and is never dropped. A site whose
referencing resource is a dbt test carries the instrument's test mark
(`testResource`), so a YAML test under a model folder is a test reference
wherever its file lies.

The ladder has one rung. A model whose access is protected or public may be
read by any model in the project, so **reference-choked** (Coherence's own
check) is the top. dbt's parser refuses a `ref` to a private model from
outside its group, which would be the dbt counterpart of `visibility-choked`;
that rung is not built.

The refutation stages one model the manifest does not hold, in memory,
beside the chokepoint (in the folder above a folder chokepoint): it reads
the chokepoint and the protected thing directly, so it is downstream of the
chokepoint and bypasses it, and its site comes from the same edge reading
every other site does. Nothing is written.

The manifest must be current. When a dbt file under the paths
dbt_project.yml names is newer than the manifest, the adapter runs the
configured `dbt.parse` command; when none is configured or the parse fails,
`ready` reports why and every question throws, so the run records not run.
On revenue-model a partial parse takes 1.5 s and a full one 3.3 s.

A project may name several instruments (`"language": ["dbt", "python"]`).
One composite adapter asks each member to resolve a name; the one that
answers owns every later question about it, and a name two members resolve
is ambiguous with both answers listed. The composite is ready only when
every member is.

The totality oracle pass has a runner per instrument. A `via` the dbt
manifest names as a test runs in one invocation of the `dbt` runner
(`dbt.testJson`, with the names joined by spaces for `--select` and
`{outdir}` a fresh folder for `--target-path`); its `run_results.json` maps
back by the name segment of each unique id, and a test at severity warn
passes with the warning in its reason. Every other `via` runs through the
project-wide runner. `dbt test` reads the relations as last built, so a
break staged in a model's SQL for `refute` needs that model built before
the refutation runs.

## The run and its view

A run appends one line to `.coherence/runs/<session>.jsonl`: time, session,
agent, commit, and one entry per enforcement: form, verdict, grade,
refutation, bypasses, test references, files, latency, reason. The
refutation field takes one of four values: `automatic` (the check called
every staged synthetic site a bypass), `refused by the language` (the
compiler or the interpreter refused the synthetic outside reference),
`witnessed` (a refutation record for a totality oracle, with a later passing
run), and `missing`. Nothing is
rewritten. `refute` appends its refutation records to the same files, marked
with `kind: "refutation"`.

A run exits non-zero when an enforcement failed and also when the instrument
was needed and could not answer: the totality pass runs the whole suite
before the first question, so the run holds the warm server's idle timer open
with a heartbeat and asks the instrument again afterwards. A run that proved
nothing must never read like a clean one.

`run --status` is a view: the latest entry per enforcement across every run;
one the latest run skipped keeps its prior dated verdict, and the line says
so. `spec --check` reads the same view: an automatic refutation or one
refused by the language satisfies a
chokepoint enforcement's refutation requirement, a refutation record with a
later passing run satisfies a totality oracle's, a passing verdict shows as
verified, and a failing one on a bullet that was otherwise complete makes it
a structural defect — an invariant whose satisfaction has been removed. A
requirement whose check is failing stays a requirement, reported with its
failing check. With no run, every enforcement is declared, unverified.

The totality oracle pass runs every test the bullets name in one invocation of the
config's `testJson` command (a combined name pattern, a per-test JSON
report) and maps results back by name; the record says so. One test per
invocation of `test` is the fallback when a runner cannot report per test.
Not configured is reported, never assumed passing. node:test ships no JSON
reporter, so `src/enforcement/node-test-reporter.ts` writes the jest-shaped
report from its events; Coherence's own config names it.

## Revelation at the edit

The warm server holds the language server open across hook invocations:
`serve` runs it in the foreground; a client connects over a unix socket
under `.coherence/run/` and spawns it detached when none listens; it shuts
down after a few idle minutes.

On PostToolUse for a file-writing tool, the hook re-checks only the
chokepoint invariants the file may involve (a prior run touched the file, or
a protected or chokepoint name appears in it) and appends the pass as a run. A bypass is printed as additionalContext in the same turn: the
invariant, the bypass site, and the two honest options, route the reference
through the chokepoint or escalate a retirement for a human. At Stop the
regulation message carries the structural defects the latest run left; at
SubagentStop one refuses the stop.
