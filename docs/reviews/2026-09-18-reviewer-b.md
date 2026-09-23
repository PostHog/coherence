# Adversarial review of Coherence (branch `distill`, 2264232)

## 1. Method

Worktree `/Users/daniloc/Documents/Dev/coherence/.claude/worktrees/agent-a2319d93c2634aa71`. It was checked out on `0094133` (`feat/human-escalation`), not the distill line, so I ran `git reset --hard distill` first; `git log --oneline -1` then read `2264232 Record the Scope merge and the parity point in the coordinator's journal` and `docs/glossary.json` was present. `npm install` added 6 packages; `typescript-language-server` and `pyright` were available.

**Read, completely:** `README.md`; `docs/glossary.json` (all 39 concepts, every `rejected` entry, every `detail` block); `docs/retired.md`, `docs/glossary.md`, `docs/spec.md`, `docs/enforcement.md`, `docs/journal.md`, `docs/economy.md`, `docs/scope-shell.md`, `docs/reference/data-is-destiny.md`; all nine spec files (`Coherence.spec.md` and `src/*/*.spec.md`, `src/readings/scope/Scope.spec.md`); every source file under `src/` except the six Scope view renderers and `src/adapters/python.ts`, which I read in part (`journal/`, `lifecycle/`, `spec/`, `scaffold/`, `enforcement/`, `adapters/adapter.ts|typescript.ts|jsonrpc.ts|index.ts`, `economy/`, `readings/scope/model.ts|derive.ts|build.ts|html.ts|journal-view.ts`, `readings/query/`); `src/enforcement/enforcement.test.ts`, `src/readings/scope/check-fixture.ts`, and the test titles of all 124 tests.

**Ran:** `node src/cli.ts glossary --check` → `0 rejected names, 0 unknown nouns (89 files)`, exit 0. `node src/cli.ts spec --check` → `9 components, 59 bullets: 52 invariants, 7 requirements; 0 problems`, exit 0. `npm test` → exit 0. Then: five throwaway fixture projects inside the worktree (a chokepoint with a hidden bypass; a spec value pointing above the root; a protected thing under a test folder; a work store; a hostile spec) driven through `run --no-server`, `spec --check`, `query`, `hook`, `scope --root`; two concurrent-writer stress runs against one journal file (40 × 200 KB and 40 × 4 MB records per process); six parallel runs of `--test` over `src/enforcement` + `src/lifecycle` without `--test-concurrency=1`; a warm-server race in one process and a two-process orphan/cascade test; malformed, empty, array and wrong-`cwd` hook stdin; and both checks against the real adopter at `/Users/daniloc/Documents/Dev/mnemion/mnemion-js` (read-only). Every fixture was deleted; `git status --short` at the end shows only ` M .coherence/runs/c1db1b63-…jsonl`, which this session's own PostToolUse hook appended to.

Roughly four hours of reading and experiment.

---

## 2. Faults

### F1 — A bypass is silently reclassified as an import, and the chokepoint grades clean
**`src/adapters/typescript.ts:161-172`** (`isImportSite`) · **critical** · **confirmed**

`isImportSite` scans back up to 40 lines for a line matching `IMPORT_START`, and if the text between that line and the site contains neither `;` nor `from "`, it calls the site an import. A bare side-effect import written without a semicolon (`import "./polyfill"`) satisfies that forever: every subsequent use of the protected thing, at any depth, is classified `import` and therefore never a bypass.

Reproduction (fixture: `SECRET` in `src/secret.ts`, chokepoint `seal`, a real bypass in `src/leak.ts`):

```
src/leak.ts:
  import { SECRET } from "./secret.ts";
  import "./polyfill.ts"          <- no semicolon

  export const leaked = SECRET

$ node ../../src/cli.ts run --no-server --session fixture2 --agent reviewer
./sealed secret
  chokepoint seal protects SECRET: reference-choked (enforced by Coherence's check at the edit and in CI) — pass (612 ms)
    SECRET is reference-choked ...; every reference in the project is inside the chokepoint
    references: 1 inside, 3 import, 0 test, 0 bypass
    refutation automatic: ... was reported as a reference at line 2
```

Adding one semicolon to line 2 — changing nothing about the bypass — flips it:

```
$ node ../../src/cli.ts run --no-server --session fixture3 --agent reviewer
  chokepoint seal protects SECRET: broken — fail (615 ms)
    1 reference to SECRET outside seal: src/leak.ts:4 in leaked
    references: 1 inside, 2 import, 0 test, 1 bypass
```

A one-character, style-level difference is the difference between "the invariant holds" and "structural defect". `export { a, b }` without a trailing semicolon has the same effect (verified directly against `isImportSite`: `true` for a site three lines below it). Semicolon-free style (`prettier --no-semi`, `standard`) is common; in such a repo the chokepoint check reports clean while bypasses accumulate. This is the exact defect class the glossary was written to catch — a green detector that cannot go red.

### F2 — The automatic refutation never checks that the synthetic site would be a bypass
**`src/adapters/typescript.ts:486-556`** (`refute`/`probe`), **`src/enforcement/check.ts:64,119`** · **critical** · **confirmed**

`refute()` opens an unsaved sibling document, asks for references, and sets `seen` if the site appears. It takes no `testFolders` and never calls `classifySite`. So it proves only that *the instrument reports a site*, not that *the detector goes red*. Where the protected thing lives under a test folder, every possible referencing site — including the synthetic one — is classified `test` at `check.ts:64`, and the check can never fail; yet the refutation is recorded as `automatic` and the bullet is promoted to invariant.

Reproduction (fixture with `FIXTURE_SECRET` in `tests/secret.ts`, chokepoint `fixtureSeal`, and a plain bypass in `tests/leak.ts`):

