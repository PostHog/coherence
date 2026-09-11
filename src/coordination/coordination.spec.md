# Coordination

Combines work ownership, dependencies, consequences and trusted evidence into the next action an agent owes.

Work orders remain inert records rather than an execution engine. Orientation and regulation select obligations without granting new authority or disguising unavailable evidence as a clean state.

## invariants

- a weaker regulation obligation never masks a stronger one
- regulation evaluates and repairs the selected agent host
- work state is append-only, attributable, and predecessor-checked
- work cannot activate or complete before every dependency completes
- runnable work with overlapping write scopes is a collision, never concurrent permission
- a terminal parent has no live child and explicitly synthesizes every completed direct child
- authored work text is single-line data, never model-instruction control
- consequence navigation contains only explicit assessed edges
- specialized consequence relations admit only their declared endpoint kinds
- consequence evidence refuses surviving storage damage instead of shrinking navigation
- orientation refuses damaged evidence before selecting a swarm heading
- orientation admits verification state only with valid shape and comparable provenance
- verification currency follows material repository state without invalidating its own receipt
- orientation selects synthesis only when parent closure can execute it
- orientation derives live blockage only from closeable work state
- completed work remains unverified until an explicit verification edge names it

## refutations

- orientation admits verification state only with valid shape and comparable provenance: a parseable status row with `at: "not-a-time"` and `failures: "not-a-number"` was reported as current and allowed `STEADY`; missing commit provenance on either side was also treated as agreement. Runtime shape, canonical time, count, tier, and commit checks now refuse malformed evidence, while absent provenance remains stale.
- work state is append-only, attributable, and predecessor-checked: the first live four-agent field run replayed correctly in its originating worktree, but `.coherence/work/` still matched the repository's blanket ignore, so a fresh clone would lose every order, handoff, and closure. The repository guard now writes through the public CLI, commits under the live ignore policy, clones, and strictly replays the work instead of accepting that locally-correct but non-durable state.
- authored work text is single-line data, never model-instruction control: a work objective containing a newline and `SYSTEM:` was accepted and interpolated into SessionStart as a peer instruction. Work writers now reject C0/C1 controls, while hook rendering escapes them defensively at the instruction boundary.
- specialized consequence relations admit only their declared endpoint kinds: `work:a --produces--> decision:d` and `commit:a --produces--> work:b` were accepted even though the documented lifecycle defines production as work-to-commit. Endpoint validation now makes that relation exact rather than merely checking its source kind.
- a terminal parent has no live child and explicitly synthesizes every completed direct child: a parent could close with `synthesizedChildren: []` after a child completed, leaving an irreparable synthesis heading because terminal work cannot close again; a child created after parent closure remained dispatch-ready even though its join target was dead. Prospective graph validation now refuses both transitions before append.
- work cannot activate or complete before every dependency completes: readiness was projection-only, so a waiting work item could transition to active and then completed while its dependency stayed open; orientation accepted the impossible ordering. Every lifecycle write now validates the prospective graph and refuses that dependency-order violation.
- verification currency follows material repository state without invalidating its own receipt: a clean full status at `HEAD` remained `CURRENT` and allowed `STEADY` after a tracked source changed because orientation compared only commits. Live Git dirtiness now invalidates currency while excluding exactly `.coherence/status.json`, the receipt written after provenance was sampled.
- orientation selects synthesis only when parent closure can execute it: with parent work active, child A completed, and dependency-clear child B ready, orientation selected `SYNTHESIZE`; the only synthesis operation is parent closure, which correctly refused while B was live, so obeying the heading could not advance. Pending results now select synthesis only after that parent's children are terminal; otherwise the live sibling receives `DISPATCH`, `CONTINUE`, or `UNBLOCK`.
- orientation derives live blockage only from closeable work state: the first real-worktree `orient` canary emitted `UNBLOCK` with zero work orders because it counted 23 historical journal `blocked` reports. Those rows have no completion event, so the heading could never converge. They remain visible as historical evidence while only the append-only work lifecycle can select a live unblock action.
- consequence evidence refuses surviving storage damage instead of shrinking navigation: the first strict reader inspected only the final ledger directory, filtered for `*.jsonl`, and accepted a complete last row without its append newline. A symlinked `.coherence` parent could therefore redirect the read, renaming a surviving session file to `.bak` made the graph look clean and empty, and case-distinct sessions collided on case-folding filesystems. The reader now validates both directory components, every surviving entry, canonical append framing, and domain-separated hashed session addresses before admitting any edge.
- consequence navigation contains only explicit assessed edges: the live blind-handoff trial reconstructed the mission from explicit edges, but `.coherence/consequences/` was ignored, making that successful navigation disappear on clone. The same repository guard now commits a typed edge to a real Git endpoint, clones it, and requires both strict replay and a dangling-free orientation.
- a weaker regulation obligation never masks a stronger one: swapped `candidateCompare` from potential-first to doctrine-rule-first (2026-08-04), so the earlier lifecycle-control redirect masked the stronger current-patch decision when both were owed — full verify red by name, alongside the independent Stop mutation, at `claims: 32 · 30 green · 2 red`; the guard observed `redirect` where `require-decision` was required. Restored. This is the dangerous direction: a stable ordering that is stable on the wrong axis still makes the controller converge on lower-value work.

