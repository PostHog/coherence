# Adapters

The language adapter seam: how to ask a language's server for definitions, references, visibility, a test filter, and a synthetic refutation.

## invariants
- name forms: A spec value reads as a bare symbol, a symbol in its file, or a module path that stays under the project root, and prose never resolves; one function decides the form.
  protects: IDENTIFIER in adapter.ts
  chokepoint: parseName
  over: every value a spec writes under protects, chokepoint, or as a module path
  via: a spec value reads as a bare symbol, a symbol in a file, a module path, or prose
  because: fourteen of the reference's sixteen chokepoint claims had prose where the protected thing belongs and stood green for months; a value that does not read as a symbol or a module must be refused as prose by one function before any instrument is asked, so a claim about nothing cannot pass. Spec text is agent-authored and never trusted about itself, so a path with a parent segment or a leading slash is prose too: the module form accepted "..", and a spec could name a file above the project root for the tool to read
  crossing: project-source -> instrument
  refuted: made parseName read prose as a bare symbol -> "a spec value reads as a bare symbol, a symbol in a file, a module path, or prose" went red in adapter.test.ts; restored, green (2026-09-17)
  kinds: none
- current text before any question: Before any references query, the adapter makes the language server see the current disk text of every document it may have open and of every file the caller names, and waits for the server to acknowledge it.
  over: every document either adapter has open and every file a forget names
  via: the check reads the current disk text after a forget, with the instrument's watcher blind to the file: a loop of edit-then-check yields zero wrong verdicts
  because: tsserver reloads a closed document from disk only when it does not own the text, and a didOpen carrying the text it already loaded leaves it owning that text, so closing the document leaves the edit to a file watcher that is late under load and blind to an excluded file; both reviewers saw the check answer from pre-edit text and a pass recorded with a bypass on disk, the one answer revelation at the edit must never give
  crossing: project-source -> instrument
  refuted: left an open document to the file watcher on forget, as the adapter did before -> "the check reads the current disk text after a forget, with the instrument's watcher blind to the file: a loop of edit-then-check yields zero wrong verdicts" went red in enforcement.test.ts with two of six verdicts answered from pre-edit text; restored, green (2026-09-18)
  kinds: none
- every site is a reference: Every site the language server reports for the protected thing is a reference, an import or re-export specifier included; the adapter reports the syntactic form it read at the site and never exempts one, and the check alone decides what the form means.
  over: every reference site either adapter reports, import and export specifiers included
  via: every site the language server reports is a reference: a bypass beneath a semicolon-less bare import is a bypass, and an import outside the chokepoint is one too
  because: an import of the protected thing outside the chokepoint reaches it and a re-export widens its reach with no call at all, so neither is exempt; the heuristic that told an import from a use called every site beneath a semicolon-less bare import an import, and a real bypass graded clean (decision d-0da89a08 dissolved the exemption rather than patch the parser). Ruling d-7abd1ba8 gives one form one meaning at one location, and the adapter still exempts nothing: it reads the form forward from the top-level statement the site sits in, which is the reading the dissolved heuristic could not make, and hands it to the check
  crossing: instrument -> reading
  refuted: exempted import specifiers from the classification, as the adapter did before -> "every site the language server reports is a reference: a bypass beneath a semicolon-less bare import is a bypass, and an import outside the chokepoint is one too" went red in enforcement.test.ts with the bypass graded pass; restored, green (2026-09-18)
  kinds: none
- test paths: A path is a test when a configured folder is one of its segments or the file is named .test or .spec.
  over: every configured test folder and every file named .test or .spec
  via: a path is a test when a configured folder is a segment or the file is named .test or .spec
  because: a test may reference a protected thing to check it and is reported rather than counted as a bypass; the rule is the config's folders plus the file naming both runners use, so a test in an unexpected folder is still a test
  crossing: project-source -> reading
  refuted: made a configured test folder no longer mark a path as a test -> "a path is a test when a configured folder is a segment or the file is named .test or .spec" went red in adapter.test.ts; restored, green (2026-09-17)
  kinds: none