```
$ node ../../src/cli.ts run --no-server --session fix4 --agent reviewer
  chokepoint fixtureSeal protects FIXTURE_SECRET: reference-choked ... — pass (637 ms)
    references: 1 inside, 2 import, 1 test, 0 bypass
    refutation automatic: an unsaved document tests/coherence-refutation-2ff00e25.ts ... was reported as a reference at line 2

$ node ../../src/cli.ts spec --check .
  sealed fixture secret  invariant
      chokepoint fixtureSeal protects FIXTURE_SECRET: verified 2026-09-18 reference-choked
1 component, 1 bullet: 1 invariant, 0 requirements
lacking: enforcement 0, refutation 0, ...
```

`tests/leak.ts` is an unambiguous reference outside the chokepoint. The bullet is a full invariant, "verified", with its refutation satisfied, and no edit anywhere in `tests/` can ever make it red. The fix is one line of intent: the refutation must assert `classifySite(syntheticSite, …) === "bypass"`, not merely that the site was returned.

### F3 — `forget()` is unsynchronised; the check answers from stale file text, in both directions
**`src/adapters/typescript.ts:300-318`**, **`src/enforcement/server.ts:155-157,282-284`** · **high** · **confirmed**

`forget()` drops the local caches and then issues `textDocument/didOpen`/`didClose` **notifications** so tsserver re-reads from disk. Notifications carry no reply. The very next `textDocument/references` request can be answered from the pre-edit text, and nothing waits. Over the socket it is worse: the server's `dispatch("forget")` returns `null` the moment the synchronous call returns, so `await remote.forget(files)` awaits only the socket round trip.

This is the live cause behind the journal's `df-033337e0` (recorded as "a truncated reply from a server another file was also driving"); the real symptom is staleness, not truncation. Reproduced by dropping the `--test-concurrency=1` workaround:

```
$ for i in 1..6; do node --test "src/enforcement/*.test.ts" "src/lifecycle/*.test.ts"; done
run 1: 0 failures   run 2: 0   run 3: 0   run 4: 4 failures   run 5: 0   run 6: 0

not ok 3 - grades: broken with a bypass, reference-choked when clean and exported, ...
  error: 1 reference to SECRET_COLUMNS outside seal: src/api/render.ts:5 in module top level
    + 'broken'  - 'reference-choked'          (enforcement.test.ts:163, right after write() + adapter.forget())

not ok 8 - a run appends one record, never rewrites; ...
  error: 'pass' !== 'fail'                    (enforcement.test.ts:281)

not ok 10 - mayTouch: a run's files, or a name token in the edited file, ...
  error: the latest run touched render.ts; false !== true
```

Failure 3 is a false red (the bypass was removed and the server still reports it, with the stale symbol `module top level` instead of `render.leaked`); failure 8 is a **false green** — a chokepoint that should have been `fail` reported `pass`. In production this is revelation at the edit: `editContext` calls `performRun(..., refresh: [file])` immediately after the write-tool event, so a just-introduced bypass can be missed and a just-repaired one can alarm. `--test-concurrency=1` hides the race in CI; it does not remove it, and the hook genuinely runs concurrently with a manual `run`.

### F4 — The warm server has no exclusion: a second `serve` unlinks a live socket, and the first's shutdown unlinks the second's
**`src/enforcement/server.ts:102,121`** · **high** · **confirmed**

`serve()` does `if (existsSync(paths.socket)) rmSync(paths.socket)` before listening, without ever probing for a live listener. `stop()` then does `rmSync(paths.socket, { force: true })` unconditionally, while the *pointer* file is removed only when `pointer.pid === process.pid` — the guard is on the wrong file.

Reproduction, two separate `serve` processes for one root:

```
server A pid 35000
server B pid 35008 | two distinct warm servers: true
(A shuts down)
socket file exists after A stopped: false
server B still running: true
a new client can no longer reach the live server B:
  no warm server listening for .../fix1; start one with: serve
```

Two warm servers coexist for one project (each holding a `typescript-language-server` plus a `tsserver`, hundreds of MB); when the orphan idles out five minutes later it deletes the live one's socket, and every subsequent client spawns yet another. This is not hypothetical: at the time of review two orphaned `serve` processes for the main checkout were already running (`pgrep -fl "cli.ts serve"` → pids 30156 and 30767, each with its own `typescript-language-server`). It directly contradicts `Enforcement.spec.md`'s "warm server the only path: … one door connects over the socket".

### F5 — The peer-feed cursor advances before the feed reaches the host; peer records are silently lost
**`src/lifecycle/hook.ts:334`** with **`src/cli.ts:136`** · **high** · **confirmed**

`runHook` calls `feed.commit()` inside itself and then returns the text; `hookCommand` writes it to stdout afterwards. The commit therefore precedes the print, which is precisely what the bullet's own `because` says must not happen ("a cursor moved before the print would let a hook that failed between render and output swallow what peers recorded").

```
$ (call runHook directly, print nothing)
cursor before runHook returned: 2026-09-18T00:00:00.000Z~
cursor after  runHook returned: 2026-09-18T00:05:00.000Z~d-11111111
the caller has NOT yet written anything to stdout; stdout length: 248
cursor moved before the print: true
```

End to end, with stdout closed so the host receives nothing:

```
$ echo '{...}' | node src/cli.ts hook PostToolUse 1>&-
exit=0
cursor now: 2026-09-18T00:05:00.000Z~d-11111111
```

The peer's decision is gone: it will never be injected again.

### F6 — Scope and the agent query read the work store raw; `query order` answers with a state-change record for a closed order
**`src/readings/scope/build.ts:195-234`**, **`src/readings/query/query.ts:223-236`** · **high** · **confirmed**

`src/journal/work.ts` already folds the store into orders (`foldOrders`/`loadOrders`). Scope ignores it and re-reads `.coherence/work/*.jsonl` "tolerantly", turning **every record** into a "work order". A real store of one order plus a move plus a close becomes three orders:

