# Coherence

The repository-level reading surface: configuration, package contract, generated maps,
and the authored explanation of why the harness exists.

Implementation belongs to the nested source and test components. This root component
keeps only the files that establish how those components are built, read, and released.

## architecture

- {"kind":"purpose","id":"project-purpose","text":"Coherence helps people and agents keep a software project understandable and accountable as it changes. Authored specs name responsibilities and promises; a shared source model makes them navigable; verification tests declared claims; durable evidence carries decisions and results into the next session."}
- {"kind":"entrance","id":"cli","label":"Explore or check a project","component":"src","anchor":"src/cli.ts","description":"The CLI loads the project configuration and dispatches commands to derive maps, inspect evidence, verify promises and record work. Begin here for the command-driven life of a project."}
- {"kind":"entrance","id":"agent-session","label":"Start an agent session","component":"src/lifecycle","anchor":"src/lifecycle/hooks.ts#runHook","description":"Lifecycle hooks connect an agent host to repository instructions, prior decisions, assigned work and attributable observations. Begin here for continuity across sessions."}
- {"kind":"relationship","id":"command-model","from":"src","to":"src/derivation","label":"Requests the project model","because":"CLI reading and checking commands ask buildGraph for the source and spec population selected by project configuration. Derivation owns what enters that model."}
- {"kind":"relationship","id":"language-seam","from":"src/derivation","to":"src/adapters","label":"Delegates language interpretation","because":"Graph derivation resolves the configured language adapter and obtains symbols, imports and source prose through its shared adapter interface. Adapters own syntax and platform knowledge."}
- {"kind":"relationship","id":"model-verification","from":"src/derivation","to":"src/verification","label":"Supplies subjects and claims","because":"runVerify evaluates claims over the derived graph. Oracle discovery and named execution evidence determine which promises can receive recorded verdicts."}
- {"kind":"relationship","id":"model-diagnostics","from":"src/derivation","to":"src/diagnostics","label":"Makes change measurable","because":"Diagnostics combine the graph with source, Git observations and recorded baselines to measure declared populations, growth and evidence gaps. Each instrument retains its own limits."}
- {"kind":"relationship","id":"model-taxonomy","from":"src/derivation","to":"src/taxonomy","label":"Addresses classification subjects","because":"Taxonomy captures graph-resolved files and symbols for caller-assessed roles and facets. The resulting obligations remain suggestions until explicitly mapped and assessed."}
- {"kind":"relationship","id":"recorded-verification","from":"src/verification","to":"src/evidence","label":"Records scoped verdicts","because":"Verification publishes claim readings through recordVerify and can retain work-bound receipts. Skipped checks do not erase prior dated evidence."}
- {"kind":"relationship","id":"evidence-orientation","from":"src/evidence","to":"src/coordination","label":"Informs the next action owed","because":"Orientation strictly reads decisions, defects, experiments and verification state alongside work and consequence ledgers. Damaged evidence outranks an actionable-looking empty projection."}
- {"kind":"relationship","id":"work-instructions","from":"src/coordination","to":"src/lifecycle","label":"Supplies assigned work context","because":"Lifecycle startup reads the work graph for the exact owner session and renders its assignment without granting new authority or promoting peer work into an assignment."}
- {"kind":"relationship","id":"session-memory","from":"src/lifecycle","to":"src/evidence","label":"Preserves session continuity","because":"Lifecycle startup opens attributable journal sessions and reads trusted decisions. Later hooks retain activity and observations that explain what a session actually encountered."}
- {"kind":"relationship","id":"readable-model","from":"src/derivation","to":"src/readings","label":"Makes architecture navigable","because":"Reading surfaces project the canonical component hierarchy and declared promises into maps, context packets and human or agent explanations. Presentation creates no new verification authority."}
- {"kind":"relationship","id":"readable-evidence","from":"src/evidence","to":"src/readings","label":"Explains what was observed","because":"Reading surfaces join retained evidence to the subjects they describe, preserving unavailable sources, dated results and explicit attribution."}
- {"kind":"relationship","id":"executable-contracts","from":"test","to":"src/verification","label":"Exercises the harness contracts","because":"The configured test population supplies focused and end-to-end oracles. A test import alone is never proof that a named oracle executed or passed."}

## works when

- passes test "repository assemblies — contracts follow their chokepoint owners and composition stays thin"

- coherence.config.json exists at root
- passes test "control — this repository's own lifecycle control is PRESENT"
- passes test "repository voice — contributor startup keeps public capability changes tied to the global hook contract"

## refutations

- repository assembly ownership: the first migration retained nine line-wrapped rationale paragraphs at the old Harness core while their invariants moved. Global text conservation passed, but why-lint reported detached rationale at the new owners. The adoption guard now checks per-owner rationale as well as chokepoint ownership; the original paragraph text was relocated unchanged.

## why

The subsystem map must describe enforced ownership rather than presentation labels. Moving a chokepoint without its contract detaches the reading surface from the code it explains, while restoring a flat source bucket hides the boundaries again. The repository adoption guard therefore reconciles live anchors with their defining owners and keeps the composition root limited to its six entry and shared-contract modules.

An agent should encounter the project's purpose and its ownership seams before source
detail. The project hook wiring also records which repository reads informed a change and
which decisions survived it. Keeping coordination separate from implementation makes that
first read small while still checking that every deeper entry point is reachable.

This spec once claimed five obvious files existed at root; three were pruned rather than
dressed up, because a root claim earns its line only when the failure it detects would
otherwise be SILENT. `package.json`, `README.md`, and `src/cli.ts` fail loudly on their
own — npm, the reader, and the CLI itself all scream within seconds of their absence —
so claiming them was green weight that could never turn red for an interesting reason
(the Known-limits section calls that spec "coherent and worthless"). The two claims
kept from that pruning are the ones whose absence the system absorbs without a sound:
`loadConfig`
falls back to defaults when `coherence.config.json` is missing (verify would silently
run with no test runner, no serial pin, and the wrong testMatch), and a missing lifecycle
control kills the journal hooks with no host error at all. The latter used to be the weak
structural claim `.claude/settings.json exists at root`; now the root claims the binary
control reading itself for every host this repository supports. Its oracle checks each
host's three tracked parts—settings, stable launcher, and root mapping—their exact
composition, host-specific exclusion controls, the absence of a competing path, and the
runnable target. One meaningful claim is lighter and stronger than six
green file-existence claims. Fewer claims, honestly scoped, is still the trade this
harness teaches; making its own root spec take it is the least it owes.

The repository-specific SessionStart appendix is a third silent surface: if it vanishes,
the canonical consumer hook correctly falls back and no host reports an error, but a
contributor can add an agent-facing capability without reviewing the global startup
contract, protocol identity, host controls, or docs. Its claim therefore exercises the
real composition crossing and pins the maintenance trigger's named surfaces while proving
that the reminder stays out of consumer canon. This is project policy carried by the
project voice, not maintenance detail imposed on every adopter.
