# Economy

The context closure of a change, the read traces that record what sessions actually loaded, calibrate over the two with an automatic outcome label, and mass: total and unreached, unreached first.

## invariants
- reach by either enforcement: Unreached mass counts a file reached when an invariant's chokepoint or its totality oracle reaches it, and says plainly which totality oracles could not be asked.
  over: every file of every component, against every latest run entry of either form
  via: mass counts reach by chokepoint or totality oracle, and says plainly when a totality oracle's run record does not name the files its test touched
  because: the glossary says unreached mass is code that no invariant's chokepoint, and no invariant's totality oracle, references, and counting only chokepoints called a file unreached that a totality oracle covers, which is the diagnostic lying about the load it is there to weigh. A totality oracle entry whose run record names no file cannot be counted either way, so it is named rather than silently counted as reaching nothing: 33 of this project's own bullets are in that state today
  crossing: record -> reading
  refuted: counted reach from the chokepoint entry alone, so a file the totality oracle's run record named stood unreached -> "mass counts reach by chokepoint or totality oracle, and says plainly when a totality oracle's run record does not name the files its test touched" went red in economy.test.ts, the covered file listed as unreached; restored, green (2026-09-18)
  kinds: none
- economy is deterministic: The closure of the same files over the same tree is the same closure: the same entries in path order, the same why lines in order, the same token estimate; nothing about it is stored.
  over: every closure predicted for a set of files over one tree
  via: economy: one hop out, one hop in, the spec of each component, and the invariants whose protected thing or chokepoint lives in the given files; deterministic
  because: a reader compares the prediction with what a session read; a closure that changed between two readings of one tree would make every comparison noise, and a stored closure would be a second truth that disagrees with the references it summarizes
  crossing: instrument -> reading
  refuted: removed the path sort from the closure's entries so they came out in insertion order -> "economy: one hop out, one hop in, the spec of each component, and the invariants whose protected thing or chokepoint lives in the given files; deterministic" went red in economy.test.ts on the entry order; restored, green (2026-09-17)
  kinds: none
- calibrate label never manual: A sample's outcome is derived from the journal and the runs written after its snapshot, through one function; no field of a trace or a command line sets it.
  protects: labelSnapshot
  chokepoint: sampleOf
  over: every read trace with a snapshot
  via: calibrate: the outcome label is automatic; a later defect record labels defect, a later passing run labels clean, nothing later is unknown, and a label written into the trace is ignored
  because: in the reference every sample stayed unknown because labeling was a command nobody ran; the loop that makes economy an instrument closes only when the label falls out of records that exist for their own reasons, and a label anyone could write by hand would be the first thing written wrong
  crossing: record -> reading
  refuted: made sampleOf read an outcome field written into the snapshot instead of deriving it -> "calibrate: the outcome label is automatic; a later defect record labels defect, a later passing run labels clean, nothing later is unknown, and a label written into the trace is ignored" went red in economy.test.ts (expected unknown, saw clean); restored, green (2026-09-17)
  kinds: none
- mass reports unreached first: The printed mass leads with the unreached numbers, for the project and for each component, before the totals; it is a reading, never a threshold, never a baseline, and never fails on growth.
  over: every mass report printed for a tree
  via: mass: a file in no component and a file in a component that no invariant reaches count as unreached; unreached prints first; deterministic
  because: growth is not the danger, weight with no definition is; an agent glancing at the top line must feel the wobbly load first, and a number that failed on growth would teach deletion where the way down is an invariant
  crossing: project-source -> reading
  refuted: printed the total line before the unreached line -> "mass: a file in no component and a file in a component that no invariant reaches count as unreached; unreached prints first; deterministic" went red in economy.test.ts on the first printed line; restored, green (2026-09-17)
  kinds: none
- working change is the project's change: The economy of the working change starts from exactly the project files git reports as changed, each with how git reported it: staged, unstaged, and untracked files not ignored against HEAD, and with --since everything from the merge base of the ref and HEAD; a deletion is reported and never given, a rename is its new path noting the old, and no ignored file or nested checkout ever counts.
  over: every path git reports for the working change of one tree, with and without --since
  via: working change: staged, unstaged, and untracked project files against HEAD, deletions reported and renames as the new path, never an ignored file or a nested checkout; --since adds everything from the merge base; sorted and deterministic
  because: an agent asking what its change must load should not have to list what it changed, and the list git gives is wider than the project: an agent's worktree copy, a nested clone, or an ignored build file named as changed would pull someone else's working state into the closure and inflate every token estimate calibrate compares; --since against a branch tip instead of the merge base would count what the branch never touched
  crossing: project-source -> reading
  refuted: let every path through without keepProjectFiles for paths on disk -> "working change: staged, unstaged, and untracked project files against HEAD, ..." went red in change.test.ts with an agent's worktree copy (.claude/worktrees/agent-x/src/api/render.ts) listed as added; restored, green (2026-09-23)
  kinds: none
- removal keeps its dependents: The files still importing a path the working change deleted, or the old path of a rename, enter the closure as that removal's dependents, and the spec of the component that held a deleted file enters with them.
  over: every deleted or renamed-away path of a working change, against every project source file importing it
  via: economy of the working change: the files still importing a deleted path or a renamed-away path enter the closure as its dependents, with the spec that held the deleted file
  because: a deleted file cannot be loaded or resolved, so hops through references find nothing for it, yet the files still naming it are exactly what the change broke; leaving them out would predict the smallest closure for the change most likely to need a wider one
  crossing: project-source -> reading
  refuted: skipped the scan for files importing a deleted or renamed-away path -> "economy of the working change: the files still importing a deleted path ..." went red in change.test.ts with src/api/uses-gone.ts missing from the closure; restored, green (2026-09-23)
  kinds: none
