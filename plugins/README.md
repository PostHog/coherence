# Bundled plugins

The plugins that ship inside `@posthog/coherence`. A project runs one by naming
it in its `coherence.config.json`:

```json
"plugins": { "<name>": "bundled" }
```

Each lives in its own folder here, `plugins/<name>/plugin.json` beside its
module. The interface, the roles a plugin may take and the swap rule are in
[docs/plugins.md](../docs/plugins.md). TypeScript, Python, Rust and the generic
language-server plugin move here next; for now the folder holds none, and the
core's own adapters answer for those languages.
