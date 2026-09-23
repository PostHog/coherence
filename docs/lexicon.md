# The lexicon is first-class

Coherence needs first-class support for building, maintaining, and validating a
project's lexicon. This is a standing requirement of the tool, not a preliminary
to the spine. The evidence is one day old.

## Why

The rebuild began with a socratic pass over the reference implementation's
vocabulary: 206 inventoried concepts, half of them another spelling of something
that already had a name, reduced to 38. That pass exposed a defect class nothing
else in the toolkit can see.

The reference's enforcement claims named a chokepoint and nothing else. When the
owner said what a chokepoint is, the one site every reference to a protected thing
passes through, the mechanism was visibly not that: it checked that a symbol
existed. Fourteen of Mnemion's sixteen chokepoint claims turned out to have prose
where the protected thing belongs and had stood green for months. The two that
named a symbol were broken as written, with seven references outside the
chokepoint that a module-level import map could never see.

No test caught this, because tests check what code does and the defect was in
what the claim meant. No review caught it, because reviewers share the
vocabulary. No metric caught it, because metrics measure structure and never hold
a referent. The journal recorded 778 decisions that used the reference's word for an
invariant without once defining it. Only an exercise that forces a definition to be stated and then holds
the mechanism against it can find a name that has drifted from what the code does.

## The three activities

**Building.** A project's lexicon is drafted from its specs, docs, component
names, and tool surface, then settled by the owner one collision at a time:
declare, map, or fix. Mnemion's draft had 88 concepts, 25 candidate overloads, and
16 uncertain terms; every one needed a human ruling. First-class support means the
tool drafts, sorts collisions by how a word is used, and records each ruling with
its reason, so the rulings are the lexicon's history rather than a chat transcript.

**Maintaining.** Vocabulary grows with the work. A new noun in a spec, a journal
record, or an identifier is caught at regulate and must be declared as a concept,
mapped as an alias, or fixed as a rejected name before the session ends. Rejected
names accumulate as the record of every drift refused. Only a human retires or
renames a concept. This exists today as the vocabulary check.

**Validating.** Names are the cheap half. The costly half is sense: a known word
used in a retired meaning, or one term carrying two meanings in two components.
The check cannot see that; the similarity seam is meant to approximate it by
clustering the contexts of a term across components, and it will approximate
badly. The exercise that found today's defects was a human asking, once per
concept, "what is this, exactly," and comparing the answer to the mechanism. The
tool must make that exercise cheap and periodic: a reading that puts each concept
beside the code that claims to implement it, without addresses, and asks the
question.

## What exists and what is owed

Exists: the lexicon shape (vocabulary injected; detail and provenance shown in
Scope only), the compact injection at session start, the vocabulary check at
regulate, the Scope lexicon view with two layers, and the ruling records in
Mnemion's lexicon.

Owed: drafting as a command rather than an agent prompt; collision sorting by
usage; overload detection through the similarity seam; and a sense-review reading
that a human can run per concept in minutes. These are the lexicon slice's second
half, and they rank ahead of any spine work that would reintroduce the class they
catch.

Anti-rot holds throughout: the lexicon names things and never points at code.

## Coverage-first work orders

The maintenance loop, transcript evidence, implementation orders, and readiness
checkpoint for the next feature-parity slice are recorded in
[Lexicon coverage before feature-parity work](lexicon-work.md). A green name
check alone does not establish vocabulary coverage or correct sense.

## Implemented command loop

The command workflow and its limitations are documented in
[Lexicon operations](lexicon-operations.md). The earlier owed list records the
requirements that motivated it; tests, measurements, and work-order closure must
show which parts now hold. Human sense rulings and live host delivery are not
implied by the existence of commands.