```
the work store the journal wrote:  order w-aaaaaaa1 | move wm-bbbbbbb1 active | completion wc-ccccccc1 completed

Scope build.loadWork ->  w-aaaaaaa1 (state: null), wm-bbbbbbb1 (state: active), wc-ccccccc1 (state: completed)
journal loadOrders   ->  w-aaaaaaa1 (state: completed, owner: s1)
```

The real order renders with "state not recorded" (`journal-view.ts:114`). The agent query is worse, because it is an answer an agent acts on:

```
$ node src/cli.ts query order --session s1 --root .rvw/fix3
wm-bbbbbbb1  active
  kind: move
  of: w-aaaaaaa1
  because: taking it up
```

The session's order is **completed**. The agent is told it has an active order, with no objective, no success criterion and no boundary — the four things the glossary says a work order *is*.

### F7 — The start injection exceeds the host context budget exactly when escalations are present
**`src/lifecycle/hook.ts:287-293`**, **`src/lifecycle/glossary.ts:335-347`** · **medium** · **confirmed**

`startContext` subtracts the head from the budget and hands the remainder to `renderCompactWithin`, but at `glossary.ts:344` that function returns the **full** text without checking the length whenever there is no project layer — which is every project that has not declared its own glossary, Coherence itself included. The escalation block above it is unbounded by design ("never shortened"). A fixture root with eight open escalations:

```
CONTEXT_BUDGET = 9500; injected characters = 15410 -> OVER BUDGET
```

By the code's own comment (`hook.ts:67-73`) Claude Code replaces hook output over 10,000 characters with a file preview. So the one record that exists for a human — an escalation awaiting an answer — is the thing that causes the whole injection, escalations included, to be replaced by a preview. `Lifecycle.spec.md`'s "injection within budget" does not hold.

### F8 — A spec value in module form reaches outside the project root
**`src/adapters/adapter.ts:143,152`**, **`src/adapters/typescript.ts:325-341`** · **medium** · **confirmed**

`MODULE_PATH` is `/^[A-Za-z0-9_./@-]+\.[A-Za-z]+$/` and the module branch — unlike the package branch two lines below, which explicitly rejects `..` — accepts `..` freely. `resolve()` then does `join(this.root, parsed.path)`, reads the file, and opens it in the language server.

```
$ node -e 'parseName("../../../../etc/hosts.txt")'
{"form":"module","path":"../../../../etc/hosts.txt"}

Fix2.spec.md:  protects: ../outside-the-project.ts
               chokepoint: src/gate.ts

$ node ../../src/cli.ts run --no-server --session fixtrav2 --agent reviewer
  chokepoint src/gate.ts protects ../outside-the-project.ts: reference-choked ... — not run
    ../outside-the-project.ts is reference-choked ... (../outside-the-project.ts is a module; any file may import it)
    refutation missing: an unsaved document ../coherence-refutation-87247158.ts ... the check is vacuous
  files: ["../outside-the-project.ts"]
```

Agent-authored spec text — which the entry spec's own trust levels classify as `project-source`, "never trusted about itself" — makes the tool read a file above the root, send its contents to a language server, open a synthetic document at a URI above the root, and write the path into the append-only run record. The vacuity guard caught this particular case (verdict `not run`), but only because the outside file was outside the tsserver project; in a monorepo where the Coherence root is a subfolder it would resolve and pass. `existsSync`/`statSync` on the joined path is also a file-existence oracle for anything above the root.

### F9 — `hooks install` silently deletes an unrelated project's hook
**`src/lifecycle/install.ts:44`** · **medium** · **confirmed**

`MINE = /(?:coherence|cli\.ts)"?\s+hook\s+(?:SessionStart|…)\s*$/` claims any command that merely ends in `cli.ts hook <Event>`.

```
Stop entries before: 2
Stop entries after : [ 'my-own-important-hook', 'node src/cli.ts hook Stop' ]
   (the deleted entry was: "node tools/other-project/cli.ts hook Stop")
```

`Lifecycle.spec.md`'s "install keeps other hooks … keeps every other hook" is false. That bullet is also the one whose refutation is admitted missing (`<not witnessed: no staged break was attempted on the merge>`) — the unstaged break is the one that fires.

### F10 — `run --status` always exits 0, including with structural defects
**`src/enforcement/cli.ts:120-128`** · **low** · **confirmed**

`formatStatus` counts structural defects and prints `✕` lines, then `runCommand` returns `0` unconditionally for the status branch. `run` itself correctly exits 1. A CI step wired to `run --status` (the command the README lists for "the latest verdict per enforcement") never goes red.

### F11 — A refutation's date is not a date
**`src/spec/grammar.ts:392`** · **low** · **confirmed**

`(\d{4}-\d{2}-\d{2})` accepts `2026-13-45`. A hostile spec bullet carrying `refuted: broke -> saw (2026-13-45)` parses cleanly and the bullet reports as a full **invariant** (`spec --check` on the hostile fixture: `__proto__  invariant … refuted 2026-13-45: broke`). `Spec.spec.md`'s "half a form is a problem … or a bad refutation is a problem" does not cover it.

### F12 — The warm-server client has no request timeout
**`src/enforcement/server.ts:237-244`** · **medium** · **plausible**

