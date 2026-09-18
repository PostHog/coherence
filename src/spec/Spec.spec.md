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
- refutation is a recorded event: A totality oracle's refutation is witnessed only by a refutation record in the run store together with a later run that found the same totality oracle passing; the bullet's refuted: line is the human account and satisfies nothing on its own, and refutation is required per enforcement, so a bullet carrying both forms needs both.
  over: every bullet with a totality oracle form, and every refutation record in the run store
  via: a totality oracle's refutation is a recorded event: the refuted line never satisfies it, a record with a later passing run does, and a bullet with both forms needs both
  because: this carries no chokepoint form on purpose: witnessedRefutations is reached only by loadSpecModel, but the import specifier that brings it into model.ts is a reference outside that function, so a chokepoint naming the symbol would be a claim this tool itself grades broken on the day it is written (escalation e-1fd35e17 asks the owner to rule on the seven older bullets in that position). Both reviewers measured 32 of the 52 bullets reported as invariants resting on a parseable sentence with nothing linking it to a red result, and a chokepoint written entirely in prose with a self-asserted refuted line read as a full invariant with 0 problems from spec --check, the only check npm test runs; a refutation is the witnessed firing of an enforcement, so it must be an event the tool watched (the totality oracle red with the break staged, then green once restored), and the chokepoint's automatic refutation proves nothing about the totality oracle standing beside it
  crossing: record -> reading
  refuted: let the bullet's own refuted: line satisfy a totality oracle's refutation again, with no record behind it -> the totality oracle went red, then green once restored (2026-09-18)
  kinds: none
- placeholders count as absent: A value still in angle brackets parses, counts as absent, and is listed as unfilled.
  over: every key of the grammar
  via: a placeholder value parses but counts as absent
  because: the scaffold writes every slot first so the shape is never wrong; a placeholder that counted as a value would make an unfilled bullet look complete
  crossing: project-source -> reading
  refuted: made isPlaceholder answer false for every value -> "a placeholder value parses but counts as absent" went red in spec.test.ts; restored, green (2026-09-17)
  kinds: none
- a refuted line parses in linear time: A refuted line's date is matched anchored at the end and its arrow by position, never by a lazy group on each side, and three digit groups that name no day are refused.
  over: every refuted: line in every spec, of any length
  via: a long refuted value parses in linear time, and three digit groups that name no day are refused
  because: loadSpecModel runs on every hook event, and the old pattern put a lazy group before the arrow, another before the date, and \s* between them: 156 KB of a value that reaches an arrow and never reaches a date took 16.5 s, and one interior run of 8 KB of spaces took 161 s, so any agent-authored spec was a stall the session could not explain; and a date of three digit groups let 2026-13-45 stand as the day a refutation was witnessed
  crossing: project-source -> reading
  refuted: made the date check accept any three digit groups again, so 2026-13-45 stood as a day -> the totality oracle went red, then green once restored (2026-09-18)
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
