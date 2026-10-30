# Bundled plugins

The plugins that ship inside `@posthog/coherence`. The core names no language:
everything it knows of TypeScript, Python and Rust, and of the languages a
config declares, is the plugin's here that provides it.

<!-- generated: default plugins -->
| Plugin | Provides |
|---|---|
| `typescript` | TypeScript and JavaScript, through typescript-language-server |
| `python` | Python, through Pyright, with tach's module boundaries where a project draws them |
| `rust` | Rust, through rust-analyzer |
| `declared` | Any language with a language server, through the server the config declares for it under `languages`: the chokepoint check alone |
<!-- /generated -->

Bundled but opt-in: a project runs these only by naming them,
`"plugins": { "<name>": "bundled" }`.

<!-- generated: opt-in plugins -->
| Plugin | Adds |
|---|---|
| `convex` | Convex, over TypeScript: a Convex function reached through the generated API as a reference, and a deployment's functions, HTTP routes and crons as entrances |
| `go` | Go, through gopls |
| `quint` | Quint, a verifier: `via: [quint]` and `[quint run]` prove a property of a Quint model |
<!-- /generated -->

`defaults.json` lists the plugins every project runs without naming them, and
the language a config that names none reads. A project's config may name a
plugin that provides one of these languages, which takes the bundled one's
place:

```json
"plugins": { "<name>": "./path/to/its/folder" }
```

Each lives in its own folder, `plugins/<name>/plugin.json` beside its modules
and its `check.json`, the project `coherence plugin check` holds it to. The
modules import Coherence only through `src/plugins/api.ts`, which the package
exports as `@posthog/coherence/plugin`, so `coherence plugin eject <name>`
can copy one into a project unchanged but for that import. A plugin written
outside this folder, read from these as an example, imports
`@posthog/coherence/plugin` instead.
The published package carries them compiled to JavaScript under
`dist/bundled`, since Node strips no types under node_modules. The interface,
the roles a plugin may take and the swap rule are in
[docs/plugins.md](../docs/plugins.md).