`LineClient.request` sets a pending entry and writes; nothing ever rejects it on time. The server serialises every request from every connection through one `queue` (`server.ts:179`), so one slow language-server call blocks all others, and a wedged tsserver (whose own 60 s per-request timeout is inside the server process, not the client's) leaves the PostToolUse hook hanging until the host's own hook timeout — installed as 60 s at `install.ts:31`, so the host kills the hook rather than the hook degrading gracefully. Not reproduced; the mechanism is plain in the code.

### F13 — The vocabulary check follows paths outside the root, and both walkers descend arbitrary dot-directories
**`src/lifecycle/check.ts:108-124`**, **`src/spec/model.ts:103-120`** · **low** · **confirmed**

`collectFiles` does `resolve(options.root, given)` on each CLI path and then filters only by `EXCLUDED_FOLDERS` names, so `glossary --check ../..` or an absolute path reads `.md`/`.ts` anywhere on the machine and reports `file:line` with the matched text. Separately, neither `findSpecs` nor `walk` skips dot-directories generally — only the six named ones — so a `.venv`, a `.cache` or a vendored dot-folder is walked as project source. Confirmed incidentally: my `.rvw/` fixture folder was picked up by `spec --check` and by the Stop hook's glossary check without being named.

### F14 — `changedFiles` swallows every git failure, including an over-long output
**`src/lifecycle/hook.ts:102-111`** · **low** · **plausible**

`execFile` with the default 1 MB `maxBuffer`, wrapped in a bare `catch { return []; }`. A working tree with a very large `git diff --name-only HEAD` (thousands of paths) exceeds the buffer, the promise rejects, and the Stop hook reports "no changed files" — so the glossary check runs over nothing and regulate reports clean. Indistinguishable, from the outside, from a genuinely clean tree.

### F15 — A `via` selects tests by substring, so one oracle can serve the wrong test
**`src/enforcement/totality.ts:175-179`** · **low** · **confirmed**

`belongsTo` uses `includes(via)` against title, ancestor titles and full name, and the batched runner's combined `--test-name-pattern` matches the same way. Checking all 58 `via` values against the 124 real test titles: all 58 match at least one test, but two match two tests each (`"the language server binary is found (the adapter's precondition)"`, `"classification: inside the chokepoint, an import, a test reference, a bypass"`), and one `via` string is shared by two different bullets. A bullet's verdict can therefore be decided by a test that is not its detector.

---

## 3. Glossary conformity

### G1 — `refutation`: for the totality oracle form, a refutation is an unverified sentence
**concept: refutation** · **`src/spec/grammar.ts:386-398`, `src/spec/state.ts:51`, `src/enforcement/run.ts:171`** · **high**

The glossary: *"The witnessed firing of an enforcement: the invariant was broken and the detector went red. Required."* and, under `detail.by_option`, the totality oracle's refutation *"Must be witnessed and recorded: what was broken and what was seen."* The code accepts any string of the shape `<text> -> <text> (YYYY-MM-DD)` (and the date need not exist — F11). Nothing links it to a run, a journal record, a commit, or a test id. `run.ts:171` writes `refutation: invariant.refutations.length > 0 ? "witnessed" : "missing"` — the run record's own account of witnessing is read straight out of the spec prose it is supposed to be independent of.

Measured on Coherence's own tree: of 52 bullets in state `invariant`, **32 rest on nothing but a `refuted:` prose line**; only 20 carry an instrument-proved automatic refutation. The load-bearing distinction of the whole lifecycle — "a green test that has never been red proves nothing" — is enforced only by the honesty of whoever typed the line.

### G2 — `refutation` (automatic): the proof is vacuous in the one direction that matters
**concept: refutation, chokepoint** · **`src/adapters/typescript.ts:486-556`, `src/enforcement/check.ts:119`** · **high**

The glossary says the chokepoint's refutation is *"Provided transparently by the tool. The language server or equivalent symbol resolution proves that a second reference to the protected thing would be reported."* The code proves the site is **reported**; it never proves the site is **a bypass**. See F2: a protected thing under a test folder earns `refutation: automatic` and `verdict: pass` while the detector is structurally incapable of firing. A refutation that cannot distinguish "the instrument sees it" from "the check goes red" is the reference implementation's defect in a new spelling.

### G3 — `structural defect`: a requirement that was never an invariant is labelled one
**concept: structural defect** · **`src/spec/state.ts:61`** · **medium**

Glossary: *"An invariant whose satisfaction has been removed."* Code: `defects.length > 0 ? "structural defect" : …` — the failing verdict wins over everything, including a bullet that never had a witnessed refutation or an answered checklist. Reproduced on a fixture bullet with no `refuted:` line at all:

```
  sealed secret  structural defect
      chokepoint seal protects SECRET: structural defect 2026-09-18 broken: 1 reference to SECRET outside seal
1 component, 1 bullet: 0 invariants, 0 requirements, 1 structural defect
```

Nothing was removed; nothing was ever established. `Coherence.spec.md`'s "structural defect overrides the state" makes this deliberate, so the divergence is between the entry spec and the glossary — and the glossary is the law. The practical cost: these bullets are counted in `structuralDefects`, escalated at orient, and refuse a SubagentStop (`hook.ts:351`).

### G4 — `regulate`: the glossary's escape hatch does not exist
**concept: regulate** · **`src/lifecycle/hook.ts:351`** · **medium**

The `detail.force` block: *"subagent: gate: SubagentStop is refused until the debt is paid **or recorded as unable**; no human is watching a subagent, so the harness holds the line."* The refusal condition is `glossaryText !== "" || spec.problems > 0 || spec.defects > 0`. No `unable` record, in any session, clears any of the three. The glossary's own concept of `unable` — "this agent, in this session, could not get past a wall, and names the wall" — has no effect on the one mechanism the glossary says it is for. The only relief is `stop_hook_active`, which is the host's, not the agent's.

Separately, the debt is project-wide, not the session's: a spec problem another session left refuses this subagent's stop, though the bullet's `because` says a refusal "is spent only on what the tool can prove is owed".

### G5 — `glossary`: the anti-rot rule is broken by the glossary itself, and has already rotted
**concept: glossary (rejected: "concept addressing … an address is a claim about code that rots when the code moves")** · **`docs/glossary.json`** · **medium**

Addresses in the file, and whether they resolve on this branch:

| where | address | present |
|---|---|---|
| **vocabulary layer** (injected) of concept `glossary` | `AGENTS.md` | **missing** |
| `provenance.defined_by` of `work order` | `authority-evidence.md` | **missing** (the file is `docs/reference/work-permissions-evidence.md`) |
| top-level `source` | `concepts-raw.json` | **missing** (the file is `docs/reference/glossary-inventory.json`) |
| `detail.first_class` of `glossary` | `docs/glossary.md` | present |

