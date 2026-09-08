# Harness core

Composes configuration, public commands and shared contracts into the Coherence CLI.

The implementation lives in independently specified subsystems beneath this composition root. Parsing, verification, durable evidence, lifecycle integration, coordination, taxonomy, diagnostics and reading surfaces retain separate ownership.

## invariants

- swarm write identity and authority flags are singleton or refused

## refutations

- swarm write identity and authority flags are singleton or refused: `work create ... --session one --session two` succeeded and silently attributed the append to `two`; the same last-wins ambiguity existed for authority and consequence writers. The shared CLI check now refuses every non-repeatable flag before any append.

## works when

- typechecks
- cli.ts imports ./config.ts
- cli.ts imports ./derivation/derive.ts
- cli.ts imports ./verification/verify.ts
- boundary "swarm write identity and authority flags are singleton or refused" at repeatedSingletonFlags via guard "swarm writes reject repeated singleton identity and authority flags before append"
- passes test "field journey — competing duties settle into reconstructable evidence and damage recovers"
- passes test "repository control — work and consequence records survive a fresh clone"

## why

**swarm write identity and authority flags are singleton or refused.** Repeated evidence,
criteria, alternatives, and scopes represent honest plurality; repeated session, owner,
authority, or predecessor selectors represent two incompatible attributions for one
append. One shared parser predicate distinguishes those sets and refuses ambiguity before
any ledger writer runs.

(The import claims above separately prove that the composition root still reaches the
configuration loader, graph derivation, verifier, spec walker, and journal.)
