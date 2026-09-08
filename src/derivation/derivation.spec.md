# Source derivation

Reads source and specs into the shared graph of components, symbols, claims and imports.

Language packs and adapters supply syntax knowledge. This assembly owns the walk and graph construction, not the verdicts later computed from that graph.

## invariants

- spec containment follows declared ancestry without inventing dependencies

- harness source remains searchable text rather than silently becoming binary
- a declared language resolves to a real adapter or refuses, never a silent fallback
- a built-in language pack is data: queries, patterns, and named strategies, never code

## refutations

- harness source remains searchable text rather than silently becoming binary: two new render/validation regexes carried literal NUL bytes, and `rg` classified `src/consequence.ts` as binary instead of returning navigable source matches. The ranges now use escaped source notation and the focused guard enumerates every live TypeScript source, so the same byte turns the claim red rather than degrading repository navigation silently.

## works when

- boundary "spec containment follows declared ancestry without inventing dependencies" at buildGraph via guard "spec containment — deepest declared ancestor is canonical parent, never an invented import"

- derive.ts imports ./walk.ts
- boundary "harness source remains searchable text rather than silently becoming binary" at sourceTextIsNavigable via guard "source text — every live TypeScript source remains NUL-free and searchable"
- boundary "a declared language resolves to a real adapter or refuses, never a silent fallback" at resolveLanguageAdapter via guard "language adapter — a project path loads and shapes the graph; unknown names refuse, never fall back"
- boundary "a built-in language pack is data: queries, patterns, and named strategies, never code" at builtinLanguagePacks via guard "language packs — every built-in pack is function-free data across all five instrument tables"

## addresses

- {"claim":"g-5f53591b84255486c8670c4aa3ebda33698b3886ceb51e44151e983e674dbe6d","subject":"src/derivation/derive.ts#buildGraph","obligation":"guarantee:G-PROJECTION","assessment":"t-62eb19624910e1e45da79565e119ca0e8cd6df2f1c6910aa7533a22f133bbe28","because":"The containment oracle checks deepest declared ownership without fabricating dependency edges. This addresses ownership preservation in the graph projection, not completeness of every adapter or source construct."}

## why

**spec containment follows declared ancestry without inventing dependencies.** Repository and subsystem containment explain ownership even where no source import exists. Treating that relationship as an import fabricates reliance; omitting it turns the enclosing project into an unexplained island. The same deepest-spec rule that assigns file ownership supplies component ancestry.

**harness source remains searchable text rather than silently becoming binary.** Agent
navigation depends on ordinary repository search seeing every source file. A single literal
zero byte can make common tools classify an otherwise textual module as binary and omit its
matches without a syntax or type error. Keeping control ranges escaped in source preserves
runtime meaning while making disappearance from the reading surface a loud regression.

**a declared language resolves to a real adapter or refuses, never a silent fallback.**
The graph is the one derivation everything downstream consumes, and the adapter decides
what that derivation can see. The old `?? typescript` fallback meant a typo'd language
name walked the wrong grammar and reported on the garbage with full confidence — the
same walking-a-different-tree failure the config loader refuses for, one seam later. So
an unknown bare name now refuses with the live built-in list, and the same seam is where
a project brings its own language: a `./`-relative module exporting the LanguageAdapter
shape, validated field-by-field so the refusal names the line that needs fixing.
Importing project code is not new trust — the atlas already declares at the loadConfig
crossing that running the harness in a tree executes that tree's config. What a custom
adapter buys is the graph tier: symbols, import edges, prose, claims over them. The
per-language instrument arms (surface counting, oracle analysis, redundancy, sinks,
batch formats) remain harness contributions, and the documentation says so, because an
adapter author who is not told the boundary believes they have the full field when they
have half.

**a built-in language pack is data: queries, patterns, and named strategies, never
code.** The declarative baseline is what keeps "add a language" a table-row act instead
of an expert contribution — and it is a rule that erodes one convenient function at a
time unless something refuses. So the packs are inspectable values aggregated in one
place, and a guard sweeps them for function-valued fields by path: the hand-rolled
scanner class is unrepresentable at the seam, not merely discouraged. The rule's edge
is honest about what a pack may name — strategies from a closed, mechanism-owned set
("jsdoc", "docstring", "cooked-string") — because some knowledge is genuinely
procedural; naming it keeps the procedure written once where every language can reach
it. Project adapter modules remain code territory by definition: purity governs what
ships built in, where a single spelling is the entire point.