The first one is injected into every session's context. `authority-evidence.md` also carries `authority`, a name the glossary rejects for `work order` — invisible to the check, because the glossary file is excluded from its own corpus (`check.ts:104`).

### G6 — `work order`: the reading does not derive the order, it shows the records
**concept: work order** · **`src/readings/scope/build.ts:195`, `src/readings/query/query.ts:223`** · **high**

The glossary defines a work order by its objective, success criterion, boundary, owner and **state**. Scope and the agent query show state-change records as orders and the order itself with no state (F6). Against `docs/reference/data-is-destiny.md`, which `docs/scope-shell.md` claims the shell follows: the fold *is* the derived value, and here it is neither computed nor stored — it is simply absent, while a second, differently-shaped copy of the work model (`WorkOrder { id, fields }`) sits beside the real one (`journal/work.ts: WorkOrder { id, objective, success, boundary, owner, state, history }`).

### G7 — The vocabulary check cannot see journal records, JSON, or any language but TypeScript
**concept: glossary, hook** · **`src/lifecycle/check.ts:61-62,517`** · **medium**

`PROSE_EXTENSIONS = {".md"}`, `CODE_EXTENSIONS = {".ts"}`. Consequences:

- The instruction the hook injects into every session says *"A rejected name in prose, a spec, **a journal record**, or an identifier is a defect"* (`hook.ts:76-82`). Journal records are `.jsonl`; the check has never read one.
- The tool ships a Python adapter and a Python grade ladder, but for a Python project the check reads no source file at all.
- Tracked `.gitignore` in this very repo contains the rejected names `taxonomy` (line 24) and `consequences` (line 22), and `glossary --check` reports `0 rejected names`.
- With a project glossary present, `codeNames = nameTable(inForce.project)` (`check.ts:517`): **Coherence's rejected names are not applied to the project's code at all.** Measured against the real adopter, 28 Coherence names remain in force for Mnemion after its own acceptances are subtracted, and they appear as identifier tokens in **131 file/name pairs** in Mnemion's TypeScript (`gate` and `oracle` in `entities/features/feature.ts` and `compose.ts`, `contract` in `clipboards/*.ts`, and so on). The check reports none of them. This is far wider than the "project sense wins" rule, which only silences names the project has actually declared.

### G8 — `enforcement` cardinality
**concept: enforcement (`detail.cardinality`: "One enforcement serves one invariant")** · **`src/adapters/Adapters.spec.md:53,60`** · **low**

The `via` string `"Python classification: inside the chokepoint, an import, a test reference, a bypass; an __all__ entry is a re-export, never a use"` is the totality oracle of two different bullets — `Python import told from use` and `whole workspace indexed`. One enforcement, two invariants; and the second is not about classification at all.

### G9 — `peer feed` injects every kind, not decisions
**concept: peer feed** · **`src/journal/feed.ts:86-96`** · **low**

Glossary: *"the hook injects the subjects of **decisions** peers have recorded"*. The code injects the subject of every record kind (and marks escalations). This is probably the better behaviour; the glossary should say so rather than the code quietly widening it.

### G10 — `reliance` is computed, but from a set that over-reports
**concept: reliance** · **`src/readings/scope/derive.ts:201-217`** · **low**

Reliance is correctly computed and never declared. But it is computed from the run entry's `files`, which is *"definitions and every reference site"* — including the protected thing's own file, the chokepoint's file, import-only sites and test files. So a component that merely imports the module is listed as relying on the invariant. `docs/scope-shell.md` admits the record lacks per-site symbols; the glossary says reliance is *"the components whose code references a chokepoint (or the protected thing behind it)"*, which is narrower than what is shown.

### G11 — `chokepoint`: the check tests something weaker than the definition, and the grade does not say so
**concept: chokepoint, chokepoint grade** · **`src/enforcement/check.ts:59-66,138-159`** · **medium**

Glossary: *"It holds while every resolved reference to the protected thing is inside the chokepoint."* What is actually tested is: every reference the language server reports, within the root, excluding `node_modules`, excluding anything the import heuristic calls an import (F1), excluding anything under a test folder, for the single position `definition.selection` (for a module: one position per exported symbol). Test references are reported in the reason line; the *import* exclusion and the single-position query are nowhere surfaced. A grade of `reference-choked` reads as a structural fact and is in truth "no bypass survived four filters". The ladder correctly names its enforcer for each rung and never assumes a rung the project must configure — that part conforms — but the rung is granted on a weaker fact than the definition states.

### G12 — Scope re-implements the model's derivations instead of importing them
**concept: scope; `docs/reference/data-is-destiny.md`** · **`src/readings/scope/derive.ts`** · **medium**

`derive.ts` re-declares `latestByEnforcement`, `entryKey`, `openEscalations`, `pointsAt`, `subjectOf` and `GLYPH` — all of which already exist, with the same intent, in `src/enforcement/record.ts` and `src/journal/record.ts`/`read.ts`. They are copies because the browser bundle cannot import Node modules, which is a real constraint; but the result is two definitions of the same derivation that can drift silently, and the `journal-view`/`query` pair has already drifted on work orders (G6). The Scope spec's "views render from state" and the shell doc's "one state, derived values computed not stored" hold for the *spec* and *run* halves and fail for the *work* half.

---

## 4. Spec findings

