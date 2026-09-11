# Scope

Scope now ships with Coherence. From a project root, run `coherence scope --serve`
for live read-only views or `coherence scope` for `scope.json` and `_scope.html`.
From this source checkout, build once with `npm run build`, then run
`node src/cli.ts scope --serve`.

The preview's separate renderer, panels, snapshots and dependency tree were retired.
These `build`, `snapshot` and `serve` scripts forward to the same CLI and retain
`--project /path/to/project` for existing development workflows.

See [the declarative configuration guide](../../docs/scope.md) for asset types,
spec-content coverage, view configuration, live behavior and evidence limits.
