/**
 * Scaffold control (d-a1095ef2): the closure proposed for an entrance with no
 * traced control, ranked, in the spec's own terms, and written only where
 * safe.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { Io } from "../journal/cli.ts";
import { parseSpec } from "../spec/grammar.ts";
import { gapProject } from "../readings/scope/gaps-fixture.ts";
import { readAndRecord, readGapBaseline, structureState } from "../readings/scope/gaps.ts";
import type { ShellState } from "../readings/scope/model.ts";
import { flowOf } from "../readings/scope/structure-flow.ts";
import { scaffoldCommand } from "./cli.ts";
import { proposeClosures, renderAll, renderProposal, writeClosure, type Proposal } from "./control.ts";

/** The fixture's state with one door verified, as a run that found it holding would leave it. */
function doorState(root: string, reading: Parameters<typeof structureState>[1]): ShellState {
  const state = structureState(root, reading);
  for (const c of state.spec.components) for (const i of c.invariants) if (i.name === "one door") i.state = "invariant";
  return state;
}

function proposalsOf(state: ShellState, root: string): Proposal[] {
  return proposeClosures(root, state, flowOf(state), "typescript");
}

function io(root: string): Io & { lines: string[]; errors: string[] } {
  const lines: string[] = [];
  const errors: string[] = [];
  return { cwd: root, out: (l) => void lines.push(l), err: (l) => void errors.push(l), lines, errors };
}

test("scaffold control proposes each gap's closure: a guard: line where its handler calls or passes a verified chokepoint its route-mates do not, else an invariant whose crossing enters from its trust, and control: none first where it plausibly needs none", () => {
  const { root, reading, remove } = gapProject({ door: true, waived: false });
  try {
    const state = doorState(root, reading);
    const byName = (ps: Proposal[], name: string): Proposal => ps.find((p) => p.entrance.name === name)!;
    const called = proposalsOf(state, root);
    assert.deepEqual(called.map((p) => p.entrance.name).sort(), ["look", "peek", "ping"], "every entrance on an untraced route");
    const look = byName(called, "look").closures[0]!;
    assert.deepEqual(look.kind === "guard" ? [look.line, look.how, look.invariant, look.rivals] : look, ["guard: door", "called", "one door", []], "look's handler calls door: the exact guard: line");
    const peek = byName(called, "peek").closures;
    assert.equal(peek[0]!.kind, "invariant", "peek's reach meets no control: an invariant first");
    const bullet = peek[0]!.kind === "invariant" ? peek[0]!.bullet : "";
    assert.match(bullet, /^- <name>: <what every peek request must satisfy before its work runs>\n/);
    assert.match(bullet, /\n {2}crossing: public -> <trust level>\n/, "the crossing prefilled from its trust");
    assert.match(bullet, /\n {2}over: [^\n]+\n {2}via: /, "in the totality oracle form, which counts as the entrance's own once verified");
    assert.deepEqual(parseSpec(`# A\n\nAn a.\n\n## invariants\n${bullet}`, "A.spec.md").problems, [], "it parses as a bullet");
    assert.deepEqual(peek.map((c) => c.kind), ["invariant", "none"]);
    assert.deepEqual(byName(called, "ping").closures.map((c) => c.kind), ["none", "invariant"], "a health check, reaching no component beyond its own: control: none first");
    // Traced: the reading saw look's handler wrapped by the verified door, and peek not, so the door is listed as passed by some.
    const traced = structuredClone(reading);
    if (traced.kind === "read") traced.entrances = traced.entrances.map((e) => (e.name === "look" ? { ...e, guards: [{ component: ".", name: "one door", how: "wrapper" as const }] } : e));
    const tracedState = doorState(root, traced);
    const route = flowOf(tracedState).routes.find((r) => r.names.includes("look"))!;
    assert.deepEqual(route.partial.map((c) => `${c.kind} ${c.name} ${c.entrances}`), ["wrapper one door 1"]);
    const passed = byName(proposalsOf(tracedState, root), "look").closures[0]!;
    assert.deepEqual(passed.kind === "guard" ? [passed.line, passed.how] : passed, ["guard: door", "traced"]);
    const words = renderProposal(byName(proposalsOf(tracedState, root), "look"), "coherence");
    assert.match(words, /^look {2}\(Gappy\.spec\.md:\d+, trust public\)\n {2}no traced control on its route: look and 1 more, \.\n {2}proposed: guard: door\n/);
    assert.match(words, /take their own route|own route/);
    assert.match(words, /\n {2}or: an invariant in Gappy\.spec\.md whose crossing enters from public/);
    assert.match(words, /\n {2}or: control: none — <why look needs no control>/);
    const all = renderAll(proposalsOf(tracedState, root), "coherence");
    assert.match(all, /^3 entrances with no traced control\. To close one, declare guard:/);
    assert.match(all, /\n {2}1 of 2: guard: door {3}one door \(\., verified\): their handlers pass it\n {4}Gappy\.spec\.md:\d+ {2}look\n/);
    assert.match(all, /the other 1 keep a route of their own once those guard: lines are written/);
  } finally {
    remove();
  }
});