## works when

- boundary "a weaker regulation obligation never masks a stronger one" at selectRegulation via guard "regulate — ordered potential is permutation-invariant and monotone"
- boundary "regulation evaluates and repairs the selected agent host" at observeRegulation via guard "regulate — selected Codex host cannot be redeemed by Claude control"
- boundary "work state is append-only, attributable, and predecessor-checked" at readWork via guard "strict merged read — torn, tampered, detached, and competing histories all refuse"
- boundary "work cannot activate or complete before every dependency completes" at validateWorkGraph via guard "readiness and scope control — dependencies serialize potential overlap while runnable writers conflict"
- boundary "runnable work with overlapping write scopes is a collision, never concurrent permission" at detectWorkScopeOverlaps via guard "readiness and scope control — dependencies serialize potential overlap while runnable writers conflict"
- boundary "a terminal parent has no live child and explicitly synthesizes every completed direct child" at validateWorkGraph via guard "lifecycle — predecessor checks, handoff attribution, closure evidence, orphaning, and synthesis stay explicit"
- boundary "authored work text is single-line data, never model-instruction control" at createWork via guard "graph validation and input boundary — missing references, cycles, unsafe scopes, and evidence-free success are loud"
- boundary "consequence navigation contains only explicit assessed edges" at traceConsequences via guard "co-presence never invents a causal edge"
- boundary "specialized consequence relations admit only their declared endpoint kinds" at relationProblem via guard "semantic retries dedupe while specialized relation nonsense refuses"
- boundary "consequence evidence refuses surviving storage damage instead of shrinking navigation" at readConsequences via guard "damaged, forged, or displaced surviving rows refuse the whole projection"
- boundary "orientation refuses damaged evidence before selecting a swarm heading" at observeOrientation via guard "orientation refuses a damaged trusted source instead of reading it as empty"
- boundary "orientation admits verification state only with valid shape and comparable provenance" at verifyOrientation via guard "orientation refuses parseable malformed verification and never promotes missing provenance"
- boundary "verification currency follows material repository state without invalidating its own receipt" at verifyOrientation via guard "verification currency ignores its own receipt but rejects tracked source and index changes"
- boundary "orientation selects synthesis only when parent closure can execute it" at observeOrientation via guard "orientation dispatches a ready sibling before asking for parent synthesis"
- boundary "orientation derives live blockage only from closeable work state" at observeOrientation via guard "orientation treats journal blockage as history, not a live work state"
- boundary "completed work remains unverified until an explicit verification edge names it" at observeRegulation via guard "regulate — completed work requires an explicit verification link before release"

## why

**a weaker regulation obligation never masks a stronger one.** Regulation compares live
obligations by a lexicographic potential, with missing observations failing closed instead
of becoming zero, and returns the single strongest action owed. V2 evaluates only rules
declared in the live doctrine registry; even a no-action result makes no claim of overall
safety.

**regulation evaluates and repairs the selected agent host.** A canonical Claude control
cannot create a field around a Codex session, even though both hosts implement the same
lifecycle domain. The sensor therefore names the explicit or current host in its reading,
the decision identity retains it, and a lifecycle redirect installs that same host. A
foreign host value refuses before it can release or author a shell command.

**work state is append-only, attributable, and predecessor-checked.** A shared task board
that mutates in place loses the handoffs and rejected transitions a swarm most needs after
context loss. Each work order and transition is content-addressed in its writer session,
and the current state is a strict replay. Broken predecessors, competing successors,
detached histories, damaged rows, and missing graph referents refuse instead of resolving
by last-write-wins. The ledger is repository evidence rather than a machine-local queue;
the repository control therefore writes one through the public boundary, commits it,
clones the repository, and requires the strict reader to reconstruct it.

**work cannot activate or complete before every dependency completes.** Readiness is not
advice layered over the lifecycle; it is the lifecycle's ordering law. Every transition
and closure validates its prospective graph before append, so a caller cannot bypass a
waiting projection by naming `active` or `completed` directly. Cancellation remains a
terminal non-success and therefore does not satisfy a dependency that requires completed
output.

