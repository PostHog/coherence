# Adapters

The language adapter seam: how to ask a language's server for definitions, references, visibility, a test filter, and a synthetic refutation.

## invariants
- name forms: A spec value reads as a bare symbol, a symbol in its file, or a module path, and prose never resolves; one function decides the form.
  protects: IDENTIFIER in adapter.ts
  chokepoint: parseName
  over: every value a spec writes under protects, chokepoint, or as a module path
  via: a spec value reads as a bare symbol, a symbol in a file, a module path, or prose
  because: fourteen of the reference's sixteen chokepoint claims had prose where the protected thing belongs and stood green for months; a value that does not read as a symbol or a module must be refused as prose by one function before any instrument is asked, so a claim about nothing cannot pass
  crossing: project-source -> instrument
  refuted: made parseName read prose as a bare symbol -> "a spec value reads as a bare symbol, a symbol in a file, a module path, or prose" went red in adapter.test.ts; restored, green (2026-09-17)
  kinds: none
- import told from use: An import or export specifier is told from a use, across wrapped lines, so bringing a name into scope is never a bypass.
  protects: IMPORT_START
  chokepoint: isImportSite
  over: every reference site the language server reports, across wrapped import and export lines
  via: an import or export specifier is told from a use, across wrapped lines
  because: an import brings a name into scope and uses nothing; counted as a bypass, every module that routes through the chokepoint would be graded broken for importing the thing it protects
  crossing: instrument -> reading
  refuted: made isImportSite answer false for every site -> "an import or export specifier is told from a use, across wrapped lines" went red in adapter.test.ts; restored, green (2026-09-17)
  kinds: none
- test paths: A path is a test when a configured folder is one of its segments or the file is named .test or .spec.
  over: every configured test folder and every file named .test or .spec
  via: a path is a test when a configured folder is a segment or the file is named .test or .spec
  because: a test may reference a protected thing to check it and is reported rather than counted as a bypass; the rule is the config's folders plus the file naming both runners use, so a test in an unexpected folder is still a test
  crossing: project-source -> reading
  refuted: made a configured test folder no longer mark a path as a test -> "a path is a test when a configured folder is a segment or the file is named .test or .spec" went red in adapter.test.ts; restored, green (2026-09-17)
  kinds: none
- ladder is adapter-defined: The top rung of the grade ladder is the adapter's to name: TypeScript enforces visibility and reaches visibility-choked; a language that does not tops out at reference-choked.
  protects: TYPESCRIPT_LADDER
  chokepoint: TypeScriptAdapter
  over: every adapter
  via: the grade ladder's top rung is adapter-defined
  because: visibility-choked means the language itself refuses a reference from outside the module; a language that enforces no visibility cannot earn it, and a ladder with one top for every language would grade a convention as a structural fact
  crossing: instrument -> reading
  refuted: raised the second adapter's top rung to visibility-choked -> the adapter-defined ladder test went red in adapter.test.ts; restored, green (2026-09-17)
  kinds: none
- server located or a reason: The language server binary is found in the adopter's node_modules first, then Coherence's, then on PATH, and its absence is a reason, never a crash.
  protects: SERVER_BIN
  chokepoint: src/adapters/typescript.ts
  over: the adopter's node_modules, Coherence's, and every folder on PATH
  via: the language server binary is found (the adapter's precondition)
  because: the language server is an optional dependency; an adopter without it must get a reason naming where the tool looked and how to install it, and a run must record not run rather than crash, since not run is a verdict the status view can show
  crossing: instrument -> reading
  refuted: <not witnessed: the binary is also on PATH on this machine, so a staged break of the node_modules lookup would stay green>
  kinds: deploy
  checklist: graceful-drain dismissed: nothing is shut down by locating the binary
  checklist: readiness-evidence declared as server located or a reason
  checklist: declared-target-coverage dismissed: three places are looked in, in order; there is no registry of targets
