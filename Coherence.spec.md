# Coherence

A prosthetic for proprioception: specs, invariants, and the readings that keep an agent session balanced.

## trust levels
- project-source: Agent-authored text: the adopter's code, specs, docs, and what an agent passes the command line. Never trusted about itself; every claim in it is checked against the code, never taken from it.
- harness: What a host sends the hook on stdin: the event, its session id, and its agent type. The caller Coherence answers, never a writer of the record.
- record: The durable files under .coherence a later session reads back: journal records and runs. Attributed and append-only, or worthless.
- reading: What leaves Coherence for an agent or a human: the injected context, a check's report, a run's printed form, the Scope page. Derived from the model and never stored as truth.
- instrument: The far side of a process boundary: the language server the adapter drives, the warm server that holds it open, and the test runner the totality oracle pass spawns. Only replies cross, and a reply the instrument cannot confirm is a vacuous check, never a pass.

## invariants
- grammar carries no rejected name: A spec written in Coherence's grammar with every shape name carries no rejected name.
  over: every key of the grammar, every shape of the checklist seed, and every rejected name of Coherence's glossary
  via: a spec written in the grammar with every shape name carries no rejected name
  because: the grammar, the seed, and the glossary are three files that can drift apart; if a key or a shape were spelled with a name the glossary refuses, every honest spec would fail the vocabulary check and the agent would learn to route around the check instead of fixing the spec
  crossing: project-source -> reading
  refuted: <not witnessed: no staged break was found for a rule over three data files; the test has not been red in this repository>
  kinds: none
- structural defect overrides the state: A failing verdict in the latest run makes a bullet a structural defect whatever else it carries, and an automatic refutation satisfies a chokepoint bullet's refutation.
  over: every bullet with an entry in the latest run that checked it
  via: the state derivation without a run: a chokepoint bullet lacks refutation; with a run: automatic refutation satisfies it, a fail is a structural defect
  because: when the enforcement no longer detects, the bullet's other lines are history; a bullet still shown as an invariant after its chokepoint broke is the failure Coherence exists to reveal, and an automatic refutation counts because the instrument proved it would see the break
  crossing: record -> reading
  refuted: made a failing run entry no longer force the structural defect state -> "the state derivation without a run: a chokepoint bullet lacks refutation; with a run: automatic refutation satisfies it, a fail is a structural defect" went red in enforcement.test.ts; restored, green (2026-09-17)
  kinds: none
