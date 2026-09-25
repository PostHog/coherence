# Coherence: feature inventory

Everything Coherence does as of branch `promo` (2026-09-24), grouped by what the user gets. Names are the product's current names (lexicon terms, command names). Features without a settled name are marked _(unnamed)_; unfinished ones are marked _(planned)_ or _(partial)_. Retired mechanisms (docs/retired.md) are left out.

## Vocabulary (Lexicon)

1- **Lexicon** — the project's settled vocabulary: each concept with its definition, aliases, and the names rejected for it and why. `lexicon.json`, `docs/lexicon.json`
- **Two-layer vocabulary** _(unnamed)_ — Coherence's own lexicon sits beneath the project's, and inside the project the project's meaning wins. `src/lifecycle/project.ts`
- **Compact lexicon** — prints the short form of the vocabulary that the hook injects, with a token estimate. `coherence lexicon`
- **Lexicon check** — flags any rejected name in prose, specs, journal records, or code identifiers, and reports unknown nouns. `coherence lexicon --check`
- **Lexicon coverage** — ranks the recurring terms that have no definition, and the words whose meaning is at risk. `coherence lexicon coverage`
- **Sense review** — shows a term's definition and live contexts, and records a ruling on one use (confirmed, not domain, deferred, defect). `coherence lexicon review`
- **Lexicon proposals** — propose declaring, defining, aliasing, rejecting, renaming, or retiring a concept, then apply it with a recorded reason. `coherence lexicon propose` / `apply`
- **Lexicon recovery** — finishes an interrupted apply without overwriting edits made in the meantime. `coherence lexicon recover`
- **Lexicon draft** — writes out unsettled candidates, collisions, and review questions for a person to work through. `coherence lexicon draft`
- **Vocabulary baseline and changes** — remembers a session's starting vocabulary and reports the undefined terms and at-risk senses the session introduced. `coherence lexicon baseline` / `changes`
- **Lexicon readiness** — checks that a named set of terms is defined before work that depends on them starts. `coherence lexicon ready`
- **Similarity suggestions** — optional offline embedding model (runs locally on Apple Silicon) that suggests aliases and near-duplicates; it never decides. `coherence lexicon similar` / `model`
- **Well-known names** — names like Python or GitHub, the names the project vouches for, and the project's own name are never asked to be defined. `src/lifecycle/well-known.json`
- **Retired lexicon file migration** — a project still using the old file name is refused with a one-line migration. `src/lifecycle/project.ts`

## Specs & components

1- **Spec** — a markdown file that makes a folder a component and holds its intent and invariants in one bullet grammar. `*.spec.md`
- **Component** — any folder with a spec; nesting of folders is the system's topology.
- **Entry spec** — the root spec declares the project's trust levels and project-wide invariants. `Coherence.spec.md`
- **Entrance** — declares where work enters the system (a command, a host event, a route, a tool), with its handler and trust level. `## entrances`
- **Spec check** — lists every component and invariant with its state, plus every spec problem with file and line. `coherence spec --check`
- **Spec model** — the whole spec tree as JSON for tools. `coherence spec --json`
- **Retired-section refusal** _(unnamed)_ — an old or unknown spec section is refused by name, with its replacement. `src/spec/retired-sections.json`

## Invariants & enforcement

