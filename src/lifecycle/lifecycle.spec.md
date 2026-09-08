# Agent lifecycle

Connects supported agent hosts to repository controls, lifecycle instructions and attributable activity traces.

Installation, inspection and observed activation are distinct facts. Host-specific transports implement one lifecycle contract without promoting indirect activity into exact session evidence.

## invariants

- agent lifecycle preserves decisions and exposes the current change signal
- high-frequency lifecycle hooks start without the analysis dependency stack
- hook telemetry loss never kills PostToolUse
- session startup injects only the exact session's current work order
- session startup teaches the executable swarm loop without manufacturing authority
- session startup survives a damaged decision-journal path with named degradation
- lifecycle hook presence is one canonical runnable bit
- supported lifecycle hosts share one control contract without sharing host syntax
- current-session activation requires exact installed-bundle evidence
- customized hook text composes declared overrides and appends, degrading to canon on damage
- activity evidence is accepted only when identity, scope, time, and command agree

## refutations

- session startup survives a damaged decision-journal path with named degradation: with `.coherence/decisions` replaced by a regular file, SessionStart threw raw `ENOTDIR` before emitting any instructions. It now retains the exact host session, names `JOURNAL CONTROL unavailable`, performs no journal write, and exits zero.
- session startup teaches the executable swarm loop without manufacturing authority: after the work graph, orientation, and consequence ledger shipped, canonical startup still taught only the decision journal and experiment planning; an exact assignment printed `work inspect` but no safe way to accept, block, hand off, or close it. Startup now names the read-only heading and fleet reads for everyone, reserves create/handoff for explicit coordination authority, and emits state-valid lifecycle commands with the standing predecessor only beside work owned by that exact session.
- hook telemetry loss never kills PostToolUse: the original no-dependency canary sent `{}`, producing no read event and never exercising persistence. A real Read event with `.coherence/read-traces` replaced by a regular file threw `EEXIST` out of the hook. The runtime boundary now contains telemetry failure, stays byte-silent, and the canary carries the hostile target.
- high-frequency lifecycle hooks start without the analysis dependency stack: the live PostToolUse hook failed before reading its event with `ERR_MODULE_NOT_FOUND` for `web-tree-sitter`; the eager chain was `hook-cli → hooks → due → commands → phrasebook → oracle-domain → web-tree-sitter`. `npm ci` repaired the checkout but left the failure class intact. Moving executable phrasebook data injection to the CLI composition root dissolved the eager edge, and the isolated no-`node_modules` runtime canary now passes.
- agent lifecycle preserves decisions and exposes the current change signal: inserted an `emit` immediately after main Stop's calibration snapshot (2026-08-04), recreating the conclusion-echo failure and the deeper attribution error — shared-worktree state bought whichever main agent happened to stop another model turn. Full verify red this claim by name at `claims: 32 · 31 green · 1 red`; the runtime guard observed nonempty stdout even for the quiet main Stop. Restored. SubagentStop still restates because its parent may see only the final reply; main Stop now snapshots calibration with byte-empty stdout.
- lifecycle hook presence is one canonical runnable bit: loosened `inspectLifecycleHook` so `present` ignored `wiringPresent` and trusted only valid JSON plus the launcher (2026-08-03) — full verify named this claim as the sole red, `claims: 30 · 29 green · 1 red`; the guard's duplicate-canonical-group fixture observed the laundered `true`. Restored. This is the dangerous direction: a checker that accepts two firing paths is not a binary control, only a substring detector with a nicer report.

## works when

- hooks.ts imports ../evidence/decisions.ts
- boundary "agent lifecycle preserves decisions and exposes the current change signal" at runHook via guard "hooks — main Stop snapshots without feedback while SubagentStop alone restates"
- boundary "high-frequency lifecycle hooks start without the analysis dependency stack" at runHook via guard "PostToolUse starts from the source bundle with no dependency installation"
- boundary "hook telemetry loss never kills PostToolUse" at runHook via guard "PostToolUse starts from the source bundle with no dependency installation"
- boundary "session startup injects only the exact session's current work order" at assignedWorkInstructions via guard "SessionStart teaches the executable swarm loop and exact owned lifecycle"
- boundary "session startup teaches the executable swarm loop without manufacturing authority" at runHook via guard "SessionStart teaches the executable swarm loop and exact owned lifecycle"
- boundary "session startup survives a damaged decision-journal path with named degradation" at runHook via guard "SessionStart degrades around a damaged journal path without killing the session"
- boundary "lifecycle hook presence is one canonical runnable bit" at inspectLifecycleHook via guard "control — presence is the complete canonical bundle, never a partial or lookalike"
- boundary "supported lifecycle hosts share one control contract without sharing host syntax" at setLifecycleHookForHost via guard "Codex control — install is exact, idempotent, preserving, and runnable across nested paths"
- boundary "current-session activation requires exact installed-bundle evidence" at currentObservation via guard "hook status — exact current bundle activates; stale, direct, replayed, and damaged evidence does not"
- boundary "customized hook text composes declared overrides and appends, degrading to canon on damage" at composeHookText via guard "hook text — override replaces, append follows, and damage degrades to the canonical emission"
- boundary "activity evidence is accepted only when identity, scope, time, and command agree" at isActivityRow via guard "activity — internally inconsistent scope, time, and command rows are damage, not evidence"

