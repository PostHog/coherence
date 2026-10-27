# Plugins

A plugin is what a project adds to Coherence through its config: a language
adapter (for a language Coherence lacks, or wrapping one it has), syntax tables
for the readings, a verifier that proves bullets, and a lexicon layer. One
interface carries all of them: `@posthog/coherence/plugin`, whose types ship
in the package as `dist/plugins/api.d.ts`. This page is the author's guide.

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

## A declared language or a plugin

A language with a language server can be checked with no code at all:
declare it under `languages` in the config (`docs/config.md`, "A language
Coherence has no adapter for"), and the bundled `declared` plugin drives its
server. That route stages its refutation as an unsaved document, so it works
only for a server that reports references from documents it has open. Write a
plugin when the server does not (sourcekit-lsp answers only from its on-disk
index), when the language's own tools know more than its server (a package
manifest that says which folders are tests, a compiler that refuses a private
name), or when the readings should read the language too (its declarations,
its entrances, its mass): a declared language gets the chokepoint check
alone.

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

When Coherence loads a plugin a project names, the plugin's imports of
`@posthog/coherence/plugin` (and of `@posthog/coherence/dist/plugins/api.js`)
are answered by the Coherence that is running, whichever copy the plugin's
folder would find on its own: the project's `node_modules`, while a global
install, `npx`, another workspace's install or a checkout runs the check.
Several helpers (`languageOfFile` among them) read what the running
Coherence registered when it read the config, and a second copy has
registered nothing, so a plugin reading through one would answer nothing
without saying why. Only files inside a plugin's folder are redirected; the
project's other files resolve the package as they always did. The installed
copy still gives an editor and a typecheck the interface's types.

The bundled plugins are the fullest examples, shipped in the package under
`plugins/`.
<!-- claims: parser python, go, rust, typescript. Held by src/plugins/plugin-docs.test.ts against each plugin's manifest. -->
For a language Coherence lacks, start from `python`: it reads its
text through a tree-sitter parser and queries (below, reading through a
parser), so the readings come from one parse and no hand-written reader of
its text can disagree with another or miss a statement that spans lines.
Every bundled language plugin reads this way: `go` (a package as a module,
its qualified uses), `rust` (paths spelled in pieces), `typescript`
(default exports, and JavaScript and TSX through one grammar). They are
also the examples of an adapter over a language server: `go` drives gopls,
`rust` a server with no npm package. `declared` completes the set. Their sources import the core as `../../src/plugins/api.ts`, the
same module the package exports as `@posthog/coherence/plugin`; an ejected
copy names it the second way, and so should a plugin you write.

### plugin.json