- **S1 — `Lifecycle / install keeps other hooks` does not hold.** Confirmed by F9. The bullet's refutation reads `<not witnessed: no staged break was attempted on the merge; the test has not been red in this repository>` — it is a requirement, honestly labelled, and it is also false as written.
- **S2 — `Lifecycle / cursor advances after the print` does not hold.** Confirmed by F5. The totality oracle `"the feed cursor advances only after the feed is printed"` tests `peerFeed`'s render-vs-`commit` split inside the library; it does not test the CLI, where `commit()` precedes `process.stdout.write`. The oracle is narrower than the sentence, and the sentence is false at the only boundary that matters.
- **S3 — `Lifecycle / injection within budget` does not hold.** Confirmed by F7 (15,410 characters against a 9,500 budget). The oracle `"renderCompactWithin steps the project layer down until the text fits; Coherence's layer never shrinks"` tests one function; the invariant sentence is about the whole start injection, which the escalation block and the no-project-layer early return both escape.
- **S4 — `Scope / deterministic build`'s named set is wrong.** `over: every byte of the page for a given pair of glossaries`, sentence: *"The same glossary in produces a byte-identical page out."* The page also embeds the spec model, every run record and every journal record. Two builds over one root with the same glossaries, separated by one appended journal line:
  `.rvw/r1.html .rvw/r2.html differ: char 83973, line 1084`.
  The build *is* deterministic for identical inputs (verified: two consecutive builds are byte-identical); the claim as written is simply about the wrong set.
- **S5 — `Lifecycle / rejected names refused`'s named set is not total over what it claims.** `over: every rejected name of both glossary layers, across every prose and code file in the corpus`. Coherence's layer is never applied to code when a project glossary exists (`check.ts:517`), and "the corpus" is `.md` and `.ts` only. Evidence in G7: 131 unreported identifier hits in the first adopter, and two rejected names in this repo's own tracked `.gitignore`.
- **S6 — `Adapters / whole workspace indexed` names an oracle that tests something else.** Its `via` is the Python *classification* test, shared with `Python import told from use`; no test exercises "waits for enumeration before answering". The bullet's refutation is honestly `<not witnessed: a staged answer before enumeration is a race the test cannot hold still>` — which means this bullet has no enforcement at all, only a borrowed test title. It is an "invariant" in the spec's grammar that nothing checks.
- **S7 — Two bullets are invariants on a refutation their totality oracle never received.** `Enforcement / automatic refutation` and `Enforcement / warm server the only path` both show `unfilled: refuted` and state `invariant`, because `deriveState` lets the chokepoint's automatic refutation satisfy the *bullet*, and both bullets also carry a totality oracle. The glossary is explicit that a totality oracle *"Requires a witnessed refutation before it counts as enforcement"*. In practice the two oracles here (`"the automatic refutation opens a synthetic reference and sees it"`, `"two clients ask the same questions; the second finds the server warm"`) have never been seen red — and F2 and F4 are faults in exactly those two mechanisms.
- **S8 — `Coherence / grammar carries no rejected name` has never fired and cannot cheaply be made to.** Its refutation: `<not witnessed: no staged break was found for a rule over three data files; the test has not been red in this repository>`. Correctly a requirement; worth saying that the project's entry spec has two bullets and one of them is undetectable.
- **S9 — `Coherence / structural defect overrides the state` contradicts the glossary's definition of `structural defect`.** See G3. The bullet is internally consistent and externally wrong.
- **S10 — The spec tree's headline number overstates its own rigour.** `9 components, 59 bullets: 52 invariants, 7 requirements`. 32 of the 52 are invariants solely because someone typed a `refuted:` line that nothing verifies (G1). The honest reading of the same tree is 20 instrument-backed invariants and 39 bullets short of one.

---

## 5. What is sound

Things I attacked and could not break:

- **Append-only, under concurrent writers.** Two processes appending 40 records each to one session file, at 200 KB and again at 4 MB per record: 80 lines, 0 unparsable, both times. `O_APPEND` holds on APFS at record sizes far beyond anything real. Journal, runs, work and traces all go through the same single-`appendFileSync` shape, and no path anywhere rewrites or truncates a record file.
- **Session tokens as file names.** `SESSION_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/` is enforced in `journal/store.ts`, `journal/work.ts`, `enforcement/record.ts`, `economy/trace.ts` and `journal/feed.ts`. `../x`, a leading dot and a path separator are all refused; I could not name a file outside the intended folder through a session id.
- **Prototype keys and hostile spec text.** A spec with `__proto__` as a bullet name, a trust level, a protected thing and a checklist shape; an empty bullet name; a value wrapping over four lines and never closing; nested angle brackets; three arrows in one crossing; a 260-character `because`; duplicate kinds. The parser reported five located problems, parsed the rest, and never threw. Maps and Sets throughout mean no prototype pollution.
- **Malformed harness input.** `not json at all`, empty stdin, a bare JSON array, a `cwd` that does not exist, and an unknown event: the hook degrades to an empty event or a located reason (`Spec: not readable (/nonexistent/place: not a folder)`), never crashes, and the unknown verb exits 64 as documented. Exit 2 is used for a subagent refusal and nowhere else; `stop_hook_active` caps the loop at one extra turn.
- **The injection carries vocabulary only.** I read `renderCompact` and diffed its output against the glossary file: no key or value from `detail`, `provenance` or `metaphors` appears, at any detail level. Provenance is never injected; that claim holds.
- **Determinism for identical inputs.** Two consecutive `npm run scope` builds are byte-identical (`cmp` clean); two consecutive `economy --json` runs are byte-identical. Entries sort by path and `why` lines sort within an entry, as documented.
- **No markup injection into the page.** `embedJson` escapes `<` so no glossary or journal text can close the state `<script>`; `html.ts` escapes every interpolated value unless it came from `html` or `raw`. I could not get spec or journal text into the page as markup.
- **A vacuous refutation never becomes a pass.** `checkChokepoint` returns `verdict: "not run"` whenever the synthetic site is unseen, and the reason says the check is vacuous. Confirmed on the out-of-root fixture. Likewise `not configured never passes`: a missing `test` command reports `not run`, and `testMatch` catches a runner that exits 0 with no test selected.
- **Namespace-import and re-export bypasses are caught.** `import * as store from "./secret.ts"; store.SECRET` is correctly graded `broken` with the bypass at `src/leak.ts:3 in leaked`. The import heuristic's hole (F1) is specific to import statements with no terminating `;` and no `from`.
- **`--over none` versus an omitted `--over`.** Kept as two different facts on disk (`"none"` versus `[]`) and rendered as `none` versus `(unexamined)`. This matches the journal doc and the glossary exactly.
- **Grade ladder honesty.** Each rung carries its enforcer as data (`TYPESCRIPT_LADDER`, `PYTHON_LADDER`), the Python checker rung is granted only from the project's own Pyright/import-linter configuration, and `whenVacuous` drops a chokepoint to `convention` where the instrument proved nothing. No rung is assumed.
- **Run as primary record, status as a view.** `latestByEnforcement` recomputes from every run on every read; nothing stores a merged status; a skipped enforcement keeps its prior dated verdict and the line says so. Damaged run lines are reported with file and line and counted, never dropped — same for the journal and the traces.
- **Socket permissions on the supported platform.** The fallback socket path is predictable (`/tmp/coherence-<sha1(root)[:12]>.sock`), but on macOS it lands in the per-user `/var/folders/.../T/` and is created `srwxr-xr-x`, so the obvious hijack is not available on the only platform the glossary supports. F4 is a liveness fault, not a trust one.
- **`via` values name real tests.** All 58 `via` strings in the nine specs match at least one of the 124 real test titles. The collisions in F15 are the only defect there.
- **`--no-server` and instrument absence.** With no adapter, the run records `not run` with a reason per enforcement and the economy says `hops skipped`; nothing pretends to a verdict it did not get.