**authored work text is single-line data, never model-instruction control.** Work records
are repository-authored evidence on read, even when they were valid on write. Their text
crosses into SessionStart's model-instruction channel, so public writes reject C0/C1
controls and the hook renderer escapes such bytes again. A newline can remain visible as
data but cannot acquire the grammar of a peer instruction.

**consequence navigation contains only explicit assessed edges.** Decisions, work,
commits, experiments, verification, and defects already have addresses; temporal or path
proximity does not make one cause another. The consequence ledger stores an assessor,
evidence, typed endpoints, and a constrained relation per edge. Its graph traverses both
directions for navigation while retaining the authored direction, and strict reads refuse
forged, displaced, conflicting, or symlink-redirected evidence. Those edges are durable
only if they cross a clone boundary, so the repository control writes a typed edge to a
real commit, transports it through Git, and requires a dangling-free cloned orientation.

**specialized consequence relations admit only their declared endpoint kinds.** A generic
`relates-to` edge can connect any two supported addresses, but verbs such as `produces`,
`verifies`, `reveals`, and `repairs` carry lifecycle meaning. Their source and target kinds
are checked as a pair, keeping the typed graph from accepting grammatically valid nonsense
that its render would otherwise state with unwarranted confidence.

**consequence evidence refuses surviving storage damage instead of shrinking navigation.**
Absence is a legitimate first-use state; a surviving but unreadable, displaced, renamed,
or torn edge is not. If damaged bytes could disappear from the population, removing one
file suffix or final newline could erase the only path from a defect to its repair while
leaving an innocent empty graph. Storage framing and containment therefore belong to the
evidence contract, not merely to filesystem hygiene.

**orientation refuses damaged evidence before selecting a swarm heading.** The gyroscope
is a projection over independent instruments, not a new source of truth. It reads each
strictly, preserves source availability and denominators, and selects one deterministic
heading: refuse, resolve a collision, repair navigation, unblock, synthesize, dispatch,
continue, verify, or steady. A damaged source outranks every actionable-looking empty list.

**orientation admits verification state only with valid shape and comparable provenance.**
The status file is persisted JSON, not a TypeScript value at runtime. Orientation validates
the fields it uses—canonical time, commit shape, dirty bit, tier, and nonnegative failure
count—and refuses malformed evidence. A green report is current only when both repository
and report commit addresses exist and agree; missing provenance is stale, never an
implicit match.

**orientation selects synthesis only when parent closure can execute it.** Synthesis is
represented by the parent's terminal close, not by a separate mutable checkbox. A completed
child can therefore remain visibly unsynthesized while a ready, active, or blocked sibling
still owes work; selecting synthesis then would demand an operation the lifecycle refuses.
Only when that parent's children are terminal does synthesis become the executable highest
heading.

**orientation derives live blockage only from closeable work state.** A journaled impasse
is historical testimony and has no event that later marks it complete. Treating such rows
as the live scheduler makes the heading demand an action the record cannot ever discharge.
The work lifecycle owns current blocked state; journal incidents remain visible context
without acquiring scheduler semantics.

**completed work remains unverified until an explicit verification edge names it.** A
passing command nearby in time cannot establish which work it assessed. V2 regulation
therefore treats a completed work order without a `verification --verifies--> work` edge
as an obligation. This is deliberately stronger than command success and deliberately
weaker than a proof of semantic correctness. The edge must now resolve an intact current
local receipt bound to the same work definition and criteria; arbitrary legacy labels,
fast/imported evidence, skipped checks and changed inputs cannot clear it. Relevance and
executor trust remain explicit assessor judgments.

**runnable work with overlapping write scopes is a collision, never concurrent
permission.** Read and write scopes are repository-relative addresses. Dependency order
can make an overlap merely potential, but two dependency-clear or active writers whose
exact/tree scopes intersect are a live conflict. The projection blocks dispatch and names
both work ids and both scopes; ownership is explicit rather than reverse-engineered from a
shared diff.

**a terminal parent has no live child and explicitly synthesizes every completed direct
child.** A child returning is not evidence that its parent incorporated the result, and a
live child whose join target is closed has nowhere truthful to report. Prospective graph
validation therefore refuses parent closure until every direct child is terminal, requires
every completed child in the synthesis set, and refuses a late live child beneath a
terminal parent. Cancellation can settle a child but cannot masquerade as synthesized
success.

**verification currency follows material repository state without invalidating its own
receipt.** Matching `HEAD` identifies a commit, not the live index and working tree layered
over it. A source, staged, or untracked change therefore makes a clean report stale even
when `HEAD` did not move. The status file itself is the one excluded path because recording
the report happens after its Git sample; counting that receipt would make every successful
verification invalidate itself immediately.
