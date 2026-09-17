# The journal

The journal is compression. A session may burn millions of tokens; what it
leaves behind is a handful of durable outcomes: what was decided and rejected,
what surprised the agent, what failed, what a plan predicted, where the agent
hit a wall, what a human must see. It is also how subagents compare notes (the
peer feed reads its subjects) and how an agent reaches the human operator.

## Verbs

Every writing verb takes `--session <id>` and `--agent <name>`, refused when
absent. `--work <id>` binds the record to a work order; unset by default
(inference from session ownership is a later slice). A single-value flag given
twice is refused.

- `decide "<chose>" [--over "<rejected>"]... --because "<why>"`: the choice, what it was chosen over, why.
- `retract <id> --because "<what refuted it>"`: a record pointing at an earlier one; nothing is edited.
- `conjecture "<observation>" [--could-be "<candidate>"]... --discriminated-by "<test>"`: a side observation, its candidates, and the separating test. "The instrument is wrong" is always a candidate.
- `resolved <id> --because "<what the test showed>" [--as "<candidate>"]`: a conjecture answered by its test.
- `dismiss <id> --because "<why nobody will chase it>"`: a conjecture set aside.
- `defect "<what failed>" --evidence "<reproducer or report>" [--file <path>]...`: a behavioral deviation with its evidence.
- `experiment create "<expectation>" [--context <file>]... --action "<step>"... --success "<criterion>"...`: a plan frozen before acting; prints step ids and a close template.
- `experiment close <id> --result <stepId>=<pass|fail|unknown>...`: a result per step; the outcome (success, failure, inconclusive) is derived; omitting a step is refused.
- `unable "<what you could not do>" --because "<the wall>"`: this agent, this session, could not pass a wall; whether a human could is the reader's call.
- `escalate "<what a human must see>" --because "<why a human>"`: heads every read until acknowledged.
- `acknowledge <id> --because "<what the human decided>"`: the human's answer to an escalation.

## Reading

`journal` prints the merged timeline across every session, oldest first: date,
glyph, id, agent, text; a decision shows its rejected alternatives on an
indented line. Filters: `--session`, `--agent`, `--kind`; `--json` for the
records. `journal --subjects --since <cursorOrIso>` prints only each record's
subject, truncated to 120 characters, and the next cursor: the peer feed's
data source. A line that will not parse is reported with its file and line
number and skipped, never silently dropped; the damaged count prints last.

## Record shape

One JSONL file per session at `.coherence/journal/<session>.jsonl`, append
only. Every record carries `id`, `kind`, `at` (ISO), `session`, `agent`,
`commit` (short sha or null), `dirty`, and its kind's fields. The id is the
kind's prefix plus eight hex digits hashed from session, time, and text, so
two writers cannot collide. The branch is never stored; a read asks git.

## The rule

A decision records what it rejected. `over` lists the refused alternatives;
`--over none` records the string `none`, meaning nothing was rejected;
omitting the flag records an empty list, meaning the question was never
examined. Two different facts, kept apart.