---

## 6. Summary

```json
[
  {"id":"F1","kind":"fault","severity":"critical","status":"confirmed","file":"src/adapters/typescript.ts","line":161,"summary":"isImportSite calls any site below a semicolon-less bare import an import, so a real bypass is not counted and the chokepoint grades reference-choked/pass; one semicolon flips it to broken"},
  {"id":"F2","kind":"fault","severity":"critical","status":"confirmed","file":"src/adapters/typescript.ts","line":486,"summary":"the automatic refutation proves the instrument reports the synthetic site, never that classifySite would call it a bypass; a protected thing under a test folder becomes a permanently undetectable invariant"},
  {"id":"F3","kind":"fault","severity":"high","status":"confirmed","file":"src/adapters/typescript.ts","line":300,"summary":"forget() re-reads files with unacknowledged notifications, so the next references query can answer from stale text; reproduced as a false pass (expected fail, got pass) under parallel test files"},
  {"id":"F4","kind":"fault","severity":"high","status":"confirmed","file":"src/enforcement/server.ts","line":102,"summary":"serve() unlinks an existing socket without probing for a live listener and stop() unlinks the socket unconditionally, so two warm servers coexist and the orphan's shutdown makes the live one unreachable"},
  {"id":"F5","kind":"fault","severity":"high","status":"confirmed","file":"src/lifecycle/hook.ts","line":334,"summary":"feed.commit() runs inside runHook before the CLI writes stdout; with stdout closed the hook exits 0, prints nothing and the cursor has advanced, losing the peer records"},
  {"id":"F6","kind":"fault","severity":"high","status":"confirmed","file":"src/readings/scope/build.ts","line":195,"summary":"Scope and the agent query read .coherence/work raw instead of folding it, so every record becomes a work order; query order answers with a move record marked active for an order that is completed"},
  {"id":"F7","kind":"fault","severity":"medium","status":"confirmed","file":"src/lifecycle/glossary.ts","line":344,"summary":"renderCompactWithin returns the full text unchecked when there is no project layer, and the escalation block is unbounded: a start injection of 15,410 characters against a 9,500 budget"},
  {"id":"F8","kind":"fault","severity":"medium","status":"confirmed","file":"src/adapters/adapter.ts","line":152,"summary":"the module form of parseName accepts .., so an agent-authored spec value makes the tool read a file above the project root, open it in the language server, and record its path in the run"},
  {"id":"F9","kind":"fault","severity":"medium","status":"confirmed","file":"src/lifecycle/install.ts","line":44,"summary":"the MINE regex claims any command ending in 'cli.ts hook <Event>', so hooks install silently deletes an unrelated project's hook entry"},
  {"id":"F10","kind":"fault","severity":"low","status":"confirmed","file":"src/enforcement/cli.ts","line":128,"summary":"run --status returns 0 even when it prints structural defects, so a CI step wired to it never goes red"},
  {"id":"F11","kind":"fault","severity":"low","status":"confirmed","file":"src/spec/grammar.ts","line":392,"summary":"a refuted: line's date is matched as three digit groups, so 2026-13-45 parses and the bullet reports as a full invariant"},
  {"id":"F12","kind":"fault","severity":"medium","status":"plausible","file":"src/enforcement/server.ts","line":237,"summary":"LineClient.request has no timeout and the server serialises every connection through one queue, so a wedged language server hangs the PostToolUse hook until the host kills it"},
  {"id":"F13","kind":"fault","severity":"low","status":"confirmed","file":"src/lifecycle/check.ts","line":108,"summary":"collectFiles resolves CLI paths without confining them to the root, and neither walker skips dot-directories generally, so the check reads files outside the project and inside vendored dot-folders"},
  {"id":"F14","kind":"fault","severity":"low","status":"plausible","file":"src/lifecycle/hook.ts","line":102,"summary":"changedFiles catches every git failure including a maxBuffer overflow and returns [], so regulate reports a clean tree when the diff is merely too large to read"},
  {"id":"F15","kind":"fault","severity":"low","status":"confirmed","file":"src/enforcement/totality.ts","line":175,"summary":"belongsTo maps report entries to a via by substring, so a bullet's verdict can be decided by a test that is not its detector; two vias match two tests each and one via serves two bullets"},
  {"id":"G1","kind":"conformity","severity":"high","status":"confirmed","file":"src/spec/state.ts","line":51,"summary":"refutation: the glossary requires a witnessed firing, but for the totality oracle form any parseable sentence satisfies it; 32 of Coherence's 52 invariants rest on nothing else"},
  {"id":"G2","kind":"conformity","severity":"high","status":"confirmed","file":"src/enforcement/check.ts","line":119,"summary":"refutation (automatic): the glossary says symbol resolution proves a second reference would be reported; the code proves only that a site is returned, not that the detector would go red"},
  {"id":"G3","kind":"conformity","severity":"medium","status":"confirmed","file":"src/spec/state.ts","line":61,"summary":"structural defect is defined as an invariant whose satisfaction has been removed, but a failing run labels a bullet that was never an invariant a structural defect"},
  {"id":"G4","kind":"conformity","severity":"medium","status":"confirmed","file":"src/lifecycle/hook.ts","line":351,"summary":"regulate: the glossary's subagent gate holds 'until the debt is paid or recorded as unable'; no unable record clears any refusal, and the debt refused is project-wide rather than the session's"},
  {"id":"G5","kind":"conformity","severity":"medium","status":"confirmed","file":"docs/glossary.json","line":1,"summary":"anti-rot: the injected vocabulary layer names AGENTS.md, provenance names authority-evidence.md and source names concepts-raw.json; none of the three exists on this branch"},
  {"id":"G6","kind":"conformity","severity":"high","status":"confirmed","file":"src/readings/scope/build.ts","line":195,"summary":"work order: the glossary defines it by objective, success, boundary, owner and state; Scope and the query show state-change records as orders and the order itself with no state"},
  {"id":"G7","kind":"conformity","severity":"medium","status":"confirmed","file":"src/lifecycle/check.ts","line":517,"summary":"the vocabulary check reads only .md and .ts, never a journal record or any other language, and applies none of Coherence's rejected names to a project's code: 131 unreported identifier hits in the first adopter, two in this repo's own .gitignore"},
  {"id":"G8","kind":"conformity","severity":"low","status":"confirmed","file":"src/adapters/Adapters.spec.md","line":60,"summary":"enforcement cardinality says one enforcement serves one invariant, but one via string is the totality oracle of two different bullets"},
  {"id":"G9","kind":"conformity","severity":"low","status":"confirmed","file":"src/journal/feed.ts","line":87,"summary":"peer feed: the glossary says the subjects of decisions; the code injects the subject of every record kind"},
  {"id":"G10","kind":"conformity","severity":"low","status":"confirmed","file":"src/readings/scope/derive.ts","line":206,"summary":"reliance is computed from the run entry's whole file list, so import-only files, test files and the chokepoint's own file are shown as relying components"},
  {"id":"G11","kind":"conformity","severity":"medium","status":"confirmed","file":"src/enforcement/check.ts","line":59,"summary":"chokepoint: 'every reference passes through' is tested as 'every reference the server reports, minus imports by heuristic, minus test paths, from one query position', and the grade does not say so"},
  {"id":"G12","kind":"conformity","severity":"medium","status":"confirmed","file":"src/readings/scope/derive.ts","line":1,"summary":"Scope re-declares six derivations that already exist in src/journal and src/enforcement, and carries a second shape for the work model; the work half has already drifted"},
  {"id":"S1","kind":"spec","severity":"medium","status":"confirmed","file":"src/lifecycle/Lifecycle.spec.md","line":75,"summary":"'install keeps other hooks' is false: a foreign hook matching the MINE regex is deleted; the bullet admits no staged break was attempted"},
  {"id":"S2","kind":"spec","severity":"high","status":"confirmed","file":"src/lifecycle/Lifecycle.spec.md","line":99,"summary":"'cursor advances after the print' is false at the CLI boundary; the oracle tests the library's render/commit split and never the print"},
  {"id":"S3","kind":"spec","severity":"medium","status":"confirmed","file":"src/lifecycle/Lifecycle.spec.md","line":18,"summary":"'injection within budget' is false with escalations present (15,410 of 9,500 characters); the oracle tests renderCompactWithin alone"},
  {"id":"S4","kind":"spec","severity":"medium","status":"confirmed","file":"src/readings/scope/Scope.spec.md","line":6,"summary":"'deterministic build … over every byte of the page for a given pair of glossaries' is falsified by appending one journal line; the page embeds runs, journal and the spec model too"},
  {"id":"S5","kind":"spec","severity":"medium","status":"confirmed","file":"src/lifecycle/Lifecycle.spec.md","line":31,"summary":"'rejected names refused … across every prose and code file in the corpus' is not total: the corpus is .md and .ts, and Coherence's layer is never applied to a project's code"},
  {"id":"S6","kind":"spec","severity":"medium","status":"confirmed","file":"src/adapters/Adapters.spec.md","line":58,"summary":"'whole workspace indexed' borrows the Python classification test as its oracle; nothing tests waiting for enumeration, so the bullet has no enforcement at all"},
  {"id":"S7","kind":"spec","severity":"medium","status":"confirmed","file":"src/enforcement/Enforcement.spec.md","line":48,"summary":"'automatic refutation' and 'warm server the only path' are invariants with refuted: unfilled; their totality oracles have never been witnessed, and both mechanisms carry faults F2 and F4"},
  {"id":"S8","kind":"spec","severity":"low","status":"confirmed","file":"Coherence.spec.md","line":13,"summary":"'grammar carries no rejected name' has never been red and the bullet says no staged break could be found: an entry-spec bullet nothing has been seen to detect"},
  {"id":"S9","kind":"spec","severity":"medium","status":"confirmed","file":"Coherence.spec.md","line":20,"summary":"'structural defect overrides the state' makes a requirement a structural defect, contradicting the glossary's definition of the term"},
  {"id":"S10","kind":"spec","severity":"high","status":"confirmed","file":"src/spec/state.ts","line":51,"summary":"the headline '52 invariants of 59 bullets' overstates the tree: 32 of the 52 rest only on an unverified refuted: line, leaving 20 instrument-backed invariants"}
]
```
