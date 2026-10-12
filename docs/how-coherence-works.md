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
  hooks, on every edit ──── broken? ───►  the agent hears it in the same turn
                │
                ▼
  journal and Scope                       what was decided and found,
                                          and a map of the project you can open
```

## The words you will hear

- **Requirement**: a rule the project must keep, written in a component's
  spec with the reason it matters. For example: "every read of an invoice
  checks that it belongs to the signed-in account." Nothing checks it yet.
- **Invariant**: a requirement with an enforcement that has been seen to
  fire. Until then the rule is only written down; after, it shows up the
  moment it breaks.
- **Enforcement**: what checks the rule. Two kinds:
  - a **chokepoint**: the one function every use of something must go
    through, such as `invoices.forAccount()` in front of the invoice table.
    Coherence asks the language server for every reference and flags any
    that go around it. No test to write.
  - a **totality oracle**: a test that checks the rule over a whole set, for
    rules no single function can guard.
- **Refutation**: the proof that the enforcement works. The rule was broken
  on purpose and the check went red. For a chokepoint, Coherence stages the
  bypass itself without touching your files.
- **Entrance**: where work comes in from outside: a route, a command, a
  queue consumer. A **spec gap** is an untrusted entrance with no control
  traced on its way in.
- **Journal**: the project's record of decisions and defects, so the reason
  for a change outlives the chat it was made in.
- **Practice**: a method the project keeps, like adopting Coherence. Its
  steps reach the agent when its commands run.

## Why a short set of invariants

You can't review everything an agent writes. You can name the handful of
rules that would hurt most if they broke: who may read whose data, money
that must add up, a boundary between two parts of the system. With those
as invariants, an agent that breaks one hears it at the edit, not in review,
and Scope shows you which ones hold today.

During adoption your agent proposes these rules. For each it tells you the
rule, what goes wrong if it breaks, and how it would be checked. Confirm,
reword or drop each one; a few that matter beat many that don't.

## Questions to ask next

- "Which invariants does this project have, and which are broken?"
- "Show me the project in Scope."
- "Why did we decide that?" (the journal keeps the answer)