- ladder is adapter-defined: The grade ladder is the adapter's to name, rung by rung, each rung a fact the adapter verifies and the name of who enforces it: TypeScript's compiler reaches visibility-choked; Python's interpreter reaches closure-choked, a checker the project runs checker-choked, Coherence's own check reference-choked, and a convention alone is enforced by nobody.
  protects: TYPESCRIPT_LADDER
  chokepoint: TypeScriptAdapter
  over: every adapter
  via: the grade ladder's top rung is adapter-defined: TypeScript enforces visibility, Python does not
  because: visibility-choked means the language itself refuses a reference from outside the module; a language that enforces no visibility cannot earn it, and a ladder with one top for every language would grade a convention as a structural fact; naming the enforcer on every rung is what lets a human read how much the structure is doing and who would stop a bypass
  crossing: instrument -> reading
  refuted: raised the second adapter's top rung to visibility-choked -> the adapter-defined ladder test went red in adapter.test.ts; restored, green (2026-09-17); left whenVacuous unset on the Python ladder -> the same test went red; restored, green (2026-09-17)
  kinds: none
- Python rungs verified: A Python chokepoint is graded closure-choked only when the protected thing is a function-local inside the chokepoint's body and no module attribute exposes it, checker-choked only when the name is underscore-prefixed and the project's Pyright configuration makes reportPrivateUsage an error (or an import-linter rule names the protected module), and reference-choked otherwise, with the underscore prefix and the __all__ list reported as evidence.
  protects: PYTHON_LADDER
  chokepoint: PythonAdapter
  over: every rung of the Python ladder and every combination of definition scope, name prefix, __all__ membership, and checker configuration
  via: Python grades: broken with a bypass; reference-choked when clean, with the convention as evidence; closure-choked for a function-local; checker-choked once Pyright's private-usage rule is an error; broken without a chokepoint; not chokeable for prose
  because: each rung names an enforcer, so a rung granted without its fact would credit the interpreter or a checker with a refusal that does not happen; the adapter reads the definition's scope from Pyright's symbols and the checker's rule from the project's own configuration, never from the spec
  crossing: instrument -> reading
  refuted: made the closure rung never verified -> "Python grades: broken with a bypass; reference-choked when clean, with the convention as evidence; closure-choked for a function-local; checker-choked once Pyright's private-usage rule is an error; broken without a chokepoint; not chokeable for prose" went red in python.test.ts; restored, green (2026-09-17)
  kinds: none
- package files are inside the package: A site in one of a protected package's own files is inside the package, and every other site Pyright reports, an import line or an __all__ entry included, is a reference classified by where it sits.
  over: every reference site Pyright reports for a protected module or package
  via: a Python module or package resolves, its members are the references' start, and the package's own files are inside it
  because: a package re-exporting its own members from __init__ is the package reaching itself, so its own files are inside; an importer of a protected name outside the chokepoint reaches the thing and is a bypass, which is what the check exists to reveal
  crossing: instrument -> reading
  refuted: made a package's own files no longer inside the protected package -> "a Python module or package resolves, its members are the references' start, and the package's own files are inside it" went red in python.test.ts; restored, green (2026-09-17)
  kinds: none
- whole workspace indexed: The Python adapter waits for Pyright's enumeration of the whole workspace before answering, and never narrows the workspace to a component.
  over: every references query and every bare-name resolution the Python adapter answers
  via: Python waits for whole-workspace enumeration before bare-name resolution and references, and finds references outside the component
  because: a Python reference can sit in any project file, so a partial index cannot prove that no bypass exists; both references queries and bare-name resolutions wait for Pyright's source-file enumeration, and Pyright receives the project root as its root and workspace folder, so a component hint orders the text scan without narrowing the workspace
  crossing: instrument -> reading
  refuted: bypassed the enumeration barrier before every indexed query -> "Python waits for whole-workspace enumeration before bare-name resolution and references, and finds references outside the component" went red; restored, green (2026-09-18); narrowed Pyright initialization from the project root to one component -> the same test went red; restored, green (2026-09-18)
  kinds: none
