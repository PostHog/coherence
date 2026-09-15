# Project behavior in Structure

Structure's defaults and project implementations use the same interfaces. Specs
supply architectural meaning; configuration selects presentation; project modules
replace behavior. Changing a renderer does not create evidence or make a promise
pass verification.

## Start with configuration

Use `coherence.scope.json` to select the initial view, add views, or replace the
Structure view's presentation options. Existing graph, table and card views keep
their declarative asset selectors. Structure consumes the canonical architectural
model so component and guarantee inspection retain their identities.

The default Structure design presents a project frame, entrances, downtown and
peripheral component stacks, architectural handoffs and guarantee terminals.
Unfurling reveals additional promise cards without moving existing cards. Zoom
changes supporting detail within fixed rectangles. Selection opens an inspector;
connection focus and local framing are explicit actions.

## Named implementations

A project module exports a default registration object with `apiVersion: 1` and
optional `rankers`, `layouts`, `routers`, `cards` and `views` maps. Configuration's
root `extensions` array names project-relative module files. A Structure view's
`implementations` selects a name for `rank`, `layout`, `route`, `card`, or `view`.
Omitted selections use `default`. Registration names must be unique; the built-in
`default` is reserved.

The generator bundles module code and supported imported assets into the output.
Project React components use Scope's own React runtime, including hooks. Opening
the generated file needs no source checkout or CDN. Default-only projects use the
prebuilt client without generating a project bundle.

Modules are executable project code, not declarative JSON or an isolation boundary.
Only configure modules you intend to ship and execute in the viewer. The generated
HTML already contains the captured catalog; presentation filters do not restrict
access to it. Module paths are resolved by the generator, not fetched by the browser. Authored
relative module declarations remain in exported configuration so it can be reused;
absolute host resolution paths are excluded.

## Mechanism contexts

| Registration | Context | Return value |
| --- | --- | --- |
| `rankers` | `model`, `options`, `defaults` | Ranked component records, preserving canonical identities |
| `layouts` | `model`, `ranked`, `options`, `defaults` | Layout with component rectangles and downtown membership |
| `routers` | `cards`, `relationships`, `annotations`, `fixedLabels`, `options`, `defaults` | Routes preserving relationship identity and endpoints |
| `cards` | `card`, `options`, interaction callbacks, `DefaultCard` | React content inside the default world-geometry shell |
| `views` | `catalog`, `view`, `onSelect`, `DefaultView` | React view that replaces Structure presentation |

Calling `defaults.rank(context)`, `defaults.layout(context)` or
`defaults.route(context)` invokes the shipped implementation directly. This lets
an extension alter one policy or result without recursively invoking itself. Card
and view wrappers can render their supplied default component for the same reason.
The registered default layout includes measured text sizing and clearance for
guarantee terminals, so a layout wrapper inherits those results too. Custom layouts
own any geometry they change.

The shared model remains the source of component IDs, declared relationships,
guarantee ownership and recorded verdicts. Mechanism validation rejects missing,
duplicated or invented subjects and malformed geometry. A whole-view replacement
owns its presentation, while source availability remains visible in Scope's shell.

## Example: inherit defaults and change two behaviors

Save this as `scope-project.jsx` at your project root:

```jsx
import React, { useState } from "react";

export default {
  apiVersion: 1,
  layouts: {
    "project.spacious": context => context.defaults.layout({
      ...context,
      options: {
        ...context.options,
        spacing: { x: 560, y: 500 },
      },
    }),
  },
  cards: {
    "project.annotated": function AnnotatedCard(props) {
      const [marked, setMarked] = useState(false);
      const DefaultCard = props.DefaultCard;
      return <>
        <DefaultCard {...props} />
        <button
          style={{ position: "absolute", right: 8, top: 8, fontSize: 10 }}
          aria-label={`Mark ${props.card.label}`}
          onClick={() => setMarked(value => !value)}
        >{marked ? "Marked" : "Mark"}</button>
      </>;
    },
  },
};
```

Select those registrations in `coherence.scope.json`:

```json
{
  "version": 1,
  "extends": "default",
  "extensions": ["./scope-project.jsx"],
  "views": [{
    "id": "structure",
    "title": "Structure",
    "renderer": "structure",
    "kinds": ["component"],
    "fields": [],
    "structure": {
      "implementations": {
        "layout": "project.spacious",
        "card": "project.annotated"
      }
    }
  }]
}
```

Then run `coherence scope`. Ranking, routes and the overall Structure view remain
at their inherited defaults. The local mark is browser interaction state, not
recorded evidence or a project assessment. For spacing alone, use the declarative
`structure.spacing` option; the layout wrapper illustrates the behavior seam.

The checked-in [acceptance fixture](../test/fixtures/scope-extensions/extension.jsx)
also replaces ranking and adds a second Structure tab using a custom whole view.
Its browser gate runs the same project through a packed installation.

The full card props are `card`, `options`, `onSelect(id)`, `onToggle(id)`,
`onFocusRelationship(id)`, `selected`, `detail`, `color` and `DefaultCard`.
A whole view additionally receives `options`, `registry`, `implementations` and
`DefaultView`; it can render `<DefaultView {...props} />` to inherit interactions.
Use canonical string IDs with selection callbacks. Keep custom card content within
its assigned rectangle; a whole-view replacement owns its own geometry.

## Failure and live editing

Invalid options, unknown implementation names, duplicate registrations, incompatible
API versions, missing modules and malformed implementation outputs produce errors.
An invalid customization never silently becomes the default design.

The Configure editor can preview configuration against implementations already
bundled into the page. Adding or changing module code requires regenerating the
page. In live Scope, a changed extension bundle requires a page reload; ordinary
catalog updates continue through the existing read-only stream.

## Current boundary

This API customizes current-state Structure. It does not implement cross-snapshot
layout stability, diff ghosts, or Scope MCP control. Large-graph placement is a
bounded deterministic heuristic, not a guarantee that every architecture will fit
one useful screen. Missing architectural declarations and missing verification
remain visible authoring/evidence gaps.