- **Requirement** — an invariant stated but not yet enforced, refuted, and checklisted; the spec shows what it still lacks.
1- **Invariant** — a requirement with enforcement, a witnessed refutation, and an answered checklist.
- **Structural defect** — an invariant whose enforcement has gone red; it is shown with its bypass sites and two honest options (route through the chokepoint, or escalate).
1- **Chokepoint check** — asks the language server for every reference to a protected thing and flags any that bypass the one site it must pass through. `coherence run --form chokepoint`
- **Chokepoint grade** — rates each chokepoint on a ladder: broken, reference-choked, visibility-choked, closure-choked, checker-choked, not chokeable. `src/enforcement/check.ts`
- **Automatic refutation** _(unnamed)_ — every chokepoint check proves it would fire by staging fake bypasses in memory; a check that misses one is called vacuous, not passing. `src/enforcement/check.ts`
1- **Totality oracle** — a named test that checks an invariant over a whole set, used where a chokepoint isn't practical. `coherence run --form totality-oracle`
- **Batched test pass** _(unnamed)_ — runs every named test in one test-runner invocation and maps results back by exact test name. `testJson` in config
- **Refute** — stages a real break and runs the test to prove it goes red, recording the refutation. `coherence refute <component>/<name> --broke "..."`
- **Decomposition checklist** — a checklist of 36 invariant shapes that fires when a requirement is declared, so related invariants are declared or dismissed. `docs/checklist-seed.json`
- **Reliance** — computed from the code, never declared: which components reference a chokepoint and so rely on its invariant. `coherence query relies-on`
- **Tree-wide invariants** _(unnamed)_ — project-wide rules like "typechecks" live in the entry spec, with the compiler as their enforcement. `Coherence.spec.md`

## Security (trust levels & crossings)

- **Trust level** — a short list of named classes of data or caller in the entry spec, each marked if it comes from outside the system's control. `## trust levels`
- **Crossing** — marks an invariant as a security boundary: `crossing: A -> B` names the trust levels on either side of its chokepoint.
- **Entrance trust** — each entrance declares its trust level, or has one derived from its handler's crossing and labeled derived; a mismatch is a spec problem.
- **No control marker** _(unnamed)_ — flags an entrance whose untrusted input reaches the system with no chokepoint where it enters. Scope Structure
- **Security spine** — lists trust levels and every crossing-bearing invariant in Structure order. `coherence query spine`
- **Crossing preview** — draws a proposed crossing on the Structure map as dashed and unverified, without touching any spec. `coherence scaffold invariant --preview`

## Verification runs

- **Run** — one verification pass, appended as a record: which invariants were checked, each verdict, the session, work order, and commit. `coherence run`
- **Run status** — the latest verdict for each enforcement, derived from every run so far. `coherence run --status`
- **Warm server** — keeps one language server per project running between calls so checks are fast; spawned on demand, one per root, restarts itself when the code changes. `coherence serve`
- **Warm server security** _(unnamed)_ — the server's socket requires a private token, and its HTTP answers only loopback, same-origin, tokened GET requests. `src/enforcement/server.ts`
- **Observation** — records per-test coverage from the same test run, mapped to components and their interfaces, bound to commit and session, and marked stale when the code moves on. `coherence run --observe`
- **Observed query** — shows which component interfaces tests exercise, which none do, and for failing tests what broke, the likely site, and the region touched. `coherence query observed`

## Journal

1- **Journal** — compresses a session's work into a handful of durable, attributed records, one append-only file per session, read back as one timeline. `coherence journal`
- **Decide** — records a choice, the alternatives rejected, and why. `coherence decide`
- **Retract** — withdraws an earlier decision and says what refuted it. `coherence retract`
- **Conjecture** — records a surprise, its possible explanations, and the test that would tell them apart; closed by resolved or dismiss. `coherence conjecture` / `resolved` / `dismiss`
- **Defect** — records a behavioral bug with its evidence (a user report, a reproducer, a field observation). `coherence defect`
- **Experiment** — a plan made falsifiable before acting: context, steps, success criteria, closed with a pass/fail per criterion. `coherence experiment create` / `close`
- **Unable** — records a wall the agent could not get past; it turns that debt into an advisory instead of a blocked stop. `coherence unable`
- **Escalate** — flags something a human must see; it heads every journal read and every session start until a human acknowledges it. `coherence escalate` / `acknowledge`
- **Citation** — a record can point at earlier records by id; the pointer is checked when written and shown both ways. `--cite <id>`
- **Human words** _(unnamed)_ — words the agent attributes to a human are kept in their own labeled field, apart from the agent's reasoning. `--human`
- **Attribution** — every record carries its session and agent; a write without both is refused.
- **Journal subjects** — just the subjects since a cursor, for a quick catch-up. `coherence journal --subjects`
- **Record lookup** — one record with everything it cites and everything citing it. `coherence journal <id>`

