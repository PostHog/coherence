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
server protocol on stdio, found in the adopter's `node_modules`, then
Coherence's own, then `PATH`.
Exportedness is not in the protocol, so the adapter reads the declaration
text. The second adapter, for Pyright, is a stub that names its ladder.

## The ladder

Every reference to the protected thing is classified: inside the chokepoint
(within the chokepoint symbol's range, or its module when the chokepoint is
a module), an import, a test reference (under a configured test folder;
reported, never a bypass), or a bypass.

- **visibility-choked**: not visible outside its module, no bypass.
- **reference-choked**: visible, but every reference is inside the chokepoint.
- **broken**: a bypass exists, or the chokepoint cannot be resolved. A
  structural defect; each bypass names file, line, and referencing symbol.
- **not chokeable**: the protected thing is not a symbol or a module; the
  totality oracle form is the compromise.

The top rung is adapter-defined. TypeScript enforces visibility, so its top
is visibility-choked. The second adapter's language does not: an underscore
prefix and a module's `__all__` list are conventions, so its chokepoints
top out at reference-choked.

## Refutation

A chokepoint refutes itself. The adapter opens an unsaved document beside
the protected thing that imports and uses it (for a thing not exported, an
unsaved edit of its own module), asks for references, and confirms the
synthetic site appears; nothing touches disk. If the instrument cannot see
the site, the check is vacuous: the run says so, the refutation is missing,
and the bullet stays a requirement. A totality oracle must be witnessed by
hand and written on the bullet as `refuted:`.

## The run and its view

A run appends one line to `.coherence/runs/<session>.jsonl`: time, session,
agent, commit, and one entry per enforcement: form, verdict, grade,
refutation, bypasses, test references, files, latency, reason. Nothing is
rewritten.

`run --status` is a view: the latest entry per enforcement across every run;
one the latest run skipped keeps its prior dated verdict, and the line says
so. `spec --check` reads the same view: an automatic refutation satisfies a
chokepoint bullet's refutation requirement, a passing verdict shows as
verified with its date, and a failing one makes the bullet a structural
defect. With no run, every enforcement is declared, unverified.

The totality oracle pass runs the test `via` names through the config's
`test` command; `testMatch` decides pass when a runner exits 0 on an empty
selection. Not configured is reported, never assumed passing.

## Revelation at the edit

The warm server holds the language server open across hook invocations:
`serve` runs it in the foreground; a client connects over a unix socket
under `.coherence/run/`, spawns it detached when none listens, and it shuts
down after a few idle minutes.

On PostToolUse for a file-writing tool, the hook re-checks only the
chokepoint invariants the file may involve (a prior run touched the file, or
a protected or chokepoint name appears in it) and appends the pass as a run. A bypass is printed as additionalContext in the same turn: the
invariant, the bypass site, and the two honest options, route the reference
through the chokepoint or escalate a retirement for a human. At Stop the
regulation message carries the structural defects the latest run left; at
SubagentStop one refuses the stop.
