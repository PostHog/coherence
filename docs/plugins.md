# Plugins

A plugin is what a project adds to Coherence through its config: a language
adapter (for a language Coherence lacks, or wrapping one it has), syntax tables
for the readings, a verifier that proves bullets, and a lexicon layer. One
interface and one registry carry all of them (`src/plugins`). This page is the
author's guide.

Plugins ship two ways:

- **Bundled** inside `@posthog/coherence`, under `plugins/<name>`, run by
  naming them in the config. TypeScript, Python, Rust and the generic
  language-server adapter move there next; Convex and Quint arrive the same way.
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

A plugin's module is code, and it runs with the project's privileges: whatever
the user running Coherence may read, write or start, it may too. It runs in
`coherence run` (so in CI, through the generated workflow), in `refute`, and in
the warm adapter server that the hooks talk to. It never runs inside a hook's
own process: a hook reads only the manifest and the lexicon layer, which are
data. Run a plugin you would run as a dev dependency, and review a change to
one as you would a change to the project's own code. A bundled plugin ships
inside `@posthog/coherence` and is reviewed with it.

The warm server's code fingerprint holds every plugin folder the project runs,
so an edited plugin replaces the server as an edited Coherence does, and a
module that fails to load is tried again once it is fixed.

A project without a `plugins` key reads nothing of any plugin: no manifest, no
lexicon layer, no bundled folder. It does exactly the work it did before
plugins existed.

## The folder

```
sample/
  plugin.json     the manifest, read as data
  index.ts        the module, imported only where its code runs
  lexicon.json    the lexicon layer (optional)
```

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

The manifest is data so that a hook that only needs to know what a plugin
provides (the vocabulary, the spec check, which language a file is written in)
reads one small file and runs no plugin code. The module loads in the warm
adapter server and in a run, when a check first asks its adapter or verifier.

### The module

```ts
import type { PluginModule } from "@posthog/coherence/plugin";

const plugin: PluginModule = {
  adapter: ({ root, language, base }) => /* a LanguageAdapter */,
  verify: async ({ root, form, name, timeoutMs }) => ({ verdict: "pass", reason: "..." }),
  syntax: { entrances, interfaces, source, members, lists },
};
export default plugin;
```

`adapter` returns a `LanguageAdapter` (`src/adapters/adapter.ts`). When the
manifest extends a language, `base` is that language's adapter: delegate what
you do not change. The core closes `base`; your adapter closes only what it
started. A module that fails to load makes the adapter unready with the reason,
so every chokepoint it was asked about reads not run, never a pass.

`syntax` holds one optional slot per table the readings scan by. A reading
reads a language a plugin brings only through these. Until the readings are
routed through them (the next step), a language a plugin brings is named not
read by every reading, never read as another language.

## Roles

### A language adapter: the swap rule

- A plugin that **provides** a language takes the core's place for it. With
  `extends` naming the same language, it is handed the core's own adapter.
  This is how an ejected, enhanced built-in replaces ours.
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

What the interface does not carry yet, for step 2 to start from:

- **Ladders are static.** `ladder` is JSON in the manifest, but Python's
  checker rung depends on the project's pyright configuration, read at check
  time. The ladder needs a way to be answered by the module (as the adapter's
  own `ladder` already is) without loading code in a hook.
- **testFilter before the module loads.** `testFilter` is synchronous; a
  plugin adapter answers with the wrapped adapter's, or the name unchanged,
  until a question has loaded its module (src/plugins/adapter.ts).
- **Built-in extension rules.** TypeScript's rule (`[cm]?[tj]sx?`, never
  `.d.ts`) is not expressible as a list of manifest `extensions`.
- **Bundled plugins in TypeScript.** Node strips no types under node_modules,
  so a bundled `.ts` plugin cannot load from an installed package: the build
  must emit JavaScript for `plugins/`, as it does for `src/`.
- **Syntax tables as code.** The tables are module code, and a reading that
  runs in a hook would load plugin code there, against the manifest-as-data
  rule (d-483262db). They need a data form, or a reading that runs outside the
  hook process.
- **Slots not yet defined.** Checker boundaries (tach), CI install steps, where
  a language server is found, test-path rules, ignores, and well-known names.
