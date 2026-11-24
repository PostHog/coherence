import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildScopePage, DEFAULTS } from "./build.ts";
import { makeFixture, type Fixture } from "./check-fixture.ts";
import type { ShellState } from "./model.ts";
import { renderView, setViewFilter, setViewQuery, VIEWS } from "./shell.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
let fixture: Fixture;
let state: ShellState;

before(async () => {
  fixture = makeFixture();
  ({ state } = await buildScopePage({ root: fixture.root, lexiconPath: DEFAULTS.lexiconPath, project: "Fixture" }));
});
after(() => fixture.remove());

test("Scope's views are named once, in VIEWS: the shell draws each from its parts and the page sets a query or filter through them, never by a switch of its own", () => {
  for (const view of VIEWS) assert.doesNotMatch(renderView(state, view.id).text, /No view named/, view.id);
  assert.match(renderView(state, "nope").text, /No view named “nope”/);
  const queries = (s: ShellState): string[] => [s.lexicon.query, s.components.query, s.practicesView.query, s.runsView.query, s.journalView.query];
  const searched = ["lexicon", "components", "practices", "runs", "journal"];
  for (const view of [...VIEWS.map((v) => v.id), "nope"]) {
    const copy = JSON.parse(JSON.stringify(state)) as ShellState;
    copy.activeView = view;
    setViewQuery(copy, "q");
    assert.deepEqual(queries(copy).map((q) => q === "q"), searched.map((v) => v === view), `a query on ${view} sets its own search alone`);
    setViewFilter(copy, "kind", "decision");
    assert.equal(copy.journalView.kind === "decision", view === "journal", `the kind filter is the journal's (${view})`);
  }
  const switching = readdirSync(HERE, { recursive: true })
    .map(String)
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
    .filter((file) => /switch \((?:state\.)?activeView\)/.test(readFileSync(join(HERE, file), "utf8")));
  assert.deepEqual(switching, [], "give a view's parts in VIEW_PARTS (shell.ts), which the compiler holds to VIEWS");
});
