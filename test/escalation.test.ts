// escalation.test.ts — the route to a human.
//
// What these pin, in order of how badly it hurts when it breaks:
//   1. AN OPEN ESCALATION HEADS EVERY HUMAN-FACING READ — the settled render, the stream
//      snapshot, and the orient heading — until a person acknowledges it. The verb exists
//      because METR (2026-08-26) measured agents that considered alerting a human and
//      did not, citing "no route"; a route that files the row at the bottom is no route.
//   2. A HOLLOW ESCALATION IS REFUSED AT THE WRITE AND LEAVES NO ROW. Empty because, or a
//      because that only restates the what. The row is a claim on a person's attention.
//   3. THE ACKNOWLEDGEMENT IS A RECORD, points only at an escalation, and is the one thing
//      that clears the heading; retracting it reopens the escalation.
//   4. IT GATES NOTHING MECHANICALLY. `orient` exits 0 on `await-human`; nothing refuses.
//   5. THE STARTUP TEXT TEACHES IT beside `blocked`, and the owner menu lists the honest
//      cancelled exit beside finish.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  appendDecision, readJournal, readTrustedJournal, resolve, renderJournal, decisionsDir,
  escalationProblems, acknowledgeableEscalation, EscalationRefusal, ESCALATION_MIN_NEW_WORDS,
} from "../src/evidence/decisions.ts";
import { formatEntryLine, runJournal } from "../src/evidence/journal.ts";
import { observeOrientation, renderOrientation } from "../src/coordination/orient.ts";
import { createWork, transitionWork } from "../src/coordination/work.ts";
import { agentInstructions, assignedWorkInstructions, stopReport } from "../src/lifecycle/hooks.ts";
import { cfg, cleanup, runCaptured, tmpProject } from "./_helpers.ts";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "cli.ts");
const T = (n: number) => `2026-09-17T10:${String(n).padStart(2, "0")}:00.000Z`;
const WHAT = "deploy needs the production signing key";
const WHY = "only the maintainer holds the production signing key; no agent may mint or request one";
const authority = { kind: "user-directed" as const, grantedBy: "user", boundary: "the fixture" };