## Multi-agent coordination

1- **Work order** — a named unit of assigned work with an objective, success criterion, and file boundary, owned by one session and moved through states. `coherence work create` / `move` / `close` / `owner` / `inspect`
- **Work binding** _(unnamed)_ — journal records and runs bind automatically to the one active work order the session owns. `src/journal/work.ts`
1- **Peer feed** — before tool uses and prompts, injects the subjects of decisions and escalations other sessions recorded since this session last looked. `src/journal/feed.ts`

## Session lifecycle (hooks)

- **Gyroscope** — the lifecycle as a whole: keeps an agent session balanced from start to stop through host events.
1- **Orient** — at SessionStart and SubagentStart, injects any open escalation, the vocabulary, spec problems and open requirements, the session's work order, undefined terms, and the exact journal command with the session id. _(partial: the definition also names structural defects and unreached mass, which the start injection does not yet carry)_ `src/lifecycle/hook.ts`
- **Injection budget** _(unnamed)_ — the start injection steps down in detail to stay under the host's size limit, never shortening escalations. `CONTEXT_BUDGET`
- **Revelation at the edit** — at PostToolUse after a file write, re-checks the chokepoints that file may touch and shows any bypass in the same turn. `src/lifecycle/hook.ts`
- **Vocabulary at the edit** _(unnamed)_ — at PostToolUse, names only a new undefined term or at-risk meaning the edit just introduced. `src/lifecycle/hook.ts`
- **Read trace** — records the files a session read at each tool use, and snapshots them at Stop against the change and the economy prediction. `src/economy/trace.ts`
1- **Regulate** — at Stop and SubagentStop, reports what the session owes (rejected names in changed files, spec problems, structural defects, an open work order, new undefined terms); a subagent's stop is refused only for what the tool can prove. `src/lifecycle/hook.ts`
1- **Hook install** — merges Coherence's hooks into Claude Code or Codex settings, leaving other hooks untouched; uninstall removes only its own. `coherence hooks install` / `uninstall`
- **Hook check** — exits non-zero when installed hooks drift from what install would write (for CI). `coherence hooks --check`
- **Hook status** — shows the wiring per agent host and what each event will actually deliver in this project. `coherence hooks status`
- **Project confinement** _(unnamed)_ — the hook answers only for the project it was installed in; events from elsewhere are refused untouched. `src/lifecycle/hook.ts`

## Context economy

- **Economy** — the context closure of a change: what a reader must load to modify these files safely, with a token estimate. `coherence economy <path>`
- **Working-change economy** _(unnamed)_ — computes the economy of everything git reports changed, or of a whole branch since a commit, including dependents of deleted files. `coherence economy --changed [--since]`
- **Calibrate** — compares the economy prediction with what sessions actually read, labeling each outcome automatically from the journal and runs. `coherence calibrate`
- **Mass** — reports total and unreached code per component, where unreached means no invariant's enforcement reaches it; a reading, never a threshold. `coherence mass`

## Scope (the reading surface)

