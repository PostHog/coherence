# Building, maintaining, and reviewing a lexicon

The lexicon commands now form a loop: observe usage, propose a change, record its
reason, apply it, and read the new evidence. Similarity is optional advice. No
command certifies that every word in a project has the right meaning.

Use `node src/cli.ts` in this checkout or `node_modules/.bin/coherence` in a linked
adopter, from the project root. A domain lexicon can be used before specs, runs,
or Scope exist. `coherence.config.json` may name its `lexicon`; otherwise the
project uses `lexicon.json`. This checkout uses `docs/lexicon.json`.

## Observe coverage and inspect a meaning

```sh
node src/cli.ts lexicon coverage
node src/cli.ts lexicon coverage --json
node src/cli.ts lexicon review exposure
node src/cli.ts query lexicon exposure
npm run scope
```

Coverage lists the actual files read, exclusions, unreadable paths, observed terms,
representative uses, and review state per component. It matches declared phrases
and uses an explicitly heuristic, Latin-alphabet extraction of identifiers, keys,
backticked names, title-case prose, headings, and component names. Candidates are
not all domain concepts: internal implementation names and ordinary words still
need classification. Counts are not a semantic coverage percentage. Source locations
are computed readings, never addresses stored in canonical concept entries.

A known spelling in a new component is still an unanswered sense question. Review
shows the definition, confusables, properties (including units), current contexts,
and an evidence key. Scope renders that same evidence in its Lexicon view and
writes nothing. The fixed agent query reads the same page state.

## Propose and apply a change

```sh
node src/cli.ts lexicon propose declare premium \
  --definition "The price paid for risk cover." --because "Distinct from exposure."
node src/cli.ts lexicon propose alias exposure "amount at risk" \
  --because "The same monetary meaning."
```

A proposal prints its `lp-…` identifier, target, expected prior content, full proposed
content, and whether a human acknowledgement is required. It writes only a preview
under ignored `.coherence/lexicon/`. Nothing changes in the canonical lexicon yet.

```sh
node src/cli.ts lexicon apply <proposal-id> \
  --session <session> --agent <name> --work <work-order> \
  --because "Why this meaning or name was chosen." --over "The rejected alternative."
```

Actions are `declare`, `define`, `alias`, `reject`, `rename`, and `retire`. Use
`--definition` or `--entry <project-relative.json>` for structured concept fields.
Metadata is preserved; definition updates merge properties, detail, and provenance,
and preserve prior aliases/rejections rather than silently losing history. An entry
cannot import the draft's live-use/code-address fields. Rejecting an accepted alias or instance under its own concept needs an explicit
human acknowledgement and moves that name into the rejection history. A concept
name itself changes only through rename or retire. Named instances are distinct
from aliases; for example, an application is an instance of an agent host, not a
synonym for the category.

A concept rename or retirement also needs `--human "the explicit acknowledgement"`.
This is an auditable assertion of a human ruling, **not identity authentication**.
Agents must not invent it. Likewise, a preview is not human approval by itself.

The application refuses an intervening lexicon edit, a target outside the project,
a duplicate name, missing reasons/alternatives, or a second concurrent application.
The lexicon replacement happens before the decision claiming it happened. If the
process stops between that write and its journal decision:

```sh
node src/cli.ts lexicon recover
```

Recovery uses the saved proposal and original attribution, refuses intervening edits,
and does not duplicate an existing decision. An abandoned process lock needs inspection
before manual removal; the tool does not guess that a lock is stale.

## Record a sense review

Read the current context and copy its evidence key first. For example:

```sh
node src/cli.ts lexicon review exposure --component money --evidence <key> \
  --disposition confirmed --human "Owner confirmed the USD meaning." \
  --because "The implementation uses the declared monetary unit." --over "Time exposed." \
  --session <session> --agent <name> --work <work-order>
```

Dispositions are `confirmed`, `not-domain`, `deferred`, and `defect`. Settling a
meaning or excluding it from domain vocabulary needs an explicit human acknowledgement.
A confirmed review cannot replace declaring/mapping/fixing an unresolved or rejected
name. An answer applies to the exact current meaning and source evidence. Source or
definition changes reopen it. Old decisions remain readable history.

## Incremental work

```sh
node src/cli.ts lexicon baseline --session <session> --agent <name>
node src/cli.ts lexicon changes --session <session>
node src/cli.ts lexicon changes --session <session> --json
```

A baseline suppresses repeated change notifications; it **does not confirm meaning**.
In an adopter, the same command also records the lexicon check's baseline: the
rejected names and unknown nouns the project already held, as a `lexicon baseline`
decision in the journal (a rejected-name finding is kept as a digest of its file,
name and line, so the record never spells what it excuses). The check then counts
those findings on one `BASELINED` line and fails only on others. The baseline only
shrinks: every baseline record is intersected with the ones before it, so running
the command again drops what was fixed and never adds; retracting a baseline record
is the one recorded way to take it afresh. Coherence's own repository keeps no
baseline, and its text is enforced whole.

