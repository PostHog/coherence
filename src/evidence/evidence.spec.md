# Durable evidence

Records decisions, defects, experiments and verification history so later sessions can recover what was observed and decided.

Each ledger keeps its own evidence contract. Readers validate surviving records; journal streaming preserves content identity across appends and compaction.

## invariants

- concurrent status writers preserve complete independent reports
- verdict-bearing decision reads fail closed on surviving journal damage
- a committed decision population cannot disappear into adoption from zero
- decision ratification follows explicit subject and authority, never prose similarity or recency
- a skipped run never clobbers an oracle's recorded verdict
- experiment outcomes require criterion-total evidence
- experiment telemetry preserves its weakest provable attribution
- surviving agent-assessed defect evidence is attributable and internally consistent
- defect writes refuse pre-existing symlink redirection
- defect provenance is data, never terminal control
- a streamed journal entry renders exactly once across appends and compaction

## refutations

- concurrent status writers preserve complete independent reports: the taxonomy field probe overlapped atlas and mass writes in twenty temporary repositories. Both writers returned successfully, but eighteen final files were unreadable and two lost a report. A sequential control kept both. One exclusive read/merge/publish transaction plus atomic rename replaces the independent whole-file writes; an abandoned lock refuses instead of being stolen.
- verdict-bearing decision reads fail closed on surviving journal damage: a symlinked `.coherence` could supply external valid rows, a renamed or blank/torn file silently shrank the trusted population, and case-distinct `Owner`/`owner` sessions collided on case-folding filesystems. The trusted projection now validates containment, every directory entry, append framing, and domain-separated hashed session addresses before admitting any row.
- a committed decision population cannot disappear into adoption from zero: two valid conflicting decision files produced `RESOLVE-CONFLICT`; deleting the entire tracked directory then produced zero trusted rows and `STEADY`. The strict empty projection now asks current Git `HEAD` whether tracked decision files disappeared, while a repository that never owned a ledger remains valid first-use adoption.
- surviving agent-assessed defect evidence is attributable and internally consistent: disabled the content-address recomputation in the strict reader (2026-08-20), so a summary, evidence string, or timestamp changed without its id remained readable — full verify red this claim by name at `claims: 51 · 50 green · 1 red`; the guard observed that the inconsistent row no longer refused. Restored. This detects accidental or partial damage, not an adversary who rewrites a valid row and recomputes its unkeyed id; committed Git history is that rewrite witness.
- defect writes refuse pre-existing symlink redirection: before release, replaced `.coherence/defects` with a symlink to an outside temporary directory and `recordDefect` created the session ledger there; replacing a session target with an outside-file symlink likewise appended through it. The focused containment guard now refuses both, and the writer opens the final component with `O_NOFOLLOW` plus descriptor/path identity checks. This is a stable-filesystem guarantee, not a claim to defeat a privileged concurrent parent-directory rename.
- defect provenance is data, never terminal control: before release, replaced a valid row's commit with `deadbeef` plus an ESC clear-screen sequence, recomputed its ordinary content id, and the strict reader accepted it; the human render contained the live control byte. The focused provenance guard now requires lowercase 40- or 64-hex Git object-name shape, and rendering still escapes it defensively.
- a skipped run never clobbers an oracle's recorded verdict: made the merge take the fresh skip unconditionally -> `claims: 26 · 25 green · 1 red`, this claim red by name. Restored, 26/26.
- a streamed journal entry renders exactly once across appends and compaction: deleted the `seen` dedupe from `tailJournal`'s parse loop — every parsed line pushed unconditionally, so a compaction fold replays its whole record set (2026-08-04) — full verify red BY NAME, `claims: 31 · 30 green · 1 red`, this claim failing through its guard (the fold fixture observed the replay). Restored, back to 31/31. This is the loosening direction and the quiet one: a feed that duplicates does not crash, it just teaches the orchestrator that a question was decided twice — the exact lie the content address exists to prevent.

## works when

- boundary "concurrent status writers preserve complete independent reports" at recordVerify via guard "status publication — concurrent processes preserve independent reports and readers see complete JSON"
- boundary "verdict-bearing decision reads fail closed on surviving journal damage" at readTrustedJournal via guard "trusted journal — any malformed, forged, displaced, conflicting, or dangling row refuses the verdict projection"
- boundary "a committed decision population cannot disappear into adoption from zero" at readTrustedJournal via guard "trusted journal — any malformed, forged, displaced, conflicting, or dangling row refuses the verdict projection"
- boundary "decision ratification follows explicit subject and authority, never prose similarity or recency" at analyzeDecisionPositions via guard "local alternatives need ratification; an explicit stronger choice settles them"
- boundary "a skipped run never clobbers an oracle's recorded verdict" at recordVerify via guard "merge — a skip never clobbers a real verdict; the old verdict rides through with its own stamp"
- boundary "experiment outcomes require criterion-total evidence" at closeExperiment over ExperimentOpened via guard "close — total nonempty evidence is mandatory and outcome is derived, never supplied"
- boundary "experiment telemetry preserves its weakest provable attribution" at closeExperiment via guard "Codex parent-only tool events close the loop as an aggregate, never exact owner evidence"
- boundary "surviving agent-assessed defect evidence is attributable and internally consistent" at recordDefect via guard "defects — agent-assessed evidence is attributable, content-addressed, and strict on inconsistent rows"
- boundary "defect writes refuse pre-existing symlink redirection" at recordDefect via guard "defect containment — pre-existing directory and session symlinks refuse external append targets"
- boundary "defect provenance is data, never terminal control" at readDefects via guard "defect provenance — commit ids have Git shape and cannot carry terminal controls"
- boundary "a streamed journal entry renders exactly once across appends and compaction" at tailJournal via guard "tail — an appended record arrives exactly once, a compaction fold re-emits nothing and drops nothing, and a half-written line waits for its bytes"