test("scaffold control writes only where safe: a guard: line under the entrance's bullet, never twice nor beside control: none; control: none only with a real reason; an invariant as a requirement with its placeholders", () => {
  const { root, reading, remove } = gapProject({ door: true, waived: false });
  try {
    const state = doorState(root, reading);
    const ps = proposalsOf(state, root);
    const look = ps.find((p) => p.entrance.name === "look")!;
    const ping = ps.find((p) => p.entrance.name === "ping")!;
    const peek = ps.find((p) => p.entrance.name === "peek")!;
    const spec = (): string => readFileSync(join(root, "Gappy.spec.md"), "utf8");
    assert.match(writeClosure(root, look, look.closures[0]!), /^Gappy\.spec\.md:\d+ {2}guard: door$/);
    assert.match(spec(), /- look: a caller looks\n {2}handler: look in src\/look\.ts\n {2}trust: public\n {2}guard: door\n- peek/);
    assert.deepEqual(parseSpec(spec(), "Gappy.spec.md").problems, []);
    assert.throws(() => writeClosure(root, look, look.closures[0]!), /already has a guard: line/);
    const none = ping.closures.find((c) => c.kind === "none")!;
    assert.throws(() => writeClosure(root, ping, none), /written only with its reason/);
    assert.throws(() => writeClosure(root, ping, none, "<why ping needs no control>"), /written only with its reason/, "never a placeholder");
    // ping sits below look, whose bullet grew by one line: the proposal is re-read, as the command does.
    const again = proposalsOf(doorState(root, reading), root);
    const ping2 = again.find((p) => p.entrance.name === "ping")!;
    assert.match(writeClosure(root, ping2, ping2.closures.find((c) => c.kind === "none")!, "the same empty answer for every caller"), /control: none — the same empty answer for every caller$/);
    assert.equal(parseSpec(spec(), "Gappy.spec.md").entrances.find((e) => e.name === "ping")!.noControl, "the same empty answer for every caller");
    const lookAgain = again.find((p) => p.entrance.name === "look")!;
    assert.deepEqual(lookAgain.route.names, ["look"], "look now declares its guard and takes a route of its own, which the door controls once a reading confirms the registration");
    const peek2 = again.find((p) => p.entrance.name === "peek")!;
    const guarded = { ...peek2, declared: { ...peek2.declared, guard: "door" } };
    assert.throws(() => writeClosure(root, guarded, { kind: "none", why: "", line: "" }, "a reason"), /cannot carry both/);
    const invariant = peek.closures.find((c) => c.kind === "invariant")!;
    assert.match(writeClosure(root, peek, invariant), /^appended to Gappy\.spec\.md/);
    const parsed = parseSpec(spec(), "Gappy.spec.md");
    assert.deepEqual(parsed.problems, [], "what the scaffold wrote still parses");
    assert.equal(parsed.invariants.length, 2, "the requirement is appended to the invariants section");
  } finally {
    remove();
  }
});

test("the scaffold control command reads the recorded reading, prints one entrance's closure or every gap's, writes on --write, and records the adoption baseline", async () => {
  const { root, reading, remove } = gapProject({ waived: false });
  try {
    await readAndRecord(root, async () => reading);
    const one = io(root);
    assert.equal(await scaffoldCommand(["control", "ping"], one), 0);
    assert.match(one.lines.join("\n"), /^ping {2}\(Gappy\.spec\.md:\d+, trust public\)\n[^]*proposed: control: none — <why ping needs no control>/);
    assert.deepEqual(one.errors, [], "the recorded reading was fresh: nothing was read");
    const write = io(root);
    assert.equal(await scaffoldCommand(["control", "ping", "--write", "--reason", "the same empty answer for every caller"], write), 0);
    assert.match(write.lines.at(-1)!, /^wrote Gappy\.spec\.md:\d+ {2}control: none — the same empty answer for every caller$/);
    const after = io(root);
    assert.equal(await scaffoldCommand(["control", "ping"], after), 0, "control: none does not make the reading stale");
    assert.match(after.lines.join("\n"), /^ping needs no closure: it declares control: none — the same empty answer for every caller\.$/);
    const all = io(root);
    assert.equal(await scaffoldCommand(["control", "--all"], all), 0);
    assert.match(all.lines.join("\n"), /^2 entrances with no traced control/);
    const missing = io(root);
    assert.equal(await scaffoldCommand(["control", "stare"], missing), 1);
    assert.match(missing.errors.join("\n"), /no entrance is named "stare"/);
    const base = io(root);
    assert.equal(await scaffoldCommand(["control", "--baseline", "--session", "s-control", "--agent", "test"], base), 0);
    assert.match(base.lines.join("\n"), /^Baseline taken \(d-[0-9a-f]+\): 2 entrances with no traced control/);
    assert.equal(readGapBaseline(root)?.entrances.size, 2);
  } finally {
    remove();
  }
});
