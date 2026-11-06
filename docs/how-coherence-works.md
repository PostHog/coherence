# How Coherence works

Agents write code faster than anyone can read it, and they cut corners where
you can't see them. Coherence keeps your project's invariants written down
next to the code, checks them while the agent works, and shows you which ones
hold.

An invariant is what must stay true from one version of your system to the
next, however much the code around it changes: every read of an invoice
checks that it belongs to the signed-in account; a payment is recorded once.

### Start

`SessionStart` · `SubagentStart`

Your agent starts every session with a briefing on your project.

- Before the agent does anything, Coherence tells it the project's open requirements, broken invariants and observable security bypasses.
- It says what other sessions decided in the last week, the conjectures nobody has settled, and the work orders no one in this session holds.
- It gives the project's vocabulary, with the names the project rejected, so the agent speaks your project's language.
- It names entrances not yet declared, hand-kept lists that drifted apart, and the practices that only arrive when asked for.
- It notes the project as the session found it, so the stop can tell what this session changed.
- A subagent starts on its parent's briefing, and its start is marked so its work can be collected when it ends.

### Your message

`UserPromptSubmit`

Your agent hears what you saw, and what its teammates did.

- When the agent last stopped, Coherence's review of the work was shown to you. With your next message, the agent gets the same review, so you both know what it found.
- Subagents that finished hand back what they recorded, and so do other sessions working on the same project.
- If the code changed, the vocabulary is read again and terms that started recurring without a definition are named.

### Before a tool

`PreToolUse`

What your project already settled arrives just as the agent starts the work it applies to.

- When the command the agent is about to run relates to a documented practice, the whole practice is handed over, before its first steps are taken. Breaking an invariant on purpose brings the steps for witnessing it; editing the vocabulary brings the steps for carrying the change through.
- Before an edit lands in a component, the decisions other sessions recorded about that component arrive with their reasons, once a session.

### After a tool

`PostToolUse`

Coherence looks over the agent's shoulder at every edit, and speaks only when something broke.

- An invariant guarded by a chokepoint is checked again for the file just written. A new way around it is said in the same turn. This protects security boundaries.
- A spec the agent wrote is read again on its own, and any problem in it is said at once.
- A hand-kept list the edit touched is compared with the list it should match.
- A word your project has rejected is flagged right away. A new word that keeps coming up is saved for the stop, so you hear about it once, not at every edit.
- Coherence keeps track of what the agent read and changed, so at the stop it can say whether the agent read the code its changes affect.

### Stop

`Stop` · `SubagentStop`

Before the agent says it's done, Coherence checks the work, and won't let a subagent leave a mess.

- What the session changed is reviewed: vocabulary, spec problems, open work, entrances with nothing checking them, and practices set off but never recorded.
- It says how much of the code that relies on the changes the agent actually read.
- A subagent that leaves a rejected name or a spec problem cannot stop until it settles them.
- A session that owes a practice it never recorded is held back once to record it.
- Otherwise the report is shown to you, and reaches the agent with your next message.
- A fresh reading of the project starts in the background, so the next session starts on the project as it is.

## What an invariant is

A system changes with every iteration. An agent rewrites a function, adds a
route, moves a file, and most of what was true about the code yesterday is
not true today, nor should it be. An invariant is what has to survive all of
it: something that holds before a change and after it, whoever made the change
and however the code got there.

That makes it more than a rule someone follows. "Use the shared logger" is a
convention: the code can drift from it and still work. "Every read of an
invoice checks that it belongs to the signed-in account" is an invariant: it
has to be as true after the next hundred changes as it is now, including
changes nobody has thought of yet. Coherence's job is to catch the iteration
that breaks one, at the edit, on a run, or on the pull request.

## The loop

```text
  you and your agent agree on an invariant
                │
                ▼
  spec  (src/billing/Billing.spec.md)     the invariant, why it matters,
                │                         and how it is checked
                ▼
  hooks, on every edit ── bypassed? ──►  the agent hears it in the same turn
                │
  run, and CI on every pull request ───►  each invariant's test, and every chokepoint again
                │
                ▼
  journal and Scope                       what was decided and found,
                                          and a map of the project you can open
```

## The words you will hear

- **Component**: a folder with a spec. The spec says what the component is
  for and what must stay true in it.
- **Requirement**: something a component must keep true, written in its spec
  with the reason it matters. For example: "every read of an invoice checks
  that it belongs to the signed-in account." Nothing checks it yet.
- **Invariant**: a requirement that is checked, and whose check has been seen
  to work: its enforcement caught a deliberate break, and its ways of breaking
  (the checklist Coherence asks about each one) have been answered. Until then
  it is only written down; after, a break shows up when its check runs.
- **Enforcement**: what checks an invariant. Two kinds:
  - a **chokepoint**: the one function every use of something must go
    through, such as `invoices.forAccount()` in front of the invoice table.
    Coherence asks the language server for every reference and flags any
    that go around it, at the very edit that adds one. No test to write.
  - a **totality oracle**: a test that checks the invariant over a whole set,
    for invariants no single function can guard. It runs with `coherence run`
    and on each pull request, not at every edit.
- **Refutation**: the proof that the enforcement works. The invariant was
  broken on purpose and the check went red. For a chokepoint, Coherence stages
  the bypass itself without touching your files.
- **Entrance**: where work comes in from outside: a route, a command, a
  queue consumer. A **spec gap** is an entrance whose callers are outside
  your control or unknown, with no control traced on its way in and no
  recorded reason that it needs none.
- **Journal**: the project's record of decisions and defects, so the reason
  for a change outlives the chat it was made in.
- **Practice**: a method the project keeps, like adopting Coherence. Its
  steps reach the agent when its commands run.

## Why a short set of invariants

Past a certain scale, you can't review everything an agent writes. You can
name the handful of things that would hurt most if they stopped being true:
who may read whose data, money that must add up, a boundary between two
components. With those as invariants, a break shows up while the agent works
or on the pull request, not in review, and Scope shows you which ones hold
today.

During adoption your agent proposes them. For each it tells you the
invariant, what goes wrong if it breaks, and how it would be checked. Confirm,
reword or drop each one; a few that matter beat many that don't.

## Questions to ask next

- "Which invariants does this project have, and which are broken?"
- "Show me the project in Scope."
- "Why did we decide that?" (the journal keeps the answer)