## why

**agent lifecycle preserves decisions and exposes the current change signal.** Decisions
and risk are cheapest to surface while the agent still holds the context that produced
them; waiting for a later reviewer externalizes both reconstruction costs. The two stop
surfaces are not interchangeable: a subagent restates its report because its caller may
see nothing else, while the main agent has already shown its report to the user and is
never interrupted by shared-worktree state that may belong to another agent. Main Stop
keeps the calibration observation and emits no bytes; only SubagentStop carries the
journal and patch signal forward.

**high-frequency lifecycle hooks start without the analysis dependency stack.**
PostToolUse is the hottest and most fragile control boundary. Its eager import closure is
built-ins plus local lifecycle modules; parser registries enter only through the main CLI
composition root. The runtime canary copies the complete source tree into an isolated
project with no dependency installation and executes PostToolUse, so a future eager edge
to a parser package recreates the measured startup failure.

**hook telemetry loss never kills PostToolUse.** Read traces calibrate the context model,
but losing that observation is cheaper than breaking every tool call in an agent session.
The hook contains both dynamic-load and persistence failures, emits no canonical bytes,
and leaves the damaged target untouched. A real file-bearing hostile-target canary ensures
this contract exercises the write path rather than vacuously recording zero events.

**session startup injects only the exact session's current work order.** Assignment is
useful only if the receiving agent can distinguish its authority, success criteria,
dependencies, write scope, and collisions from another worker's. SessionStart reads the
work graph dynamically and emits only records whose owner session exactly matches the
host session; failure degrades to a named unavailable reading rather than breaking agent
startup.

**session startup teaches the executable swarm loop without manufacturing authority.**
Every agent gets the two inert readings that establish direction and fleet state, while
creation and handoff remain explicitly conditional on coordination authority. Only an
exactly owned live order acquires mutation examples, and those examples are selected from
its standing state and carry both the host session and predecessor token. After one write
the token expires and the hook says to inspect again; startup guidance therefore cannot
turn a stale instruction or a general orientation heading into last-writer-wins authority.

**session startup survives a damaged decision-journal path with named degradation.** The
journal carries decisions but cannot be allowed to prevent the agent that might repair it
from starting. SessionStart keeps the exact host identity in memory, emits the canonical
instructions plus a visible unavailable control, and skips the journal write when the
standing path cannot be read or opened. This is degradation, not silent adoption of an
empty history.

**lifecycle hook presence is one canonical runnable bit.** The control surface cannot
create a field if every repository is free to carry a merely similar—or silently dead—
hook. Printing, installation, and inspection therefore share one five-event value and
one stable launcher per host. Presence means exactly one shared project copy, no competing
local, inline, or legacy path, an aligned host/launcher root, a correct declared root
mapping, an enabled project-hook layer, and a runnable target. Unrelated hooks may coexist.
Historical journal activity is reported beside this bit but can neither redeem current
absence nor erase current presence.

**supported lifecycle hosts share one control contract without sharing host syntax.**
Claude and Codex expose the same five lifecycle meanings through different settings files,
matchers, launch commands, and response envelopes. Host parity therefore means deriving
each complete bundle from one host-selected domain while retaining a distinct fingerprint;
copying Claude bytes into Codex would be resemblance, not parity.

**current-session activation requires exact installed-bundle evidence.** Structural
presence proves that the project control is runnable, not that this session loaded it. A
session becomes observed only when its activity names the selected host, launcher
transport, and current bundle fingerprint. Direct probes, stale bundles, other sessions,
and a guessed newest session cannot establish activation; parent-session fallback stays a
named attribution ceiling rather than being promoted to child evidence.

**activity evidence is accepted only when identity, scope, time, and command agree.** A
row is useful precisely because later status and experiment readers stop re-deriving the
host event. That cached inference is safe only while its relational fields still agree:
agent attribution names the row session, parent fallback names its parent domain, event
identity recomputes, time is canonical, and command kind/result agrees with name and exit
code. One strict reader grades that whole relation; malformed rows become counted damage,
never partially trusted evidence.

**customized hook text composes declared overrides and appends, degrading to canon on
damage.** The canonical hook text is the harness's voice — identical across adopting
projects, and byte-testable because of it — but a project knows things the harness cannot:
its own commands, its conventions, the one warning its history taught it. So a project
gets a declared voice per event rather than a fork of the hook body, under one composition
rule with no conflict state: the override answers what the base is, the append answers
what follows it, and both may coexist; an empty override is a deliberate, visible silence,
not an error. Damage must degrade to the canonical emission at hook time, because the hook
body runs inside every agent session of every adopting project — a torn customization
file that broke sessions would make the journal's carrier the thing that kills the work it
records — so a tear costs exactly the customization, never the session, and the loud
surface for it is `hooks review`, where a reader is actually looking. Events with no
canonical emission — main Stop, PostToolUse — speak only with a declared project voice;
main Stop's canonical byte-silence and the attribution reasoning behind it stand unchanged
as the default.
