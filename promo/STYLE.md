# Promo style

Locked 2026-09-23 on scene 9 (`scenes/09-journal.src.html`). That scene is the reference build: when this page and the scene disagree, the scene wins, and this page gets updated.

## The conceit

- **Every map has a real territory underneath.** Beneath the product's surfaces lies the software itself: a flat ground of code cells and faint routes, mostly lost in fog. Coherence's views are maps of that ground.
- **Coherence is a reducer.** It takes a field of software cells and pushes it toward its floor of irreducible complexity. Fog clears where Coherence has been.
- **The finale:** the camera pulls out over dozens, then hundreds, then thousands of maps. Each clears its reds, until the frame is one clean mint surface.

## Tokens

The same four colours carry the same meanings everywhere: cells, selections, records, borders, reticles.

| Token | Hex | Meaning |
|---|---|---|
| grey | `#5E6A73` | unexamined: the bulk of any transcript or codebase |
| orange | `#FF9A3C` | in question: considered, not yet judged |
| red | `#FF4B4B` | broken: a bad call, a bypass, a structural defect |
| mint | `#54E8B0` | coherent: settled, enforced, verified; the final surface |

Supporting colours:

| Role | Hex |
|---|---|
| ground | `#07090C` |
| fog | `#0A0F13` |
| ink | `#E6ECEF` |
| muted | `#8B98A2` |
| code / tool output | `#46596A` |
| tool chrome | `#7E93A3` |
| lit orange | `#FFB866` |
| lit mint | `#9BFFD6` |

Every state change is a colour change along one path: grey or orange → mint, or orange → red. Nothing starts red: the bad call begins orange like every other call, and **goes** red when it is judged.

## Type and symbols

- **Instrument Sans** for statements and record titles.
- **JetBrains Mono** for labels, counters, ids and tool calls.
- **Symbols:** Tabler Icons (MIT), drawn as strokes at 1.5–2.6 depending on size.
  - The decision glyph is `arrow-fork`.
  - Tool calls: `file-text` Read, `search` Grep, `terminal-2` Bash, `pencil` Edit, `file-plus` Write, `world` WebFetch.
  - Other concepts: `flask` conjecture, `bug` defect, `alert-triangle` escalation, `clipboard-check` work order, `lock-access` chokepoint, `door-enter` entrance, `circle-check` run, `message-dots` transcript.

## Light

- **The bloom pass** (UnrealBloom, strength about 0.8, radius 0.55, threshold 0.18) is the look. Bright shapes glow; the dark ground doesn't.
- **Text on a bright shape is drawn after the bloom, in an overlay pass.** The shape glows with everything else, but its glyph and label stay crisp. Decision chips are the reference.
- **Fog** is exponential (density about 0.04, thinning to about 0.028 as Coherence acts). It is layered with drifting haze sheets that clear near whatever Coherence is working on.

## Objects

- **Cells:** short bars on a 0.19 row pitch, standing in for tokens. They are how the video depicts software at every scale. Transcripts, code on the territory, and anything Coherence reduces are all made of cells.
- **Transcript:**
  - Prose rows, a short last row, and a blank line between turns.
  - Tool calls: a steel chip (glyph, name, argument) with 2–4 indented rows of code-coloured output hanging from a thin rule.
  - It types in at the bottom and scrolls up into the fog, and never stops.
- **Selection:**
  - A band at about 11% opacity, with a solid bar down its left edge, grows over the selected rows.
  - The selected cells stay where they are and light up.
  - A copy of each lit cell travels on a curve to wherever the selection is going.
- **Records** (decisions, and later other journal kinds):
  - A dark card with a 3 px border in its state colour.
  - A label chip grows out of the top-left corner of the border.
  - Records materialize where their incoming copies land. There are no placeholder slots.
- **Inspection:**
  - A reticle (corner brackets, centre ticks, an `INSPECT` label) locks onto a record with a small settle.
  - A sweep line crosses the record, and the verdict colour fills in behind the sweep.
  - A failing sweep stalls, shudders, and the record snaps red, with the reticle turning red too.
- **Hooks:** Coherence reaches an agent only through its harness hooks, and every scene shows them the same way.
  - A mint pulse sweeps the agent's panel and its border flashes.
  - A mint chip with the `plug-connected` glyph names the event: `hook · SubagentStart`, `PostToolUse`, `SubagentStop`.
  - What the hook carries moves visibly: at start, one cell per lexicon term streams into the agent's context.
  - The first appearance carries the on-screen line “Delivered through your agent's own hooks”.
  - Stay true to what each hook does. Starts deliver the lexicon and orientation. Tool boundaries deliver the peer feed and, after edits, the chokepoint re-check. Stops run regulate, and SubagentStop refuses to let a subagent stop while findings remain. Coherence never detects a sense overload by itself: the catch is the agent's, made possible by what the hook delivered.
- **Threads:** thin red lines that connect a record to where its consequence lives, typically down through the fog to a cell on the territory.

## Camera

- The camera sits roughly square to the layout it is showing: things are laid out flat, in depth, and the camera moves through that space.
- Moves are slow eased dollies with a faint constant drift, never handheld.
- To make a point, it pushes in close enough to read a record.
- To show consequence, it pulls back and tilts down to the territory.

## Build

- **Stack:** three.js r128 from jsdelivr, with the `examples/js` postprocessing scripts for bloom. Every object is a canvas-drawn texture on a plane, and cells are instanced meshes.
- **Files:** each scene is `scenes/NN-name.src.html`. `node promo/scenes/build.mjs` writes the published `NN-name.html`, inlining `scenes/common.js` (renderer, bloom, fog, territory) at `/*COMMON*/` and the Tabler path data from `scenes/icons.json` at `/*ICONS*/`, because artifacts can't fetch either at runtime.
- **Crisp pass:** `crispOver(mesh, …)` in scene 8 is the general form of the overlay pass: it mirrors any mesh's world transform and opacity into the overlay scene, drawing only the parts that must stay sharp.
- **Time:** every scene is a pure function of scene time `t`. That keeps scenes scrubbable, lets them be deep-linked as `#t<seconds>`, and makes them renderable frame by frame later (Remotion or a headless capture).
