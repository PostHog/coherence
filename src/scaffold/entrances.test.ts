/**
 * Scaffold entrances: the ## entrances bullets proposed for the detected
 * entrances no spec declares, in the spec grammar, under the component that
 * owns each file, covering each once filled, and never written.
 */

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { Io } from "../journal/cli.ts";
import { loadSpecModel } from "../spec/model.ts";
import { undeclaredProject } from "../readings/scope/undeclared-fixture.ts";
import { undeclaredNow } from "../readings/scope/undeclared.ts";
import { scaffoldCommand } from "./cli.ts";
import { MEANING_PLACEHOLDER, entranceName, proposeEntrances } from "./entrances.ts";

function io(root: string): Io & { lines: string[]; errors: string[] } {
  const lines: string[] = [];
  const errors: string[] = [];
  return { cwd: root, out: (l) => void lines.push(l), err: (l) => void errors.push(l), lines, errors };
}

/** Each "# <spec>" group of the printed proposal: the spec it names and its bullet lines. */
function groupsOf(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const block of text.split("\n# ").slice(1)) {
    const [head, ...rest] = block.split("\n");
    const body = rest.join("\n").split("\n\n")[0]!;
    out.set(head!.split(" (")[0]!, body);
  }
  return out;
}

/** Paste a group's bullets under the spec's ## entrances, adding the section before ## invariants when it has none. */
function paste(path: string, bullets: string): void {
  const text = readFileSync(path, "utf8");
  const next = text.includes("\n## entrances\n")
    ? text.replace(/\n## invariants/, `${bullets}\n\n## invariants`)
    : text.replace(/\n## invariants/, `\n## entrances\n${bullets}\n\n## invariants`);
  writeFileSync(path, next);
}

test("scaffold entrances proposes a bullet in the spec grammar for every undeclared entrance, under the spec of the component owning its file, that covers it once its meaning and trust are filled, and writes nothing", async () => {
  const { root, remove } = undeclaredProject({ serverSpec: true });
  try {
    const specs = ["Shelf.spec.md", "src/server/Server.spec.md"];
    const before = specs.map((s) => readFileSync(join(root, s), "utf8"));
    const out = io(root);
    assert.equal(await scaffoldCommand(["entrances"], out), 0, out.errors.join("\n"));
    const text = out.lines.join("\n");
    assert.match(text, /^6 undeclared entrances \(7 detected in the project, 1 declared\)\./);
    assert.deepEqual(specs.map((s) => readFileSync(join(root, s), "utf8")), before, "printed, never written");
    const groups = groupsOf(text);
    assert.deepEqual([...groups.keys()], ["Shelf.spec.md", "src/server/Server.spec.md"], "grouped by the component holding each file");
    const server = groups.get("src/server/Server.spec.md")!;
    assert.equal((server.match(/^- /gm) ?? []).length, 4, "one bullet per undeclared server function");
    assert.ok(server.includes(`- write thing: ${MEANING_PLACEHOLDER}\n  handler: writeThing in fns.ts\n  trust: <trust level: visitor | operator>`), server);
    const shelf = groups.get("Shelf.spec.md")!;
    assert.ok(shelf.includes("- route api/users.$id: ") && shelf.includes("  handler: Route in src/routes/api/users.$id.ts"), shelf);
    assert.ok(shelf.includes("- seed: ") && shelf.includes("  handler: scripts/seed.ts"), "a file-grain entrance names its module");
    // Filled as the agent fills them, pasted where the proposal says: every one parses and is covered.
    for (const [spec, body] of groups) paste(join(root, spec), body.replaceAll(MEANING_PLACEHOLDER, "work enters").replace(/<trust level: [^>]*>/g, "visitor"));
    assert.deepEqual(loadSpecModel(root, { runs: false }).problems, [], "the filled bullets parse and every handler resolves");
    assert.equal(undeclaredNow(root)?.undeclared.length, 0, "and cover every entrance they were proposed for");
    const done = io(root);
    await scaffoldCommand(["entrances"], done);
    assert.match(done.lines.join("\n"), /^Every detected entrance is declared \(7 declared, 7 detected in the project\)\.$/);
  } finally {
    remove();
  }
});

test("scaffold entrances narrows to a folder or file inside the project, and names each entrance apart from those its spec already has", async () => {
  const { root, remove } = undeclaredProject();
  try {
    const routes = io(root);
    await scaffoldCommand(["entrances", "src/routes"], routes);
    assert.match(routes.lines.join("\n"), /^1 undeclared entrance under src\/routes /);
    const outside = io(root);
    assert.equal(await scaffoldCommand(["entrances", "../elsewhere"], outside), 1);
    assert.match(outside.errors.join("\n"), /no folder or file inside the project/);
    const [group] = proposeEntrances(
      [
        { file: "src/a.ts", line: 1, symbol: "readThing", rule: "server function", why: "w" },
        { file: "src/b.ts", line: 1, symbol: "readThing", rule: "server function", why: "w" },
      ],
      [{ folder: ".", specPath: "Shelf.spec.md", entrances: [{ name: "read thing" }] }],
    );
    assert.deepEqual(group!.entrances.map((e) => e.name), ["read thing in a", "read thing in b"], "never a name the spec already has, nor one proposed twice");
    assert.equal(entranceName({ file: "src/app/api/items/route.ts", symbol: "POST", rule: "route handler" }), "POST api/items/route");
    assert.equal(entranceName({ file: "scripts/sync:all.ts", symbol: "", rule: "script" }), "sync all", "never a colon, which would end the name");
  } finally {
    remove();
  }
});
