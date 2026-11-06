import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { journalVerbs } from "../journal/cli.ts";
import { loadJournal } from "../journal/store.ts";
import type { Conjecture, Decision, JournalRecord } from "../journal/record.ts";
import type { WorkOrder } from "../journal/work.ts";
import { recordWriteTrace } from "../economy/trace.ts";
import { CARRIED_DECISIONS, NEAR_PER_COMPONENT, carryBlock, decisionsNear, keepPlaced } from "./carry-over.ts";

const stamp = { commit: null, dirty: false, agent: "main" };
const decision = (id: string, at: string, chose: string, extra: Partial<Decision> = {}): Decision => ({ ...stamp, id, kind: "decision", at, session: "earlier", chose, over: [], because: `why ${id}`, ...extra });
const conjecture = (id: string, at: string, observation: string): Conjecture => ({ ...stamp, id, kind: "conjecture", at, session: "earlier", observation, couldBe: ["the instrument is wrong"], discriminatedBy: "a test" });
const order = (id: string, state: WorkOrder["state"], owner: string): WorkOrder => ({ id, objective: `objective ${id}`, success: "s", boundary: "b", owner, state, at: "2026-11-01T00:00:00.000Z", session: owner, agent: "main", history: [] });
const NOW = new Date("2026-11-05T12:00:00.000Z");

