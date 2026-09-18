# Adversarial review — Coherence, `distill` @ 2264232

## 1. Method

Worktree `/Users/daniloc/Documents/Dev/coherence/.claude/worktrees/agent-a858f61e73b3d0d7f`. On arrival `git log --oneline -1` was `0094133 Merge branch 'feat/human-escalation'` and `docs/glossary.json` was absent, so `git reset --hard distill` → `2264232`. `npm install` (6 packages, 0 vulnerabilities).

**Read, completely:** `README.md`; `docs/glossary.json` (39 concepts, every definition, `detail`, `provenance`, `rejected`, `metaphors`, `shape`); `docs/retired.md`; `docs/glossary.md`; `docs/spec.md`; `docs/enforcement.md`; `docs/journal.md`; `docs/economy.md`; `docs/scope-shell.md`; `docs/reference/data-is-destiny.md`; `Coherence.spec.md` and all eight component specs; every source file under `src/` (34 files, ~7.5k lines) plus `package.json`, `coherence.config.json`, `.gitignore`, `.claude/settings.json`. Skimmed the test files for fixture shape; read `src/enforcement/enforcement.test.ts` closely. Read `/Users/daniloc/Documents/Dev/mnemion/mnemion-js` as a real adopter (spec tree, config, runs).

**Ran:** `node src/cli.ts glossary --check` (**0 rejected names, 0 unknown nouns, 89 files, exit 0**); `spec --check` (9 components, 59 bullets, 52 invariants, 7 requirements, 0 problems, exit 0); `spec --check` over mnemion-js; `run` (80 enforcements, 79 pass, 0 fail, 1 not run); `run --status`; `npm test`; `npm run scope` twice; `query order`; `work create/move/close`; the hook on all six events with hostile stdin.

**Wrote and ran probes** (all under a scratch dir since deleted; `git status --short` is now empty apart from `.coherence/runs/...jsonl`, which the live PostToolUse hook appended):
- an adapter staleness probe (write → `forget()` → `checkChokepoint`, alternating bypass/clean, N iterations, 1–16 concurrent processes);
- a warm-server probe (concurrent spawn race; SIGKILL mid-request; idle shutdown while held);
- an idle-vs-totality-pass probe (`serve --idle 3s` + a 6 s test command + `performRun`);
- a concurrent append-only writer probe (2 writers × 40 records at 500 B / 200 KB / 2 MB);
- parser probes (`parseName` traversal, `isPlaceholder` false positives, `refuted:` regex scaling);
- a refutation-vacuity probe (non-exported symbol, module chokepoint);
- `verdictsFromReport` / `isTestPath` weakness probes.

Elapsed: roughly 2.5 hours of wall clock.

---

## 2. Faults, ranked

### F1 — The chokepoint check reads stale file contents; a bypass added at the edit can be missed
**critical · confirmed · `src/adapters/typescript.ts:300-318` (`forget`)**

`forget()` builds `refresh = touched ∪ files ∪ opened` and then, per file:

```ts
if (!this.opened.has(file)) this.open(file);   // fresh disk text, only if NOT already open
this.closeDocument(file);                       // didClose, then trust tsserver to re-read
```

A file that is already open — which every file holding a reference site is, because `enclosingSymbol` → `documentSymbols` → `open()` — is **only closed**. Its new content is never sent. The adapter then relies on tsserver reloading a closed document from disk promptly; that is watcher-driven and asynchronous, so under load the next `textDocument/references` answers from the pre-edit text.

Reproduction A (isolated, 16 concurrent probe processes, 20 alternating write→`forget()`→`checkChokepoint` cycles each):

```
grep -h WRONG dist/scratch/m*.txt | sed 's/^[0-9]* //' | sort | uniq -c
 160 disk=clean  check=BYPASS grade=broken verdict=fail   <-- WRONG
```

160 of 320 checks wrong. Single-process, unloaded: 0/20 wrong — which is why the bug is invisible in normal development.

