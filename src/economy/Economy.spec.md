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
