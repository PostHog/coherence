# Self-correction: the next phases

Coherence keeps a project's intentions checked, and it has to stay fast doing
it: a hook that makes the call cycle feel sluggish gets switched off, and
every check goes with it. This is the plan for making Coherence correct its
own cost and its own defects the way a closed-loop machine does: measure,
act on the measurement, and verify the action, at every timescale, without
waiting for a person to notice. Each phase rests on the one before it.

The decisions that set this direction: d-45f0a5f4 (deadline-aware hooks),
d-fcfc2649 (pending work stays visible), d-0d25f513 (the reduction loop).

## Phase 0: stabilize (now)

Velocity ran ahead of verification: every release from 1.3.0 to 1.5.1 let a
defect escape, about half the week's notable defects were introduced by the
week's own changes, and both blind reviews of the guard work found confirmed
defects. Before adding behavior:

- **The work meter** (#48): every expensive operation inside a hook (project
  file reads, child processes, coverage readings, spec model loads, language
  server requests, phrase comparisons) passes one counter, and invariants hold
  a hook's work independent of project size.
- **The upgrade test** (#47): a fixture adopter on the previous release
  upgrades to the candidate and nothing it did is turned against it.
- **Real-adopter verification** before every release: the candidate run
  against the PostHog adoption, hook by hook, before the version moves.
- **Defect classes, guard or decide, and the convergence reading**: every
  defect names its class and its origin; closing one needs a guard that makes
  the class unrepresentable or mechanically caught, or a decision saying why
  the instance fix suffices; a defect in an already-guarded class is a guard
  failure. `query convergence` reports defects introduced by fixes, escapes
  per release, guarded closures, repeats per class, and hook cost per version.
- **The invariant floor**: an invariant does not become a requirement without
  a decision saying why, as a practice keeps what its enactments taught.
- **Representations that rule out this week's classes**: a `ProjectPath` that
  only one function constructs (real path resolved, membership decided), and
  verdicts that cannot pass without the scope and freshness they cover.

Exit condition: a release verified on a real adopter with no escape.

## Phase 1: deadline-aware hooks (d-45f0a5f4, d-fcfc2649)

Work proportional to the project never runs inside a tool hook's own time.

- **Start early, never wait.** The earliest hook that could use a reading
  (session start, or a leaf's first entry) starts it detached and returns.
  Candidates: vocabulary coverage, the economy prediction, the gap reading, a
  whole Structure reading.
- **Deliver once, when ready.** The reading records its result with the tree
  state it read. Any later hook that finds it finished and fresh delivers what
  is new, once, at the cost of a stat and a key comparison. A stale result is
  used only where the change cannot reach it; the rest is re-read
  incrementally, file by file.
- **Pending is never invisible.** The hook that defers a reading names it,
  when it started, when it is expected, and how to collect it.
  `coherence pending` lists readings running, finished and undelivered, or
  stale; `collect` returns one or waits a bounded time. A stop with pending
  readings that bear on the session says so where the agent reads it. Orient
  and Scope show them. A reading leaves the list only when delivered or
  superseded.
- **Audience is a type.** Hook output is built only by one host-protocol
  module that maps a message's reader (agent or user) to the field that
  reaches it, per event and host.
- **Cost is a capability.** Project-sized operations need a handle a tool
  hook's context does not hold; background readings hold it.
- **Self-report.** A hook phase over its budget repeatedly records its own
  defect, naming the phase, the project's size, and the version.

Invariants: project-sized work happens at most once per tree state and never
inside a tool hook's time; a deferred reading not named where the agent reads
it fails a test; a pending reading never leaves the list undelivered.

## Phase 2: the reduction loop (d-0d25f513)

Coherence finds reducible complexity without being asked, turns it into
work, and verifies that the work paid off.

1. **Sensors.** Beside what the journal, runs, hook times, enactments and
   git already hold, PostToolUse records friction: a failed command and the
   shape of its error, per session. Repeats cluster on their own.
2. **Classes as data.** Each defect class carries its signatures (what an
   instance looks like in a defect or a friction record) and its reduction
   templates (the type, chokepoint, invariant or floor that rules it out). A
   classified defect arrives already carrying its candidate cure.
3. **Ranking and surfacing.** A background reading scores candidates by
   frequency, severity, spread and escapes: a recurring class, a file reworked
   again and again, a practice step deviated from repeatedly, friction across
   sessions, a hook phase drifting over budget, a requirement open for weeks.
   It has hysteresis, so it does not repeat itself, and it surfaces as one
   orient line pointing at `coherence query reductions`.
4. **Proposals become work.** Past a threshold, a candidate becomes a proposed
   work order carrying the reduction template, the sibling sweep, and guard or
   decide. A structural reduction is an escalation awaiting the owner; a
   mechanical one (another instance of an already-guarded class) any session
   may take.
5. **Payoff verification.** After a reduction lands, the convergence reading
   checks the class stopped recurring, the file cooled, the cost fell. A
   reduction that paid is confirmed, and its guard is now a sensor; one that
   did not is a guard failure and is escalated.

Repeated friction and repeated deviation also propose practices, or
amendments to the ones that exist: method harvested from evidence, beside
prevention harvested from defects.

## Open questions for the owner

- **Fleet telemetry.** Learning from adopters' hook costs and friction across
  installations would close the widest loop, but Coherence runs in other
  people's code: it would be opt-in, minimal (phase timings per version, never
  content), and a deliberate decision, not a default.
- **Thresholds.** Where a candidate becomes a proposal, and which reductions
  count as mechanical enough to take without the owner, are policy to settle
  once the reading shows real numbers.