## Whose rejected names bind where

Coherence's rejected names bind only where Coherence's concepts are named. In this
repository that is everywhere. In an adopter, the project's code and domain prose
are its own words and Coherence's names are never matched there; the text written
to Coherence (journal and work records, a spec's section headings, property keys
and checklist shapes with their state words, and `coherence.config.json`) is
matched, and a hit there is advisory: one `ADVISORY` line, never a failure. The
project's own lexicon's rejected names bind in all of its text, as before. A project
claims a word Coherence refused by declaring it in its own lexicon (a concept,
alias, or instance); the claim silences that name everywhere in the project.
Start hooks explain the current unresolved population and maintenance commands.
After delivery, they establish the session's baseline. Later tool/prompt boundaries
show bounded new or changed contexts, and advance only after the host receives the
output. Stops retain a summary of unsettled coverage. These heuristic questions do
not mechanically refuse a subagent; existing exact rejected-name rules are unchanged.

The hook recognizes structured multi-file patches, follows the installed root from
subdirectories, and uses an explicit child identity when the host provides one. A
native child event missing that identity does not charge the parent's work. Both
host-shaped fixture delivery and the actual CLI launcher are tested; that is not a
claim that a fresh live host session has been observed.

## Drafting a new lexicon

```sh
node src/cli.ts lexicon draft
node src/cli.ts lexicon draft --out .coherence/lexicon/draft.json
```

A draft lists candidates, usage-based collision questions, existing vocabulary, and
uncertainty. Definitions are left unsettled rather than invented as facts. It is not
a canonical lexicon and cannot overwrite one. Use the maintenance workflow to settle
individual entries. Repeated drafting reads current rulings and source evidence.

## Local similarity

The implementation follows the September 17 survey: pinned `node-llama-cpp` 3.21.1,
its Metal prebuilt, zero GPU layers, fixed batch/thread settings, and a small local
English model. The package is optional; no model downloads occur during checking.

```sh
node src/cli.ts lexicon model --download
node src/cli.ts lexicon similar "terminology drift" --json
```

The explicit setup downloads the pinned 36,806,944-byte BGE small Q8 model and checks
its SHA-256 before configuring it. Alternatively use `lexicon model --file <gguf>
--sha256 <full-hash>`. Configuration and cached vectors live under ignored
`.coherence/`, never in concept entries. Cached vectors are separated by model hash
and fixed backend settings. Ordinary similarity reads are offline; missing package,
model, unsupported platform, changed model, or excessive input returns an honest
unavailable result while exact coverage remains usable.

Suggestions compare definitions and can expose differences between sampled usage
contexts. They never apply a change, settle a review, or alter an enforcement
verdict. The model is not a runtime-intent detector or an automatic overload verdict.
It samples at most two excerpts per context and twelve contexts, with a 512-token
input bound. See `docs/embeddings-survey.md` for the research; measurements from that
survey are not performance claims about current end-to-end command latency.

## Readiness for a selected feature slice

```sh
node src/cli.ts lexicon ready --terms "lexicon,hook,attribution" --json
```

This checks current review evidence for the specified observed terms, not every
concept in the repository. Unreadable inputs or unresolved context questions keep it
unsatisfied. Absence from the source population is not treated as a pass. It also
cannot prove actual host delivery: the remaining requirements of `w-c8d5418a` must
be observed separately. A vocabulary reading must never stand in for those facts.

## Help, inflections, and property meanings

`lexicon --help` lists the read, review, proposal, baseline, similarity, and
recovery workflows without loading a project lexicon. Every workflow also accepts
`--help`; for example, `lexicon changes --help` describes that workflow without
creating or reading a baseline. Other unknown flags remain errors rather than being
interpreted as help.

Coverage preserves the spelling it observed. It may associate a conservative English
plural with an already-declared complete name (`exposures` with `exposure`, or
`categories` with `category`). It does not infer arbitrary compounds, accept an
unknown singular merely because it can remove a suffix, or claim that the matched
spelling has the declared sense; each new component still needs review.

A property key accepted as vocabulary carries the owning concept's definition and
properties into its evidence. Changing the property's value therefore changes both
the term meaning fingerprint and its context evidence keys, reopening prior reviews.
If several concepts declare the same property spelling, the JSON and detailed text
reading expose all applicable property meanings and leave the single `concept` field
unset rather than choosing whichever owner happened to be read last. This identifies
candidate owning meanings; it does not resolve an overload or constitute human
confirmation.
