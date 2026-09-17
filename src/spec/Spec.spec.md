# Spec

The spec grammar and the model: one bullet shape, with each bullet's state derived from what it carries and from the latest run.

## invariants
- retired sections refused: A section the reference used is refused by name with its replacement, and any other section is refused as unknown.
  protects: RETIRED_SECTIONS
  chokepoint: retiredSection
  over: every section in retired-sections.json
  via: every retired section is refused by name with its replacement
  because: the reference's sections are the shape agents remember; refusing each by name and saying what replaced it turns a habit into one edit, and keeping the names as data read by one function keeps them out of code and prose
  crossing: project-source -> reading
  refuted: inverted the retired-section test in the parser so a retired name passed as unknown -> "every retired section is refused by name with its replacement" went red in spec.test.ts; restored, green (2026-09-17)
  kinds: none
- requirement until complete: A bullet lacking enforcement, a witnessed refutation, kinds, or an answered checklist is a requirement, never an invariant; a missing because is reported and does not change the state.
  protects: deriveState
  chokepoint: loadSpecModel
  over: every bullet in every spec under the root
  via: the state derivation: the full bullet is an invariant, and each missing part keeps it a requirement
  because: an invariant is a claim that something detects its violation; a bullet that names no enforcement, has never been seen to fire, or skipped its checklist is a plan, and calling it an invariant would let a plan pass as detection; the derivation lives in one function that only the model loader calls, so no reading can compute a different state
  crossing: project-source -> reading
  refuted: stopped deriveState from recording a missing enforcement as a lack -> "the state derivation: the full bullet is an invariant, and each missing part keeps it a requirement" went red in spec.test.ts; restored, green (2026-09-17)
  kinds: none
- placeholders count as absent: A value still in angle brackets parses, counts as absent, and is listed as unfilled.
  over: every key of the grammar
  via: a placeholder value parses but counts as absent
  because: the scaffold writes every slot first so the shape is never wrong; a placeholder that counted as a value would make an unfilled bullet look complete
  crossing: project-source -> reading
  refuted: made isPlaceholder answer false for every value -> "a placeholder value parses but counts as absent" went red in spec.test.ts; restored, green (2026-09-17)
  kinds: none
- half a form is a problem: Half an enforcement form, an unknown key, a bad crossing, or a bad refutation is a problem reported with its file and line.
  over: every key on every bullet: the two enforcement pairs, the crossing, the refutation, and any key the grammar does not name
  via: half an enforcement form, an unknown key, a bad crossing, and a bad refutation are problems
  because: a bullet with protects and no chokepoint claims a structure nobody can check, and a key the grammar does not name is a slot the agent invented; reported as a problem with its line, each is fixed before it can pass as a requirement
  crossing: project-source -> reading
  refuted: let a bullet carrying one key of an enforcement pair through without a problem -> "half an enforcement form, an unknown key, a bad crossing, and a bad refutation are problems" went red in spec.test.ts; restored, green (2026-09-17)
  kinds: none
- trust levels in the entry spec only: A crossing names two declared trust levels, and only the entry spec declares them.
  over: every crossing in every spec and every trust levels section
  via: the model: crossings name declared trust levels, and only the entry spec declares them
  because: a crossing is a query key, every chokepoint where agent input reaches the record; a level declared in two places or named in none would split the key, and one short list in the entry spec keeps it whole
  crossing: project-source -> reading
  refuted: disabled the problem for a trust levels section outside the entry spec -> "the model: crossings name declared trust levels, and only the entry spec declares them" went red in spec.test.ts; restored, green (2026-09-17)
  kinds: none
- one spec per folder: Names are unique within a component, a declared-as name must exist, and a folder holds one spec.
  over: every spec file under the root and every declared-as line in it
  via: the model: names are unique within a component, declared-as names must exist, and one spec per folder
  because: a checklist line declares a shape as a named invariant; if the name matched two bullets or none, the declaration would point nowhere, and a folder with two specs would be two components in one place
  crossing: project-source -> reading
  refuted: disabled the duplicate-name problem in loadSpecModel -> "the model: names are unique within a component, declared-as names must exist, and one spec per folder" went red in spec.test.ts; restored, green (2026-09-17)
  kinds: none
