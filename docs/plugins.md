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
  but run only for a project that names them, `"<name>": "bundled"`: Convex
  and Quint
  (below).
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
  lexicon.json    the lexicon layer (optional)
```

The bundled plugins are the fullest examples: `plugins/typescript`,
`plugins/python` (with tach), `plugins/rust` and `plugins/declared`.

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
| `provides.language` | The language its adapter answers for. A built-in name takes the built-in's place (see the swap rule). A new name needs `extensions`, and the config's `language` must name it. |
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
| `ci` | `note`: what the generated CI workflow says for a project that reads the language. |
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

`adapter` returns a `LanguageAdapter` (`src/adapters/adapter.ts`). When the
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
| `entrances` | entrance detection | `EntranceSyntax` (`src/adapters/entrance-candidates.ts`) |
| `interfaces` | the Structure reading | `InterfaceSyntax` (`src/readings/scope/component-interfaces.ts`) |
| `kept` | the Structure reading's kept answers | `(file, text) => string[]` |
| `source` | the economy and mass | `SourceSyntax` (`src/economy/source.ts`) |
| `declares` | the observation's interface map | `(line) => "type" \| "value" \| "body" \| "unknown"` |
| `notice` | the session start | `(root) => string` |
| `lists` | declared mirrors | `(text, name) => Literal \| undefined` |
| `topLevel` | the spec model's check that a handler, guard or mirror is declared | `(text, name) => boolean` |
| `boundaries` | `scaffold import` and adoption | `BoundarySource` (`src/scaffold/boundaries.ts`): a tool's declaration file read into modules, as tach's |

A slot a plugin leaves empty reads as "not read for <language>", never as
another language. A plugin answers for the project whose config names it
alone: a process serving several projects asks each one's questions under
`forProject(root, ...)`. A plugin that provides one of the bundled languages answers
each field and slot it declares, and the bundled plugin answers the rest, so
an enhancement of the adapter alone keeps every reading of the language. Its
file rule is one rule: a plugin that names its files, by `files` or
`extensions`, owns them whole.

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
   nowhere, or when the config already runs a plugin by that name.

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
- **Bullets about a plugin's code** still live in the core's specs
  (`src/adapters/Adapters.spec.md`): a bullet's witnessed refutation is keyed
  by its component, so moving one restages its refutation.
