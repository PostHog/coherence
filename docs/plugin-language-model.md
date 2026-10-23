# One model of a language per plugin (draft)

Draft for plugin interface 3. Nothing here is built yet.

## Why

A language plugin today fills up to nine syntax slots, and each slot asks
its own question of the language. Several of them ask the same question in
different shapes, and the core supplies a slot's empty answer by itself, so a
plugin that fills two slots of nine loads, passes `plugin check`, and reads
almost nothing. That is how the Rust plugin shipped (every text slot empty,
`notScanned` set), how the blind session's Swift plugin came out (two slots,
imports that never resolve), and how Go still stands.

The slots are locally sensible and mutually redundant: the decoherence
Maevyn's essay describes, built into the interface itself. The evidence, from
the bundled plugins:

- **What a line declares** is answered five times: `source.declarationOf`,
  `declares`, `topLevel`, `interfaces.isTypeDeclaration` and
  `entrances.binds`. Before 185756c the Rust plugin held four item patterns
  for these.
- **The modules a file glob-imports** is answered twice, by `kept` and
  `interfaces.wildcardModules`, and in TypeScript and Rust the two are the
  same function in all three languages that fill them.
- **An empty slot reads as nothing, silently.** `NO_SOURCE` and
  `NO_INTERFACES` in the core stand in for a slot the plugin left empty. The
  only trace is a "not read" line in mass, which nothing counts.
- **Language knowledge leaked into the core.** Until 185756c,
  `src/scaffold/entrances.ts` knew a Rust crate's folder layout to name a
  binary.
- **An import that names a whole module has no shape.** `resolveModule`
  returns one file, so a Swift `import Store` (or a Go package import)
  cannot be said at all, and the plugin's correct answer joins nothing.

## The model

A language plugin supplies one model of its language, and the readings derive
what they ask from it:

```ts
interface LanguageModel {
  /** Every item the text declares: name, one-based line, kind, whether its file exports it, whether it is at the top level. */
  items(text: string, file: string): Item[];
  /** Every import: the name brought in (undefined for the whole module, "*" for a glob), its alias, and the specifier. */
  imports(text: string, file: string): Import[];
  /** Where a specifier leads from a file: one file, a module of several files, or undefined outside the project. */
  resolve(root: string, from: string, specifier: string, vanished: ReadonlySet<string>): string | { module: string; files: string[] } | undefined;
  /** The text with comments blanked, every offset kept; with `literals` true, string contents blanked too. */
  code(text: string, literals?: boolean): string;
  /** The character ranges that compile only for tests. */
  tests?(text: string): [number, number][];
}

interface Item {
  name: string;
  line: number;
  kind: "type" | "value" | "body" | "module" | "unknown";
  exported: boolean;
  top: boolean;
  /** The module's default export (TypeScript's `export default`). */
  default?: true;
}
```

What each reading reads from it:

| Today | Derived from |
|---|---|
| `source.declarationOf` | `items`, `top` |
| `source.importsOf` | `imports` |
| `source.resolveModule` | `resolve` (a module counts every file in it) |
| `declares` | `items`, `kind` |
| `topLevel` | `items`, `top` and `name` |
| `interfaces.isTypeDeclaration`, `isDefaultExport`, `defaultNames` | `items`, `kind` and `default` |
| `interfaces.importLists` | `imports`, aliases |
| `interfaces.wildcardModules`, `kept` | `imports` named `*`, through `resolve` |
| `entrances.binds` | `items` and `imports` |
| entrance scans skipping comments and tests | `code` and `tests` |

These stay their own slots, since each is a feature of a tool or framework
rather than a reading of the language: entrance rules (`candidates`,
`manifestCandidates`), `notice`, `lists` and `boundaries`.

## Every plugin is held to one abstract spec

A plugin is a component, and Coherence holds every one to a spec, so no
plugin is ever without one. Because the shape of a plugin is known, the spec
is written once, in Coherence: an abstract spec, `src/plugins/Plugin.spec.md`,
whose bullets are what any plugin owes for each role it provides and each
reading its model gives. Every loaded plugin, bundled or by path, is held to
every bullet that applies to its shape, whether or not its author wrote a
line.

