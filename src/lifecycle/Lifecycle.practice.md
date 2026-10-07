- carry a lexicon change through: A change to the lexicon reaches every place that names the concept, and the injection still fits, before anything uses the new name.
  when: command lexicon apply | edit docs/lexicon.json
  step: measure the compact injection before proposing; when the change would take it past 2,000 tokens, first split a long first sentence, moving its enumeration later and dropping nothing
    leaves: a decision per split, with the measured tokens in its because
  step: before a reject or a rename, count the findings it would create across the corpus; a word in ordinary use or a language keyword gets a qualifying rename instead of a bare rejection
  step: propose, then apply with because and over; a human ruling carries the human's words with --human, and none is ever invented
  step: declare a new noun before any code, spec, or record uses it
  step: update every concept whose definition or related list names the changed one
  step: rename once, everywhere: files, commands, modules, Scope views, npm scripts, and refuse the old name with a one-line migration
  step: run the vocabulary check and the compact budget test
    leaves: lexicon check with 0 rejected names and 0 unknown nouns; the budget test green
  pitfall: rejecting a bare word turned 227 uses of the TypeScript keyword into findings (d-5060eaab, rt-cdcf2a29)
  pitfall: the budget was crossed and trimmed afterwards three times, and once the budget test was already red for the next session (d-3eb04416, d-7f5b5203, d-beedd69e, u-1c5215fe)
  pitfall: a rejected alternative of three words or fewer becomes a name the check enforces; write it as a sentence when the word is in ordinary use (d-7c0ecc04)
  pitfall: a rejected name sat in a concept's related list after its concept was renamed (d-572be38e)
  pitfall: new nouns were left undeclared because the lexicon was outside the work order's write scope; escalate rather than leave them (u-de8416b2)
  learned: d-14651cb4, d-3eb04416, rt-cdcf2a29, d-edf80438
  reach: internal
  because: the lexicon is injected into every session, so a change that stops halfway teaches every later session the half; the cascade and the budget check are the steps that were skipped, and each skip cost a retraction or a trim after the fact
- harvest practices: A project adopting Coherence finds the methods it already has and keeps each as a candidate practice with its evidence, before the next session has to rediscover them.
  when: explicit
  step: read where method hides: the agent instructions (CLAUDE.md, AGENTS.md), skills, saved memories, contributing and release notes, and the order of the build and release scripts
  step: read the history for what repeats and what broke: the journal if there is one, and the git log for recurring commit shapes, fix-ups, reverts, and restores
  step: for each candidate, find at least one record or commit where the method was done, or where skipping it cost something; a method with no such evidence is a wish, and stays out
  step: rank by how often it recurs and how often it broke; the tacit steps that broke are the ones a practice pays for first
  step: write each beside the spec of the component whose work it governs, with scaffold practice, its pitfalls citing what witnessed them
    leaves: spec --check with 0 problems and each new practice listed as a candidate
  step: replace the procedure where it was found with a pointer to the practice, so the method is written once
  step: record a decision naming the practices written and the candidates left out, with why
    leaves: the decision's id
  pitfall: a review's method and findings sat in a session scratchpad, not the repository, and the next review rebuilt them from nothing (2755a69)
  pitfall: a command reference kept in prose drifted twelve commands behind the code it described (46cacf1)
  pitfall: an append-only store was rewritten by a commit and no check went red; the restore came by hand, later (8a237b5)
  learned: d-861e8319, d-7c0ecc04, f3920ae
  reach: kernel
  because: every project already has practices, kept in heads, scrollback and memory files that no session reliably reads; adoption is the cheapest moment to find them, and a practice found with its evidence starts as a candidate instead of a rule nobody can trace
