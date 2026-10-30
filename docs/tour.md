# A tour of Coherence

## See the system: Structure and Connections

`coherence scope` opens Scope, a live page that projects the whole model of
your project for a human. It leads with one verdict (all verified, nothing
enforced yet, or how many invariants are broken). Its first two views show
what the system is made of.

**Structure** shows the project as a relief, one block per component (a
folder that carries a spec), each standing on its parent's platform.

- A block's **footprint** is its share of a measure you pick: lines, lines no
  invariant reaches, invariants, refutations, crossings, how much other
  components lean on it, or open defects.
- Its **height** is churn: how often it changed in the window you pick.
- Folders with no spec inside a component stand as **districts**, so code
  no spec covers still has a place.
- Pick two commits, or a commit and the working tree, and each block shows
  the lines added and deleted between them.
- What agents read and edit lights up as they do it, so you can see where a
  session is working.

Double-click a platform or block to step into it.

![Scope's Structure view of Coherence itself: each component is a block on the project's platform, its footprint its lines and its height how often it changed in the last 30 days, the lines added and deleted since the last release shown as green and red meters on each block, and the components ranked in a list beside it.](https://raw.githubusercontent.com/PostHog/coherence/main/docs/images/scope-structure-relief.jpg)

**Connections** shows how components use one another, starting from one
entrance or one component. Columns are hops from that start, and **+N** on a
card brings in what lies one hop further out.

- Each **chokepoint** is drawn once, at the door of the component it
  protects. Select the door to see every caller that reaches the protected
  thing through it.
- **Core dependencies**, the components most others call, are chips on the
  cards that use them, so they don't tangle the view.
- Select a component to see every **entrance** whose work reaches it: how
  many hops away, through which component, and the trust level it carries
  in.

Every line comes from resolved references the language server reports, not
from a diagram someone drew and forgot to update. When an agent changes how
components relate, the view changes with it.

![Scope's Connections view started from the Journal component: the entrances whose work reaches it on the left, the components that call it in the next column, the components it calls on the right, and beside them the list of every entrance that reaches it and through which component.](https://raw.githubusercontent.com/PostHog/coherence/main/docs/images/scope-connections.jpg)

A chokepoint that a caller goes around is marked broken at its door, and the
interface carrying the bypass lists each bypass site by file and line. An
entrance whose untrusted input reaches the system with no verified
chokepoint or totality oracle traced on its way is flagged `no traced
control`: not a demonstrated bypass, but a place to look. A chokepoint counts
where the reading sees the handler pass it; a totality oracle counts only on
the entrances its invariant names (`entrances:`), never on every entrance
whose trust its crossing matches.

## Agents start with clear definitions

Language models are built out of language, and an ambiguous word produces an
ambiguous implementation. Coherence keeps the project's settled vocabulary in
a **lexicon**: each concept with its definition, its aliases, and the names
rejected for it and why. Your agent's own hooks deliver it at the start of
every session and subagent, so agents do what you meant, not just what you
said. `coherence lexicon --check` finds a rejected name anywhere in prose,
specs, journal records, or identifiers; in your project those are the names
your lexicon rejects, and a word Coherence also uses is never refused for that
alone. `coherence lexicon coverage`
ranks the recurring terms that still lack a definition; give it folders or files
(`coherence lexicon coverage src/billing docs`) to read only those.

Each concept in Scope's Lexicon view carries its definition, the alternatives
that were rejected and why, and its related concepts. When an agent reaches
for a rejected name, the record of why it was rejected is already there:

![A concept in the Lexicon view: chokepoint, with its definition, two rejected alternatives each with its reason, and links to related concepts.](https://raw.githubusercontent.com/PostHog/coherence/main/docs/images/scope-lexicon.jpg)

## Intentions live in the structure, and the structure is checked

Each component's spec states its **invariants** in one plain bullet grammar,
along with the reason each one matters. An invariant counts only when it has
**enforcement** and a witnessed **refutation**: someone broke it on purpose
and the detector went red.

- A **chokepoint** is the one site every reference to a protected thing must
  pass through, like `sessions.get()` in front of the session store. The
  chokepoint check asks the language server for every reference and flags
  any that go around it. It also stages fake bypasses, without touching your
  files, to prove it would fire; a check that would miss one is reported as vacuous, not
  passing. A module boundary adds `from: outside the component`, so the
  module's own code may use its internals; those references are reported as
  exempt, never dropped.
- A **totality oracle** is a detector, usually a test, that checks the
  invariant over a whole set, for the cases where a chokepoint isn't
  practical.
- **Crossings** mark the invariants that stand on a security boundary, naming
  the trust levels on either side. A crossing says which trust an invariant
  checks, not where it enters: a totality oracle counts as a control only on
  the entrances its `entrances:` line names.

![The Invariants view: each invariant with its sentence, the reason it matters, its enforcement, and its latest verdict.](https://raw.githubusercontent.com/PostHog/coherence/main/docs/images/scope-invariants.jpg)

## Violations surface at the edit, not in review

Coherence runs inside your agent host (Claude Code or Codex) through its
hooks. The moment an agent writes a file that may touch a chokepoint, the
check runs again through a warm language server and reports any bypass in
the same turn, by file and line, with the two honest options: route through
the chokepoint, or escalate to a human. At the end of a session, the
regulate step reports what the session still owes; a subagent's stop is
refused only for what the tool can prove.

A host shows a main-thread stop hook's message to you and never to the agent,
so regulate says each line once per session and puts it where the agent reads
it. A practice the session fired and never recorded holds the stop once, with
the reason in front of the agent; everything else is shown to you and carried
into the agent's next prompt.

## The hooks stay out of the way

The hooks around every tool call are the cost every session pays, and a call
cycle that feels sluggish is how a check gets switched off. Each hook call's
time is kept. A tool hook (PreToolUse, PostToolUse) over the latency budget,
3 s unless `latencyBudget` says otherwise, says so in its own answer, and
regulate and orient name the calls over it; regulate also names the stops
over it. A tool use that writes nothing
reads no vocabulary, a prompt over an unchanged tree reads none either, and
a command or edit outside every adopted project costs a constant: on this
repository a tool hook takes about 0.3 s, and 0.4 to 2.4 s in the PostHog
monorepo with two products adopted.

In Claude Code, Coherence can also show its own line in the status line,
for you rather than the agent: the version running, the session's tool hook
time against the budget, and the practices it owes.

```
coherence <version> · hooks 0.4 s avg · 1 practice owed: close a defect
```

It reads only the session's own records, about 0.1 s a render. Add it to
`.claude/settings.json`, or to `~/.claude/settings.json` for every project:

```json
{ "statusLine": { "type": "command", "command": "npx --no -- coherence-statusline" } }
```

While Coherence's warm server is serving Scope (after `coherence scope`), the
line ends with a `scope ↗` link to the live page, in terminals that draw
hyperlinks (iTerm2, Kitty, WezTerm). The address carries the project's token,
so it is only ever the link's target, never printed.

If you already have a status line, keep it by passing its command after
`--`: `npx --no -- coherence-statusline -- ~/.claude/statusline.sh` prints
yours first, then Coherence's.

### The Claude Code mod: one warm process per session

In Claude Code you can also run Coherence's hooks through its mod instead
of the settings hooks. The mod starts one Coherence process per session and
sends it every event, so an event no longer pays Node's start and
Coherence's module load, about 0.25 s each. In the PostHog monorepo a
prompt, a read or an edit outside every adopted project drops from about
260 ms to under 10 ms. The expensive steps (a project's first entry, a stop
after an edit) cost about the same either way.

The mod also shows Coherence's line in the status line, marks each edit's
tool row with its check's verdict, and puts a `Scope ↗` button above the
prompt (or run `/scope`). The agent still gets exactly what the settings
hooks give it.

Beside it, `Journal` (or `/journal [session]`) opens a pane that tells the
journal as it is written: each decision, defect, conjecture and
escalation in its own words, folded to one line, over a small tree of the
files it touched. By default it streams the latest records live across
every session and every git worktree of the repository, background agents'
included, each under its agent and session; `/journal <session>` shows one
session's and `/journal live` goes back. The agent can point you at a record
through the `mcp__coherence__journal` tool.

```
npx --no -- coherence hooks install --host claude --mod
```

This is personal to you in this project. It registers Coherence's repository
as a Claude Code plugin marketplace and installs the mod from it, both in
`.claude/settings.local.json`. The mod runs the project's own installed
Coherence, so it works with whatever version the project uses. It also
removes your personal Coherence settings hooks, which the mod replaces.
Committed hooks belong to the team and stay; while they are there, the mod
leaves the events they cover to them, and install names those events. To
move the whole team, `hooks install --host claude --mod --shared` enables the
mod in the committed `.claude/settings.json` in place of the committed Claude
Code hooks; each teammate is asked to install it at their next session.
`coherence hooks uninstall --host claude` removes the mod too. Claude Code
updates the mod with `claude plugin update coherence@coherence`. Codex keeps
the settings hooks. The measurements and the mod's limits are in
[docs/mods-spike.md](https://github.com/PostHog/coherence/blob/main/docs/mods-spike.md).

## Decisions are never buried in a transcript

The **journal** compresses hundreds of thousands of session tokens into a
handful of durable records: decisions with the alternatives rejected and
why, conjectures, defects, experiments, and escalations for a human. Every
record carries its session and agent. If a bad call was made along the way,
it's right there in the history instead of buried in the code, and a later
session can retract it and say what refuted it.

The journal, the runs and the work orders are committed with the code, as
append-only files per session under `.coherence/`. A writer starts a new file
(a sealed shard) whenever HEAD or the branch moves, so no file is ever
written from two branches, and parallel or stacked branches that recorded in
the same session land by merge, squash or rebase on GitHub without a
conflict (docs/records-layout.md). You don't have to do anything to get it.

Here is one decision as the Journal view shows it: what was chosen, the
alternatives rejected, the reason, the human words that prompted it, and the
earlier decision it builds on.

![A decision record in the Journal view: the choice, two rejected alternatives, the reason, the human's words as the agent attributes them, and a citation of an earlier decision.](https://raw.githubusercontent.com/PostHog/coherence/main/docs/images/scope-journal.jpg)

## Methods are kept, not rediscovered

Every project has ways of working that live only in someone's head or a
scrollback: how to witness a refutation, how to carry a lexicon change
through, how to merge a parallel worktree without losing records. Each agent
session starts with none of them. A **practice** keeps one: a file beside a
component's spec (`Enforcement.practice.md` beside `Enforcement.spec.md`)
lists the steps, the evidence each step leaves, and the pitfalls, each citing
the record that witnessed it.

```markdown
- witness a refutation: A refutation counts only when the detector went red because of the staged break.
  when: command refute | edit **/*.spec.md adding refuted:
  step: run the bullet's test alone, by its filter, and see it green
    leaves: run record for the bullet, pass
  step: stage the smallest break that changes the behavior the bullet claims
  pitfall: a sed matched two lines, so the test hung and went red only when killed (d-828ddc83)
  learned: d-4dafa61b, df-b9b2711b
  because: the step that slips is the one no command checks: that the red came from the break
```

A `leaves:` line belongs to the step above it whatever its indentation; a
formatter that flattens it to two spaces changes nothing.

When a tool use is about to fire a practice's trigger, the hook delivers the
practice whole, before the act. The session records what it did with
`enact`: every step done, deviated, or skipped, with why. Once a practice has
been enacted, a step can only leave it with a decision that says why, so a
method improves through recorded deviations instead of eroding through
silent ones. Coherence ships **kernel practices** for its own commands and
for adoption itself, so an adopter starts with them; each of Coherence's
practices declares `reach: kernel` or `reach: internal`.

## Many agents, one picture

Move between conversations and agents without writing summary files for the
next session. **Work orders** give each unit of work an owner, an objective,
and a file boundary, and journal records and runs bind to them automatically. The **peer feed** drops
the subjects of other sessions' new decisions into each agent before its next
tool use, so subagents compare notes as they go.

## Know what a change will cost

`coherence economy <path>` predicts what a reader must load to change
something safely, with a token estimate. `coherence calibrate` checks that
prediction against what sessions actually read, and `coherence mass` reports
how much code no invariant's enforcement reaches yet.