test("escalation — a hollow because is refused at the write and leaves no row", async () => {
  // The pure rule first, with the exact pair the first implementation admitted: three
  // function words are not three reasons.
  assert.deepEqual(escalationProblems(WHAT, WHY), []);
  assert.match(escalationProblems(WHAT, "")[0], /nonempty --because/);
  assert.match(escalationProblems(WHAT, "   ")[0], /nonempty --because/);
  assert.match(escalationProblems(WHAT, WHAT)[0], /only restates the what/);
  assert.match(escalationProblems("deploy needs the prod key", "the prod key is needed to deploy")[0],
    /only restates the what \(0 new word\(s\)/, "function words and inflections carry no decision");
  assert.match(escalationProblems(WHAT, "we need the signing key for the deploy")[0], /only restates the what/);
  assert.ok(ESCALATION_MIN_NEW_WORDS >= 3, "the threshold is a real bar, not a nonempty check in disguise");
  assert.match(escalationProblems("", WHY)[0], /what a human must see/);

  const root = await tmpProject();
  try {
    const config = cfg(root);
    assert.throws(() => appendDecision(config, {
      kind: "escalation", chose: WHAT, because: WHAT, session: "s-agent", agent: "worker", now: T(1),
    }), (error: unknown) => error instanceof EscalationRefusal && /only restates/.test(error.problems[0]));
    assert.throws(() => appendDecision(config, {
      kind: "escalation", chose: WHAT, because: "", session: "s-agent", agent: "worker", now: T(1),
    }), EscalationRefusal);
    assert.equal(existsSync(decisionsDir(config)), false, "a refused escalation must not even create the ledger");

    const rec = appendDecision(config, { kind: "escalation", chose: WHAT, because: WHY, session: "s-agent", agent: "worker", now: T(1) });
    assert.equal(rec.kind, "escalation");
    assert.match(rec.id, /^d-[0-9a-f]{8}$/);
    assert.equal(readJournal(config).records.length, 1);
  } finally { await cleanup(root); }
});

test("escalation — an open escalation heads the settled render and the stream snapshot until a human acknowledges it", async () => {
  const root = await tmpProject();
  try {
    const config = cfg(root);
    appendDecision(config, { kind: "decision", chose: "keep the grid", over: ["a list"], because: "it measured faster", session: "s-agent", agent: "worker", now: T(1) });
    appendDecision(config, { kind: "blocked", chose: "could not reach the registry", because: "offline", session: "s-agent", agent: "worker", now: T(2) });
    appendDecision(config, { kind: "conjecture", chose: "the count doubled", because: "", discriminatedBy: "recount by hand", session: "s-agent", agent: "worker", now: T(3) });
    const esc = appendDecision(config, { kind: "escalation", chose: WHAT, because: WHY, session: "s-agent", agent: "worker", now: T(4) });

    // The settled render: escalations first, above the open questions, above standing.
    const { text, count } = renderJournal(config);
    const at = (needle: string) => { const i = text.indexOf(needle); assert.ok(i >= 0, `render lacks ${needle}`); return i; };
    assert.ok(at("ESCALATED — A HUMAN MUST SEE THIS BEFORE ANYONE PROCEEDS") < at("Open questions"));
    assert.ok(at("Open questions") < at("Standing"));
    assert.ok(at("Standing") < at("Could not"));
    assert.match(text, /^1 ESCALATION\(S\) AWAITING A HUMAN · 1 standing/m, "the summary line leads with the person's obligation");
    assert.match(text, new RegExp(`why a human: ${WHY.replace(/[;]/g, "\\$&")}`));
    assert.match(text, new RegExp(`acknowledge with: coherence acknowledge ${esc.id} --because`));
    assert.doesNotMatch(text.slice(at("ESCALATED"), at("Open questions")), /over:/, "an escalation rejects nothing; no over line");
    assert.equal(count, 4);
    // `--open` is a lens on what is unsettled, and nothing is less settled than this.
    assert.match(renderJournal(config, { open: true }).text, /ESCALATED — A HUMAN MUST SEE THIS/);
    // Markdown nests the same way.
    assert.match(renderJournal(config, { markdown: true }).text, /^## ESCALATED — A HUMAN MUST SEE THIS BEFORE ANYONE PROCEEDS$/m);

    // The stream snapshot (`journal --once`): the escalation heads the chronology, with
    // its id inline so the human can type the acknowledgement.
    const snapshot = await runCaptured(() => runJournal(config, { once: true }));
    const lines = snapshot.out.split("\n");
    assert.equal(lines[2], "ESCALATED — a human must see this before anyone proceeds (1):");
    // `escalation` is exactly ten characters, so the kind column adds no padding after it.
    assert.match(lines[3], new RegExp(`! escalation \\[worker · s-agent · ${esc.id}\\] {2}${WHAT}`));
    assert.match(formatEntryLine(esc), new RegExp(esc.id));
    assert.equal(lines.filter((line) => line.includes(WHAT)).length, 2, "once in the header, once in the chronology");

    // The strict reader admits the new kinds: this is verdict-bearing evidence.
    assert.equal(readTrustedJournal(config).ok, true);

    // The acknowledgement clears the heading, and only the acknowledgement does.
    appendDecision(config, { kind: "resolution", chose: "(resolved)", because: "recounted: 2x is real", supersedes: readJournal(config).records.find((r) => r.kind === "conjecture")!.id, session: "s-agent", agent: "worker", now: T(5) });
    assert.match(renderJournal(config).text, /ESCALATED/, "settling an unrelated question changes nothing");
    const ack = appendDecision(config, {
      kind: "acknowledgement", chose: `(acknowledged: ${esc.id})`, because: "I rotated the key myself; proceed",
      supersedes: esc.id, session: "s-human", agent: "danilo", now: T(6),
    });
    const after = renderJournal(config).text;
    assert.doesNotMatch(after, /ESCALATED/);
    assert.doesNotMatch(after, /AWAITING A HUMAN/);
    assert.match(after, /· 1 acknowledged ·/);
    assert.match(after, /^Acknowledged — a human saw it and decided$/m);
    assert.match(after, new RegExp(`ACKNOWLEDGED by danilo \\(s-human\\): I rotated the key myself; proceed`));
    assert.ok(after.indexOf("Acknowledged —") < after.indexOf("Could not"), "acknowledged rows read as settled, above the impasses");
    const settled = await runCaptured(() => runJournal(config, { once: true }));
    assert.doesNotMatch(settled.out, /ESCALATED/);
    assert.match(settled.out, /☑ acknowledgement/);
    assert.equal(readTrustedJournal(config).ok, true);
    const buckets = resolve(readJournal(config).records);
    assert.deepEqual(buckets.escalations, []);
    assert.deepEqual(buckets.acknowledged.map((x) => [x.rec.id, x.by.id]), [[esc.id, ack.id]]);
    assert.ok(!buckets.standing.some((r) => r.kind === "escalation"), "an escalation is never a standing choice");
  } finally { await cleanup(root); }
});

test("acknowledge — only an open escalation is acknowledgeable, and a retracted acknowledgement reopens it", async () => {
  const root = await tmpProject();
  try {
    const config = cfg(root);
    const dec = appendDecision(config, { kind: "decision", chose: "a choice", because: "a reason", session: "s-agent", agent: "worker", now: T(1) });
    const esc = appendDecision(config, { kind: "escalation", chose: WHAT, because: WHY, session: "s-agent", agent: "worker", now: T(2) });
    const records = () => readJournal(config).records;

    const unknown = acknowledgeableEscalation(records(), "d-deadbeef");
    assert.ok("error" in unknown && /no entry d-deadbeef/.test(unknown.error[0]));
    const wrongKind = acknowledgeableEscalation(records(), dec.id);
    assert.ok("error" in wrongKind && /is a decision, not an escalation/.test(wrongKind.error[0]));
    const open = acknowledgeableEscalation(records(), esc.id);
    assert.ok("rec" in open && open.rec.id === esc.id);

    const ack = appendDecision(config, { kind: "acknowledgement", chose: `(acknowledged: ${esc.id})`, because: "decided", supersedes: esc.id, session: "s-human", agent: "danilo", now: T(3) });
    const twice = acknowledgeableEscalation(records(), esc.id);
    assert.ok("error" in twice && twice.error[0] === `${esc.id} is already acknowledged by ${ack.id}.`);
    assert.match(("error" in twice ? twice.error[1] : ""), new RegExp(`retract ${ack.id}`));

    // A retraction of the acknowledgement withdraws the human's claim: the escalation is
    // open again and heads the render again.
    appendDecision(config, { kind: "retraction", chose: `(withdrawn: ${ack.id})`, because: "acknowledged the wrong row", supersedes: ack.id, session: "s-human", agent: "danilo", now: T(4) });
    assert.deepEqual(resolve(records()).escalations.map((r) => r.id), [esc.id]);
    assert.match(renderJournal(config).text, /ESCALATED — A HUMAN MUST SEE THIS/);
    assert.ok("rec" in acknowledgeableEscalation(records(), esc.id));
    assert.equal(readTrustedJournal(config).ok, true);

    // The strict reader refuses an acknowledgement that points at anything but an escalation.
    appendDecision(config, { kind: "acknowledgement", chose: "(acknowledged: decision)", because: "nonsense", supersedes: dec.id, session: "s-human", agent: "danilo", now: T(5) });
    const trusted = readTrustedJournal(config);
    assert.equal(trusted.ok, false);
    assert.ok(trusted.damage.some((d) => d.code === "reference" && /acknowledgement target .* is decision, not escalation/.test(d.detail)));
  } finally { await cleanup(root); }
});

test("orientation — an open escalation outranks ready work until a human acknowledges it", async () => {
  const root = await tmpProject();
  try {
    const config = cfg(root);
    createWork(config, {
      session: "orchestrator", objective: "implement parser", criteria: ["tests pass"],
      authority, risk: "medium", writeScopes: ["src/parser.ts"], now: T(1),
    });
    assert.equal((await observeOrientation(config)).action, "dispatch");

    const esc = appendDecision(config, { kind: "escalation", chose: WHAT, because: WHY, session: "s-agent", agent: "worker", now: T(2) });
    const awaiting = await observeOrientation(config);
    assert.equal(awaiting.action, "await-human");
    assert.deepEqual(awaiting.reasons, [`${esc.id} awaits a human: ${WHAT}`]);
    assert.deepEqual(awaiting.decisions?.openEscalations, [{ id: esc.id, what: WHAT, agent: "worker", at: T(2) }]);
    assert.deepEqual(awaiting.work?.ready.length, 1, "the ready work is still visible; it is outranked, not hidden");
    assert.ok(awaiting.sources.every((item) => item.ok), "an escalation is not damage");
    const rendered = renderOrientation(awaiting);
    assert.match(rendered, /^ORIENTATION AWAIT-HUMAN$/m);
    assert.match(rendered, new RegExp(`^  ! AWAITING A HUMAN ${esc.id} — ${WHAT} \\(worker, ${T(2)}\\)$`, "m"));
    assert.match(rendered, /1 ESCALATION\(S\) AWAITING A HUMAN/);
    assert.match(rendered, /gates nothing mechanically/, "the limit line states the meaning exactly");

    // It outranks a live write conflict too — resolving a conflict is proceeding.
    const left = createWork(config, {
      session: "one", owner: { session: "one", agent: "a" }, objective: "left", criteria: ["done"],
      authority, risk: "high", writeScopes: ["lib/**"], now: T(3),
    });
    const right = createWork(config, {
      session: "two", owner: { session: "two", agent: "b" }, objective: "right", criteria: ["done"],
      authority, risk: "high", writeScopes: ["lib/file.ts"], now: T(4),
    });
    transitionWork(config, { work: left.work, session: "one", to: "active", reason: "started", now: T(5) });
    transitionWork(config, { work: right.work, session: "two", to: "active", reason: "started", now: T(6) });
    assert.equal((await observeOrientation(config)).action, "await-human");

    appendDecision(config, { kind: "acknowledgement", chose: `(acknowledged: ${esc.id})`, because: "decided", supersedes: esc.id, session: "s-human", agent: "danilo", now: T(7) });
    const cleared = await observeOrientation(config);
    assert.equal(cleared.action, "resolve-conflict", "with the human's decision recorded, the next heading is the conflict");
    assert.deepEqual(cleared.decisions?.openEscalations, []);
  } finally { await cleanup(root); }
});

test("hook text — startup teaches escalate beside blocked and the owner menu lists the cancelled exit", async () => {
  const t = agentInstructions("s-abc", "npx coherence", "worker");
  assert.match(t, /npx coherence escalate "<what a human must see>" --because "<why a human, not a peer>" --session "s-abc" --agent "worker"/);
  assert.match(t, /WHEN A HUMAN MUST DECIDE, ESCALATE — never to a peer, never parked in blocked/);
  assert.match(t, /A human decision, a secret, a policy question, an infeasible or harmful order/);
  assert.match(t, /gates nothing mechanically/);
  assert.match(t, /acknowledge <id> --because/);
  assert.ok(t.indexOf("npx coherence blocked") < t.indexOf("npx coherence escalate"), "taught beside blocked, after it");
  assert.equal(t, agentInstructions("s-abc", "npx coherence", "worker"), "still a pure function");

  const root = await tmpProject();
  try {
    const config = cfg(root);
    const item = createWork(config, {
      session: "orchestrator", owner: { session: "s-owner", agent: "worker" }, objective: "meet the criterion",
      criteria: ["it is met"], authority, risk: "low", now: T(1),
    });
    const ready = (await assignedWorkInstructions(config, "s-owner", "npx coherence", "worker")).join("\n");
    assert.match(ready, new RegExp(`    cancel: npx coherence work close "${item.work}" cancelled --because "WHY_THE_CRITERION_CANNOT_BE_MET" --expected-previous "${item.id}" --session "s-owner" --agent "worker"`));
    assert.match(ready, /cancel is the honest exit when a criterion cannot be met: never fabricate evidence for finish, never park in blocked to avoid it\./);

    const active = transitionWork(config, { work: item.work, session: "s-owner", agent: "worker", to: "active", reason: "go", expectedPrevious: item.id, now: T(2) });
    const working = (await assignedWorkInstructions(config, "s-owner", "npx coherence", "worker")).join("\n");
    const finishAt = working.indexOf("    finish:"), cancelAt = working.indexOf("    cancel:");
    assert.ok(finishAt >= 0 && cancelAt > finishAt, "cancel prints beside finish, right after it");
    assert.match(working, new RegExp(`cancelled --because "WHY_THE_CRITERION_CANNOT_BE_MET" --expected-previous "${active.id}"`));

    const blocked = transitionWork(config, { work: item.work, session: "s-owner", agent: "worker", to: "blocked", reason: "stuck", expectedPrevious: active.id, now: T(3) });
    const stuck = (await assignedWorkInstructions(config, "s-owner", "npx coherence", "worker")).join("\n");
    assert.match(stuck, /    resume:/);
    assert.match(stuck, new RegExp(`    cancel: .*--expected-previous "${blocked.id}"`), "the exit is beside resume too");

    // SubagentStop names an open escalation: the caller may be the human who must see it.
    appendDecision(config, { kind: "escalation", chose: WHAT, because: WHY, session: "s-agent", agent: "worker", now: T(4) });
    assert.match(stopReport(config, "s-agent"), /1 ESCALATION\(S\) AWAITING A HUMAN in this repo/);
  } finally { await cleanup(root); }
});

test("escalate/acknowledge CLI — the public route refuses hollow input with exit 2 and no row, then round-trips", async () => {
  const root = await tmpProject({ "coherence.config.json": "{}\n" });
  const env = { ...process.env };
  for (const key of ["COHERENCE_SESSION", "COHERENCE_AGENT", "COHERENCE_JOB", "CODEX_THREAD_ID", "CLAUDE_PROJECT_DIR", "COHERENCE_PROJECT_ROOT"]) delete env[key];
  const cli = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { cwd: root, encoding: "utf8", env });
  try {
    const scope = ["--session", "s-agent", "--agent", "worker"];
    const hollow = cli("escalate", WHAT, "--because", WHAT, ...scope);
    assert.equal(hollow.status, 2, hollow.stderr);
    assert.match(hollow.stderr, /only restates the what/);
    assert.match(hollow.stderr, /usage: coherence escalate/);
    assert.equal(existsSync(join(root, ".coherence", "decisions")), false, "exit 2 must leave no ledger residue");
    const missing = cli("escalate", WHAT, ...scope);
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /Not `blocked`/);
    const bad = cli("escalate", WHAT, "--because", WHY, "--over", "x", ...scope);
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /unsupported flag\(s\) for escalate: --over/, "an escalation has no alternatives to reject");

    const real = cli("escalate", WHAT, "--because", WHY, "--file", "deploy.sh", ...scope);
    assert.equal(real.status, 0, real.stderr);
    const id = real.stdout.match(/^(d-[0-9a-f]{8})\s+escalation/m)?.[1];
    assert.ok(id, real.stdout);
    assert.match(real.stdout, new RegExp(`coherence acknowledge ${id} --because`), "the closing line is handed back");
    assert.match(real.stdout, /gates nothing mechanically/);
    assert.equal(cli("escalate", WHAT, "--because", WHY, "--file", "deploy.sh", ...scope).stdout, real.stdout, "a re-log dedupes on content");

    assert.match(cli("decisions").stdout, /^ESCALATED — A HUMAN MUST SEE THIS BEFORE ANYONE PROCEEDS$/m);
    assert.match(cli("journal", "--once").stdout, /^ESCALATED — a human must see this before anyone proceeds \(1\):$/m);
    const orient = cli("orient", "--json");
    assert.equal(orient.status, 0, "await-human gates nothing: exit 0");
    assert.equal(JSON.parse(orient.stdout).action, "await-human");

    const noBecause = cli("acknowledge", id!, "--session", "s-human");
    assert.equal(noBecause.status, 2);
    assert.match(noBecause.stderr, /usage: coherence acknowledge/);
    const ack = cli("acknowledge", id!, "--because", "rotated by hand; proceed", "--session", "s-human", "--agent", "danilo");
    assert.equal(ack.status, 0, ack.stderr);
    assert.match(ack.stdout, new RegExp(`acknowledges ${id} — a human decided`));
    const again = cli("acknowledge", id!, "--because", "again", "--session", "s-human");
    assert.equal(again.status, 2);
    assert.match(again.stderr, /already acknowledged/);
    assert.notEqual(JSON.parse(cli("orient", "--json").stdout).action, "await-human");
    assert.doesNotMatch(cli("decisions").stdout, /ESCALATED/);
    assert.match(cli("decisions").stdout, /ACKNOWLEDGED by danilo \(s-human\): rotated by hand; proceed/);
  } finally { await cleanup(root); }
});
