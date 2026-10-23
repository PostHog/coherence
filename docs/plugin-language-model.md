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

## No silent reading

- **Every reading is read or declined.** `plugin.json` gains `declines`:
  `{ "<reading>": "<why>" }`. A model method a plugin leaves out is refused at
  load unless its reading is declined, and a declined reading is said at
  session start and counted in mass's "not read" line as a gap, as an
  undeclared entrance is. `NO_SOURCE` and `NO_INTERFACES` go; `notScanned`
  becomes a decline of every reading.
- **The sample project proves each reading.** `check.json` gains
  expectations: the items a file declares, the files an import resolves to,
  the entrances detected, the files and reach mass reports. `plugin check`
  grades each and prints a table: read and proven, read and unproven, or
  declined with why. An unproven reading fails the check.
- **The bundled plugins decline nothing without a spec bullet.** A
  structural test fails on a bundled plugin's decline that no bullet of
  `src/plugins/Plugins.spec.md` names with its reason.
- **The core names no language.** A structural test fails on a language's
  layout word (`Cargo.toml`, `src/bin`, `__init__.py`, `go.mod`...) in a core
  module outside the language table, so knowledge of one language stays in
  its plugin.

## Moving the plugins

Plugin interface 3, with interface 2 still read: a v2 plugin's slots load
as they do today, and the session start names what changed. Each bundled
plugin then moves in its own commit, with the same answers before and after
on a real project:

1. Rust first: `rust-source.ts` is already the model (`itemOf`,
   `manifestOf`, `binaryOf`, `codeOnly`, `testRanges`).
2. TypeScript and Python, which fill every slot today; the derived answers
   must match theirs on Coherence itself and on PostHog.
3. Go, which gains `items` from `go-top-level.ts` and package imports
   through the module form of `resolve`.
4. Convex and Quint, which are not language models and decline the readings
   they do not give, with why.
5. The Swift plugin, from the blind session, as the test of the module form.

## Open questions

- Whether `items` is read per file and cached (the hooks read one file at a
  time), or kept per line as `declarationOf` is, for the 3 s latency budget.
- Whether a module import should spread its reach across every file of the
  module, or count as one edge to the module.