1- **Scope** — one live page projecting the whole model for a human, served locally by the warm server. `coherence scope`
- **Live updates** — journal records and runs appear on an open page as they're written, and a reconnecting page catches up without losing any. `src/readings/scope/live.ts`
- **Scope snapshot** — writes the page as one self-contained file with no outside dependencies, for this project or another. `coherence scope --snapshot [--root]`
- **Health masthead** _(unnamed)_ — the page leads with one large verdict: all verified, nothing enforced yet, or how many are broken.
1- **Structure view** — a transit-style map of components, the routes work takes from each entrance, and core dependencies. `structure-flow-view.ts`
- **Structural route** — each entrance's path through the components, drawn as one colored line with motion from caller to callee.
- **Component interface** — every place one component uses another is drawn on the map, labeled from its invariants.
- **Interface identifier** — a tag on a component interface where a chokepoint or crossing stands, filled by state: solid verified, hatched requirement, red broken.
- **Broken marks** _(unnamed)_ — a red mark on any component with a broken chokepoint that lists every bypass site; the map opens on the worst one.
- **Health strip** _(unnamed)_ — counts every invariant by verdict above the map, plus uncovered components; each count selects its set.
- **Trust-level selection** _(unnamed)_ — selecting a trust level lights every crossing that carries it: where sensitive data goes.
- **Reliance selection** _(unnamed)_ — selecting a chokepoint shows every component and site that references it.
- **Uncovered components** _(unnamed)_ — components no enforcement covers get a hollow bar and a not-covered mark.
1- **Change comparison** _(planned)_ — compares Structure with the previous commit to show what a change touched and weakened; the comparison function (`compareFlows`) exists, the view is a placeholder. `structure-flow.ts`
1- **Lexicon view** — the two-layer vocabulary, searchable, led by undefined terms and at-risk meanings, with provenance one click away.
1- **Components view** — the component tree with each intent and counts of invariants by state. _(partial: its mass line reads "not measured")_
1- **Invariants view** — every invariant with state, enforcement, grade, crossing, reason, refutation, checklist, and what it lacks; filterable and searchable.
- **Runs view** — the run timeline with session, agent, commit, and pass/fail counts, per-enforcement verdicts one click away.
1- **Journal view** — the merged timeline across sessions with escalations pinned, rejected alternatives shown, work orders, and citations linked both ways.
- **Deep links** _(unnamed)_ — every card has a link that opens the right view with it selected.

## Agent queries

- **Agent query** — the same answers Scope shows a human, as plain text for an agent. `coherence query`
- **Invariants for files** — which invariants touch these files. `coherence query invariants <path>`
- **Relies-on** — who references this chokepoint. `coherence query relies-on <chokepoint>`
- **Structure query** — the routes, core dependencies, and interface identifiers the Structure map draws. `coherence query structure`
- **Status query** — structural defects, open requirements, and escalations awaiting a human. `coherence query status`
- **Component query** — one component's intent, counts, and invariants. `coherence query component <folder>`
- **Order query** — the session's active work order with its citations and bound records. `coherence query order`
- **Economy query** — what must be loaded to change these files safely. `coherence query economy`
- **Lexicon query** — a term's full definition and every use. `coherence query lexicon <term>`

## Scaffolding & setup

- **Scaffold component** — creates a component folder and spec with its intent, never overwriting. `coherence scaffold component`
- **Scaffold invariant** — prints or writes an invariant with every slot as a placeholder, plus its checklist lines. `coherence scaffold invariant [--write]`
- **Config** — one file for the project facts the tool cannot derive: name, language, ignore list, typecheck and test commands, well-known names, interface budget. `coherence.config.json`
- **Agent setup prompt** _(unnamed)_ — a paste-in prompt that has an agent install Coherence, write config, hooks, lexicon, and specs, and report the result. `README.md`

## Platform / language support

1- **Language adapter** — the seam that lets chokepoint checks and reference lookup work across languages via each language's server. `src/adapters/`
1- **TypeScript support** — via the TypeScript language server; reaches the visibility-choked grade. `src/adapters/typescript.ts`
1- **Python support** — via Pyright and pytest; reaches closure-choked and checker-choked grades. `src/adapters/python.ts`
- **Agent host support** — Claude Code and Codex.
- **Platform** — Apple Silicon Macs only.
- **Project files only** _(unnamed)_ — only files git tracks (or untracked, not ignored) count as evidence; vendored checkouts are ignored. `src/adapters/project-files.ts`

## Shown in the promo so far

- Scene 8: **Lexicon** injected by **Orient** at SubagentStart (**Compact lexicon**, **Hook install**)
- Scene 9: **Journal** compressing transcripts (**Decide** and the other journal verbs)
- Scene 10: **Peer feed** and **Orient** across sessions
- Scene 11: **Revelation at the edit**: a **Chokepoint check** at PostToolUse via the **Language adapter** / **Warm server** catches a bypass (**Structural defect**)
- Scene 12: reduction to a **Chokepoint** plus a **Spec** edit
- Scenes 13–14: **Scope** **Structure view**, including **Broken marks** and **Change comparison** (the change comparison is still _planned_ in the product)
