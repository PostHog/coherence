# Plugins

A plugin is what a project adds to Coherence through its config: a language
adapter (for a language Coherence lacks, or wrapping one it has), syntax tables
for the readings, a verifier that proves bullets, and a lexicon layer. One
interface and one registry carry all of them (`src/plugins`). This page is the
author's guide.

Plugins ship two ways:

- **Bundled** inside `@posthog/coherence`, under `plugins/<name>`.
  TypeScript, Python, Rust, and the generic language-server adapter that reads
  the languages a config declares (`declared`) are bundled plugins that every
  project runs without naming them (`plugins/defaults.json` lists them, with
  the default language). Coherence's core names no language: everything it
  knows of one is asked of the plugin that provides it. Others ship bundled
  but run only for a project that names them, `"<name>": "bundled"`: Go,
  Convex and Quint (below).
- **By path**: a folder in the project (or anywhere the project names). This is
  how a project enhances a bundled plugin: copy it out, change it, and point
  the config at the copy.

## Running a plugin

```json
{
  "language": ["typescript"],
  "plugins": {
    "convex": "bundled",
    "sample": "./coherence/plugins/sample"
  }
}
```

The key is the plugin's name, which its manifest must carry. The value is
`"bundled"` or a path to the plugin's folder. The key is the project's own: a
registry's `plugins` are never inherited by its leaves, since the paths are the
writer's.

A relative path must stay inside the project; one that climbs out of it
(`"../shared/plugin"`) is refused. To run a plugin from outside the project,
write its absolute path out: that is the explicit form, and it says on the page
that the code comes from elsewhere.

## Trust

A plugin's code runs with the project's privileges: whatever the user running
Coherence may read, write or start, it may too. Its `module` (the adapter and
the verifier) runs in `coherence run` (so in CI, through the generated
workflow), in `refute`, and in the warm adapter server that the hooks talk to.
The modules its `syntax` slots name run wherever a reading reads its language,
a hook's own process included: the economy's prediction at a stop, the
lexicon's member scan and entrance detection read languages there, and the
core's own languages are plugins now. A slot's module is loaded only when a
reading asks for that slot, and should be what a syntax table is: small and
without effects. A session start names, in one line, each plugin the project
brings whose syntax code will run in its hooks. Run a plugin you would run as a dev dependency, and review a
change to one as you would a change to the project's own code. A bundled
plugin ships inside `@posthog/coherence` and is reviewed with it.

The warm server's code fingerprint holds every plugin folder the project runs,
so an edited plugin replaces the server as an edited Coherence does, and a
module that fails to load is tried again once it is fixed.

A project without a `plugins` key reads no plugin of its own. The bundled
plugins that provide its languages are read once per process, as the
built-in languages' tables were compiled in before, and it does exactly the
work it did before plugins existed.

## The folder

```
sample/
  plugin.json     the manifest, read as data
  index.ts        the module, imported only where its code runs
  check.json      the project plugin check holds it to (below)
  package.json    { "type": "module", "private": true }
  lexicon.json    the lexicon layer (optional)
```

The modules are TypeScript run as written, as ES modules: Node 22.18 or later
runs them without a flag. The folder's `package.json` says they are ES
modules, so Node neither guesses nor warns at every load, whatever the
project's own `package.json` says (`plugin eject` writes it). Code imports
Coherence only through `@posthog/coherence/plugin`, whose types ship in the
package as `dist/plugins/api.d.ts`; a tsconfig that typechecks the folder
needs `"allowImportingTsExtensions": true` with `noEmit`, and `@types/node`
as a dev dependency, since the interface names Node's types.

The bundled plugins are the fullest examples, shipped in the package under
`plugins/`: `go` for a language Coherence lacks, `rust` for an adapter over a
language server with no npm package, `typescript`, `python` (with tach) and
`declared`. Their sources import the core as `../../src/plugins/api.ts`, the
same module the package exports as `@posthog/coherence/plugin`; an ejected
copy names it the second way, and so should a plugin you write.

### plugin.json