```json
{
  "name": "sample",
  "version": "0.1.0",
  "pluginApi": 3,
  "provides": { "language": "swift" },
  "extensions": [".swift"],
  "testFolders": ["Tests"],
  "module": "./index.ts",
  "treeSitter": { "parser": "tree-sitter-swift.wasm", "queries": "swift.scm", "resolve": "swift-resolve.ts#SWIFT_RESOLVE" },
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
| `pluginApi` | The interface version it was written for. This release runs `3` and reads plugins written for `1` to `3`: a plugin written for an older one loads, and the session start names it with what changed since. Any other version is refused, naming both. Version 3 brought the parser path (`treeSitter`), imports that resolve to a module of several files, the adapter's `topLevelSymbols`, and `check.json`'s `reference` map; `plugin check` holds a plugin to the reference reading and server agrees duties from 3, and tells a plugin written for 2 they are not held. |
| `provides` | `language`: the language its adapter answers for (or `declaredLanguages: true`, the bundled declared plugin's, for the languages a config declares). A built-in name takes the built-in's place (see the swap rule). A new name needs `extensions` (or `files`), and the config's `language` must name it; the language is then read as a bundled one is, for that project: its files, test files and folders, its entrance rules, its CI steps and every syntax slot it fills. |
| `extends` | The language whose adapter it is handed to wrap, as `base` (Convex extends `typescript`). A plugin for a language of its own extends nothing. |
| `extensions` | The files a new language is written in. An extension a built-in, a declared language, or another plugin owns is refused. |
| `module` | The module, relative to the manifest. Required for an adapter, and for a verifier with no `command`. |
| `ladder` | The rungs the adapter grades on: `top`, `because`, `rungs`, and optionally `whenVacuous`, the rung a chokepoint stands on when the refutation could not see its staged uses (absent, the earned rung stands with the verdict not run). Absent, the wrapped adapter's; with none, reference-choked alone, enforced by Coherence's check. |
| `verifiers` | The via forms it proves (below). A `command` must name `{name}`; a command that is never told what to prove is refused. An optional `match` is a regular expression its output must match for an exit 0 to pass. |
| `lexicon` | Its lexicon layer, relative to the manifest. |
| `syntax` | The syntax slots it fills, each `"<module beside the manifest>#<export>"` (below). |
| `treeSitter` | The tree-sitter parser its language's text is read through, and the queries over it (below, reading through a parser). The core then derives the `source`, `declares` and `topLevel` slots and the `interfaces` slot's import answers from the parse, so the plugin fills none of those itself. |
| `files` | The files a language is written in, as a regular expression `pattern` with an optional `except` (TypeScript, as JSON writes them: `\\.(?:[cm]?[tj]sx?)$` except `\\.d\\.ts$`); `extensions` is the short form for a plain list. |
| `source` | `except`: of the language's files, those the plain source scan leaves out (TypeScript's JavaScript, Python's stubs). |
| `serverExtensions` | The extensions the language server can report a site in or resolve a name to. |
| `testFiles` | Regular expressions a test file's base name matches by the language's own naming (pytest's `^test_.*\\.py$`), beside `.test.`/`.spec.` and the test folders. |
| `testFolders` | Folder names whose files are all tests by the language's own layout, wherever they sit (SwiftPM's `Tests`), beside the config's test folders. A name matches a folder exactly, case and all. |
| `basisFiles` | Regular expressions a base name matches for the files besides source the language's answers and entrances rest on: its configuration, manifests and lockfiles (`^Cargo\\.toml$`). A kept answer and the Structure reading's fingerprint are read against them. |
| `moduleFolders` | Regular expressions a module file's path matches, the first group the folder it owns (`^(.*)/__init__\\.py$`), by which a chokepoint that is a module covers its folder's files. |
| `members` | How an exported type's body reads for the lexicon's member scan: `opens`, `closes`, `field`, each a regular expression. |
| `entrances` | The entrance detection rules (`rule`, `plural`, `detects`) and `notDetected`, what they miss: printed by the query, the page and orient. |
| `notScanned` | Why the text scans do not read the language. Present, it turns off every reading that scans the language's text, whatever slots are filled: mass, entrance detection and the Structure reading each name the language as not read, with this reason. No bundled plugin carries it, and `plugin check` fails a plugin that does: every language plugin owes the readings of its text (the reading duties below), and none is waived. It stays so that a plugin still being written says what it does not read rather than measuring as a project of no code. |
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

`root` is the project's folder as Coherence was handed it. A server may
answer in the real path instead: on macOS `/var` and `/tmp` are links into
`/private`, so a project under one comes back as `/private/var/...`. Map a
path the server reports against `realpathSync(root)` as well as `root`, or
every site falls outside the project and is dropped. (`plugin check` hands
its scratch project's real path.)

### Which files an adapter reads

The helpers `@posthog/coherence/plugin` exports for listing the project
differ in what they leave out:

| Helper | Leaves out |
|---|---|
| `walkedProjectFiles(walkBounds(root))` | What git ignores, nested checkouts, hidden, host and environment folders, and what the config's `ignore` names. |
| `walkedProjectFiles(walkBounds(root, []))` | The same, less the config's `ignore`: the bundled adapters' choice, since a reference from code the adoption leaves out still reaches the thing. |
| `keepProjectFiles(root, paths)` | Of the paths given, those git ignores and those in nested checkouts; never the config's `ignore`. |
| `projectListing(root)` | Nothing more: one listing taken once, handed to `keepProjectFiles` to answer without asking git again. |

So a fixture copy under an ignored folder is still among an adapter's files.
Resolve a `Name in <path>` hint with `hintedFiles(files, hint)`: the file at
that exact path when there is one, and every file ending with it only when
there is not, so the copy never makes the name ambiguous.

### The syntax slots

A language plugin should read its text through a parser (below, reading
through a parser), which derives the `source`, `declares` and `topLevel`
slots and the `interfaces` slot's import answers; it still fills the slots no
parse answers (`entrances`, `notice`, `lists`, `boundaries`, the
`interfaces` table's language facts). A plugin with no parser for its
language can still read by hand-written slots; no bundled plugin does.

The readings scan a language by the tables its plugin's manifest names under
`syntax`, each as `"<module>#<export>"`, loaded synchronously, once, when a
reading first asks for that slot:

| Slot | Read by | Type |
|---|---|---|
| `entrances` | entrance detection | `EntranceSyntax` |
| `interfaces` | the Structure reading | `InterfaceSyntax` |
| `kept` | the Structure reading's kept answers, when filled; else `interfaces.wildcardModules` | `(file, text) => string[]` |
| `source` | the economy and mass | `SourceSyntax` |
| `declares` | the observation's interface map | `(line) => "type" \| "value" \| "body" \| "unknown"` |
| `notice` | the session start | `(root) => string` |
| `lists` | declared mirrors, for a list in the language's files; a file of a language whose plugin fills none is read as TypeScript | `(text, name) => Literal \| undefined` |
| `topLevel` | the spec model's check that a handler, guard or mirror is declared | `(text, name) => boolean` |
| `boundaries` | `scaffold import` and adoption | `BoundarySource`: a tool's declaration file read into modules, as tach's |

An `EntranceSyntax`'s `manifestCandidates(read, exists, files)` is handed the
project's files inside the bounds as its third argument, so a language whose
manifests lie through the tree (every Cargo.toml of a workspace) reads each.
A candidate may carry a `name`, the one `scaffold entrances` proposes when
the plugin knows a better one than its symbol gives (a Rust binary by the
name its Cargo.toml gives it), so no language's layout is known in the core.

Every type is exported from `@posthog/coherence/plugin`. A slot a plugin leaves empty reads as "not read for <language>", never as
another language: a plugin that fills no `source` slot is named not read by
mass and every reading that scans text, and one that fills no `interfaces`
slot by the Structure reading. The kept answers read the `interfaces` slot's
`wildcardModules`; the `kept` slot is still read when a plugin fills it, and
`plugin check` fails a plugin whose two slots answer with one function or
two spelled alike (its "one answer each" duty).

Two manifest fields name a language's files so the core never does:
`basisFiles`, regular expressions a base name matches for the files besides
source its answers and entrances rest on (configuration, manifests,
lockfiles: `^Cargo\.toml$`), which a kept answer and the Structure reading's
fingerprint are both read against; and `moduleFolders`, regular expressions a
module file's path matches whose first group is the folder it owns
(`^(.*)/__init__\.py$`), by which a chokepoint that is a module covers its
folder's files. A plugin answers for the project whose config names it
alone: a process serving several projects asks each one's questions under
`forProject(root, ...)`. A plugin that provides one of the bundled languages answers
each field and slot it declares, and the bundled plugin answers the rest, so
an enhancement of the adapter alone keeps every reading of the language. Its
file rule is one rule: a plugin that names its files, by `files` or
`extensions`, owns them whole.

### Reading through a parser

A plugin that provides a language can hand Coherence a
[tree-sitter](https://tree-sitter.github.io/) parser for it, and queries
over its syntax tree, in place of hand-written readers. Coherence parses
each file once per reading and derives every reading of its text from the
same parse: the names a file declares at its top level, what each declares,
and every import. A statement is read whole, whatever lines it spans; text
inside a string or a comment is never read as code. Every bundled
language plugin reads this way (`plugins/python`, `plugins/go`,
`plugins/rust`, `plugins/typescript`).

```json
"treeSitter": {
  "parser": "tree-sitter-python.wasm",
  "queries": "python.scm",
  "resolve": "python-source.ts#PYTHON_RESOLVE",
  "privateName": "^_"
}
```

| Key | Meaning |
|---|---|
| `parser` | The language's parser compiled to WebAssembly, beside the manifest. Many grammars' npm packages ship one (`tree-sitter-python`, `tree-sitter-rust`, `tree-sitter-go`, `tree-sitter-java`, `tree-sitter-c`): copy the `.wasm` out of the package. For a grammar whose npm package ships none, look on the grammar's GitHub releases first: `tree-sitter-swift` attaches `tree-sitter-swift.wasm` to each release. Failing that, run `tree-sitter build --wasm` in the grammar's repository; the tree-sitter CLI compiles it with Emscripten, or with Docker or Podman when Emscripten is not installed. Coherence runs web-tree-sitter 0.27, which loads parsers built for language ABI 13 to 15. |
| `queries` | A file of tree-sitter queries, beside the manifest, whose captures are the names below. A query that does not compile against the parser, or a capture Coherence reads nothing by, is refused naming the plugin. |
| `resolve` | `"<module>#<export>"`: a `ModuleResolution`, `{ resolveModule(root, from, specifier, vanished), modulePaths(from, specifier), boundName?(specifier) }`. Where an import leads is the language's rule, not its syntax, so it stays code: `resolveModule` names the project file a specifier leads to, or, where the language's module is several files (a Go package, a SwiftPM target), the module as `{ module: "<folder>", files: ["<every file of it>"] }`, or `undefined` outside the project. `modulePaths` gives every spelling of the files a glob import names. `boundName`, optional, gives the name a whole-module import binds when it gives none (a Go package's name, from its path); absent, the specifier's last path element. |
| `privateName` | For a language that exports by name rather than by a keyword: a regular expression a name it keeps private matches (Python's `^_`, Go's `^\\P{Lu}`), read with Unicode's character classes (the `u` flag). A language that exports by keyword captures `@exported` instead. |
| `separator` | For queries that capture `@import.prefix`: the text the language joins a path's segments with (Rust's `::`), which joins each prefix to the path it prefixes. |

The captures:

| Capture | On | Means |
|---|---|---|
| `@import` | an import's whole statement, in the same match as its other captures | the statement: `coherence plugin shapes` reads from it whether the import spans lines or sits inside a block |
| `@import.from` | the module node of an import that names what it brings in | the specifier, as written (`..pkg.mod`) |
| `@import.name` | each name it brings in, one match per name | the name |
| `@import.alias` | the name it is bound to, when renamed | the alias |
| `@import.glob` | the glob (`*`) | every name the module exports |
| `@import.module` | the module of a whole-module import (`import os.path`) | the specifier |
| `@import.prefix` | a path a group spells in pieces (Rust's `use a::b::{c, d}`: the `a::b`) | joined by `separator` to each specifier inside it, so `a::b::c` is read whole |
| `@import.default` | the name a default import binds (TypeScript's `import foo from "./m"`) | the module's default export, under that name |
| `@declaration.body`, `@declaration.value`, `@declaration.type`, `@declaration.unknown` | a top-level declaration, by what it declares | the declaration; its line is its `@name`'s |
| `@name` | the declaration's name | the name |
| `@bound` | a top-level name the file binds without declaring it (Python's lowercase module variables) | the spec model's check that a handler, guard or mirror exists reads it; mass does not |
| `@exported` | anything in a declaration's match | the file exports it |
| `@default` | anything in a declaration's match, or a name alone (`export default foo`) | the file exports it, or that name, as its default |
| `@use.qualifier`, `@use.name` | a use through a whole-module import (Go's `st.Seal`) | the file uses that name of the module it binds as the qualifier, so the import joins only the file that declares it |

A capture whose name starts with an underscore (`@_alias`) is the queries'
own, for a predicate to test (`(#eq? @_alias "default")`); Coherence reads
nothing by it and never refuses it.

An import that resolves to a module joins, of the module's files, those
that declare the name it imports (read through the plugin's own parser), and
every file of the module when it imports the module whole or no file declares
the name. Return the module and let Coherence choose: a plugin that picks one
file of a module (its first, the one named after it) misses the importer's
other files, and two plugins that pick differently read one project two ways.
A plugin with a hand-written `source` slot may return a module from its
`resolveModule` the same way; the bundled Go plugin does.

Python's queries (`plugins/python/python.scm`) are the worked example:
one pattern per shape of import, then one per kind of declaration, each
anchored to the module so a nested definition is no top-level one. Go's
(`go.scm`) add qualified uses, Rust's (`rust.scm`) prefixes, TypeScript's
(`typescript.scm`) default exports and the queries' own captures.

A grammar reads the language as its release knew it. Syntax newer than the
grammar parses as an error node, and the statements around it still read;
`coherence plugin calibrate` counts what the reading and the language
server disagree on, so a project can see what its grammar misses. The
bundled Go grammar (0.25) predates Go 1.26; TypeScript's TSX grammar reads
every `.ts`, `.tsx` and `.js` file, so the one form TSX forbids, an
angle-bracket type assertion (`<string>value`; write `value as string`),
parses as an error there.

The plugin still fills the slots no parse answers: `entrances` (a
framework's rules), `notice`, `lists`, `boundaries`, and an `interfaces`
table for the language's own facts (whether its server narrows to bounds,
its default exports). A manifest that names a parser and also fills
`source`, `declares`, `topLevel` or `kept`, or an `interfaces` table that
answers `importLists` or `wildcardModules`, is refused naming the slot: a
second reader of the same text is how two readings of it come to disagree,
as Python's two hand-written readers of its imports did.

Parsing costs: a WebAssembly parser reads about 11 MB of text a second, so
Coherence keeps each file's parse in the project's `.coherence/parses`,
under the text's digest and the parser's and queries' fingerprint. The
warm-up a session start launches parses every source file once in the
background; after that a reading of the whole project parses only the files
that changed (PostHog's 20,000 Python files: 30 s for the first warm-up,
2 s for the next, and mass in 3.4 s). A hook that reads a file or two parses
it directly and never loads the store. Changing the parser or the queries
changes the fingerprint, so nothing kept under the old ones is read.
`plugin eject` copies a plugin's parser byte for byte with its queries, so
an ejected copy reads as the bundled plugin read.

Every language plugin's `check.json` maps its files and names onto one
reference project, the same in every language, under `reference`:
`files` names the file playing each role (`secrets`, declaring
`SECRET_COLUMNS` and `seal`; `rows`, declaring `Row`, in the same module as
`secrets`; `render`, using all three; `main`, using `render`), and `names`
the language's spelling of each of `SECRET_COLUMNS`, `seal`, `Row` and
`render`. The reference reading duty holds the plugin to recover each
relation over it, and `coherence plugin compare` lays every language
plugin's reading of it side by side, the bundled ones and the project's,
naming each that reads a relation another way (exit 1). A store of two files
is the point: a plugin that resolves an import of a module to one file of it
misses the other here.

`coherence plugin calibrate [--files <n>]`, run in a project, holds each
language's text reading to its language server over the first n source
files: the declarations the server reports too, each it does not (a misread,
with its file and line), and what the server reports that the reading leaves
out, counted by symbol kind. An adapter takes part by offering
`topLevelSymbols(file)`, the server's top-level symbols with their lines and
LSP kinds; the bundled adapters do, and from pluginApi 3 every adapter over
a language server must.

`coherence plugin shapes`, run in a project, counts each shape of import
its code writes (named, renamed, glob, whole module, spans lines, inside a
block) through each language's parser, beside how many of each the plugin's
check projects put to it (an import there counts only when it resolves to a
file of the check project, since only those are what the imports duty
compares; the check projects are the ones plugin check reads, found by
language), and names each shape the project writes that no check project
puts to the plugin as untested: plugin check never puts that shape to the
plugin, so a reader could miss every one and pass. Add one to the plugin's
`check.json` files and `readings.imports`. Capture each import's whole
statement as `@import` so the census can tell an import inside a block.

The parser runtime starts once per process, before any command. Code that
imports Coherence's modules and asks a reading itself, outside its CLI,
first awaits `startParsers()` (`@posthog/coherence/dist/plugins/syntax-trees.js`);
a reading asked before then is refused saying so.

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
| `references(definition)` | Every site in the project's own files (`keepProjectFiles`) that names the thing, the declaration itself left out, as a `ReferenceSite`: `file`, `line` (1-based), `character` (0-based), `symbol` (the enclosing declaration's dotted path, absent at the top level); `form`, `"import"` or `"re-export"` when the site is one; `test: true` when the adapter knows the site is test code that its path does not show (Rust's `#[cfg(test)]`, a SwiftPM test target read from the package); `unread`, why, when the adapter cannot tell whether the site reaches the thing. Test files are recognized by the check from the manifest's `testFiles` and `testFolders` and the config's test folders; report every site. |
| `visibility(definition, chokepoint?)` | Whether the language itself refuses a reference from outside the thing's module (`enforced`), whether the thing is reachable from outside it (`visible`), the `evidence` read, and the `rung` a clean chokepoint earns on it, one of the manifest's `ladder.rungs`. |
| `refute(protected, chokepoint?, exempt?, occasion?)` | The refutation, below. |
| `testFilter(via)` | A bullet's `via` as the project's test runner filters by it; most return it unchanged. |
| `forget(files?)` | Make the instrument read the disk again: the named files, or all it may have open. Resolve only once the instrument has taken the change in, since the edit hook checks again right after. |
| `close()` | Stop what the adapter started. The core closes a `base` it handed you. |
| `serverPid()` | Optional: the server's process id, so a reading can bound its memory. |
| `topLevelSymbols(file)` | Required from pluginApi 3 for an adapter over a language server: the symbols the server reports a file declaring at its top level, each `{ name, line, kind }` (one-based line, LSP SymbolKind), from `textDocument/documentSymbol`'s top level (a flat answer's symbols with a container left out). `plugin check`'s server agrees duty and `coherence plugin calibrate` hold the text readings to it. An adapter that extends a language may leave it to the one it wraps. |

### The refutation

A check that could never fail proves nothing, so every chokepoint run
refutes itself: the adapter stages uses the check must catch, and the run
reads what it saw. The project's own files are never changed: stage each use
as an unsaved document (`textDocument/didOpen`, or `didChange` over a file
the project has), and close or restore every one before `refute` returns,
whatever it returns. A server that answers only from what is on disk
(sourcekit-lsp reads its index, never an open document) cannot see an
unsaved use: stage it instead in a throwaway copy of the project outside it,
as Python's tach refutation does, ask a server over the copy, map the copy's
paths back to the project's in what you return, and remove the copy.

`occasion` says who asks: `"edit"` for the check at an edit, which a hook
waits on inside its latency budget, `"run"` for a run, `refute` and `plugin
check`. A refutation that costs seconds (a cold index of a copy) may take a
cheaper path at an edit, such as a copy and an index kept warm between edits
and refreshed with the edited files, or report `seen: false` at an edit and
leave the proof to the run, which then reads not run at the edit, never pass.
It never reports a use it did not see.

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
   Coherence that runs it what it read bundled. The copy is TypeScript run as
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
   | reference reading | the readings recover, over the check project, every relation of the reference project its `reference` map places there (below); held from pluginApi 3 |
   | references | the adapter reports every reference to the protected thing, and none else; one that reports none fails here, by name |
   | server agrees | every name the text reading finds a file declaring is a top-level symbol the language server reports for that file (the adapter's `topLevelSymbols`, required from pluginApi 3; a plugin written for 2 is told it is not held) |
   | chokepoint | the run grades the chokepoint as `check.json` expects, bypasses named, its refutation seen or refused |
   | mass | mass reads the language, counts each file, and the `source` slot's scan finds in each the names `check.json`'s `readings.declared` gives |
   | imports | the `source` slot's scan reads every import `readings.imports` names, resolved to its project file, and none else: what the economy's closure walks |
   | interfaces | with each folder `readings.interfaces` names a component, the component interface reading finds the symbols one uses of another, and none else |
   | entrances | entrance detection finds every entrance `readings.entrances` names, by file, handler and rule, and none else |
   | answers agree | where two slots answer one question of the same text, they agree over every file: a name `source` declares is one `topLevel` finds; a type declaration where `interfaces` and `declares` both say so; a name an `interfaces` import list renames is one `source` reads imported |
   | one answer each | no two of its slots answer with one function, or two spelled alike |

   Each duty passes, fails with why, or is not run with why (the
   language server is absent). The command exits 0 only when every one
   passes. The reading duties run each reading as a project's runs, through
   the core, so a slot that answers in its type and reads nothing (a
   `declarationOf` that always says `undefined`) fails every reading it
   feeds, by what each missed, and so does a slot left empty: a slot's
   success is what the readings that consume it recover. No plugin waives a
   reading; a check project that names no `readings` fails each reading duty
   as nothing to check. The bundled plugin's `check.json` for the language, as the
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
   | `readings` | What each reading of the language's text must recover over `files`, each compared exactly, each with at least one answer: `declared`, `{ "<file>": ["Name", ...] }` for every non-test file of the language; `imports`, `[{ "file", "module", "names" }]`, one per file and the project file it imports from, `"*"` for the module whole; `interfaces`, `[{ "from", "to", "symbols" }]`, component folders and the symbols of `to` that `from` uses; `entrances`, `[{ "file", "symbol", "rule" }]`, `symbol` empty when the file itself is the entrance. Write it for your small project before you write a slot: it is the slot's spec. |
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
  a guard in a Go file; its entrances (a `main` package's `main`, an HTTP
  handler it registers); and its imports through its parser: a package is
  one module of its files, and a use through the package (`st.Seal`) joins
  the file that declares the name.
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
