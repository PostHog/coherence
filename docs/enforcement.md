# Enforcement

Enforcement turns a requirement into an invariant by detection. A bullet
carries it as a chokepoint (`protects:` and `chokepoint:`) or a
totality oracle (`over:` and `via:`).

```sh
node src/cli.ts run [--session <id> --agent <name>]   # both passes, one run appended
node src/cli.ts run --status                           # the latest verdict per enforcement
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
module), an import, a test reference (reported, never a bypass), or a
bypass.

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

A chokepoint refutes itself. The adapter opens an unsaved document beside
the protected thing that imports and uses it (for a thing not exported, an
unsaved edit of its own module), asks for references, and confirms the
synthetic site appears; nothing touches disk. If the instrument cannot see
the site, the check is vacuous: the run says so and the bullet stays a
requirement. A totality oracle must be witnessed by hand and written on the
bullet as `refuted:`.

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

## The run and its view

A run appends one line to `.coherence/runs/<session>.jsonl`: time, session,
agent, commit, and one entry per enforcement: form, verdict, grade,
refutation, bypasses, test references, files, latency, reason. Nothing is
rewritten.

`run --status` is a view: the latest entry per enforcement across every run;
one the latest run skipped keeps its prior dated verdict, and the line says
so. `spec --check` reads the same view: an automatic refutation satisfies a
chokepoint bullet's refutation requirement, a passing verdict shows as
verified, and a failing one makes the bullet a structural defect. With no
run, every enforcement is declared, unverified.

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
