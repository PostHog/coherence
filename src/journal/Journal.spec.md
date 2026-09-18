# Journal

Compression: one append-only file per session of attributed, durable outcomes, read back as one timeline.

## invariants
- append-only store: A journal file is only appended: a second write never changes the first line, and no path rewrites or deletes a record.
  protects: journalDir
  chokepoint: src/journal/store.ts
  over: every session file under .coherence/journal
  via: append only: a second write never changes the first line
  because: a record a later session reads back is worth reading only if no earlier record could have been edited; the verbs that answer a record point at it instead, and the one module that knows where the journal lives exposes an append and a read, nothing that rewrites
  crossing: project-source -> record
  refuted: replaced the append in appendRecord with a whole-file write -> "append only: a second write never changes the first line" went red in journal.test.ts; restored, green (2026-09-17)
  kinds: storage, revision
  checklist: scoped-reads dismissed: every reader sees every session; filters narrow the view, not the population
  checklist: encrypted-storage dismissed: the journal is plain text by design; a human reads it with cat
  checklist: key-rotation-compatibility dismissed: no key exists
  checklist: input-validation declared as attributed writes
  checklist: revision-preservation declared as append-only store
  checklist: commit-ordered-effects dismissed: a write has no external effect; the file is the effect
  checklist: durable-dispatch-intent dismissed: nothing is dispatched after the append
  checklist: declared-target-coverage dismissed: one folder, one file per session; no fan-out
  checklist: completion-evidence dismissed: the append is complete when the call returns; there is no later observer
- attributed writes: Every journal write carries a session and an agent, refused when either is absent, and a flag that takes one value is refused when given twice.
  protects: appendRecord
  chokepoint: write in verbs.ts
  over: every writing verb: decide, retract, conjecture, resolved, dismiss, defect, experiment, unable, escalate, acknowledge
  via: repeated singleton flags and missing attribution are refused
  because: the session is the key everything binds through and the agent is the readable name; a record without them cannot be placed in a timeline or bound to a work order, so the one function that appends takes a head built from an attribution that refuses when either is missing
  crossing: project-source -> record
  refuted: made a missing --agent default to "unknown" in attribution -> "repeated singleton flags and missing attribution are refused" went red in journal.test.ts; restored, green (2026-09-17)
  kinds: identity
  checklist: capability-authorization dismissed: attribution names the writer; it grants nothing and no permission is checked
  checklist: canonical-encoding dismissed: a session id is stored as given, and it must already be a file-safe token
  checklist: identity-continuity dismissed: a record is written once and its session never changes
- escalation heads every read: An escalation nobody has acknowledged heads every read of the journal until a human acknowledges it.
  over: every reader of the journal: the timeline, the subjects feed, and the JSON envelope
  via: an escalation heads every read until it is acknowledged
  because: an escalation is the one record that exists for a human; a read that could bury it under later records would let a session act past a question a human has not answered
  crossing: record -> reading
  refuted: dropped the escalation heading from renderTimeline -> "an escalation heads every read until it is acknowledged" went red in journal.test.ts; restored, green (2026-09-17)
  kinds: read
  checklist: scoped-reads dismissed: every reader sees every open escalation; there is no scope to narrow
  checklist: redaction dismissed: an escalation is shown whole and never shortened, since a human must see it
- damaged lines reported: A line that will not parse is reported with its file and line number and skipped, never silently dropped.
  over: every line of every session file under .coherence/journal
  via: a damaged line is reported with its file and line number, skipped, and counted
  because: a crashed write leaves a partial last line; a reader that dropped it silently would present a record as whole when it is not, and the count printed last is how a reader knows the timeline is complete
  crossing: record -> reading
  refuted: removed the damaged push in loadJournal so a bad line was skipped silently -> "a damaged line is reported with its file and line number, skipped, and counted" went red in journal.test.ts; restored, green (2026-09-17)
  kinds: read
  checklist: scoped-reads dismissed: the report covers every file; there is no scope
  checklist: redaction dismissed: the damaged line's file and number are shown, not hidden