## addresses

- {"claim":"g-5fb8608906bde1e3901cc69a620b322119d60860709f5e8a119f429ab08d5150","subject":"src/evidence/decisions.ts#readTrustedJournal","obligation":"guarantee:G-BOUNDARY","assessment":"t-157fca4c0054ab5f39288e1bea84ccd3b8172d17ee48cea48315c735dac7cd32","because":"The strict journal projection validates surviving records and refuses the whole reading on damage. This addresses the invalid-input refusal part of the boundary obligation, not all caller-visible failure semantics."}
- {"claim":"g-e8d24eb9de00abbec60bc1f3876c94517c970228bad3d4cf4f3b63d51bec89cf","subject":"src/evidence/status.ts#recordVerify","obligation":"guarantee:G-PERSISTENCE","assessment":"t-43387dcec74b31d96afdd95ba168f59db2ee996d511ef3d565958514ebeadb59","because":"The merge preserves the dated prior oracle verdict when a later run skips it. This addresses retained report history, not immutable evidence or complete crash recovery."}

## why

**concurrent status writers preserve complete independent reports.** A successful report
write is a promise that later readers can recover it. Independent instruments must not
erase one another merely because their finish times overlap, and a reader must never
inherit half of a report. Availability after a killed writer is less valuable than
inventing ownership of a still-live writer's critical section.

**verdict-bearing decision reads fail closed on surviving journal damage.** The journal's
tolerant reader is useful for a human salvaging old history, but a regulator or waiver
cannot turn its skipped lines into a smaller trusted population. The strict projection
validates wire version, canonical shape and time, content identity, session/file
attribution, containment, append framing, duplicate agreement, and terminal references
as one relation. Domain-separated session hashes retain case-sensitive identity on
case-folding filesystems while an owned historical filename remains readable. Any damage
makes the verdict-bearing population unavailable while the historical render stays
backward-compatible.

**a committed decision population cannot disappear into adoption from zero.** An absent
ledger is legitimate before first use, so filesystem absence alone proves nothing. Once
current Git `HEAD` owns decision files, however, their wholesale deletion is an external
witness that zero rows means lost evidence rather than adoption. The witness is consulted
only at zero: populated compaction remains legal, while non-Git and unborn repositories
retain an honestly unproven empty state.

**a skipped run never clobbers an oracle's recorded verdict.** The record is the last
known truth, honestly dated. A fast tier that skips the executable claims every commit
would otherwise erase last week's real pass — or, worse, a real fail — with "did not
look", and history that can be overwritten by not looking is not history.

**experiment outcomes require criterion-total evidence.** A
plan is frozen before work with its predicted context, actions, criteria, and evidence
cursors. Closure answers every action and criterion exactly once, preserves the assessor,
and derives success, failure, or inconclusive from criterion statuses rather than accepting
an outcome label. Otherwise the ledger would turn an incomplete story into a measured loop.

**experiment telemetry preserves its weakest provable attribution.** Trace and activity
windows may be empty, prove an exact owner session, or only prove a parent-session aggregate
that can include descendants; older trace may carry no observation metadata at all. Those
four scopes remain distinct in the immutable close record. Damaged prefixes, unreadable
rows, and unknown or inconsistent scope refuse. That keeps compatible history without
turning absence or uncertainty into false precision.

**surviving agent-assessed defect evidence is attributable and internally consistent.** A
conjecture keeps uncertainty alive; a defect record says an agent crossed that epistemic
boundary and must therefore carry the evidence for doing so, the repository subject it
judged, and the caller-attributed writer labels attached to the assessment. Records append per session and
dedupe exact retries, while the merged reader recomputes the ordinary content address and
refuses malformed, inconsistent, or displaced surviving rows. That detects partial damage;
it does not prove that a valid row was never rewritten with a recomputed id. Committed Git
history is this first recorder's external rewrite and deletion witness, and an independently
anchored head is future work.

**defect writes refuse pre-existing symlink redirection.** A path beneath the repository
is not containment when its stable components redirect through a symlink. The reader
therefore refuses linked ledger directories and entries, while the writer validates both
directory components and opens the session target without following its final link, then
compares the opened descriptor with the standing path before appending. This prevents the
measured stable-state redirects; it is not an `openat`-grade promise against a privileged
process racing parent-directory renames during the append.

**defect provenance is data, never terminal control.** Repository identity is captured by
the machine, but the committed row is still untrusted input on its next read. A commit is
therefore null or has lowercase SHA-1/SHA-256 object-name shape, never merely a nonempty string; the
human renderer also neutralizes its bytes. Without both the semantic constraint and the
output encoding, an edited but re-addressed row could turn provenance into a terminal
instruction while remaining structurally valid.

**a streamed journal entry renders exactly once across appends and compaction.** The live
stream exists for the one reader the settled render cannot serve — an orchestrator watching
five subagents mid-flight — and that reader has no way to audit the feed against the files.
A dropped entry is a decision the orchestrator never saw, indistinguishable from one never
made; a duplicate teaches the opposite lie, that a question was decided twice. Both are
cheap to produce, because the journal's files do not strictly grow: compaction moves lines
between files and unlinks the originals, which a position-addressed reader replays in full.
So a record's identity in the stream comes from its content — the same triple the merged
timeline sorts by — and a moved line is one the feed already carried.

**decision ratification follows explicit subject and authority, never prose similarity or
recency.** Independent agents can word the same question differently and can mention the
same noun while answering different questions. Conflict detection therefore compares only
standing decisions that share a machine-authored subject. Local alternatives remain
proposals; one explicit orchestrator-accepted or user-directed choice can ratify them;
incompatible choices tied at the highest authority stay contested.
