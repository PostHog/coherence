# Project, inspect, enrich, repeat

`scripts/structure-blockout/project.mjs` is a local prototype instrument for an
agent's visual authoring loop. It builds the same catalog, Structure model and
React Flow picture as the interactive study, then writes a PNG and a compact JSON
reading. It does not run verification, start a server or require the full browser
regression suite. This is not yet a packaged Coherence CLI command or Scope MCP.

From the `coherence-scope-local` checkout:

```sh
node scripts/structure-blockout/project.mjs \
  --project /Users/daniloc/Documents/Dev/mnemion-scope-study/mnemion-js \
  --name mnemion-structure \
  --presentation docs/prototypes/mnemion-structure/presentation.json
```

The command prints absolute image and JSON paths, capture time, elapsed time,
declaration gaps and cropped object IDs. Open the image with the agent's image
viewer, then use the JSON to identify the pictured subjects and declarations.

For another view of the already captured project:

```sh
node scripts/structure-blockout/project.mjs \
  --name mnemion-structure --capture-only --layer all

node scripts/structure-blockout/project.mjs \
  --name mnemion-structure --capture-only --unfurl Hive --frame local
```

`--layer` accepts `opening`, `all` or `guarantees`. `--unfurl` accepts a unique
component label or canonical component ID. It preserves the camera unless
`--frame local` is supplied. `--capture-only` deliberately reuses the snapshot;
after editing specs, rerun the first command to capture fresh inputs. Omit the
project/name/presentation flags to project Coherence itself.

The image is 1600×1100. The reading includes all modeled components, their purpose,
ranking inputs and guarantee verdicts; all declared entrances and relationships
with rationale and declaration IDs; and the actual camera, selection, expansion,
visible relationship IDs, and screen bounds of rendered objects. Each object says
whether it intersects the viewport and whether it is fully visible. A local view
therefore cannot silently stand in for the whole project. The capture-only
all-handoffs run measured 1.46 seconds on this machine; this is an observation,
not a performance guarantee.

Browser and routing errors fail the command. When the picture can be inspected,
the image and reading are retained even if an error is reported. Readings name
known declaration gaps, not every missing architectural concept: omitted component
specs still require source review. A screenshot is material for judgment, not an
automatic readability verdict. Existing guarantee verdicts remain dated source
evidence; this command does not establish new test outcomes.

## Enriching a project

1. Project its existing specs first. Preserve that baseline and inventory which
   components, purpose, entrances, handoffs and guarantee consumers are declared.
2. Read its documentation and the implementation at the relevant boundaries.
   Look for responsibilities and concrete transfers: what enters, who owns the
   data, which promise another component needs, and where output leaves.
3. Add source-supported architecture declarations and explicit guarantee reliance
   to the owning specs. Missing component specs are an authoring task too. Keep
   authored relationship meaning separate from source import observations. Short
   terminal labels belong in presentation configuration.
4. Check guarantee-link integrity, rebuild the picture, and inspect overview,
   relationship and local-promise views. Check whether a reader can explain the
   project's purpose, entry paths, central responsibilities and guarantees.
5. Treat unreadable routing or missing disclosure as renderer defects; treat
   absent or misleading architectural meaning as spec defects. Keep both kinds
   of changes reviewable. A new architectural declaration is not new verification
   evidence.

The Mnemion [study](../mnemion-structure/RESULTS.md) exercises this loop with an
untouched baseline and a separately captured enrichment patch.