- pointing never edits: A record that answers an earlier one points at it by id; nothing on disk is edited, and a second answer is refused.
  over: every verb that answers an earlier record: retract, resolved, dismiss, experiment close, acknowledge
  via: retract points at the record and never edits it
  because: an edit would make the record lie about what a session knew at the time; a pointer keeps both the claim and its answer, and the timeline folds the answer onto the record at read time
  crossing: project-source -> record
  refuted: removed the refusal of a second retraction of the same record -> "retract points at the record and never edits it" went red in journal.test.ts; restored, green (2026-09-17)
  kinds: revision
  checklist: revision-preservation declared as append-only store
- one id minter: A record id is minted in one place from session, time, and text, so two writers never collide.
  protects: recordId
  chokepoint: head in verbs.ts
  over: every kind of record, across sessions and across times
  via: ids are unique across sessions and across times for the same text
  because: an answer points at a record by id, so two writers minting the same id would let a retraction land on the wrong record; hashing session, time, and text in one place makes a collision the same record written twice in one millisecond
  crossing: project-source -> record
  refuted: hashed the text alone in recordId, dropping session and time -> "ids are unique across sessions and across times for the same text" went red in journal.test.ts; restored, green (2026-09-17)
  kinds: identity
  checklist: capability-authorization dismissed: an id names a record; it authorizes nothing
  checklist: canonical-encoding declared as one id minter
  checklist: identity-continuity dismissed: a record's id never changes after the write
- binding inferred from sole ownership: A journal write binds to the one active work order its session owns; --work names another order, which must exist; a session owning none or several binds nothing, and the record says why.
  over: every writing verb, every session, every state of the work store
  via: a write binds to the one active order its session owns; none or several bind nothing and say so; --work names another
  because: the reference bound 6 of 361 decisions from owning sessions, since binding was a flag no template printed; a default settled at the one append site forms the picture the owner wants without anyone remembering a flag, and a record that binds nothing says so rather than looking bound
  crossing: project-source -> record
  refuted: made workBinding answer none for a session owning one active order -> "a write binds to the one active order its session owns; none or several bind nothing and say so; --work names another" went red in journal.test.ts; restored, green (2026-09-17)
  kinds: identity
  checklist: capability-authorization dismissed: a binding names the order a record belongs to; it grants nothing and no permission is checked
  checklist: canonical-encoding dismissed: the order id is stored as minted; there is no second spelling
  checklist: identity-continuity dismissed: a binding is settled once at the append and never changes; an order that changes owner later leaves earlier records bound as they were
- terminal orders never move: A completed or cancelled work order accepts no move, close, or owner change, and completed is written by close alone.
  over: every work verb that writes about an existing order: move, close, owner
  via: work orders: create, move, close, owner, inspect; terminal orders do not move and completed is close's alone
  because: an order's end is the reader's fixed point for everything bound to it; a record after the end would file work under a closed assignment, and a second path to completed would leave a reader two record kinds to search for how an order ended
  crossing: project-source -> record
  refuted: removed the terminal refusal from close -> "work orders: create, move, close, owner, inspect; terminal orders do not move and completed is close's alone" went red in journal.test.ts at "a completed order does not close again"; restored, green (2026-09-17)
  kinds: state
  checklist: revalidated-permission dismissed: no permission is held; anyone may move an order, and the record names who
  checklist: separation-of-duties dismissed: the writer and the owner may be one session by design; an order is context, not a control
  checklist: legal-state-succession declared as terminal orders never move
  checklist: supersession-safety dismissed: a later record never replaces an earlier one; the order is the fold of all of them
  checklist: worker-fencing dismissed: no lease or fence exists; ownership is a field a reader uses to find records
  checklist: commit-ordered-effects dismissed: the append is the only effect
  checklist: resumption-coverage dismissed: nothing resumes from a checkpoint; the state is recomputed from every record at each read
