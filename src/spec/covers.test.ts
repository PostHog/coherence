/**
 * Which entrances an invariant covers (covers.ts): the entrances: line, as
 * the grammar parses it and the model checks it, and the advisory spec
 * --check prints for every entrance an invariant covered by its crossing
 * alone before the line existed. The adopter's shape is covers-fixture.ts.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { APPLE, adopterFiles } from "./covers-fixture.ts";
import { parseSpec } from "./grammar.ts";
import { crossingAloneCredits, loadSpecModel, type SpecModel } from "./model.ts";
import { crossingAloneLines, formatReport } from "./report.ts";

function withModel(files: Record<string, string>, run: (model: SpecModel) => void): void {
  const root = mkdtempSync(join(tmpdir(), "coherence-covers-spec-"));
  try {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(root, path, ".."), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    run(loadSpecModel(root, { runs: false }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const messages = (model: SpecModel): string[] => model.problems.map((p) => `${p.file}:${p.line} ${p.message}`);

test("the model: an invariant's entrances: line names declared entrances whose trust its crossing checks; an unknown, ambiguous or mismatched name, none beside a name, a name twice, a chokepoint's line and one with no crossing are problems", () => {
  withModel(adopterFiles(), (model) => {
    assert.deepEqual(model.problems, []);
    const apple = model.components.find((c) => c.folder === "src/routes")!.invariants.find((i) => i.name === "signed apple notifications")!;
    assert.deepEqual(apple.entrances, { names: [APPLE], line: 25 });
  });
  withModel(adopterFiles({ entrances: "route api/nowhere" }), (model) => {
    assert.deepEqual(messages(model), ["src/routes/Routes.spec.md:25 entrances on signed apple notifications: no spec declares an entrance named route api/nowhere"], "an unknown name is a spec problem");
  });
  withModel(adopterFiles({ entrances: "route api/previews/battles.$token" }), (model) => assert.deepEqual(model.problems, [], "a name one other spec declares resolves there"));
  // Two other specs declaring one name: ambiguous, until the folder picks one.
  const twice = (entrances: string): Record<string, string> => {
    const files = adopterFiles();
    files["src/routes/api/previews/LinkPreviews.spec.md"] = files["src/routes/api/previews/LinkPreviews.spec.md"]!.replace("\n## invariants", "- route robots[.]txt: a crawler reads the previews' crawler policy\n  handler: Route in battles.$token.ts\n  trust: visitor\n\n## invariants");
    files["src/server/Server.spec.md"] = files["src/server/Server.spec.md"]!.replace("  kinds: none", `  entrances: ${entrances}\n  kinds: none`);
    return files;
  };
  withModel(twice("route robots[.]txt"), (model) => {
    assert.deepEqual(messages(model), ["src/server/Server.spec.md:11 entrances on session-scoped rosters: route robots[.]txt is declared in src/routes and src/routes/api/previews; name it as route robots[.]txt in <folder>"]);
  });
  withModel(twice("route robots[.]txt in src/routes"), (model) => assert.deepEqual(model.problems, [], "the folder picks one"));
  // A crossing that checks another trust names an entrance it checks nothing of.
  const player = adopterFiles();
  player["src/routes/Routes.spec.md"] = player["src/routes/Routes.spec.md"]!.replace("crossing: visitor -> account store", "crossing: player -> account store");
  withModel(player, (model) => {
    assert.deepEqual(messages(model), [`src/routes/Routes.spec.md:25 entrances on signed apple notifications names ${APPLE}, which carries visitor in, but its crossing player -> account store neither enters from visitor nor enters it, so it checks nothing that entrance sends`]);
  });
  // The grammar's own refusals.
  const bullet = (lines: string): string[] => parseSpec(`# A\n\nAn a.\n\n## invariants\n- checked: A thing is checked.\n${lines}`, "A.spec.md").problems.map((p) => `${p.line} ${p.message}`);
  assert.deepEqual(bullet("  over: every thing\n  via: things are checked\n  crossing: a -> b\n  entrances: none\n"), [], "none alone says it checks no entrance");
  assert.deepEqual(bullet("  over: every thing\n  via: things are checked\n  entrances: none\n"), [], "and needs no crossing");
  assert.deepEqual(bullet("  over: every thing\n  via: things are checked\n  crossing: a -> b\n  entrances: none, door\n"), ["10 entrances on checked: none cannot be combined with an entrance"]);
  assert.deepEqual(bullet("  over: every thing\n  via: things are checked\n  crossing: a -> b\n  entrances: door, door\n"), ["10 entrances on checked names door twice"]);
  assert.deepEqual(bullet("  protects: thing\n  chokepoint: check\n  crossing: a -> b\n  entrances: door\n"), ["10 entrances on checked: a chokepoint's entrances are traced, never named; declare guard: <chokepoint> on an entrance whose handler is registered through it"]);
  assert.deepEqual(bullet("  over: every thing\n  via: things are checked\n  entrances: door\n"), ["9 entrances on checked names the entrances its crossing checks; add crossing: <trust level> -> <trust level>"]);
  assert.deepEqual(parseSpec("# A\n\nAn a.\n\n## invariants\n- checked: A thing is checked.\n  entrances: <the entrances whose work its test checks, comma separated, or none>\n", "A.spec.md").invariants[0]!.unfilled, ["entrances"], "a placeholder counts as absent");
});

test("spec --check names each entrance a verified invariant covered by its crossing alone, never as a problem, until the invariant names the entrances it checks or says none", () => {
  const verified = (model: SpecModel): SpecModel["components"] => {
    for (const c of model.components) for (const i of c.invariants) i.state = "invariant";
    return model.components;
  };
  withModel(adopterFiles({ named: false }), (model) => {
    const credits = crossingAloneCredits(verified(model), model.trustLevels);
    assert.deepEqual(
      credits.map((c) => `${c.invariant.name}: ${c.entrance.name}`),
      [`signed apple notifications: ${APPLE}`, "signed apple notifications: route api/auth.$", "signed apple notifications: route robots[.]txt", "signed apple notifications: server fn listRosters", "session-scoped rosters: server fn listRosters"],
      "every entrance its component declares or handles whose trust its crossing matched: the apple check stood for the crawler file and the sign-in route",
    );
    const lines = crossingAloneLines(credits);
    assert.deepEqual(lines[0], `COVERAGE  src/routes/Routes.spec.md:20  signed apple notifications no longer covers 4 entrances by its crossing alone: ${APPLE}, route api/auth.$, route robots[.]txt, server fn listRosters lost it as a control. Under it, name the ones its test checks (entrances: <name>, <name>), or write entrances: none; scaffold control "${APPLE}" proposes the line.`);
    const report = formatReport({ ...model, crossingAlone: credits });
    assert.ok(report.includes(lines[1]!), "spec --check prints each, after the counts");
    assert.deepEqual(model.problems, [], "advisory: the old credit was the over-claim, so losing it is no problem");
  });
  withModel(adopterFiles(), (model) => {
    assert.deepEqual(crossingAloneCredits(verified(model), model.trustLevels).map((c) => c.invariant.name), ["session-scoped rosters"], "naming its entrance ends the apple check's advisory");
  });
  withModel(adopterFiles({ entrances: "none" }), (model) => {
    assert.deepEqual(crossingAloneCredits(verified(model), model.trustLevels).map((c) => c.invariant.name), ["session-scoped rosters"], "and so does entrances: none");
  });
  withModel(adopterFiles({ named: false }), (model) => {
    assert.deepEqual(crossingAloneCredits(model.components, model.trustLevels), [], "an unverified invariant gave no control, so none was lost");
  });
});
