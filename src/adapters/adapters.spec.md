# Source adapters

Translate language syntax and platform configuration into the common graph vocabulary consumed by the harness core.

Adapters may know a language or platform. The derivation and verification layers should
not acquire those details directly.

## invariants

- committed platform capabilities survive optional deployment-config toggles
- a grammar-backed adapter derives the graph through the same language seam
- a parse's heap is returned before the next file

## refutations

- committed platform capabilities survive optional deployment-config toggles: Mnemion intentionally ships its `DOCUMENTS` R2 stanza commented so clean deploys need no R2 account, while three committed `Env` interfaces declare `DOCUMENTS?: R2Bucket`. A graph made with a locally enabled stanza gained `i:DOCUMENTS` and its bind edges; the same commit in a clean clone lost them and failed docs freshness. The Cloudflare adapter now unions direct typed `Env` capabilities from the already-filtered code population with wrangler declarations, deduplicates agreement, and refuses type conflicts; a generated local declaration cannot re-enter after the project ignores it.
- committed platform capabilities survive optional deployment-config toggles: after 0.36.3 stabilized Mnemion's nodes and edges, `bindings.vars.WORKER_HOST` still embedded the working-tree Wrangler value verbatim (`your-worker.workers.dev` in Git, the real host on the deploy machine), so docs freshness still failed on one line. Reproduced against current Mnemion main: changing only that value changed the old graph. `Bindings.vars` can now represent only the literal marker `declared`; pristine and real-host variants produce the same normalized graph hash while the `WORKER_HOST` name remains visible.
- a parse's heap is returned before the next file: shipped 0.34.0 with no `tree.delete()` at any parse site — an adopter's configless `verify` from a home directory aborted the wasm runtime mid-walk (`RuntimeError: Aborted()` in Parser.parse). Reproduced at exactly parse #638 of an 80KB file; the identical loop with delete runs unbounded. The oracle-gate agent had already observed the failure mode in its harness and it was read as gate plumbing rather than a shipped hazard. Fixed by dissolution: every parse routes through `withTree`, which frees in a finally, so the leak is unrepresentable — and the guard is calibrated just past the measured cliff.

## works when

- tree-sitter.ts exists at this node
- cloudflare.ts exists at this node
- boundary "committed platform capabilities survive optional deployment-config toggles" at cloudflareBindings via guard "Cloudflare bindings — committed Env capability is stable across optional wrangler toggles"
- boundary "a grammar-backed adapter derives the graph through the same language seam" at makeTreeSitterAdapter via guard "tree-sitter — a grammar-backed adapter derives ruby symbols, imports, and prose through the same seam"
- boundary "a parse's heap is returned before the next file" at withTree via guard "wasm heap — parses past the measured abort cliff survive because every tree is freed"

## why

**a grammar-backed adapter derives the graph through the same language seam.** Language and platform knowledge changes on a different cadence from graph semantics.
Keeping it at this seam prevents a new parser or deployment target from multiplying
conditionals through every renderer and verifier.

**a grammar-backed adapter derives the graph through the same language seam.** One parsing foundation lives here now. The regex adapters that preceded it were
corpus-diffed to parity and deleted — two implementations of one outcome are two
spellings of a domain, and the languages themselves became data: a grammar binary
plus a spec of capture queries per language, with the prose-extraction logic the
regex era proved carried over verbatim.

**committed platform capabilities survive optional deployment-config toggles.** The graph
describes the capability surface authored code can address, not only what one machine has
enabled for its next deploy. For Cloudflare stores, a direct `Env` property with a known
binding type and a wrangler stanza are two observations of the same binding domain: the
adapter unions them, collapses agreement, and refuses disagreement. Source inference uses
the graph's already-filtered file population, so a generated machine-local environment
declaration cannot become a hidden second walk. Runtime-variable names are retained as
declarations, but their deployment values are unrepresentable in `Bindings` and never
enter generated artifacts. An optional binding or machine-specific value may therefore
change without silently changing the architecture documented for the same source tree.

**a grammar-backed adapter derives the graph through the same language seam.** The
regex adapters scale in expert code — the python push measured ~900 hand-built lines
across five instrument arms — while a grammar plus capture queries scales in data:
modern tree-sitter grammar packages ship a prebuilt wasm, `web-tree-sitter` runs it
without a native toolchain, and the language-specific knowledge shrinks to patterns a
contributor can write without touching verdict logic. The factory is async once (wasm
load) and the adapter it returns is synchronous, so the seam is unchanged and a project
module reaches it with one top-level await. The corpus diff that justified the phase
also bounded it: on this repository's own sixty-three TypeScript files the regex grade
missed zero symbols a real parse found, so the graph tier was not where parse fidelity
was owed. The built-ins then CONVERGED onto the grammar path anyway — not for fidelity
but because two implementations of one outcome are two spellings of a domain, the
redundancy class this harness ranks in other people's code. The regex adapters were
corpus-diffed to parity (every delta an enumerated regex mistake), their prose logic
ported verbatim, and then deleted; their grammars ship vendored with provenance. The
instrument arms remain hand-built until a later phase ports them to query packs.

**a parse's heap is returned before the next file.** web-tree-sitter trees hold wasm
heap only an explicit delete returns, and the emscripten heap is fixed — so a leak is
invisible on a small repository and fatal on a large one, the worst observability
profile a defect can have. The measured incident is the refutation above. The repair is
the ladder's top rung, not discipline: `withTree` owns the tree's whole lifetime, every
call site takes it, node captures die inside it (the one lazy consumer was made eager
rather than allowed to touch a freed node), and forgetting to free is unrepresentable.
