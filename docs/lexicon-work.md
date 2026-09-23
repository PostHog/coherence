# Lexicon coverage before feature-parity work

Planning date: September 18, 2026. Planning work order: `w-9c1152d7`.
This is an implementation plan, not a claim that coverage has already been measured
or that the work below is complete. The implementation orders were created open.
The work store, read with `node src/cli.ts work inspect <id>`, is their current state.

## Requirement

Maintain and improve lexicon coverage before beginning the next feature-parity
slice. A working reader and a green vocabulary check are necessary but insufficient:
zero findings may mean that the current heuristic did not recognize the missing
vocabulary, or that a familiar term was used with a different meaning.

Coverage must be an account of the vocabulary actually encountered, the source
population examined, the uses that have been settled, and what remains uncertain.
It is not a claim that a machine has proved the meaning of every word.

## Source: the latest Claude Code conversation

The project-local transcript is
`c1db1b63-f5b7-4dc3-94a8-3c324ee41fcb.jsonl`, for this repository on `distill`.
Its last visible conversation message is September 18, 2026 at 11:05:37 a.m. EDT
(`2026-09-18T15:05:37.932Z`). Selection used message timestamps, not file modification
time: two other transcript files were rewritten more recently but their visible
conversations ended on September 17. Tool results and task notifications were not
mistaken for owner rulings.

The following are local transcript line references, not addresses stored in a
concept entry. Proposed design and owner instructions are distinguished.

| Evidence | What it establishes |
| --- | --- |
| Owner, line 145, September 17 at 15:24:57 UTC | Rebuild from the reference; inventory concepts and settle them Socratically into a lexicon. |
| Owner, line 980, September 17 at 17:46:17 UTC | Every Coherence project has a lexicon; no run should miss its injection. |
| Owner, line 998, September 17 at 17:48:36 UTC | Reject concept-to-code addressing because it rots; the lexicon must strengthen through use. |
| Owner, line 1010, September 17 at 17:50:14 UTC | Prevent overloading in jargon-heavy domains, not just repeated invention of synonyms. |
| Assistant design, line 1013; accepted by owner at line 1022 | One term per sense; confusables and distinguishing properties; review a known term when it first enters a new component. Acknowledge unsupported surfaces and inability to read runtime intent. |
| Assistant design, line 989; now also in the lexicon's growth rule | Agents propose and announce; only a human retires or renames. Each definition change is a decision with alternatives and a reason. |
| Owner, lines 1066 and 1109 | Preserve TypeScript/Node; investigate local embeddings on supported M-series Macs. The assistant's line 1071 keeps similarity advisory, never a verdict. |
| Owner, line 1381 | The project's meanings are its own; do not overwrite domain terminology merely to match Coherence's vocabulary. |
| Owner, lines 2772, 2779, and 2792, ending September 17 at 21:52:23 UTC | The lexicon exercise exposed a defect class other checks missed; building, maintaining, and validating it require first-class support. This became `docs/lexicon.md`. |

There is already a local-embedding survey in the same transcript (task result at
line 1430). It includes measured comparisons and a recommendation, not an owner
selection or a current implementation. The similarity order must use that evidence
rather than restart the research or pretend the recommendation is settled.

## The maintenance and improvement loop

1. **Establish the population.** Read the supported authored corpus: specs, docs,
   journal/work text, component names, public tool surface, and supported
   identifiers. Declare extraction rules, exclusions, unreadable files, and
   unsupported surfaces. A project without specs must still be able to start.
2. **Show the gaps with context.** Group candidate terms and uses against canonical
   concepts, aliases, rejected names, and unresolved questions. Show representative
   current uses and components when known. Keep name coverage separate from sense
   confidence. A known spelling is not evidence that its meaning is correct.
3. **Settle a question.** Declare a concept, map an alias, or fix a rejected use.
   For an overload, keep one sense, qualify different senses, or identify a
   source/documentation defect. Record alternatives and because; do not silently
   convert an agent's guess into a human ruling.
4. **Apply and rescan.** Use a supported preview/apply workflow that preserves the
   whole lexicon entry and records an actual change. Show which uses the ruling
   settles and which still need attention. Rejected-name history accumulates;
   append-only journal records are never rewritten to make an old reading green.
5. **Catch the next change.** During parity work, new terms and first use of a known
   term in a new component reopen the question at the edit or next practical
   lifecycle boundary. Unchanged, answered contexts do not nag. A changed definition
   invalidates the affected confirmations. Deferred questions remain visible.
6. **Review sense periodically.** Put a concept's definition, confusables, properties,
   and live uses beside each other for a human. Ask whether the mechanism honors
   the meaning. Optional similarity can improve the questions later; it cannot
   answer them or make a green name check a semantic proof.

No numeric percentage should be presented without naming its population and the
limits of extraction. Unsupported or unresolved material is not counted as covered.
The source locations needed for a useful reading are computed from current files;
they are not durable addresses inside lexicon entries.