```json
{
  "name": "sample",
  "version": "0.1.0",
  "pluginApi": 2,
  "provides": { "language": "swift" },
  "extends": "typescript",
  "extensions": [".swift"],
  "module": "./index.ts",
  "ladder": { "top": "reference-choked", "because": "...", "rungs": [] },
  "verifiers": [
    { "form": "sample prove", "evidence": "model-checked" },
    { "form": "sample exit", "evidence": "exit-checked", "command": ["node", "check.js", "{name}"], "match": "^proved " }
  ],
  "lexicon": "./lexicon.json"
}
```

| Key | Meaning |
|---|---|
| `name`, `version` | Who the plugin is. Every run entry its adapter or verifier answers names both. |
| `pluginApi` | The interface version it was written for. This release runs `2` and reads plugins written for `1` to `2`: a plugin written for `1` loads, and the session start names it with what changed since. Any other version is refused, naming both. |
| `provides.language` | The language its adapter answers for. A built-in name takes the built-in's place (see the swap rule). A new name needs `extensions` (or `files`), and the config's `language` must name it; the language is then read as a bundled one is, for that project: its files, test files and folders, its entrance rules, its CI steps and every syntax slot it fills. |
| `extends` | The language whose adapter it is handed to wrap. |
| `extensions` | The files a new language is written in. An extension a built-in, a declared language, or another plugin owns is refused. |
| `module` | The module, relative to the manifest. Required for an adapter, and for a verifier with no `command`. |
| `ladder` | The rungs the adapter grades on. Absent, the wrapped adapter's; with none, reference-choked alone, enforced by Coherence's check. |
| `verifiers` | The via forms it proves (below). A `command` must name `{name}`; a command that is never told what to prove is refused. An optional `match` is a regular expression its output must match for an exit 0 to pass. |
| `lexicon` | Its lexicon layer, relative to the manifest. |
| `syntax` | The syntax slots it fills, each `"<module beside the manifest>#<export>"` (below). |
| `files` | The files a language is written in, as a regular expression `pattern` with an optional `except` (TypeScript, as JSON writes them: `\\.(?:[cm]?[tj]sx?)$` except `\\.d\\.ts$`); `extensions` is the short form for a plain list. |
| `source` | `except`: of the language's files, those the plain source scan leaves out (TypeScript's JavaScript, Python's stubs). |
| `serverExtensions` | The extensions the language server can report a site in or resolve a name to. |
| `testFiles` | Regular expressions a test file's base name matches by the language's own naming (pytest's `^test_.*\\.py$`), beside `.test.`/`.spec.` and the test folders. |
| `members` | How an exported type's body reads for the lexicon's member scan: `opens`, `closes`, `field`, each a regular expression. |
| `entrances` | The entrance detection rules (`rule`, `plural`, `detects`) and `notDetected`, what they miss: printed by the query, the page and orient. |
| `notScanned` | Why the text scans do not read the language yet (Rust's); absent when they do. |
| `environmentFolders` | Folder names no project authors code in, wherever they sit (`node_modules`, `__pycache__`). |
| `markedFolders` | Folders the language's tools make, left out by a `marker` inside (`pyvenv.cfg`) or by `name` beside a file (`target` beside `Cargo.toml`), each with its `reason`. |
| `ci` | `note`: what the generated CI workflow says for a project that reads the language. `steps`: what it runs after the install to set up what the adapter asks (Go's toolchain and gopls), each `{ "name"?, "uses": "<owner/repo>@<40-hex commit>", "version": "<its release>", "with"? }` or `{ "name"?, "run": "<command>" }`. |
| `wellKnown` | Names the plugin vouches for as well known, beside Coherence's own list. |

The manifest is data so that a hook that only needs to know what a plugin
provides (the vocabulary, the spec check, which language a file is written in,
the folders a walk leaves out) reads one small file and runs no plugin code,
and so that the Scope page, in a browser, can print a language's entrance
rules. The module loads in the warm adapter server and in a run, when a check
first asks its adapter or verifier.

### The module

```ts
import type { PluginModule } from "@posthog/coherence/plugin";

const plugin: PluginModule = {
  adapter: ({ root, language, base, bounds }) => /* a LanguageAdapter */,
  verify: async ({ root, form, name, timeoutMs }) => ({ verdict: "pass", reason: "..." }),
};
export default plugin;
```

`adapter` returns a `LanguageAdapter`, exported from
`@posthog/coherence/plugin` (below, writing an adapter). When the
manifest extends a language, `base` is that language's adapter: delegate what
you do not change. The core closes `base`; your adapter closes only what it
started. A module that fails to load makes the adapter unready with the reason,
so every chokepoint it was asked about reads not run, never a pass.

`bounds`, for a server that can narrow its workspace, is the folders the
component interface reading leaves out.

### The syntax slots

The readings scan a language by the tables its plugin's manifest names under
`syntax`, each as `"<module>#<export>"`, loaded synchronously, once, when a
reading first asks for that slot:

| Slot | Read by | Type |
|---|---|---|
| `entrances` | entrance detection | `EntranceSyntax` |
| `interfaces` | the Structure reading | `InterfaceSyntax` |
| `kept` | the Structure reading's kept answers | `(file, text) => string[]` |
| `source` | the economy and mass | `SourceSyntax` |
| `declares` | the observation's interface map | `(line) => "type" \| "value" \| "body" \| "unknown"` |
| `notice` | the session start | `(root) => string` |
| `lists` | declared mirrors | `(text, name) => Literal \| undefined` |
| `topLevel` | the spec model's check that a handler, guard or mirror is declared | `(text, name) => boolean` |
| `boundaries` | `scaffold import` and adoption | `BoundarySource`: a tool's declaration file read into modules, as tach's |

Every type is exported from `@posthog/coherence/plugin`. A slot a plugin leaves empty reads as "not read for <language>", never as
another language. A plugin answers for the project whose config names it
alone: a process serving several projects asks each one's questions under
`forProject(root, ...)`. A plugin that provides one of the bundled languages answers
each field and slot it declares, and the bundled plugin answers the rest, so
an enhancement of the adapter alone keeps every reading of the language. Its
file rule is one rule: a plugin that names its files, by `files` or
`extensions`, owns them whole.

## Writing a language adapter

An adapter answers the questions a chokepoint check asks, about one language,
over one project. Most drive a language server over the language server
protocol on stdio (`JsonRpcClient`, exported from
`@posthog/coherence/plugin`); `plugins/go/go.ts` drives gopls in about 600
lines and is the shortest whole example. `docs/enforcement.md`, shipped
beside this page, explains the grades, the ladder and refutation from the
reader's side; this is the author's side.

| Method | Owes |
|---|---|
| `ready()` | `{ ok: true }` once the instrument answers, else `{ ok: false, reason }` naming what is missing and how to get it (`gopls was not found (install it with ...)`). Never throws for a missing tool: every chokepoint then reads not run with the reason, never pass. |
| `resolve(name, hint)` | A spec name to one `Definition`: a file, a range, and the position of the name. Read the name with `parseName`: a bare symbol, `Name in file`, or a module path. Several candidates are chosen among by `hint` (not in a test file, then under `hint.component`), and a name still ambiguous is refused with `candidates`, never guessed. |
| `references(definition)` | Every site in the project's own files (`keepProjectFiles`) that names the thing, the declaration itself left out, as `{ file, line, character, symbol }`: the line 1-based, `symbol` the enclosing declaration's dotted path. Test files are recognized by the check from the manifest's `testFiles` and the test folders; report every site. |
| `visibility(definition, chokepoint?)` | Whether the language itself refuses a reference from outside the thing's module (`enforced`), whether the thing is reachable from outside it (`visible`), the `evidence` read, and the `rung` a clean chokepoint earns on it, one of the manifest's `ladder.rungs`. |
| `refute(protected, chokepoint?, exempt?)` | The refutation, below. |
| `testFilter(via)` | A bullet's `via` as the project's test runner filters by it; most return it unchanged. |
| `forget(files?)` | Make the instrument read the disk again: the named files, or all it may have open. Resolve only once the instrument has taken the change in, since the edit hook checks again right after. |
| `close()` | Stop what the adapter started. The core closes a `base` it handed you. |
| `serverPid()` | Optional: the server's process id, so a reading can bound its memory. |

### The refutation

A check that could never fail proves nothing, so every chokepoint run
refutes itself: the adapter stages uses the check must catch, and the run
reads what it saw. Nothing may touch disk: stage each use as an unsaved
document (`textDocument/didOpen`, or `didChange` over a file the project
has), and close or restore every one before `refute` returns, whatever it
returns.

- **When Coherence's check enforces the rung** (`reference-choked`), stage
  the uses the check must call bypasses and return them as `staged`, each
  with the site the instrument reported for it (`site`), absent when it
  reported none:
  - a use of the thing in the chokepoint's own file, past the chokepoint's
    range, when the chokepoint is a symbol;
  - a use from a new document beside the protected thing (a re-export, in a
    language that has them);
  - with `exempt`, the folder whose references the chokepoint does not
    govern: no use inside it, and one from a new document outside it
    (`outsideOfFolder`).

  Never decide yourself whether a staged site is a bypass: the check
  classifies each with the function it classifies every site with, and the
  refutation fires only when it calls every one a bypass. `seen` is whether
  the instrument reported every staged use. A use it did not report, or one
  the check would not call a bypass, makes the check vacuous: the run says
  which and why, and records not run, never pass.
- **When the language enforces the rung** (`visibility-choked`: Go's
  unexported names, Rust's privacy), Coherence's check can never be made to
  fire, since the compiler refuses every outside use first. Stage a use from
  outside the thing's module, pull the instrument's diagnostics on it, and
  return the refusal's own text as `refused`, with `seen: true` and nothing
  staged. Stage a control use from inside the module too, which must not be
  refused: a refusal there means the name is wrong, not private, and the
  refutation proves nothing (`seen: false`).
- **When nothing can be staged** (no module path a new package could
  import, an instrument that cannot open an unsaved document), return
  `seen: false` with nothing staged.

`account` says, in one line, what was staged and what was seen: the run
prints it as the refutation's evidence.

## Eject, enhance and swap

Every language Coherence reads is a bundled plugin, so a project that finds
one wanting changes a copy of it:

1. **Eject**: `coherence plugin eject typescript` copies `plugins/typescript`
   from the installed package into `coherence-plugins/typescript` (or
   `--to <dir>`), with its `check.json`, and adds
   `"plugins": { "typescript": "./coherence-plugins/typescript" }` to the
   project's config. The copy imports Coherence only through
   `@posthog/coherence/plugin`: the bundled plugins import the core through
   that one module (`src/plugins/api.ts`), so the copy reads from the
   installed package what it read bundled. The copy is TypeScript run as
   written, its imports naming `.ts` files: it needs Node 22.18 or later
   (which runs TypeScript without a flag), and a project that typechecks it
   needs `"allowImportingTsExtensions": true` (with `noEmit`) in the
   tsconfig that includes it. Eject edits only the config's `plugins` key,
   every other byte kept. It refuses, writing nothing, when the folder
   exists (a link there that leads nowhere included), when it leaves the
   project once symbolic links are followed, when a link on the way leads
   nowhere, or when the config already runs a plugin by that name from a
   path. A plugin the config runs bundled (`"go": "bundled"`) is the one
   copied, and its copy takes that entry's place.

   The copy's folder is Coherence's instrument, not your code: no walk reads
   it (specs, readings, mass, the lexicon's corpus), no reference found there
   counts against a chokepoint, and a name it declares shadows none of yours.
   Say `"gradePlugins": true` in the config to have your plugin folders
   walked like any other.
2. **Enhance**: change the copy. It answers for its language in the bundled
   plugin's place from the next command on; what it does not declare (a data
   field, a syntax slot) the bundled plugin still answers.
3. **Check**: `coherence plugin check ./coherence-plugins/typescript` holds it
   to what every language plugin owes, over the project its `check.json`
   carries:

   | Duty | Holds when |
   |---|---|
   | file rule | the files `check.json` names as the language's are, and the others are not |
   | declarations | the `topLevel` slot says which names a file declares, as `check.json` says |
   | references | the adapter reports every reference to the protected thing, and none else; one that reports none fails here, by name |
   | chokepoint | the run grades the chokepoint as `check.json` expects, bypasses named, its refutation seen or refused |

   Each duty passes, fails with why, or is not run with why (the
   language server is absent). The command exits 0 only when every one
   passes. The bundled plugin's `check.json` for the language, as the
   installed package ships it, is the minimum: every plugin for that
   language is held to it, whatever its own `check.json` says. Add cases to
   the copy's `check.json` as you enhance it: they are its tests, held
   besides the minimum, never in its place. A duty with no case fails as
   "nothing to check", a `check.json` that is no check project (`{}`) is
   refused naming each field it lacks, and a duty that throws fails with
   what it threw while the others still report. `plugin check typescript`
   holds the bundled plugin to the same.

   A language plugin's `check.json` is one small project and what the
   plugin must answer over it. `plugins/go/check.json` is a whole one for a
   language Coherence does not bundle as a default:

   | Field | Holds |
   |---|---|
   | `files` | The project: each file's text by its path from the root. The check writes them into a scratch folder, with a config that runs the plugin, and reads nothing else. |
   | `language` | `{ "files": [...], "not": [...] }`: paths the file rule must take as the language's, and paths it must not. Only the names are read, so a path need not be in `files`. |
   | `declarations` | `[{ "file", "name", "declared" }]`: what the `topLevel` slot must say of a name in one of `files`. |
   | `protects`, `chokepoint` | The thing and its one way in, written as a spec bullet writes them (`Seal`, `Name in file.go`). |
   | `references` | Every reference to `protects` as `file:line`, the line 1-based, test files' included: the adapter must report exactly these, none missed and none more. |
   | `grade` | What the run grades the chokepoint (`broken`, `reference-choked`, `visibility-choked`). |
   | `bypasses` | The references outside the chokepoint the run must name, as `file:line`; a test file's never is one. |
4. **Swap back**: remove the `plugins` entry, and the bundled plugin answers
   again.

A plugin is pinned to the `pluginApi` it was written for. When Coherence moves
on, the session start names the plugin and what changed since, so an ejected
copy's author knows what to update. `pluginApi` 2 moved the syntax slots from
the module's `syntax` export into `plugin.json`
(`"syntax": { "<slot>": "<module>#<export>" }`), made the member scan
`plugin.json` data (`members`), and added the `kept`, `declares`, `notice`,
`topLevel` and `boundaries` slots. A module that still exports `syntax` is
refused at load, by name, rather than read as having none.

## Roles

### A language adapter: the swap rule

- A plugin that **provides** a language takes the core's place for it: the
  bundled plugin's. With `extends` naming the same language, it is handed the
  bundled plugin's adapter. This is how an ejected, enhanced built-in replaces
  ours.
- A plugin that **extends** a language without providing it wraps whichever
  adapter answers for that language, the core's or a providing plugin's. Several
  wrap in the config's order. This is how an enhancement such as Convex layers
  over TypeScript.
- A plugin that extends a language adds to its readings too: the entrance
  rules its manifest lists (`entrances.rules`) and the names it vouches for
  (`wellKnown`) join the language's, and a syntax slot it fills names a
  function of the table beneath it (the provider's, then each earlier
  extending plugin's) that returns the table to read by. Convex's
  `"entrances": "convex-entrances.ts#convexEntrances"` returns TypeScript's
  entrance syntax with Convex's shapes added. All of it is for the project
  that names the plugin alone; one that does not reads no file of it.
- `plugin check` holds a plugin that extends a language to that language's
  duties, over the bundled minimum for it and the plugin's own `check.json`.
- **Two plugins that provide one language are refused**, both named: two
  adapters cannot both answer.

### A verifier

A bullet proved by a plugin rather than a test writes its form in brackets:

```
- the model holds: The work-order model never reopens an ended order.
  over: every state the model reaches
  via: [sample prove] terminalNeverMoves
```

The bracketed form is one a loaded plugin declares. The plugin is asked to
prove the name (a module's `verify` is also told the folder of the bullet's
spec, `component`, where a name without a file is looked for), by its `command` (the name in place of `{name}`, run from the
project root; exit 0 is a pass, and with `match` only when the output matches
too, an exit 0 whose output does not being a fail that names the expression)
or its module's `verify`. The verdict is graded
as a test's is, and the run entry records the plugin and the form's evidence
label. A bracket begins no test title, so the two never read as each other. A
form no loaded plugin declares is a spec problem naming the forms that are,
never a test run under that title. Two plugins that prove one form are refused.

A verifier that does not answer within the run's timeout is not run: it
proved nothing either way.

`refute` stages a break and runs the bullet as `run` does, so a verifier's
bullet is refuted like any other.

`plugin check` holds a verifier plugin (one that provides no language) to its
own `check.json`: `{ "files": {...}, "proofs": [{ "via", "verdict",
"reason"?, "component"?, "env"? }] }`. Each proof is proved over a scratch copy
as a run proves a bullet, with any environment it names set, and must read the
verdict it expects (its reason matching `reason`). There is one duty per form:
a form with no proof fails as nothing to check, and a proof expected to pass or
fail that could not run leaves its duty not run with why, never pass. The
report says `NOT RUN` when no duty failed but one did not pass.

### A lexicon layer

The lexicon is a stack: Coherence's layer, then each plugin's in the config's
order, then the project's.

- A plugin's concepts count as declared wherever Coherence's do, and every view
  says whose each is: `coherence lexicon` prints each layer under its plugin's
  header, the Scope lexicon view shows each as its own layer, and coverage
  reports a term's layer as `plugin <name>`.
- A plugin's rejected names govern only its own terms; they are not refused
  across the project.
- A defect class a plugin's layer declares is a legal `--class`. A plugin adds
  classes as properties of a concept named `defect` with an empty definition,
  which carries properties and is not a clash.
- **A clash is never merged.** A plugin concept whose name or alias Coherence or
  an earlier plugin already declares stays out of the stack, and the spec check
  and `coherence lexicon` report it. The project settles it by declaring the
  name in its own lexicon, as a concept or as an alias of the sense it means;
  inside the project its sense wins.
- A session start carries a plugin's layer only while its surface is in use: a
  language it provides or extends among the project's, or a via form it proves
  on some bullet. `coherence lexicon` always prints every layer.

## Opt-in bundled plugins

### Go

`"plugins": { "go": "bundled" }` with `"language": "go"` (or a list naming
it) reads a Go module through gopls:

- **Names.** A spec names a Go thing as `Name in path/to/file.go`, or by its
  name alone when the module declares it once. Go's own `store.Write` is
  prose here: the package qualifier is no part of a spec name. A module is
  one `.go` file; a package folder (`internal/audit/`) resolves only when it
  holds one non-test file, since a definition is one file.
- **Grades.** An unexported name is **visibility-choked**: the compiler
  refuses it from any other package, and the refutation is gopls's own
  refusal of a use from an unsaved new package, beside a use inside the
  package that it must accept. An exported one is **reference-choked**:
  every reference gopls reports in the module must be inside the
  chokepoint, and the refutation stages a use beside the protected thing and
  one in the chokepoint's own file past the chokepoint. A `_test.go` file is
  test code.
- **Read by the readings.** Go's files, tests and `vendor` folder, and its
  top-level declarations, so the spec check reads an entrance's handler or
  a guard in a Go file. Not yet: entrance detection (declare each under
  `## entrances`) and the text scans mass and the economy read by.
- **gopls** is found from `COHERENCE_GOPLS`, else the `PATH`, else
  `go env GOPATH`/bin; with none, every Go chokepoint reads not run with
  how to install it. `ci install` sets up Go and gopls in the workflow it
  writes.

### Convex

`"plugins": { "convex": "bundled" }` in a TypeScript project that deploys a
Convex backend. It extends TypeScript:

- **References.** Convex code reaches a function through the object `convex
  dev` generates into `<functions folder>/_generated/api`
  (`internal.telemetry.send` is `telemetry.ts`'s `send`), whose type the
  language server never links back to the export. The plugin reads each such
  property chain, from the syntax tree, as a reference to the export it names,
  so a chokepoint over a Convex function grades the calls real callers make.
  Its refutation stages one such reference. The functions folder is the
  nearest one above a file holding both `_generated/api` and
  `_generated/server`; a path alias to it must end in the folder's own name.
  Followed as references: a namespace import (`import * as g`), a module that
  re-exports the objects (by a relative path or a path alias, relays deep), a
  const holding part of a chain (`const t = internal.telemetry; t.send`) and
  a destructure (`const { send: s } = internal.telemetry`).
- **Gaps, never silence.** Any other use the plugin cannot read through is
  reported as a site not read through, with why, so one outside the
  chokepoint keeps it from passing: the object or part of a chain passed on
  as a value, spread, read with a computed key or a rest pattern, and a
  string naming the function as Convex does (`"telemetry:send"`). Names are
  matched by name, not scope: a local that shadows a followed name reads as
  that name.
- **Entrances.** A public function (an exported `query`, `mutation` or
  `action` built from the folder's `_generated/server`), a route a
  `convex/server` `httpRouter` registers, and the function a `cronJobs` table
  runs. Internal functions are not entrances. Not detected: a library's
  routes added with `addHttpRoutes`, a custom builder wrapping Convex's, and
  the functions a library such as `convexAuth` exports.
- **Vocabulary.** Its own lexicon layer: Convex function, generated API,
  functions folder, Convex cron.

It needs the TypeScript compiler (`typescript`, an optional dependency of
Coherence's that a Convex project has already).

### Quint

`"plugins": { "quint": "bundled" }` proves properties of a
[Quint](https://quint-lang.org) model:

```
- an ended order never moves: The model never reopens an ended order.
  over: every state the model reaches within its bound
  via: [quint] terminalNeverMoves in Journal.qnt
```

- `[quint run] <property>`: `quint typecheck`, then `quint run --invariant`
  over sampled runs. Evidence `simulated`. The pass says what was checked:
  no violation in so many sampled traces, and the deepest one reached, read
  from quint's trace length statistics; a run that stopped short of the steps
  asked says so as a limit, and a model with no initial state is not run.
- `[quint] <property>`: the same, then `quint verify`, Apalache's bounded model
  check. Evidence `bounded-model-checked`; the reason states the bound, since
  it is not every reachable state. Each proof starts its own Apalache server
  on a free port (`--server-endpoint`), never one already running.
- The model file is named from the bullet's spec folder, or with none named
  the folder's one `.qnt` model.
- A state that breaks the property fails the bullet with the states quint
  printed; a refusal (a type error, an unknown name) fails it too.
- **What could not run is not run, never a pass:** no quint (install
  `@informalsystems/quint@0.33`, or set `COHERENCE_QUINT`), a shell that found
  none, `quint verify` without the Java runtime Apalache needs or without
  Apalache fetched, and a step out of time.
- Tuned under `"quint"` in the config: `backend` (`typescript`, the default,
  fetches nothing; `rust`), `maxSamples` (1000), `maxSteps` (20), `seed`,
  `verifySteps` (10). Quint keeps what it fetches under `QUINT_HOME`.
- Its vocabulary is its own lexicon layer (quint model, quint property, bounded
  model check), carried only while a bullet proves by its forms.

## What a run records

A run entry that a plugin's adapter graded, or a plugin's verifier proved,
carries `plugins: [{ name, version }]`, in the order they wrapped. A verifier's
entry also carries `evidence`, the label its manifest gives the form.

## Not yet

What the interface does not carry yet:

- **Language knowledge still in the core.** The vocabulary's code scan reads
  many languages' declarations (`src/lifecycle/lexicon-coverage.ts`,
  `src/lifecycle/check.ts`); entrance detection's package-script rule names
  the runners it follows, and its pyproject console scripts; the mirror
  readers parse with the TypeScript compiler and resolve its specifiers; a
  module's own files (a Python package's `__init__`, a Rust module's folder)
  are read in `src/enforcement/check.ts`; run routes pytest; the observation
  reads Python tracebacks. The structural test names each as an exception
  with its reason, and each is a table a language plugin should own.
- **A package that is many files.** A definition is one file, so a Go
  package folder stands for a chokepoint or a protected module only when it
  holds one non-test file.
- **Bullets about a plugin's code** still live in the core's specs
  (`src/adapters/Adapters.spec.md`): a bullet's witnessed refutation is keyed
  by its component, so moving one restages its refutation.