- pytest report mapped by name: The batched totality pass reads pytest's JUnit XML or pytest-json-report's JSON as the one report shape, and writes pytest's name filter as a -k expression joined with or.
  protects: reportFromJunit
  chokepoint: parseReport
  over: every report the configured testJson command writes and every via a Python bullet names
  via: pytest's JUnit report reads as the jest shape, and -k names join with or
  because: pytest ships no jest-shaped reporter but writes JUnit XML itself; a name joined as a regex would be one -k expression pytest cannot parse, so no test would run and every Python totality oracle would fail for the wrong reason
  crossing: instrument -> record
  refuted: joined pytest names as a regex -> "pytest's JUnit report reads as the jest shape, and -k names join with or" went red in python.test.ts; restored, green (2026-09-17)
  kinds: none
- server located or a reason: The language server binary is found in the adopter's node_modules first, then Coherence's, then on PATH, and its absence is a reason, never a crash.
  protects: SERVER_BIN in typescript.ts
  chokepoint: src/adapters/typescript.ts
  over: the adopter's node_modules, Coherence's, and every folder on PATH
  via: the language server binary is found (the adapter's precondition)
  because: the language server is an optional dependency; an adopter without it must get a reason naming where the tool looked and how to install it, and a run must record not run rather than crash, since not run is a verdict the status view can show. The chokepoint's refutation is the compiler's own refusal of a synthetic import of SERVER_BIN, which its module does not export (ruling rs-e93ecdd6); the totality oracle was refuted by making locateServer answer before it looked anywhere, which is the absence branch staged inside the function rather than by taking the binary off the machine
  crossing: instrument -> reading
  refuted: made locateServer return undefined before it looked anywhere, so the adapter's precondition found no binary -> the totality oracle went red, then green once restored (2026-09-18)
  kinds: deploy
  checklist: graceful-drain dismissed: nothing is shut down by locating the binary
  checklist: readiness-evidence declared as server located or a reason
  checklist: declared-target-coverage dismissed: three places are looked in, in order; there is no registry of targets
- only the project's files: Only the project's own files are ever evidence: a file is the project's when git tracks it or lists it untracked and not ignored, and it lies inside no nested checkout; one function set decides it (projectFiles, keepProjectFiles, projectSites in project-files.ts), and every walk of the project and every reference an instrument reports passes through it.
  over: every walk of the project (the adapters' source scans, the spec walker, economy and mass, the vocabulary check's corpus, observation's path mapping, the changed-file listings) and every reference site accepted from an instrument (the adapters, the chokepoint check, the edit hook's re-check, the economy closure, the observed and Scope component interfaces)
  via: only the project's own files are ever evidence: a nested checkout and an ignored path are no bypass, no vocabulary, and no mass
  because: agents work in git worktrees under .claude/worktrees, inside the main checkout, and each worktree's copy of a file reads to a language server as more of the project; a reference in an agent's copy of verbs.ts graded attributed writes broken in the main checkout, the edit hook reported the same false bypasses to several agents, and the Structure map shown to reviewers carried the false broken (conjecture c-16d2f394, resolution rs-b4cf50f6). Git's own ignore rules already say what is not the project's, and a folder holding a .git is another checkout even when git cannot follow its gitdir, so both halves are one rule
  crossing: instrument -> reading
  kinds: none
- every manifest edge is a reference: Every depends_on edge into a resolved dbt model is reported as one site, whether or not the text that writes it is found; a computed ref sits at line 1 of the reading file.
  over: every depends_on edge of every resource in the dbt manifest
  via: every manifest edge is a reference: one site per edge, at the ref call, at line 1 when no literal call writes it, and a YAML test at its name line
  because: dbt resolves what a model depends on, including a ref the template computes that no text search finds; an edge dropped because its call could not be located is a bypass nobody sees, so the text only places the site and never decides whether it exists
  crossing: instrument -> reading
  refuted: skipped every edge whose ref call the text search could not locate -> the totality oracle went red in dbt.test.ts; restored, green (2026-09-28)
  kinds: none
- a stale manifest answers nothing: When any dbt file is newer than the manifest and no configured parse makes it current, the dbt adapter is not ready and every question it is asked throws, so the run records not run.
  over: every question the dbt adapter answers and every dbt file under the paths dbt_project.yml names
  via: a stale manifest answers nothing: a dbt file newer than the manifest makes ready fail and every question throw, until a configured parse makes it current
  because: the manifest is the instrument; one older than the text describes a project that no longer exists, and a check answered from it could pass with a bypass on disk, the one answer revelation at the edit must never give
  crossing: instrument -> reading
  refuted: let refresh read a manifest older than a dbt file without parsing or refusing -> the totality oracle went red in dbt.test.ts; restored, green (2026-09-28)
  kinds: none
- a module is its folder: A folder named as a module is every dbt model file under it and nothing else, and a site in any of those files is within the module.
  over: every folder a spec names as a dbt module and every site the check classifies against one
  via: a module is its folder: a site in any member file is inside, a site beside the folder is not
  because: the entry families, the staging models, and the diagnostics are folders, not files; a prefix match would put a sibling folder whose name merely starts the same inside the module and hide its bypasses
  crossing: instrument -> reading
  refuted: matched a folder module by path prefix instead of its member files -> the totality oracle went red in dbt.test.ts; restored, green (2026-09-28)
  kinds: none
- a test resource is a test site: A site whose referencing resource is a dbt test carries the instrument's test mark wherever its file lies, and the check classifies it a test.
  over: every reference site the dbt adapter reports from a dbt test, singular or declared in a model folder's YAML
  via: a test resource is a test site wherever its file lies: the adapter marks a YAML test under a model folder, and the check classifies it a test
  because: a dbt test declared in YAML lives in a model folder, so no test-folder rule can see it; without the instrument's word every such test reads as a bypass of the model it tests
  crossing: instrument -> reading
  refuted: dropped the test mark for tests declared in YAML -> the totality oracle went red in dbt.test.ts; restored, green (2026-09-28)
  kinds: none
- dbt results mapped by unique id: The batched totality pass reads dbt's run_results.json, names each result by the test-name segment of its unique id, passes a test at severity warn with the warning in its reason, and reports a via that matches no result as matched 0.
  protects: reportFromDbtRunResults
  chokepoint: parseReport
  over: every result in the run_results.json the dbt runner writes and every via a dbt totality oracle names
  via: a dbt result maps by unique id: one invocation's run_results.json gives each test its verdict, a warning passes and says so, and a name matching no result reports matched 0
  because: dbt writes its report only into its target folder and names each test by unique id; a mapping by prefix or by the whole id would give one bullet another test's verdict or none, and a warning the ruling declared acceptable must not read as a failure
  crossing: instrument -> record
  refuted: named each result by everything after the package, hash included -> the totality oracle went red in dbt.test.ts; restored, green (2026-09-28)
  kinds: none
- two instruments, one owner: In a project with several instruments, the one that resolves a name answers every later question about it, a name more than one resolves is ambiguous with every answer listed, and the composite is ready only when every member is.
  over: every member of the composite adapter and every name a spec gives it
  via: two instruments in one project: the member that resolves a name answers every question about it, a name two members resolve is ambiguous, and one member down makes the composite not ready
  because: a dbt model and a Python symbol may share a name; a silent pick would grade one of them on the other's references, and a composite that answered with a member down would report a clean check the missing member never made
  crossing: instrument -> reading
  refuted: let the first member that resolves a name own it, however many resolve it -> the totality oracle went red in dbt.test.ts; restored, green (2026-09-28)
  kinds: none