## Work orders and sequence

| Order | Deliverable | Phase | Prerequisites |
| --- | --- | --- | --- |
| `w-947cd2be` | Vocabulary coverage and usage inventory | Prerequisite | None |
| `w-b3b8bd06` | Lexicon maintenance and recorded rulings | Prerequisite | `w-947cd2be` |
| `w-b7e2dd75` | Incremental coverage and first-use review | Prerequisite | `w-947cd2be`, `w-b3b8bd06` |
| `w-56730192` | Human sense review against live usage | Prerequisite | `w-947cd2be`, `w-b3b8bd06` |
| `w-3b735c94` | Lexicon drafting and guided collision settlement | Follow-on | `w-947cd2be`, `w-b3b8bd06`, `w-56730192` |
| `w-0f433420` | Optional local similarity for lexicon nominations | Follow-on | `w-947cd2be`, `w-56730192` |
| `w-c8d5418a` | Coverage baseline and readiness for feature-parity work | Checkpoint | `w-947cd2be`, `w-b3b8bd06`, `w-b7e2dd75`, `w-56730192` |

Implementation sequence:

- Start with `w-947cd2be` and then `w-b3b8bd06`. These make gaps observable
  and give an operator a supported means of settling them.
- `w-b7e2dd75` and `w-56730192` follow that foundation. Their eventual
  owners must coordinate shared CLI, lifecycle, and reading files before working
  in parallel; these orders do not grant overlapping write permission.
- `w-c8d5418a` exercises the whole loop on Coherence and a temporary adopter
  and determines readiness for a specifically named first parity slice.
- `w-3b735c94` and `w-0f433420` remain explicit follow-on lexicon work.
  Automated drafting and an embedding backend are not prerequisites for maintaining
  this project's existing lexicon. Human sense review is a prerequisite; similarity
  is not a substitute for it.

The first four implementation orders and the readiness checkpoint take priority
over beginning new spine implementation. The five existing spine/reliance/preview
orders remain open and were not rewritten or closed by this planning task.
This plan does not silently retire any remaining lexicon requirement.

## Readiness checkpoint for the first parity slice

Close `w-c8d5418a` only with evidence of all of the following:

- A current, reproducible coverage reading names the examined source population,
  dispositions, missing/unsupported surfaces, and unresolved questions.
- The proposed first parity slice is named. Its concepts, aliases, confusables,
  and required distinguishing properties are explicit. Its meaning disputes are
  settled by the appropriate human rulings, not renamed as successful coverage.
- The full loop works: introduce a term or a new context, observe the question,
  record the ruling, apply it, rescan, and read back why it changed. A changed
  definition reopens relevant confirmations.
- A known word used in a different sense is exposed for review even when the
  exact-name check reports no findings. The human decision remains explicit.
- A temporary adopter without invariants, run history, or Scope can use the
  lexicon/check/lifecycle subset; domain meanings are not silently overwritten.
- Fresh Claude Code and Codex sessions actually receive the configured lexicon
  and maintenance/drill-down instructions. Installation status or a manually
  printed hook payload alone is not evidence of host delivery. Missing delivery
  stays an unmet criterion rather than being assumed from the config file.
- Questions outside that slice are listed with their disposition and next work;
  their existence is not hidden by an overall pass label. Unresolved questions
  needed by the selected slice prevent declaring it ready.

Readiness is an evidence-backed planning decision, not a new permissions system.
Nothing here reinstates retired work permissions or lets a similarity score refuse
work. Known rejected names keep their current treatment; heuristic nominations
remain advisory.

## Work discipline

Before implementation, assign an order to the actual executing session and activate
only the intended order so journal/run binding is unambiguous. Record choices,
limitations, and measured outcomes against it. Close with `work close` only when its
observable success criteria hold. A written plan, drafted file, or passing unrelated
test suite is not completion of lexicon coverage.

The lifecycle issues in Terra's review must be coordinated with the incremental
and readiness orders where they affect lexicon delivery; do not implement a second
competing host-integration path. External adopter repositories remain read-only
unless separately authorized.

## First coverage question exposed during planning

The project-wide vocabulary check now nominates `codex`: the new plan and the
existing README put the name over the check's repeated-use threshold. The earlier
zero-unknown result was not proof that this vocabulary was declared. The reader
currently finds zero rejected names in editable files, but one unknown noun.

This is a first input for `w-947cd2be`, not an excuse to weaken the check or silently
add a wrong alias. Determine whether the supported host's name needs a declared
concept/instance treatment or whether this use is outside the nomination rule's
intended population. Do not equate a product, a hook, and the supported hardware
platform merely to make a check green. Record the reasoning and keep the item
unresolved until that distinction is settled. The implementation plan is complete;
this coverage question and the readiness checkpoint are not.
