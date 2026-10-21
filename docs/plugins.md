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
  knows of one is asked of the plugin that provides it. Convex and Quint will
  arrive as bundled plugins a project opts into by naming them.
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
without effects. Run a plugin you would run as a dev dependency, and review a
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
  "pluginApi": 1,
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
| `pluginApi` | The interface version it was written for. A version this Coherence does not run is refused, naming both. This release runs `1`. |
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

A slot a plugin leaves empty reads as "not read for <language>", never as
another language. A plugin that provides one of the bundled languages answers
each field and slot it declares, and the bundled plugin answers the rest, so
an enhancement of the adapter alone keeps every reading of the language.

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
prove the name, by its `command` (the name in place of `{name}`, run from the
project root; exit 0 is a pass, and with `match` only when the output matches
too, an exit 0 whose output does not being a fail that names the expression)
or its module's `verify`. The verdict is graded
as a test's is, and the run entry records the plugin and the form's evidence
label. A bracket begins no test title, so the two never read as each other. A
form no loaded plugin declares is a spec problem naming the forms that are,
never a test run under that title. Two plugins that prove one form are refused.

`refute` stages a break and runs the bullet as `run` does, so a verifier's
bullet is refuted like any other.

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

## What a run records

A run entry that a plugin's adapter graded, or a plugin's verifier proved,
carries `plugins: [{ name, version }]`, in the order they wrapped. A verifier's
entry also carries `evidence`, the label its manifest gives the form.

## Not yet

What the interface does not carry yet:

- **Eject and check.** `coherence plugin eject <name>` (copy a bundled plugin
  into the project and point the config at it) and `coherence plugin check`
  (the bundled plugins' own suite run against any plugin) are the next step.
- **Language knowledge still in the core.** The spec model's check that a
  handler or a mirror is declared at a file's top level reads TypeScript's
  and Python's declaration forms itself (`declaresAtTop`, `src/spec/model.ts`);
  the vocabulary's code scan reads many languages' declarations
  (`src/lifecycle/lexicon-coverage.ts`, `src/lifecycle/check.ts`); entrance
  detection's package-script rule names the runners it follows; `scaffold
  import` and adoption read tach's configuration (`src/scaffold/boundaries.ts`,
  `src/lifecycle/adopt.ts`); the mirror reading parses with the TypeScript
  compiler; and rust-analyzer is located in `src/adapters/installed.ts`. None
  branches on a language's name, which the structural test holds, but each is
  a table a language plugin should own.
- **Bullets about a plugin's code** still live in the core's specs
  (`src/adapters/Adapters.spec.md`): a bullet's witnessed refutation is keyed
  by its component, so moving one restages its refutation.
- **One project per process.** A plugin a project's config names takes its
  language's place for the rest of the process, until another project's
  config is read; a registry run reads each project's config before running it.