Reproduction B (the project's own suite, with the concurrency guard removed):

```
node --disable-warning=ExperimentalWarning --test "src/**/*.test.ts"
# pass 119 / # fail 4   (2 of 3 attempts; 1 clean)
not ok 25 - grades: ...   actual 'broken', expected 'reference-choked'
not ok 30 - a run appends one record ...  'pass' !== 'fail'   (enforcement.test.ts:281)
not ok 32 - mayTouch: a run's files ...   false !== true
not ok 33 - PostToolUse ...               Unexpected end of JSON input
```

Failure 30 is the dangerous direction: the run recorded **`verdict: "pass"` for `digest-only egress` while the bypass was on disk**. That is the tool silently missing the exact thing it exists to reveal, in the exact code path the edit hook uses (`editContext` → `performRun({refresh:[file]})` → `forget([file])`).

`package.json` pins `--test-concurrency=1`, which hides it. The journal records this as `df-033337e0` and diagnoses it as cross-file server contention ("a truncated reply from a server another file was also driving"). That is at most one of four symptoms; three are stale reads inside a single in-process adapter over its own private mkdtemp fixture, so the diagnosis is wrong and the defect is in production code, not in the test harness.

Fix direction: keep the document open and send `didChange` with the fresh text (as `forget()` already does for `this.seed`), instead of closing and hoping.

---

### F2 — A totality pass longer than the idle window silently disables every chokepoint check, and `run` still exits 0
**high · confirmed · `src/enforcement/run.ts:100-105`, `src/enforcement/server.ts:30,82,131-135`, `src/enforcement/cli.ts:148`**

`performRun` runs `runTotalityBatch` (the whole test suite, `TOTALITY_TIMEOUT_MS = 10 min`) **before** it asks the adapter anything. The warm server's idle timer is reset only when a request line arrives (`touch()` inside the `line` handler). `DEFAULT_IDLE_MS = 5 min`. So any project whose tests take longer than five minutes loses its warm server mid-run.

Reproduced with `serve --idle 3000` and a 6-second test command:

```
serve: typescript adapter ready
serve: stopping
chokepoint       digest-only egress  verdict=not run grade=-  instrument failed: the warm server closed the connection
totality oracle  slow totality       verdict=pass    grade=-  1 test under "slow totality" passed ...
instrumentReason: undefined
```

Three compounding problems:
1. `instrumentReason` is `undefined`, so `editContext` and the run's summary do not report the instrument as unavailable.
2. `runCommand` returns 1 only when some verdict is `"fail"`; a run in which **zero chokepoints were checked** exits **0**. CI goes green with no structural enforcement at all.
3. The `not run` entries carry `refutation: "missing"` and overwrite the previous `automatic` entries in `latestByEnforcement`, so `deriveState` (`src/spec/state.ts:49-51`) demotes previously-verified invariants to requirements on the next `spec --check`. The "skipped keeps its prior verdict" rule does not save them: the entry is present, just useless.

---

### F3 — `query order` can never return a work order, and reports completed orders as active
**high · confirmed · `src/readings/scope/build.ts:182-231` (`workOrderOf`, `loadWork`), `src/readings/query/query.ts:223-233`**

`loadWork` treats **every line** of `.coherence/work/*.jsonl` as a work order (`workOrderOf` accepts any JSON object). `answerOrder` then filters `o.fields["state"] === "active"`. A `WorkOrderRecord` (`src/journal/record.ts:261`) has **no `state` field** — state is the fold of its `move`/`completion` records — so only `move` records can ever match.

Reproduction (scratch project, order created → moved active → closed):

```
$ node ../../../src/cli.ts work create "do the thing" --success "it is done" --boundary "src/" --session s1 --agent probe
w-1e7a9b98  work order recorded ...; owner s1; state open
$ ... work move w-1e7a9b98 active ...     → wm-2566dddf
$ ... work close w-1e7a9b98 ...           → wc-84a5b897  active -> completed
$ node ../../../src/cli.ts query order --session s1
wm-2566dddf  active
  kind: move
  of: w-1e7a9b98
  because: taking it up
```

The answer to the glossary's own question "what does my work order say" is a move record; the objective, success criterion and boundary never appear; and a **completed** order is reported as active. The `--session` filter also matches `fields["session"]` (whoever wrote the move) rather than the owner. The hook's `workBlock` (`src/lifecycle/hook.ts:138`) uses the correct `loadOrders` fold — the model exists twice and the two copies disagree, which is precisely the failure `data-is-destiny` warns about.

The same `loadWork` feeds the Scope Journal view's work cards.

---

### F4 — A chokepoint written entirely in prose passes `spec --check` as a full invariant, and the CI gate never runs the chokepoint check
**high · confirmed · `src/spec/grammar.ts` (no name validation), `src/spec/state.ts:46-62`, `package.json` `test` script**

```markdown
- prose chokepoint: A secret leaves storage only as its digest.
  protects: every secret column the store holds
  chokepoint: the one sealing site in the renderer
  because: a read of a leaked row must disclose no usable bearer
  kinds: none
  refuted: removed the seal call -> the check went red (2026-01-01)
```

```
$ node src/cli.ts spec --check dist/scratch/proj
  prose chokepoint  invariant
      chokepoint the one sealing site in the renderer protects every secret column the store holds: declared, unverified
1 component, 1 bullet: 1 invariant, 0 requirements
lacking: ... 0 problems; no run yet
EXIT=0
```

`npm test` = `typecheck && test:unit && glossary:check && spec:check`. It never invokes `run`. So the green gate cannot see a prose chokepoint — and this is the exact defect class `docs/glossary.md` says the rebuild exists to catch ("Fourteen of Mnemion's sixteen chokepoint claims turned out to have prose where the protected thing belongs and had stood green for months"). `Adapters.spec.md`'s `name forms` bullet says prose "must be refused … **before any instrument is asked**, so a claim about nothing cannot pass"; `parseName` does refuse it, but only inside `run`, and only as `not run` — never as a problem, never as a lack, never as a structural defect. `deriveState` never downgrades on `not run`, so with a self-asserted `refuted:` line the bullet stays an invariant forever.

mnemion-js shows the live shape of this: three Routing bullets carry prose chokepoints and only `run` reveals them.

---

### F5 — Quadratic blowup in the `refuted:` parser: a spec file stalls every hook event
**high · confirmed · `src/spec/grammar.ts:392`**

```ts
const match = /^(.*?)\s*(?:->|→)\s*(.*?)\s*\((\d{4}-\d{2}-\d{2})\)\s*$/s.exec(field.value);
```

Two lazy `.*?` groups with no anchor between them; every `->` in the value forces a full rescan to the end when no date follows. Continuation lines are joined into one value, so the payload needs no long line.

```
2000 arrows (10 KB):     66 ms
4000 arrows (20 KB):    247 ms
8000 arrows (39 KB):   1012 ms
16000 arrows (78 KB):  4010 ms
32000 arrows (156 KB): 16411 ms
```

`loadSpecModel` runs on `SessionStart`, `SubagentStart`, `PostToolUse`, `Stop` and `SubagentStop`; the installed hook timeout is 60 s (`.claude/settings.json`). ~400 KB of `refuted:` text in one spec file takes every hook past its timeout, and `npm test` with it. Spec text is `project-source`, which the entry spec declares is "never trusted about itself".

---

### F6 — The warm server's socket is unauthenticated and its location comes from an in-repo pointer file
**high · confirmed (mechanism), plausible (exploitation) · `src/enforcement/server.ts:41-47, 166-196, 310-319, 334-362`**

```ts
const socket = Buffer.byteLength(local) <= SOCKET_PATH_LIMIT
  ? local
  : join(tmpdir(), `coherence-${createHash("sha1").update(root).digest("hex").slice(0, 12)}.sock`);
```

Observed on this machine (the in-repo path exceeded 100 bytes, which is ordinary for real project paths):

```
srwxr-xr-x  1 daniloc  staff  0  /var/folders/.../T/coherence-e4a1bab6a372.sock
.coherence/run/server.json:
{"pid":30767,"socket":"/var/folders/.../T/coherence-e4a1bab6a372.sock", ...}
```

Three issues:
1. The socket is mode 0755 with no authentication. `dispatch` (`:137-164`) exposes `resolve`, `references`, `visibility`, `refute`, `forget` and an unauthenticated **`stop`** to anyone who can connect. On macOS `os.tmpdir()` is per-user; on Linux it is `/tmp`, world-writable, and the name is a deterministic sha1 of the project root — so a local attacker can pre-bind it and become the instrument.
2. `socketFor` connects to whatever path `.coherence/run/server.json` names, with no validation. Anything that can write the repo redirects the instrument.
3. A hostile instrument's replies are fully trusted: it can answer `references: []`, `visibility: {enforced:true, visible:false}` and `refute: {seen:true}`, making every chokepoint grade `visibility-choked`, `verdict: pass`, `refutation: automatic`. `Coherence.spec.md`'s `instrument` trust level says "a reply the instrument cannot confirm is a vacuous check, never a pass" — but there is no confirmation that the far side is the language server.

Secondary: `refute`/`references` take a caller-supplied `Definition.file` and `readFileSync(join(this.root, file))` it, so a socket peer gets arbitrary local file reads into the language server.

---

### F7 — The automatic refutation reports a synthetic reference *inside* the chokepoint as "outside the chokepoint"
**medium · confirmed · `src/adapters/typescript.ts:510-534` (`refuteInside`), `src/adapters/adapter.ts:158-164`**

```ts
const outside = outsideOf === undefined
  || outsideOf.file !== protectedThing.file
  || !rangeContains(outsideOf.range, { line, character: added.indexOf(importName) });
```

When the chokepoint is the protected thing's own **module**, `outsideOf.range` ends at `{line: lines.length-1, character: 0}` — the trailing empty element of `split("\n")`. `refuteInside` appends at exactly that line with `character = added.indexOf(importName) > 0`, so `rangeContains` is false and `outside` is wrongly true.

```
$ node dist/scratch/refute.ts     # HIDDEN not exported, chokepoint = src/store.ts
grade: visibility-choked | verdict: pass | refutation: automatic
account: an unsaved edit of src/store.ts adding a use of HIDDEN at line 6 outside the chokepoint was reported as a reference
```

Line 6 of `src/store.ts` is inside `src/store.ts`. The guard that exists to refuse a vacuous refutation is dead in this configuration, and the account printed to the human is false. The honest answer for a not-exported symbol whose chokepoint is its whole module is "no out-of-chokepoint site can exist; the compiler is the enforcer" — not a manufactured "outside".

---

### F8 — A filled spec value that merely looks like a placeholder is silently treated as absent, with no problem reported
**medium · confirmed · `src/spec/grammar.ts:118-122, 337-349, 352-371`**

`PLACEHOLDER = /<[a-z][^<>]*>/` matches ordinary prose that mentions a generic:

```
"Map<string, Latest>"                                        -> isPlaceholder true
"the latest verdict is a Map<string, Latest> keyed by ..."    -> isPlaceholder true
```

Consequences, reproduced:
- `because: ... Map<string, Latest> ...` → the bullet reports `lacks because`.
- `via: the cache keeps one Map<string, entry> per project` with `over:` present → `problems: []`, `enforcements: []`, `unfilled: ["via"]`. The **enforcement silently disappears** and `pair()` reports nothing, because both keys are present.

`Spec.spec.md`'s `half a form is a problem` does not cover this: the form is whole, one half is simply voided.

---

### F9 — `parseName` accepts `..` in a module path; spec text makes the adapter read any file
**medium · confirmed · `src/adapters/adapter.ts:143-155`; consumed at `src/adapters/typescript.ts:326-331`**

`MODULE_PATH = /^[A-Za-z0-9_./@-]+\.[A-Za-z]+$/` has no containment check; only `PACKAGE_PATH` rejects `..`.

```
"../../../../etc/hosts.txt"           -> {"form":"module","path":"../../../../etc/hosts.txt"}
"../secrets/../../../etc/passwd.conf" -> {"form":"module","path":"../secrets/../../../etc/passwd.conf"}
```

`TypeScriptAdapter.resolve` then does `join(this.root, parsed.path)`, `existsSync`, `readFileSync` and `didOpen`s the contents into tsserver. `references()` filters results starting with `..`, but the definition itself already escaped. Spec text is `project-source`.

---

### F10 — `scaffold component` writes outside the project root
**medium · confirmed · `src/scaffold/scaffold.ts:56-68`**

```
$ node src/cli.ts scaffold component /tmp/coherence-escape-test "an intent"
wrote /tmp/coherence-escape-test/Coherence-escape-test.spec.md
$ node src/cli.ts scaffold component dist/scratch/../scratch-escape "an intent"
wrote .../dist/scratch-escape/Scratch-escape.spec.md
```

`resolve(root, folder)` with an unvalidated CLI argument, then `mkdirSync(..., {recursive:true})` + `writeFileSync`. `Scaffold.spec.md`'s `no overwrite` guards only an existing spec, not containment. (Both artefacts removed.)

---

### F11 — The Stop snapshot never has an instrument, so calibrate always compares against a hop-less prediction
**medium · confirmed · `src/lifecycle/hook.ts:341`**

```ts
await snapshotTrace(root, input.session_id, { adapter: options.adapter, changed: changedNow });
```

`options.adapter` is only ever set by tests (`HookOptions` has no other producer), so the production Stop path calls `predictClosure` with no adapter and both hops are skipped. Confirmed in a real snapshot on this machine:

```json
{"kind":"snapshot", ..., "predicted":[".coherence/journal/…jsonl","Coherence.spec.md"],
 "instrument":{"language":"typescript","server":"none","reason":"no adapter"}}
```

`Economy.spec.md`'s `economy is deterministic` defines the closure as "one hop out, one hop in, the spec of each component, and the invariants…"; the only closure calibrate ever sees has neither hop. The calibration loop the Economy component exists to close cannot close. (`economy <path>` from the CLI does use the warm server; only the automatic snapshot does not.)

Related: the snapshot counts the hook's own `.coherence/journal/<session>.jsonl` as part of the session's patch.

---

### F12 — Concurrent clients spawn duplicate warm servers; client and server disagree about the socket path
**medium · confirmed · `src/enforcement/server.ts:334-362`, `:101-102`, `:41-47`**

`connectAdapter` has no lock: on a failed connect it `rmSync`es the socket and the pointer, then spawns. `serve` in turn `rmSync`es any existing socket before listening. Four simultaneous clients:

```
fulfilled server=cold pid=35542   (all four)
serve processes now: 2
pointer: {"pid":35542,"socket":"/var/folders/.../T/coherence-5f8380dce5b5.sock", ...}
```

Two servers for one root; the loser is orphaned holding a language server until its idle timeout. Note the pointer names a **tmpdir** socket while the client computed `<root>/.coherence/run/adapter.sock`: the child's `process.cwd()` is the macOS realpath (`/private/var/...`, 8 bytes longer) and crosses `SOCKET_PATH_LIMIT`. So `connectAdapter`'s `rmSync(paths.socket)` cleans a path nobody uses, and if the pointer file is ever lost the client can never find a running server — it spawns a fresh cold one on every hook, which defeats the warm server entirely. Two such orphans were already alive on this machine at the start of the review.

---

### F13 — The hook takes its project root from harness stdin with no containment
**medium · confirmed · `src/lifecycle/hook.ts:316`**

```
$ printf '{"session_id":"abc","cwd":"/etc"}' | node src/cli.ts hook SessionStart
{"hookSpecificOutput":{...,"additionalContext":"Spec: not readable (EACCES: permission denied, scandir '/etc/cups/certs')\n\nCoherence vocabulary ..."}}
```

`root = input.cwd ?? fallbackRoot`. Every record the hook writes — runs, read traces, feed cursors — lands under that root. `Coherence.spec.md` declares `harness` as "The caller Coherence answers, **never a writer of the record**"; here the harness chooses where the record is written. (Session ids *are* contained: `../../../../tmp/pwned` writes nothing, because `SESSION_TOKEN` refuses it.)

---

### F14 — Totality-oracle results are mapped back by substring
**medium · confirmed · `src/enforcement/totality.ts:175-179`**

```ts
function belongsTo(result, via) {
  if (result.title?.includes(via)) return true;
  ...
}
```

```
via "writes are atomic" over a report containing only "writes are atomic under load"
  -> {"verdict":"pass","reason":"1 test under \"writes are atomic\" passed ..."}
```

A `via` that is a prefix or substring of another test's title is satisfied by that other test. Coherence's own latest run already binds two oracles to two tests each (`sites classified`, `server located or a reason`). Totality — "a detector that checks the invariant holds over the whole named set" — depends on the detector's identity, and the identity is fuzzy.

---

### F15 — Any file named `*.test.*` / `*.spec.*` is exempt from being a bypass
**medium · confirmed · `src/adapters/adapter.ts:167-172`, `src/enforcement/check.ts:64`**

```
src/api/render.ts          isTestPath=false
src/api/render.test.ts     isTestPath=true
src/api/render.spec.ts     isTestPath=true
src/api/test/render.ts     isTestPath=true
```

Renaming a bypassing file is enough to turn a structural defect into a reported "test reference" and restore a clean grade. The exemption is documented and defensible, but nothing bounds it: the classification is by filename alone, and Coherence's own strongest claims lean heavily on it (`automatic refutation` 16 test references, `requirement until complete` 17, `Python rungs verified` 7).

---

### F16 — The vocabulary check crashes on an unreadable directory and follows paths outside the root
**low · confirmed · `src/lifecycle/check.ts:87-99` (`walk`, no try/catch), `:108-118`**

```
$ node src/cli.ts glossary --check /etc
EACCES: permission denied, scandir '/etc/cups/certs'     (exit 70)
$ node src/cli.ts glossary --check ../../../
318 rejected names, 8 unknown nouns (93 files)
```

`collectFiles` resolves each given path against the root without containment, and the exclusion filter (`dirname(relative(root,p)).split(sep)`) is meaningless for a path outside the root. An unreadable subdirectory anywhere under a project aborts the whole check rather than being skipped and reported.

---

### F17 — The peer-feed cursor is committed before the feed reaches the host
**low · confirmed · `src/lifecycle/hook.ts:331-335` vs `src/cli.ts:135`**

`runHook` calls `feed.commit()` after building the JSON but before `process.stdout.write`. `Lifecycle.spec.md`'s `cursor advances after the print` says the advance "follows the effect it records" and that "a hook that failed between render and output" must not swallow peers' records; a write failure between the two loses the feed.

---

### F18 — Two paths construct a language adapter outside the warm-server door
**low · plausible · `src/enforcement/cli.ts:13,143`, `src/readings/scope/build.ts:26,122`**

`run --no-server` builds an in-process adapter; `ladderFor` constructs one to read its static `.ladder`. Neither goes through `withWarmAdapter`. The chokepoint claim protects `connectAdapter`, not `adapterFor`, so the check stays green — see S2.

---

## 3. Glossary conformity

### G1 — Work-order states: the code invented an undeclared noun
**high · `docs/glossary.json` (work order → detail.states.list), `src/journal/record.ts:252`**

Glossary: `["open","active","blocked","completed","cancelled"]`, "Kept as given. Blocked is a valid state for a work order and a valid journal verb; naming under review." The glossary's `unable` concept simultaneously lists **`blocked`** as a rejected name. The code resolved the contradiction by shipping `waiting` — a noun the glossary neither declares nor maps. `docs/journal.md` and `workVerbs.ts` both use it. The vocabulary check does not catch it (it is not rejected, and the unknown-noun nominator only fires on backticked snake_case or Title Case prose). The glossary's own rule — "A new noun the glossary lacks must be declared there as a concept, or mapped as an alias" — is broken by the tool itself.

### G2 — The agent query ships a different fixed set than the glossary names
**high · `docs/glossary.json` (agent query), `src/readings/query/query.ts:28`**

Glossary: "a small fixed set of questions … which invariants touch these files, who relies on this chokepoint, **what must be loaded to change this safely (the economy prediction)**, and what does my work order say." Code: `["invariants","relies-on","status","component","order"]`. The economy prediction is absent; `status` and `component` are additions the glossary does not name. Since the glossary is "the project's law" and the query's whole value is that the set is fixed and known, this is a substantive divergence, not a naming one.

### G3 — Refutation is per-enforcement in the glossary, per-bullet in the code
**high · `docs/glossary.json` (refutation.detail.by_option), `src/spec/state.ts:48-51`**

Glossary: chokepoints refute themselves; "totality oracle: Must be witnessed and recorded … Until then the oracle is a requirement, not enforcement." Code:

```ts
const automatic = hasChokepoint && latest.chokepoint?.refutation === "automatic";
if (invariant.refutations.length === 0 && !automatic) lacks.push("refutation");
```

One automatic chokepoint refutation satisfies the whole bullet, including a totality oracle that has never been seen to fire. Three of Coherence's own bullets ride on this: `Enforcement/automatic refutation`, `Enforcement/warm server the only path`, `Lifecycle/install keeps other hooks` — each shows `unfilled: refuted` and state `invariant` in `spec --check`.

### G4 — Mass ignores oracles
**medium · `docs/glossary.json` (mass), `src/economy/mass.ts:73-75`**

Glossary: unreached mass is "code in no component, or in a component that **no invariant's chokepoint or oracle** references". `chokepointNames` returns only `protects`/`chokepoint`; a totality oracle's named set never counts as reach, so unreached mass is over-reported. The module comment already restates the narrower rule ("chokepoint or protected thing"), so the drift is documented but unreconciled.

### G5 — Scope stores a second copy of everything it claims to derive
**medium · `docs/scope-shell.md`, `docs/reference/data-is-destiny.md`, `src/readings/scope/build.ts:151-165`, `src/readings/scope/model.ts:200-207`, `src/readings/scope/invariants-view.ts:58,73`**

`docs/scope-shell.md`: "The latest verdict per enforcement, the kept-from-an-earlier-run marks, reliance, open escalations, and every count are derived in `derive.ts` on each render, **never embedded**."

Measured on the built page: `state.spec.components[].invariants[]` carries `latest`, `verified`, `defects`, `state`, `lacks`, `applicable`, `missingShapes` — **105,688 bytes**, about 20% of the 516,964-byte embedded state — sitting beside the 106 run records they are derived from. `state.spec.counts` is likewise a stored count. The Invariants view reads the stored copy (`invariant.latest.find(...)`), not `latestByEnforcement(state.runs.records)`, which exists in `derive.ts` but is used only by `keptFromEarlier`. Two loads of `.coherence/runs` happen (one in `loadSpecModel`, one in `loadState`), so the two copies can disagree if a run is appended between them. This is "store truth once, then compute its consequences" inverted, in the one component whose spec names that rule.

### G6 — The chokepoint check tests "every reference except tests and imports"
**medium · `docs/glossary.json` (chokepoint), `src/enforcement/check.ts:59-66`**

Glossary: "It holds while **every** resolved reference to the protected thing is inside the chokepoint." The check exempts import specifiers (sound: an import is not a use) and test files (a policy choice, `Enforcement.spec.md`'s `sites classified`). The glossary does not license the test exemption, and F15 shows how cheap it is to exploit.

### G7 — An oracle's recorded refutation is a claim, not evidence
**medium · `src/enforcement/run.ts:171`**

```ts
refutation: invariant.refutations.length > 0 ? "witnessed" : "missing",
```

The run record's `refutation: "witnessed"` for a totality oracle means only "the bullet has a `refuted:` line". The run — the primary record of a verification pass — records self-assertion in a field that reads as evidence, next to chokepoint entries where `"automatic"` really is instrument-derived.

### G8 — Reliance is computed, but from the wrong set
**low · `docs/glossary.json` (reliance), `src/readings/scope/derive.ts:201-217`**

Glossary: "the components whose code **references a chokepoint (or the protected thing behind it)**". The code uses `entry.files`, which is `[protectedThing.file, chokepoint.file, ...every reference site]` — so the defining file and the chokepoint file are listed as relying on the invariant, import-only and test sites count, and references to the *chokepoint symbol* are never gathered. `docs/scope-shell.md` discloses the gap ("the view says what the run record lacks"), which is honest but leaves the computed fact different from the defined one. The positive half holds: nothing anywhere lets reliance be declared.

### G9 — "not chokeable" does not require its reason
**low · `docs/glossary.json` (chokepoint grade.ladder), `src/enforcement/check.ts:83-93`**

Glossary: at `not chokeable` "a totality oracle is the required compromise and **the claim must say why structure was unavailable**". The run prints a suggestion; nothing requires the bullet to carry the reason and nothing checks for it.

### G10 — `docs/economy.md` contradicts the code
**low · `docs/economy.md` last paragraph vs `src/economy/cli.ts:37-39`**

"The command drives the adapter in process; the warm server is reached only through the run today." `economyFor` reaches the adapter through `withWarmAdapter`. The module's own header comment says the opposite of the doc.

### G11 — Conformity that holds
- **Enforcement is a category with exactly two options**: `Form = "chokepoint" | "totality oracle"` everywhere; no third form exists.
- **Lifecycle derivation**: `requirement | invariant | structural defect` are exactly the glossary's three, and a failing verdict overrides everything else (`state.ts:61`).
- **The grade ladder names its enforcer on every rung** and is adapter-defined (`TYPESCRIPT_LADDER`, `PYTHON_LADDER`, `Rung.enforcer`); a rung the project must configure (`checker-choked`) is verified against `pyrightconfig.json` / `.importlinter`, never assumed.
- **The run is the primary record and the status is derived**: `run --status` recomputes from every run file, keeps a skipped enforcement's prior verdict with its date and says so; nothing writes a latest-verdict file. (Scope breaks this — G5.)
- **The hook injects vocabulary only**: `lifecycle/glossary.ts` does not even parse `detail` or `provenance`; `renderCompact` emits name, first sentence, aliases, rejected names, distinctions.
- **The peer feed injects subjects only**, capped at 12, with the command that shows the rest.
- **The journal keeps "nothing was rejected" apart from "never examined"**: `over: "none"` vs `over: []`, rendered as `none` vs `(unexamined)`.
- **Reliance is never declared** anywhere.
- **Anti-rot**: `docs/glossary.json` contains no code addresses — the only paths in it are `docs/glossary.md`, `docs/retired.md`, `glossary.json`, `AGENTS.md`, all documentation pointers.
- **`glossary --check` on the tree**: 0 rejected names, 0 unknown nouns, 89 files, exit 0.

---

## 4. Spec findings

### S1 — `Lifecycle/regulate refuses only what it can prove` refuses on something it cannot prove
**high · `src/lifecycle/hook.ts:351`**

The bullet's `because` enumerates what a refusal may be spent on: "a rejected name in a changed file, a spec that will not parse, a chokepoint that no longer chokes". The code refuses on `glossaryText !== ""`, which includes **unknown nouns** — a heuristic nomination (a Title Case phrase appearing twice), not a proof.

```
$ printf 'The Frobnicator Widget is a thing.\n\nWe use the Frobnicator Widget twice here.\n' > NOTE-probe.md
$ printf '{"session_id":"probe1","agent_type":"t"}' | node src/cli.ts hook SubagentStop
Regulate found what this session owes; settle it before stopping.
Glossary check:
UNKNOWN NOUN   "frobnicator widget" (2)  NOTE-probe.md:1, NOTE-probe.md:3
EXIT=2
```

A subagent is held in its loop by a nomination the tool itself describes as "precision over recall" guesswork. The bullet's own totality oracle only tests that an *open requirement* never refuses, so the oracle does not cover the sentence.

### S2 — `Enforcement/warm server the only path` protects the wrong symbol
**high · `src/enforcement/Enforcement.spec.md:73-81`**

Sentence: "From a hook or a reading, the language server is reached **only** through the warm server." Chokepoint: `withWarmAdapter` protects `connectAdapter`. But the door to a language server is `adapterFor`, which is reached from `src/enforcement/cli.ts:143` (`run --no-server`) and `src/readings/scope/build.ts:122` (a reading). The chokepoint claim is structurally true and strictly weaker than the sentence it is attached to — the same mismatch between claim and referent that `docs/glossary.md` says the glossary pass was invented to find.

### S3 — `Journal/append-only store` protects a path helper, not the write
**medium · `src/journal/Journal.spec.md:6-13`**

Sentence: "A journal file is only appended: a second write never changes the first line, and **no path rewrites or deletes a record**." Chokepoint: `src/journal/store.ts` protects `journalDir`. `journalDir` has exactly four references, all inside `store.ts`, so the chokepoint holds — but it constrains only who may *name the directory*. Nothing structural stops any module from `writeFileSync(join(cwd, ".coherence/journal/x.jsonl"), ...)`, and nothing stops a rewrite *inside* `store.ts`. Compare `Enforcement/run appended never rewritten`, which protects `appendRun` (the writer) with `performRun` as the chokepoint — the stronger and correct shape. The journal's bullet overclaims by one level.

### S4 — Three invariants are invariants only because of G3
**medium · `Enforcement.spec.md:48-56, 73-81`, `Lifecycle.spec.md:75-86`**

`automatic refutation`, `warm server the only path` and `install keeps other hooks` all carry `refuted: <not witnessed …>` (a placeholder, correctly counted as absent) and a totality oracle with no witnessed firing, yet `spec --check` reports all three as `invariant` with `unfilled: refuted`. The prose is honest; the derived state is not. For `automatic refutation` the cover is itself the automatic refutation whose soundness F7 undermines.

### S5 — `Lifecycle/injection within budget`: the oracle does not test the sentence
**medium · `src/lifecycle/Lifecycle.spec.md:18-24`, `src/lifecycle/hook.ts:287-293`**

Sentence: "**The start injection** stays under the host budget." Oracle: "`renderCompactWithin` steps the project layer down until the text fits". But `startContext` computes `renderCompactWithin(coherence, project, CONTEXT_BUDGET - head.length - tail.length)` where `head` = escalations + spec problems + open requirements + work orders, all unbounded and all emitted whole. With a long head the budget argument goes negative, the glossary collapses to names-only, and the injection still overruns. The oracle is total over `renderCompactWithin`, which is not the thing the sentence names.

### S6 — `Adapters/name forms`: the refusal does not happen where the bullet says
**medium · `src/adapters/Adapters.spec.md:6-14`**

"a value that does not read as a symbol or a module must be refused as prose by one function **before any instrument is asked**, so a claim about nothing cannot pass." `parseName` refuses correctly, but it is only reached from `run`. The gate that runs in CI (`spec --check`) passes the claim as an invariant with 0 problems — see F4. The bullet's own oracle tests `parseName` in isolation, so it can never see this.

### S7 — `Coherence/grammar carries no rejected name` is an unenforced requirement, correctly labelled
**low** — declared `<not witnessed: no staged break was found for a rule over three data files>`. Honest; noted only because the headline "52 invariants" is what an agent reads, and 7 of 59 bullets are still requirements while 3 more are invariants only by G3.

### S8 — `Enforcement/one invocation for every test` holds, but its "every test the bullets name" is substring-matched
**low** — see F14. The run's batch does invoke once and does map back; the mapping key is not exact.

### S9 — `Scope/deterministic build` holds
**verified** — two builds of `public/_scope.html` produced 645,192 identical bytes; there is no clock, no randomness and no map iteration over unsorted keys in the state path.

---

## 5. What is sound

Things I attacked and could not break:

- **Append-only under concurrent writers.** Two processes appending to one session file, 40 records each, at 500 B, 200 KB and **2 MB** per record: 80 lines, 0 unparsable, 0 damaged, every time. `appendFileSync` with `O_APPEND` holds on APFS at every size I tried.
- **Hook stdin.** Empty, `not json`, `[1,2,3]`, 400 KB of base64 noise, `session_id: 123`, `cwd: {}`, `stop_hook_active: "yes"` — always exit 0 and well-formed `hookSpecificOutput` / `systemMessage` JSON. `readStdinJson` degrades to `{}` and nothing downstream assumes a shape it did not check.
- **Session-token containment.** `session_id: "../../../../tmp/pwned"` writes no journal file, no run file, no trace and no cursor: `SESSION_TOKEN` is checked in `sessionFile`, `workFile`, `appendRun`, `traceFile` and `cursorFile` alike.
- **Naming a chokepoint that does not exist.** `chokepoint: noSuchFunction` → `verdict: fail`, `grade: broken`, reason "no symbol named noSuchFunction". Prose in `protects:` → `not chokeable` / `not run`, never a pass. An ambiguous symbol (`SERVER_BIN` declared in two files) is refused with both candidates and a suggested `SERVER_BIN in <file>`, never guessed.
- **"Not configured never passes."** A missing `test` command yields `not run` with the reason, not a pass; `testMatch` catches a runner that exits 0 with no test selected; a name with no matching test is a `fail`.
- **`run --status` as a derived view.** Nothing stores a latest verdict; a skipped enforcement keeps its prior verdict *with its date* and the line says "kept from the run at …; the latest run skipped it". Verified after a selective edit-hook run.
- **Scope determinism.** Byte-identical output across builds (645,192 bytes), as claimed.
- **Warm server kill and idle.** SIGKILL mid-request → the pending call rejects with "the warm server closed the connection" (never a hang, never a fabricated answer); the next client respawns in ~106 ms. A clean idle stop removes both the socket and its own pointer and rejects in-flight calls the same way. Malformed lines on the socket get `{"id":null,"error":"not JSON"}` and do not kill the server.
- **Journal semantics.** `--over none` vs an omitted `--over` stay distinct on disk and in the timeline; a second retraction/resolution/acknowledgement of the same record is refused; a damaged line is reported with file and line and counted last; a completed order refuses further moves.
- **The compact injection.** Nothing from `detail`, `provenance` or `metaphors` can leak: the hook's glossary reader does not parse those keys at all.
- **The vocabulary check on the tree itself.** 0 rejected names and 0 unknown nouns over 89 files, with project-sense guarding and language globals excluded — the one gate the project points at works.
- **A real adopter.** `spec --check` over `mnemion-js` parses eight component specs, reports 1 invariant / 33 requirements / **2 structural defects** and 0 problems, and correctly refuses three prose chokepoints at run time with the exact remediation text.

---

## 6. Findings as JSON

```json
[
 {"id":"F1","kind":"fault","severity":"critical","status":"confirmed","file":"src/adapters/typescript.ts","line":300,"summary":"forget() never re-sends the text of an already-open document, so the chokepoint check can answer from pre-edit content; reproduced 160/320 wrong verdicts under concurrency and a 'pass' recorded while a bypass was on disk in the project's own suite"},
 {"id":"F2","kind":"fault","severity":"high","status":"confirmed","file":"src/enforcement/run.ts","line":100,"summary":"the totality pass runs before any adapter question and does not touch the warm server's idle timer, so a test suite longer than the 5 min idle window makes every chokepoint 'not run' with instrumentReason undefined and run still exits 0"},
 {"id":"F3","kind":"fault","severity":"high","status":"confirmed","file":"src/readings/query/query.ts","line":223,"summary":"answerOrder filters raw work records by fields.state, so query order can only ever return move records, reports completed orders as active, and never shows objective, success or boundary"},
 {"id":"F4","kind":"fault","severity":"high","status":"confirmed","file":"src/spec/state.ts","line":46,"summary":"a chokepoint written entirely in prose with a self-asserted refuted: line reads as a full invariant with 0 problems and exit 0 from spec --check, the gate npm test runs; only run reveals it, and only as 'not run'"},
 {"id":"F5","kind":"fault","severity":"high","status":"confirmed","file":"src/spec/grammar.ts","line":392,"summary":"quadratic backtracking in the refuted: regex: 156 KB of value takes 16.4 s, and loadSpecModel runs on every hook event under a 60 s timeout"},
 {"id":"F6","kind":"fault","severity":"high","status":"confirmed","file":"src/enforcement/server.ts","line":41,"summary":"the warm server's unix socket is unauthenticated, mode 0755, falls back to a predictable name in os.tmpdir(), and its path is taken from an in-repo pointer file; a substituted instrument can make every chokepoint pass with refutation 'automatic'"},
 {"id":"F7","kind":"fault","severity":"medium","status":"confirmed","file":"src/adapters/typescript.ts","line":523,"summary":"refuteInside reports a synthetic reference added inside the chokepoint module as 'outside the chokepoint' because rangeContains fails on the module range's trailing empty line; the anti-vacuity guard is dead in that configuration"},
 {"id":"F8","kind":"fault","severity":"medium","status":"confirmed","file":"src/spec/grammar.ts","line":118,"summary":"PLACEHOLDER matches any <lowercase...> text, so a value mentioning a generic such as Map<string, Latest> is silently treated as absent; a whole totality-oracle enforcement can vanish with no problem reported"},
 {"id":"F9","kind":"fault","severity":"medium","status":"confirmed","file":"src/adapters/adapter.ts","line":143,"summary":"MODULE_PATH accepts '..', so spec text resolves to a module outside the project root and the adapter reads that file and opens it in the language server"},
 {"id":"F10","kind":"fault","severity":"medium","status":"confirmed","file":"src/scaffold/scaffold.ts","line":56,"summary":"scaffold component resolves an unvalidated folder argument, creating directories and writing spec files outside the project root (absolute paths and .. both work)"},
 {"id":"F11","kind":"fault","severity":"medium","status":"confirmed","file":"src/lifecycle/hook.ts","line":341,"summary":"the Stop snapshot passes an adapter only in tests, so every production read-trace snapshot records a hop-less closure; calibrate can never compare against the prediction its spec defines"},
 {"id":"F12","kind":"fault","severity":"medium","status":"confirmed","file":"src/enforcement/server.ts","line":334,"summary":"connectAdapter has no spawn lock (four concurrent clients left two servers for one root) and computes a different socket path than the server does on macOS, so cleanup targets an unused path and a lost pointer file loses every warm server"},
 {"id":"F13","kind":"fault","severity":"medium","status":"confirmed","file":"src/lifecycle/hook.ts","line":316,"summary":"the hook takes its project root from harness stdin with no containment; {\"cwd\":\"/etc\"} redirects both reads and every record the hook writes"},
 {"id":"F14","kind":"fault","severity":"medium","status":"confirmed","file":"src/enforcement/totality.ts","line":175,"summary":"belongsTo maps report entries to a via value by substring, so an oracle can pass on a different test whose title merely contains it"},
 {"id":"F15","kind":"fault","severity":"medium","status":"confirmed","file":"src/adapters/adapter.ts","line":167,"summary":"any path named *.test.* or *.spec.*, or under a test folder, is exempt from being a bypass, so renaming a file silences a structural defect"},
 {"id":"F16","kind":"fault","severity":"low","status":"confirmed","file":"src/lifecycle/check.ts","line":87,"summary":"the corpus walk has no error handling (EACCES aborts the whole check) and collectFiles follows given paths outside the project root"},
 {"id":"F17","kind":"fault","severity":"low","status":"confirmed","file":"src/lifecycle/hook.ts","line":334,"summary":"feed.commit() runs before the hook's stdout is written, so a failed write loses the peer records the cursor already skipped"},
 {"id":"F18","kind":"fault","severity":"low","status":"plausible","file":"src/enforcement/cli.ts","line":143,"summary":"run --no-server and Scope's ladderFor construct a language adapter outside withWarmAdapter, which the 'warm server the only path' chokepoint does not cover"},

 {"id":"G1","kind":"conformity","severity":"high","status":"confirmed","file":"src/journal/record.ts","line":252,"summary":"work-order states use 'waiting', a noun the glossary neither declares nor maps, invented to dodge the glossary's own contradiction between work order's 'blocked' state and unable's rejection of 'blocked'"},
 {"id":"G2","kind":"conformity","severity":"high","status":"confirmed","file":"src/readings/query/query.ts","line":28,"summary":"the agent query's fixed set omits the economy prediction the glossary names and adds status and component, which it does not"},
 {"id":"G3","kind":"conformity","severity":"high","status":"confirmed","file":"src/spec/state.ts","line":49,"summary":"refutation is required per enforcement in the glossary but satisfied per bullet in the code: a chokepoint's automatic refutation covers a totality oracle that has never been witnessed (three of Coherence's own bullets)"},
 {"id":"G4","kind":"conformity","severity":"medium","status":"confirmed","file":"src/economy/mass.ts","line":73,"summary":"unreached mass counts only chokepoint reach; the glossary says 'no invariant's chokepoint or oracle references' it"},
 {"id":"G5","kind":"conformity","severity":"medium","status":"confirmed","file":"src/readings/scope/build.ts","line":151,"summary":"Scope embeds 105,688 bytes of derived state (latest, verified, defects, state, lacks, counts) beside the run records it comes from and the views read the stored copy, contradicting docs/scope-shell.md's 'never embedded' and data-is-destiny"},
 {"id":"G6","kind":"conformity","severity":"medium","status":"confirmed","file":"src/enforcement/check.ts","line":59,"summary":"the chokepoint check exempts test files, so it tests 'every non-test reference is inside the chokepoint', not the glossary's 'every resolved reference'"},
 {"id":"G7","kind":"conformity","severity":"medium","status":"confirmed","file":"src/enforcement/run.ts","line":171,"summary":"a totality oracle's run entry records refutation 'witnessed' purely because the bullet carries a refuted: line, putting a self-assertion in an evidence field"},
 {"id":"G8","kind":"conformity","severity":"low","status":"confirmed","file":"src/readings/scope/derive.ts","line":201,"summary":"reliance is computed from the run entry's files (which include the defining file, the chokepoint file, imports and tests) and never from references to the chokepoint symbol"},
 {"id":"G9","kind":"conformity","severity":"low","status":"confirmed","file":"src/enforcement/check.ts","line":83,"summary":"the glossary requires a 'not chokeable' claim to say why structure was unavailable; nothing requires or checks it"},
 {"id":"G10","kind":"conformity","severity":"low","status":"confirmed","file":"docs/economy.md","line":73,"summary":"the doc says economy drives the adapter in process and the warm server is reached only through the run; economyFor uses withWarmAdapter"},

 {"id":"S1","kind":"spec","severity":"high","status":"confirmed","file":"src/lifecycle/hook.ts","line":351,"summary":"'regulate refuses only what it can prove' also refuses a subagent stop on an UNKNOWN NOUN, a heuristic nomination outside the three things its because permits; reproduced with exit 2"},
 {"id":"S2","kind":"spec","severity":"high","status":"confirmed","file":"src/enforcement/Enforcement.spec.md","line":73,"summary":"'warm server the only path' protects connectAdapter, not adapterFor; the chokepoint holds while the sentence does not, since run --no-server and scope/build.ts both build adapters directly"},
 {"id":"S3","kind":"spec","severity":"medium","status":"confirmed","file":"src/journal/Journal.spec.md","line":6,"summary":"'append-only store' protects journalDir, a path helper, so nothing structural prevents a rewrite of a journal file; the sentence claims more than the chokepoint can detect"},
 {"id":"S4","kind":"spec","severity":"medium","status":"confirmed","file":"src/enforcement/Enforcement.spec.md","line":48,"summary":"three bullets with an unfilled refuted: placeholder and an unwitnessed oracle report as invariants because a chokepoint's automatic refutation covers the bullet (see G3)"},
 {"id":"S5","kind":"spec","severity":"medium","status":"confirmed","file":"src/lifecycle/Lifecycle.spec.md","line":18,"summary":"'injection within budget' claims the start injection stays under the host budget, but its oracle tests renderCompactWithin alone while startContext prepends an unbounded head of escalations, requirements and work orders"},
 {"id":"S6","kind":"spec","severity":"medium","status":"confirmed","file":"src/adapters/Adapters.spec.md","line":6,"summary":"'name forms' says prose is refused before any instrument is asked, but the refusal lives only in run; spec --check, the CI gate, passes a prose chokepoint as an invariant"},
 {"id":"S7","kind":"spec","severity":"low","status":"confirmed","file":"Coherence.spec.md","line":13,"summary":"the entry spec's first invariant is an unenforced requirement with an unwitnessed refutation, correctly labelled but counted inside a headline that reads '52 invariants'"},
 {"id":"S8","kind":"spec","severity":"low","status":"confirmed","file":"src/enforcement/Enforcement.spec.md","line":64,"summary":"'one invocation for every test' holds, but results map back by substring so 'every test the bullets name' can be satisfied by a different test"}
]
```
