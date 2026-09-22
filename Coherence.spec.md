# Coherence

A prosthetic for proprioception: specs, invariants, and the readings that keep an agent session balanced.

## trust levels
- project-source: Agent-authored text: the adopter's code, specs, docs, and what an agent passes the command line. Never trusted about itself; every claim in it is checked against the code, never taken from it.
- harness: What a host sends the hook on stdin: the event, its session id, and its agent type. The caller Coherence answers, never a writer of the record.
- record: The durable files under .coherence a later session reads back: journal records and runs. Attributed and append-only, or worthless.
- reading: What leaves Coherence for an agent or a human: the injected context, a check's report, a run's printed form, the Scope page. Derived from the model and never stored as truth.
- instrument: The far side of a process boundary: the language server the adapter drives, the warm server that holds it open, and the test runner the totality oracle pass spawns. Only replies cross, and a reply the instrument cannot confirm is a vacuous check, never a pass.

## entrances
- journal verbs: an agent records a decision, conjecture, defect, experiment, unable, or escalation, or reads the journal
  handler: journalVerbs in src/journal/cli.ts
- work: an agent creates, moves, owns, closes, or inspects a work order, through the journal's verb table
  handler: journalVerbs in src/journal/cli.ts
- spec: an agent reads the components, invariants with their state, and every spec problem
  handler: specCommand in src/spec/cli.ts
- scaffold: an agent writes a component or an invariant bullet in the complete shape
  handler: scaffoldCommand in src/scaffold/cli.ts
- run: an agent verifies the invariants and appends the run record
  handler: runCommand in src/enforcement/cli.ts
- refute: an agent stages a break and records the totality oracle going red
  handler: refuteCommand in src/enforcement/cli.ts
- serve: the warm language server for this project starts and holds the instrument open
  handler: serveCommand in src/enforcement/cli.ts
- economy: an agent asks what must be loaded to change these files safely
  handler: economyCommand in src/economy/cli.ts
- calibrate: an agent compares the economy prediction with what sessions actually read
  handler: calibrateCommand in src/economy/cli.ts
- mass: an agent reads total and unreached mass per component
  handler: massCommand in src/economy/cli.ts
- query: an agent asks one of the fixed questions Scope answers for a human
  handler: queryCommand in src/readings/query/cli.ts
- glossary: an agent reads, reviews, or maintains the settled vocabulary, or checks text against it
  handler: glossaryCommand in src/cli.ts
- hooks install: a human installs or inspects Coherence's hooks for an agent host
  handler: hooksCommand in src/cli.ts

## invariants
- grammar carries no rejected name: A spec written in Coherence's grammar with every shape name carries no rejected name.
  over: every key of the grammar, every shape of the checklist seed, and every rejected name of Coherence's glossary
  via: a spec written in the grammar with every shape name carries no rejected name
  because: the grammar, the seed, and the glossary are three files that can drift apart; if a key or a shape were spelled with a name the glossary refuses, every honest spec would fail the vocabulary check and the agent would learn to route around the check instead of fixing the spec
  crossing: project-source -> reading
  refuted: renamed a checklist shape to a name the glossary rejects for invariant -> the totality oracle went red, then green once restored (2026-09-18)
  kinds: none
- a structural defect was an invariant: A failing verdict in the latest run makes a bullet a structural defect only when the bullet was otherwise complete; a requirement with a failing check stays a requirement and is reported with its failing check, never promoted, and an automatic refutation satisfies a chokepoint enforcement's refutation.
  over: every bullet with an entry in the latest run that checked it
  via: a structural defect is an invariant whose satisfaction has been removed; a requirement with a failing check stays a requirement
  because: the glossary defines a structural defect as an invariant whose satisfaction has been removed, and a bullet that never reached invariant has no satisfaction to remove; calling it one both overstates what the tree had and hides the ordinary case, a requirement whose detector is red because the work is not done. A bullet still shown as an invariant after its chokepoint broke is the other half of the same failure, and an automatic refutation counts because the check itself proved it would report the break
  crossing: record -> reading
  refuted: let a failing verdict force the structural defect state whatever else the bullet lacked -> the totality oracle went red, then green once restored (2026-09-18)
  kinds: none