test("a start carries the last week's standing decisions, the open conjectures and the orders it does not hold, newest first and capped", () => {
  const records: JournalRecord[] = [
    ...Array.from({ length: CARRIED_DECISIONS + 2 }, (_, i) => decision(`d-${i}`, `2026-11-0${(i % 4) + 1}T0${i}:00:00.000Z`, `choice ${i}`)),
    decision("d-old", "2026-10-01T00:00:00.000Z", "a choice from last month"),
    decision("d-gone", "2026-11-04T09:00:00.000Z", "a retracted choice"),
    { ...stamp, id: "rt-1", kind: "retraction", at: "2026-11-04T10:00:00.000Z", session: "earlier", of: "d-gone", because: "refuted" },
    decision("d-class", "2026-11-04T11:00:00.000Z", "a classification", { classifies: { of: "df-1", class: "x" } }),
    conjecture("c-open", "2026-11-03T00:00:00.000Z", "the feed is late"),
    conjecture("c-done", "2026-11-02T00:00:00.000Z", "the cache is stale"),
    { ...stamp, id: "rs-1", kind: "resolution", at: "2026-11-03T00:00:00.000Z", session: "earlier", of: "c-done", because: "it was" },
  ];
  const orders = [order("w-open", "open", "someone"), order("w-mine", "active", "me"), order("w-done", "completed", "someone")];
  const block = carryBlock(records, orders, "me", "coherence", NOW);
  assert.match(block, new RegExp(`^Decided in the last 7 days \\(${CARRIED_DECISIONS + 2}, the newest ${CARRIED_DECISIONS}; one whole, with why: coherence journal <id>\\):\\n`));
  assert.equal(block.split("\n").filter((l) => /^ {2}d-/.test(l)).length, CARRIED_DECISIONS);
  assert.ok(block.indexOf("d-3 ") < block.indexOf("d-2 "), "newest first");
  assert.doesNotMatch(block, /d-old|d-gone|d-class/, "an old decision, a retracted one and a defect's classification are not carried");
  assert.match(block, /^Open conjectures \(1; [^\n]*\n {2}c-open 2026-11-03 the feed is late$/m);
  assert.doesNotMatch(block, /c-done/, "a resolved conjecture is settled");
  assert.match(block, /^Work orders this session does not hold \(1; coherence work inspect <id>\):\n {2}w-open open, held by someone since 2026-11-01: objective w-open$/m);
  assert.doesNotMatch(block, /w-mine|w-done/, "the session's own order and a completed one are not carried");
  assert.ok(block.endsWith("\n\n"));
  assert.equal(carryBlock([], [], "me", "coherence", NOW), "", "nothing carried, nothing said");
});

test("before an edit, the decisions about the component it lands in, kept at the start, are told once a session, capped a component, never the session's own or the root's", () => {
  const root = mkdtempSync(join(tmpdir(), "coherence-carry-"));
  try {
    const records: JournalRecord[] = [
      decision("d-model", "2026-11-04T00:00:00.000Z", "caps live in the model", { about: ["convex/model"] }),
      decision("d-convex", "2026-11-03T00:00:00.000Z", "every mutation authorizes first", { about: ["convex"] }),
      decision("d-web", "2026-11-03T00:00:00.000Z", "the web app never calls Convex directly", { about: ["src"] }),
      decision("d-root", "2026-11-03T00:00:00.000Z", "one package manager", { about: ["."] }),
      decision("d-mine", "2026-11-04T00:00:00.000Z", "this session's own", { about: ["convex/model"], session: "s" }),
      ...Array.from({ length: NEAR_PER_COMPONENT + 2 }, (_, i) => decision(`d-many-${i}`, `2026-10-2${i}T00:00:00.000Z`, `older ${i}`, { about: ["convex/model"] })),
    ];
    assert.equal(decisionsNear(root, "s", ["convex/model/roster.ts"], "coherence").text, "", "a session whose start kept nothing is told nothing");
    keepPlaced(root, "s", records);
    const first = decisionsNear(root, "s", ["convex/model/roster.ts"], "coherence");
    assert.match(first.text, /^Decided before about convex\/model, where this edit lands:\n {2}d-model 2026-11-04 caps live in the model: because why d-model\n/);
    const modelBlock = first.text.slice(0, first.text.indexOf("\nDecided before about convex,"));
    assert.equal(modelBlock.split("\n").filter((l) => /^ {2}d-/.test(l)).length, NEAR_PER_COMPONENT, "a component's decisions are capped");
    assert.match(first.text, /more decided there: coherence journal --kind decision/);
    assert.doesNotMatch(first.text, /d-web|d-root|d-mine/, "another component's, the root's and the session's own are not told");
    assert.match(first.text, /retract <id>/);
    first.commit();
    assert.match(first.text, /\nDecided before about convex, where this edit lands:\n {2}d-convex /, "a decision about the component holding convex/model is told there too, after the deeper component's");
    assert.equal(decisionsNear(root, "s", ["convex/model/roster.ts"], "coherence").text, "", "told once: every component's share was given");
    assert.equal(decisionsNear(root, "s", ["src/lib/date.ts"], "coherence").text.match(/d-web/)?.[0], "d-web", "a file inside a decision's component hears it");
    assert.equal(decisionsNear(root, "s", ["README.md"], "coherence").text, "", "a file in no decision's component hears nothing");
    assert.equal(decisionsNear(root, undefined, ["convex/a.ts"], "coherence").text, "", "no session, nothing to keep track of, nothing told");
    keepPlaced(root, "s", records);
    assert.equal(decisionsNear(root, "s", ["convex/model/roster.ts"], "coherence").text.includes("d-model"), false, "a restarted session keeps what it was told");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("decide records the components --about names, refusing a path that is not there, else the few components below the root the deciding session wrote in, and says which", () => {
  const root = mkdtempSync(join(tmpdir(), "coherence-about-"));
  try {
    writeFileSync(join(root, "coherence.config.json"), "{}");
    writeFileSync(join(root, "Project.spec.md"), "# Project\n\nThe whole project.\n");
    mkdirSync(join(root, "src/app"), { recursive: true });
    writeFileSync(join(root, "src/app/page.ts"), "export {};\n");
    for (const [folder, name] of [["convex", "Backend"], ["convex/model", "Model"], ["src", "Web"], ["scripts", "Scripts"], ["worker", "Worker"]] as const) {
      mkdirSync(join(root, folder), { recursive: true });
      writeFileSync(join(root, folder, `${name}.spec.md`), `# ${name}\n\nThe ${name} component.\n`);
    }
    const printed: string[] = [];
    const io = { cwd: root, out: (l: string) => printed.push(l), err: (l: string) => printed.push(l) };
    const decide = (session: string, ...flags: string[]): Decision => {
      printed.length = 0;
      assert.equal(journalVerbs["decide"]!([`a choice by ${session}`, "--because", "a reason", "--session", session, "--agent", "main", ...flags], io), 0, printed.join("\n"));
      return loadJournal(root).records.filter((r): r is Decision => r.kind === "decision").at(-1)!;
    };
    assert.deepEqual(decide("named", "--about", "convex/model", "--about", "src/app/page.ts").about, ["convex/model", "src"], "a component's folder names it; a path names the component holding it");
    assert.match(printed.join("\n"), /^ {2}about convex\/model, src$/m);
    printed.length = 0;
    assert.notEqual(journalVerbs["decide"]!(["a choice about nowhere", "--because", "a typo", "--session", "typo", "--agent", "main", "--about", "convex/modle"], io), 0, "a path that is not there is refused, as --cite refuses an id that names no record");
    assert.match(printed.join("\n"), /--about convex\/modle: no such file or folder/);
    recordWriteTrace(root, "wrote", ["convex/model/roster.ts", "convex/http.ts", "README.md"]);
    assert.deepEqual(decide("wrote").about, ["convex", "convex/model"], "inferred from the session's writes, the root's own file placing nothing");
    assert.match(printed.join("\n"), /about convex, convex\/model \(from this session's writes; --about <path> names it instead\)/);
    assert.equal(decide("nothing").about, undefined, "a session that wrote nothing places nothing");
    assert.match(printed.join("\n"), /about no component: this session wrote nothing yet/);
    recordWriteTrace(root, "wide", ["convex/a.ts", "convex/model/b.ts", "src/c.ts", "scripts/d.ts"]);
    assert.equal(decide("wide").about, undefined, "a session that wrote across many components decided nothing local to one");
    assert.match(printed.join("\n"), /about no component: this session wrote in 4/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
