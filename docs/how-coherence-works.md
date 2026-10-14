# How Coherence works

Agents write code faster than anyone can read it, and they cut corners where
you can't see them. Coherence keeps the few rules your project must never
break written down next to the code, checks them while the agent works, and
shows you which ones hold.

```text
  you and your agent agree on a rule
                │
                ▼
  spec  (src/billing/Billing.spec.md)     the rule, why it matters,
                │                         and how it is checked
                ▼
  hooks, on every edit ── bypassed? ──►  the agent hears it in the same turn
                │
  run, and CI on every pull request ───►  each rule's test, and every chokepoint again
                │
                ▼
  journal and Scope                       what was decided and found,
                                          and a map of the project you can open
```

## The words you will hear

- **Requirement**: a rule the project must keep, written in a component's
  spec with the reason it matters. For example: "every read of an invoice
  checks that it belongs to the signed-in account." Nothing checks it yet.
- **Invariant**: a requirement whose enforcement has been seen to fire,
  and whose ways of breaking (the checklist Coherence asks about each rule)
  have been answered. Until then the rule is only written down; after, a
  break shows up when its check runs.
- **Enforcement**: what checks the rule. Two kinds:
  - a **chokepoint**: the one function every use of something must go
    through, such as `invoices.forAccount()` in front of the invoice table.
    Coherence asks the language server for every reference and flags any
    that go around it, at the very edit that adds one. No test to write.
  - a **totality oracle**: a test that checks the rule over a whole set, for
    rules no single function can guard. It runs with `coherence run` and on
    each pull request, not at every edit.
- **Refutation**: the proof that the enforcement works. The rule was broken
  on purpose and the check went red. For a chokepoint, Coherence stages the
  bypass itself without touching your files.
- **Entrance**: where work comes in from outside: a route, a command, a
  queue consumer. A **spec gap** is an entrance whose callers are outside
  your control or unknown, with no control traced on its way in and no
  recorded reason that it needs none.
- **Journal**: the project's record of decisions and defects, so the reason
  for a change outlives the chat it was made in.
- **Practice**: a method the project keeps, like adopting Coherence. Its
  steps reach the agent when its commands run.

## Why a short set of invariants

You can't review everything an agent writes. You can name the handful of
rules that would hurt most if they broke: who may read whose data, money
that must add up, a boundary between two parts of the system. With those
as invariants, a break shows up while the agent works or on the pull
request, not in review, and Scope shows you which ones hold today.

During adoption your agent proposes these rules. For each it tells you the
rule, what goes wrong if it breaks, and how it would be checked. Confirm,
reword or drop each one; a few that matter beat many that don't.

## Questions to ask next

- "Which invariants does this project have, and which are broken?"
- "Show me the project in Scope."
- "Why did we decide that?" (the journal keeps the answer)