| The plugin provides | The abstract bullet it is held to | Proved by |
|---|---|---|
| a language (`extensions`, file rule) | its files are read and no others | `[plugin files]`: `check.json` `language` |
| an adapter | every reference to a protected thing is found, and a chokepoint's bypasses named | `[plugin references]`, `[plugin chokepoint]` |
| `items` | the items a file declares, top level or not, exported or not | `[plugin items]`: `check.json` `declarations` |
| `imports` and `resolve` | an import joins the file, or the module, it names | `[plugin imports]`: `check.json` `imports` (new) |
| entrance rules | the sample project's entrances are found, by name | `[plugin entrances]`: `check.json` `entrances` (new) |
| `boundaries` | the tool's declared boundaries are read | `[plugin boundaries]`: `check.json` `boundaries` (new) |
| a verifier form | the form passes a true name and fails a false one | `[plugin <form>]`: both, from `check.json` |
| a lexicon layer | its terms clash with none of Coherence's | `[plugin lexicon]` |

A plugin language's readings are all owed: a language plugin that gives no
`items` is held to the `items` bullet and fails it, rather than being excused
from it.

- **The concrete spec only overrides.** A plugin's own `<Name>.spec.md`,
  beside its `plugin.json`, is optional. It names abstract bullets the plugin
  does not hold, each with `because:` (Convex is no language model and gives
  no `items`; Quint's verifier is its only role), may narrow one (Go resolves
  a package import as a module, never a file), and adds the plugin's own
  bullets. An override without `because:` is a spec problem, and an overridden
  reading is said at session start and counted in mass's "not read" line as a
  gap, as an undeclared entrance is. Absent the file, nothing is overridden:
  the default is to be held to everything.
- **The proof is the plugin's own sample project.** `[plugin ...]` is a via
  form Coherence itself proves (the verifier role), graded over each plugin's
  `check.json` as `plugin check` grades its duties today, so a plugin needs no
  test runner of its own. The abstract bullets grade once per plugin in the
  run of whichever project holds it: Coherence's run for the bundled plugins,
  the project's for a plugin by path. A plugin whose `check.json` lacks what a
  bullet reads fails that bullet by name.
- **Each abstract bullet is refuted once, for every plugin.** The shape that
  says what a bullet must be also says how to break it: swap the reading for
  its empty answer (no items, no imports, an adapter that reports nothing)
  and the bullet must go red. It is refuted against the abstract spec, so no
  plugin author witnesses a refutation, and `plugin check` repeats the swap
  on each plugin: a bullet a plugin passes with its reading emptied proves
  nothing for it, and fails. This is the check that a plugin which "does
  almost nothing" fails, however many slots it fills.
- **`plugin check` is the abstract spec's run.** Its duties today are the
  first four abstract bullets; it becomes the table of every bullet: held and
  proven, overridden with why, or failed.
- **Nothing is read silently.** `NO_SOURCE` and `NO_INTERFACES` go; `notScanned` becomes an override of
  every reading.
- **The core names no language.** A structural test fails on a language's
  layout word (`Cargo.toml`, `src/bin`, `__init__.py`, `go.mod`...) in a core
  module outside the language table, so knowledge of one language stays in
  its plugin.

## Moving the plugins

Plugin interface 3, with interface 2 still read: a v2 plugin's slots load
as they do today, and the session start names what changed. Each bundled
plugin then moves in its own commit, with the same answers before and after
on a real project:

0. The abstract spec first, on interface 2: it does not wait for the model.
   Its bullets are keyed to today's slots; the bundled plugins' overrides are
   written (Rust's and Go's empty text slots among them, which is the point),
   and the bullets about one plugin in `src/plugins/Plugins.spec.md` move
   into that plugin's concrete spec. Third-party plugins are held from the
   release after, with a session-start notice in between.
1. Rust first: `rust-source.ts` is already the model (`itemOf`,
   `manifestOf`, `binaryOf`, `codeOnly`, `testRanges`).
2. TypeScript and Python, which fill every slot today; the derived answers
   must match theirs on Coherence itself and on PostHog.
3. Go, which gains `items` from `go-top-level.ts` and package imports
   through the module form of `resolve`.
4. Convex and Quint, which are not language models and override the readings
   they do not give, with why.
5. The Swift plugin, from the blind session, as the test of the module form.

## Open questions

- Whether `items` is read per file and cached (the hooks read one file at a
  time), or kept per line as `declarationOf` is, for the 3 s latency budget.
- Whether a module import should spread its reach across every file of the
  module, or count as one edge to the module.