- adopt Coherence: A project that has just installed Coherence and its hooks reaches a checked first reading of itself: its vocabulary settled, its components and entrances declared, the invariants that matter most witnessed, and every finding it already held baselined.
  when: explicit
  step: confirm the hooks are wired as install would write them: coherence hooks --check --host <claude or codex>
    leaves: hooks --check exits 0
  step: write coherence.config.json at the root: name, language, the folders that are not this project's code or prose under ignore (vendored code, generated output, fixtures), and, where the project has tests, test with testMatch and testJson; every key is in docs/config.md in the installed package
  step: settle the vocabulary: coherence lexicon coverage, then declare the terms that carry the project's meaning (the practice settle a domain term)
  step: to settle one part of the project first, name its folders or files: coherence lexicon coverage src/billing docs, and coherence lexicon draft src/billing for its unsettled candidates; each path is relative to the root or absolute inside it, and the config's ignore list still holds inside it
  step: declare the components and where work enters them: the entry spec with its trust levels, one spec per component folder, then every entrance (the practice declare entrances); the grammar is in docs/spec.md in the installed package
  step: give each real unit its own spec at whatever depth it sits, not one per top-level folder: run coherence mass, and for each folder it names as having no spec of its own, write its spec or record with decide why it belongs to the component above; repeat until mass names none you have not decided
    leaves: mass names no folder without a spec or a decision
  step: declare the few invariants that matter most (security, tenant isolation, data integrity), each through the practice declare a requirement
  step: run, then witness each refutation (the practice witness a refutation); a broken chokepoint is a finding to report with its bypass sites, not a failure to hide; a requirement the code already breaks stays a requirement, with a defect per site and an escalation, and a test that cannot run here is recorded as unable
    leaves: spec --check with 0 problems
  step: baseline what the project already held: coherence lexicon baseline, and coherence scaffold control --baseline for entrances with no traced control
    leaves: the baseline records in the journal
  step: find the methods the project already has (the practice harvest practices)
  step: commit coherence.config.json, the lexicon, the specs and practice files, the hook settings, .coherence/.gitignore (hooks install wrote it so git sees nothing Coherence regenerates), and .coherence/journal, .coherence/runs and .coherence/work
    leaves: the commit
  step: from the project's own root, run coherence scope and report what the reading shows: health, broken chokepoints, entrances with no traced control, and components no enforcement covers
  pitfall: both outside adopters' checks were red on arrival from Coherence's rejected names in their own prose, and npm link broke a pnpm build; install as a dev dependency and baseline what was already there (d-127ab8e4)
  pitfall: Scope failed when run from an adopter's own folder, because every page until then had been built from Coherence's checkout with --root (d-01976691)
  pitfall: a coverage report redirected into the adopter's root was read back as its source and grew on every run (df-79ac2d4e)
  pitfall: both outside adoptions left their route gaps open because nothing in the session's loop showed them (d-a1095ef2)
  pitfall: an adoption declared one spec per top-level folder and stopped, and a human had to ask for the nested units (df-9750aee2)
  pitfall: a fresh adoption found its first requirements already false and its tests unable to run unattended, and had to improvise what to record (df-8ac95c4d)
  learned: d-96eb6814, d-127ab8e4, d-a1095ef2, f658594
  reach: kernel
  because: the setup prompt was a method kept in prose, carried out once and reported in a chat reply that no later session reads; as a practice each step is delivered where its commands run, and the enactment is the durable record of how the project was adopted
- settle a domain term: A term enters the project's lexicon as the right kind of thing (a concept, an alias, a property, or ordinary code) with the reason recorded, before code or specs use it.
  when: command lexicon propose | command lexicon review
  step: read the term's live uses before naming it: coherence lexicon review <term>
  step: decide what it is: the project's own concept, an alias of one, a property of one (a field, a column, a unit), or an ordinary programming word that needs no entry
  step: settle a contested term from the project's own history (commit messages, pull request discussion) and record the tie-break with decide
    leaves: the decision's id
  step: when the history does not settle it, escalate instead of deciding: two live senses that no record separates, the owner's word colliding with a name the lexicon rejected, or any rename, retire, reject or lift of a concept; carry on with the term provisional, and apply only with the human's words
    leaves: the escalation's id
  step: before rejecting a name, count the findings it would create; a word in ordinary use gets a qualifying rename, not a bare rejection
  step: propose, then apply with because and over; a human ruling carries the human's words with --human, and none is ever invented
  step: run coherence lexicon --check
    leaves: 0 rejected names and 0 unknown nouns beyond the baseline
  pitfall: rejecting a bare word turned 227 uses of a language keyword into findings (rt-cdcf2a29)
  pitfall: field and column names were nominated as unknown nouns until they were filed as properties of their concepts (d-3283157b)
  pitfall: identifiers written in backticks in specs were nominated as unknown nouns (d-9e7b9247)
  pitfall: common programming words kept as rejected names made hundreds of findings in ordinary code (d-f77ce193)
  pitfall: the owner's own word for a thing collided with a name the lexicon had rejected for another concept (c-c05b409e)
  pitfall: new nouns were left undeclared because the lexicon was outside the session's scope, where an escalation would have reached the owner (u-de8416b2)
  learned: d-3283157b, d-f77ce193, d-2a689809, rt-cdcf2a29
  reach: kernel
  because: a lexicon entry is injected into every session, so a term filed as the wrong kind of thing (a field as a concept, a common word as a rejection) costs every later session a false finding or a missing one
