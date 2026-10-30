/**
 * The live reading: the warm server answers the fixture project over HTTP,
 * and a client reads it the way the page does (first load, event stream,
 * history by cursor), folding every update with the page's own merge.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import type { LanguageAdapter } from "../../adapters/adapter.ts";
import { readReliefApart, type ReliefRead, type Touch } from "../relief/relief.ts";
import { loadRuns } from "../../enforcement/record.ts";
import { connectAdapter, serve, type Serving } from "../../enforcement/server.ts";
import { loadJournal } from "../../journal/store.ts";
import { COHERENCE_LEXICON } from "../../lifecycle/project.ts";
import { closeWork, openWork } from "../../lifecycle/work-meter.ts";
import { CONFIG_FILE, loadSpecModel } from "../../spec/model.ts";
import { keptUnlessRejected, scopeState, type BuildOptions, type Shell } from "./build.ts";
import { makeFixture, type Fixture } from "./check-fixture.ts";
import { latestOf } from "./derive.ts";
import { coverageOffLoop, pageCoverage, type CoverageAsk } from "./coverage-reading.ts";
import { PageShell, scopeApp, storeOf, throttle, watchedLexicons, type LiveOptions } from "./live.ts";
import type { CoverageUnread, InterfaceReading, JournalRecord, LexiconCoverage, PageEntry, RecordedSite, RunRecord, ShellState } from "./model.ts";
import { answer } from "../query/query.ts";
import { renderShell, renderView } from "./shell.ts";
import { applyUpdate, cursorsOf, mergeJournal, mergeRuns, mergeSites, parseStream, runKeyOf, type StreamEvent } from "./updates.ts";

interface Live {
  serving: Serving;
  base: string;
  token: string;
  get: (path: string) => Promise<unknown>;
  stop: () => Promise<void>;
}

/** Serve a root with the live reading (no instrument reading, a short settle) and ask it for HTTP, as `scope` does. */
async function live(root: string, options: LiveOptions = {}): Promise<Live> {
  const serving = await serve(root, { idleMs: 60_000, http: scopeApp({ interfaces: false, debounceMs: 30, ...options }) });
  const connected = await connectAdapter(root, { spawn: false });
  const { url } = await connected.adapter.openHttp();
  await connected.adapter.close();
  const address = new URL(url);
  const token = address.searchParams.get("token")!;
  const base = `${address.protocol}//${address.host}`;
  const get = async (path: string): Promise<unknown> => {
    const response = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200, `${path}: ${response.status}`);
    return response.json();
  };
  return { serving, base, token, get, stop: () => serving.stop() };
}

/** An open event stream, read as the page reads it; `until` waits for a condition over the events so far. */
interface Stream {
  events: StreamEvent[];
  until: (done: (events: StreamEvent[]) => boolean, ms?: number) => Promise<boolean>;
  close: () => void;
}

async function openStream(server: Live, state: ShellState): Promise<Stream> {
  const cursors = cursorsOf(state);
  const query = new URLSearchParams({ journal: cursors.journal, runs: cursors.runs, work: cursors.work, version: state.connection?.version ?? "" });
  const abort = new AbortController();
  const response = await fetch(`${server.base}/api/events?${query.toString()}`, { headers: { authorization: `Bearer ${server.token}` }, signal: abort.signal });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
  const events: StreamEvent[] = [];
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        const parsed = parseStream(buffer + value);
        buffer = parsed.rest;
        events.push(...parsed.events);
      }
    } catch {
      // Aborted.
    }
  })();
  const until = async (done: (events: StreamEvent[]) => boolean, ms = 8_000): Promise<boolean> => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (done(events)) return true;
      await new Promise((r) => setTimeout(r, 25));
    }
    return done(events);
  };
  return { events, until, close: () => abort.abort() };
}

/** Fold every event after the first `from` into the state, as the page does; returns how many were applied. */
function fold(state: ShellState, events: readonly StreamEvent[], from = 0): number {
  for (const event of events.slice(from)) {
    const data: unknown = JSON.parse(event.data);
    if (event.event === "ready") state.connection = { ...state.connection, mode: "live", status: "live", version: (data as { version: string }).version };
    else applyUpdate(state, event.event, data);
  }
  return events.length;
}

async function firstLoad(server: Live): Promise<ShellState> {
  const first = (await server.get("/api/state")) as { state: ShellState; version: string; history: { journal?: string; runs?: string } };
  first.state.connection = { mode: "live", status: "connecting", version: first.version, history: first.history };
  return first.state;
}

function decision(fixture: Fixture, id: string, at: string, chose: string): JournalRecord {
  return { id, kind: "decision", at, session: fixture.names.session, agent: "live-test", commit: "abc1234", dirty: false, chose, over: ["a reload"], because: "the page follows the journal" };
}

function appendJournal(fixture: Fixture, record: JournalRecord): void {
  appendFileSync(join(fixture.root, ".coherence", "journal", `${fixture.names.session}.jsonl`), JSON.stringify(record) + "\n");
}

function appendRun(fixture: Fixture, at: string): void {
  const run = { at, session: fixture.names.session, agent: "live-test", commit: "abc1234", dirty: false, instrument: { language: "typescript", server: "warm" }, latency: 1, invariants: [{ component: "src/store", name: "read shape", form: "totality oracle", verdict: "pass", mode: "batched", refutation: "witnessed", bypasses: [], testReferences: 0, files: [], latency: 1, reason: "1 test passed" }] };
  appendFileSync(join(fixture.root, ".coherence", "runs", `${fixture.names.session}.jsonl`), JSON.stringify(run) + "\n");
}

const ids = (state: ShellState): string[] => state.journal.records.map((record) => record.id);

test("a journal record appended while a page is connected reaches it as a live update, and a run the same way", async () => {
  const fixture = makeFixture();
  const server = await live(fixture.root);
  try {
    const state = await firstLoad(server);
    const stream = await openStream(server, state);
    assert.ok(await stream.until((events) => events.some((e) => e.event === "ready")), "the stream says it is ready");
    let seen = fold(state, stream.events);
    const record = decision(fixture, "d-11ve0001", new Date().toISOString(), "the page shows a record the moment it is appended");
    appendJournal(fixture, record);
    assert.ok(await stream.until((events) => events.some((e) => e.event === "journal" && e.data.includes(record.id))), "the append arrives on the stream without a reload");
    seen = fold(state, stream.events, seen);
    assert.ok(ids(state).includes(record.id), "the merged state holds it");
    assert.match(renderView(state, "journal").text, new RegExp(`id="journal-${record.id}"`), "and the journal view renders its card");
    const run = new Date(Date.now() + 1000).toISOString();
    appendRun(fixture, run);
    assert.ok(await stream.until((events) => events.some((e) => e.event === "runs" && e.data.includes(run))), "a run arrives the same way");
    fold(state, stream.events, seen);
    assert.ok(state.runs.records.some((r) => r.at === run), "the merged state holds the run");
    assert.equal(new Set(ids(state)).size, ids(state).length, "no record is held twice");
    stream.close();
  } finally {
    await server.stop();
    fixture.remove();
  }
});

test("coverage never stalls the warm server: the first load is sent before the coverage is read and says it is being read, the reading arrives as an update, a reload carries it as being read again, and the reading runs on one worker thread however many ask", async () => {
  const fixture = makeFixture();
  // Each coverage reading the server asks for waits until the test lets it go.
  const held: (() => void)[] = [];
  const reading = (root: string): CoverageAsk => ({ reading: new Promise((resolve, reject) => held.push(() => pageCoverage(root).then(resolve, reject))), release: async () => {} });
  const server = await live(fixture.root, { coverage: reading });
  const within = <T>(promise: Promise<T>, what: string): Promise<T> =>
    Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${what} waited on the coverage reading`)), 4_000))]);
  const unread = (state: ShellState): CoverageUnread | undefined => {
    const coverage = state.lexicon.coverage;
    return coverage !== undefined && "kind" in coverage ? coverage : undefined;
  };
  try {
    const state = await within(firstLoad(server), "the first load");
    assert.equal(held.length, 1, "the reading was asked for and is still held");
    assert.equal(unread(state)?.kind, "reading", "the first load carries the coverage as being read");
    const lexicon = renderView(state, "lexicon").text;
    assert.match(lexicon, /Still being read/, "the Lexicon view says the coverage is still being read");
    assert.doesNotMatch(lexicon, /No recurring term lacks a definition|Full observed population/, "and shows no signal or total in its place");
    assert.match(answer(state, "lexicon", ["store"]).text, /still being read/, "the agent query says so too");
    const response = await within(fetch(`${server.base}/api/no-such-path`, { headers: { authorization: `Bearer ${server.token}` } }), "another request");
    assert.equal(response.status, 404, "the server answers other requests while the reading is held");

    // The reading lands after the page loaded and before it opens its stream: the stream's catch-up carries it.
    held[0]!();
    for (let i = 0; i < 200 && unread(((await server.get("/api/state")) as { state: ShellState }).state) !== undefined; i++) await new Promise((r) => setTimeout(r, 25));
    const stream = await openStream(server, state);
    assert.ok(await stream.until((events) => events.some((e) => e.event === "ready")));
    assert.ok(stream.events.some((e) => e.event === "snapshot"), "the reading moved the state's version, so the page that loaded before it is sent a snapshot");
    let seen = fold(state, stream.events);
    assert.equal(unread(state), undefined, "the merged state holds the reading");
    assert.deepEqual(state.lexicon.coverage, await pageCoverage(fixture.root), "the reading the page carries is the page's own coverage");
    assert.match(renderView(state, "lexicon").text, /Full observed population/, "and the Lexicon view shows it");

    // A spec changes: the reloaded snapshot carries the coverage as being read again, and the new reading follows.
    appendFileSync(join(fixture.root, "Fixture.spec.md"), "\nA line the reload reads.\n");
    assert.ok(await stream.until((events) => events.slice(seen).some((e) => e.event === "snapshot")), "the reload arrives as a snapshot");
    seen = fold(state, stream.events, seen);
    assert.equal(unread(state)?.kind, "reading", "the snapshot's merge carries the coverage as being read again");
    assert.ok(await stream.until(() => held.length === 2), "the reload asked for the reading again");
    held[1]!();
    assert.ok(await stream.until((events) => events.slice(seen).some((e) => e.event === "coverage")), "the new reading arrives as an update");
    fold(state, stream.events, seen);
    assert.equal(unread(state), undefined, "and the merged state holds it");
    const latest = (await server.get("/api/state")) as { version: string };
    assert.equal(state.connection?.version, latest.version, "at the version the reading moved the state to");
    stream.close();
  } finally {
    await server.stop();
  }
  // The server's own reader: one worker thread for every caller asking at once, and no reading on the caller's thread.
  try {
    const scope = openWork();
    let both: LexiconCoverage[];
    try {
      const asks = [coverageOffLoop(fixture.root), coverageOffLoop(fixture.root)];
      both = await Promise.all(asks.map((ask) => ask.reading));
      for (const ask of asks) await ask.release();
    } finally {
      closeWork(scope);
    }
    assert.equal(scope.work.spawns.filter((line) => line.startsWith("worker")).length, 1, `two callers at once share one worker thread (${scope.work.spawns.join("; ")})`);
    assert.equal(scope.work.counts["coverage reading"], 0, "the caller's thread takes no coverage reading");
    assert.equal(both[0], both[1], "both callers get the one reading");
    assert.deepEqual(both[0], await pageCoverage(fixture.root), "the worker's reading is the page's coverage");
    // Released before it lands, the reading's worker is stopped, and the release returns once its thread has ended.
    const dropped = coverageOffLoop(fixture.root);
    await dropped.release();
    await assert.rejects(dropped.reading, /exited/, "the last release of a running reading stops its worker");
  } finally {
    fixture.remove();
  }
});

test("a page that reconnects with its cursors gets every record appended while it was away, each once, across a server restart", async () => {
  const fixture = makeFixture();
  let server = await live(fixture.root);
  try {
    const state = await firstLoad(server);
    const stream = await openStream(server, state);
    assert.ok(await stream.until((events) => events.some((e) => e.event === "ready")));
    fold(state, stream.events);
    const before = ids(state);
    const latest = state.journal.records.at(-1)!;
    stream.close();

    // Away from the same server: one record after the page's cursor, and one a slower writer stamped a moment before the page's latest.
    const early = decision(fixture, "d-a11b0001", new Date(Date.parse(latest.at) + 4_000).toISOString(), "appended while the page was away from a running server");
    const slow = decision(fixture, "d-a11b0000", new Date(Date.parse(latest.at) - 2_000).toISOString(), "stamped before the page's latest, appended after it, same server");
    for (const record of [early, slow]) appendJournal(fixture, record);
    // The server has read both before the page returns, so only the catch-up can bring them: nothing is broadcast to a page that is away.
    const has = async (id: string): Promise<boolean> => (await fetch(`${server.base}/api/record?id=${id}`, { headers: { authorization: `Bearer ${server.token}` } })).status === 200;
    for (let i = 0; i < 200 && !((await has(early.id)) && (await has(slow.id))); i++) await new Promise((r) => setTimeout(r, 25));
    const back = await openStream(server, state);
    assert.ok(await back.until((events) => events.some((e) => e.event === "ready")), "the page reconnects to the running server");
    assert.ok(!back.events.some((e) => e.event === "snapshot"), "the same server's version is the page's, so no snapshot is resent");
    fold(state, back.events);
    for (const record of [early, slow]) assert.equal(ids(state).filter((id) => id === record.id).length, 1, `${record.id} is held exactly once after the catch-up`);
    back.close();
    const { port } = new URL(server.base);
    await server.stop();

    // While the page is away and the server is down: a record after its cursor, a second one, and one a slower writer stamped before its latest.
    const later = decision(fixture, "d-a11a0001", new Date(Date.parse(latest.at) + 5_000).toISOString(), "appended while the page was away");
    const second = decision(fixture, "d-a11a0002", new Date(Date.parse(latest.at) + 6_000).toISOString(), "appended while the page was away, second");
    const late = decision(fixture, "d-a11a0000", new Date(Date.parse(latest.at) - 1_000).toISOString(), "stamped before the page's latest, appended after it");
    for (const record of [later, second, late]) appendJournal(fixture, record);

    server = await live(fixture.root);
    assert.equal(new URL(server.base).port, port, "the restarted server answers where the page left it");
    const again = await openStream(server, state);
    assert.ok(await again.until((events) => events.some((e) => e.event === "ready")), "the page reconnects with the same token");
    fold(state, again.events);
    const after = ids(state);
    for (const record of [early, slow, later, second, late]) assert.equal(after.filter((id) => id === record.id).length, 1, `${record.id} is held exactly once`);
    assert.equal(new Set(after).size, after.length, "no record is held twice");
    for (const id of before) assert.ok(after.includes(id), `${id}, held before, is still held`);
    assert.equal(after.length, before.length + 5, "nothing was lost and nothing added twice");
    const caughtUp = again.events.filter((e) => e.event === "journal").flatMap((e) => (JSON.parse(e.data) as { records: JournalRecord[] }).records.map((r) => r.id));
    assert.ok(caughtUp.includes(latest.id), "the catch-up overlapped what the page held, and the merge kept one copy");
    again.close();
  } finally {
    await server.stop();
    fixture.remove();
  }
});

test("the first load stays flat as the journal, the runs and the code grow, every derived verdict is unchanged, and history loads every record left out by cursor, once", async () => {
  const grown = makeFixture();
  try {
    const session = "s-growth";
    // The code grows too: files the relief counts in the first load and serves by folder.
    const code = (files: number, from: number): void => {
      mkdirSync(join(grown.root, "src/api/routes"), { recursive: true });
      for (let i = from; i < from + files; i++) writeFileSync(join(grown.root, `src/api/routes/route${i}.ts`), `export function route${i}(request: string): string {\n  return request;\n}\n`);
    };
    const grow = (records: number, runs: number, from: number): void => {
      const journal = Array.from({ length: records }, (_, i) => JSON.stringify({ id: `d-${(from + i).toString(16).padStart(8, "0")}`, kind: "decision", at: new Date(Date.UTC(2026, 8, 12) + (from + i) * 1000).toISOString(), session, agent: "growth", commit: "abc1234", dirty: false, chose: `choice ${from + i} with some words to weigh the record`, over: ["the other one"], because: "the test grows the journal" }));
      appendFileSync(join(grown.root, `.coherence/journal/${session}.jsonl`), journal.join("\n") + "\n");
      const run = (i: number): string => JSON.stringify({ at: new Date(Date.UTC(2026, 8, 12) + (from + i) * 1000).toISOString(), session, agent: "growth", commit: "abc1234", dirty: false, instrument: { language: "typescript", server: "warm" }, latency: 3, invariants: [{ component: "src/store", name: "read shape", form: "totality oracle", verdict: "pass", mode: "batched", refutation: "witnessed", bypasses: [], testReferences: 0, files: [], latency: 1, reason: "1 test passed" }] });
      appendFileSync(join(grown.root, `.coherence/runs/${session}.jsonl`), Array.from({ length: runs }, (_, i) => run(i)).join("\n") + "\n");
    };
    // The chokepoint's latest check, with more reference sites each time: the code grows as well as the stores.
    const check = (sites: number, phase: number): RecordedSite[] => {
      const recorded = Array.from({ length: sites }, (_, i): RecordedSite => ({ file: i % 3 === 0 ? "src/api/handler.test.ts" : "src/api/handler.ts", line: i + 1, symbol: `caller${i}`, class: i % 3 === 0 ? "test" : "chokepoint-reference", of: "chokepoint", test: i % 3 === 0 }));
      const entry = { component: "src/store", name: "single writer", form: "chokepoint", grade: "reference-choked", verdict: "pass", refutation: "automatic", bypasses: [], testReferences: 0, files: [], latency: 1, reason: "every write passes the door", sites: recorded };
      appendFileSync(join(grown.root, `.coherence/runs/s-check.jsonl`), JSON.stringify({ at: new Date(Date.UTC(2026, 8, 13) + phase * 1000).toISOString(), session: "s-check", agent: "growth", commit: "abc1234", dirty: false, instrument: { language: "typescript", server: "warm" }, latency: 3, invariants: [entry] }) + "\n");
      return recorded;
    };
    const firstLoadBytes = async (): Promise<{ bytes: number; state: ShellState; server: Live }> => {
      const server = await live(grown.root);
      const response = await fetch(`${server.base}/api/state`, { headers: { authorization: `Bearer ${server.token}` } });
      const text = await response.text();
      const first = JSON.parse(text) as { state: ShellState; version: string; history: { journal?: string; runs?: string } };
      first.state.connection = { mode: "live", status: "live", version: first.version, history: first.history };
      return { bytes: Buffer.byteLength(text, "utf8"), state: first.state, server };
    };
    grow(400, 60, 0);
    check(800, 0);
    code(20, 0);
    const small = await firstLoadBytes();
    await small.server.stop();
    grow(2000, 300, 400);
    const sites = check(8000, 1);
    code(2000, 20);
    const large = await firstLoadBytes();
    try {
      assert.ok(Math.abs(large.bytes - small.bytes) < 1024, `the first load stays flat: ${small.bytes} bytes, then ${large.bytes} after 2000 records, 300 runs, 7200 reference sites and 2000 code files more`);
      const state = large.state;
      // The relief counts every file and lists none; the files load by their folder, every one.
      assert.equal(state.relief?.kind, "read", "the relief was read");
      const api = state.relief!.kind === "read" ? state.relief!.components.find((c) => c.folder === "src/api")! : undefined;
      assert.equal(api?.files, 2021, "the first load counts every file of the component");
      const served = (await large.server.get(`/api/relief/files?folder=src%2Fapi`)) as { stamp: string; folders: Record<string, { file: string }[]> };
      assert.equal(served.folders["src/api"]!.length, 2021, "and the files route lists every one");
      assert.equal(served.stamp, state.relief!.kind === "read" ? state.relief!.stamp : "", "under the reading the first load carried");
      const allJournal = loadJournal(grown.root).records;
      const allRuns = loadRuns(grown.root).records;
      assert.equal(state.journal.records.length + (state.journal.omitted ?? 0), allJournal.length, "every journal record is loaded or counted");
      assert.equal(state.runs.records.length + (state.runs.omitted ?? 0), allRuns.length, "every run is loaded or counted");
      assert.ok(state.journal.records.some((r) => r.id === grown.names.openEscalation), "an open escalation is in the first load however old");
      const whole = await scopeState({ root: grown.root, lexiconPath: COHERENCE_LEXICON, project: "Fixture", window: false });
      // The reference sites the first load counted and did not list load by their run and enforcement, every one.
      const latestCheck = state.runs.records.find((r) => r.session === "s-check" && r.at === new Date(Date.UTC(2026, 8, 13) + 1000).toISOString())!;
      const carried = latestCheck.invariants[0] as PageEntry;
      assert.ok(carried.sites!.length < sites.length && carried.sitesLeft !== undefined, `the first load lists ${carried.sites!.length} of ${sites.length} sites and counts the rest`);
      const answer = (await large.server.get(`/api/sites?run=${encodeURIComponent(runKeyOf(latestCheck))}&component=src%2Fstore&name=single%20writer`)) as { sites: RecordedSite[] };
      assert.deepEqual(answer.sites, sites, "the live page's server answers every site of the entry");
      assert.ok(mergeSites(state, runKeyOf(latestCheck), "src/store", "single writer", answer.sites));
      for (const invariant of whole.spec.components.flatMap((c) => c.invariants)) {
        assert.deepEqual(latestOf(invariant, state.runs.records), latestOf(invariant, whole.runs.records), `${invariant.name}: the first load derives the same latest verdicts`);
      }
      assert.match(renderShell(state).text, new RegExp(`${allJournal.length} journal records`), "the masthead counts every record");
      assert.match(renderView(state, "journal").text, /data-history="journal"/, "the journal view offers the rest");

      // Page back as the page does: from the server's hint, then below the oldest record each page returned.
      for (const store of ["journal", "runs"] as const) {
        let before = state.connection!.history![store] ?? "";
        for (let pages = 0; pages < 50; pages++) {
          const answer = (await large.server.get(`/api/${store}?before=${encodeURIComponent(before)}&limit=200`)) as { records: (JournalRecord | RunRecord)[]; more: boolean };
          if (store === "journal") mergeJournal(state, answer.records as JournalRecord[], true);
          else mergeRuns(state, answer.records as RunRecord[], true);
          const oldest = answer.records[0] as { at: string; id?: string; session: string } | undefined;
          if (!answer.more || oldest === undefined) break;
          before = `${oldest.at}~${oldest.id ?? oldest.session}`;
        }
      }
      assert.deepEqual(ids(state), allJournal.map((r) => r.id), "history loaded every journal record, in order, once");
      assert.equal(state.journal.omitted, undefined, "and nothing is counted as left out");
      assert.deepEqual(state.runs.records.map(runKeyOf), allRuns.map(runKeyOf), "and every run, once");
      assert.equal(state.runs.omitted, undefined);
      const found = (await large.server.get(`/api/journal?q=${encodeURIComponent("choice 17 with")}`)) as { records: JournalRecord[] };
      assert.deepEqual(found.records.map((r) => r.id), [`d-${(17).toString(16).padStart(8, "0")}`], "a search reaches records the first load left out");
      const one = (await large.server.get(`/api/record?id=${encodeURIComponent(allJournal[3]!.id)}`)) as { records: JournalRecord[] };
      assert.equal(one.records[0]?.id, allJournal[3]!.id, "a citation's record loads by id");
    } finally {
      await large.server.stop();
    }
  } finally {
    grown.remove();
  }
});

test("the relief's files load by folder: a folder the relief read is answered whole, any other name is refused, and a reread that changed the reading answers under a new stamp", async () => {
  const fixture = makeFixture();
  const server = await live(fixture.root);
  try {
    const status = async (query: string): Promise<number> => (await fetch(`${server.base}/api/relief/files?${query}`, { headers: { authorization: `Bearer ${server.token}` } })).status;
    // An odd name is refused before the state loads at all.
    for (const odd of ["..", "../etc", "/etc", "/", "-n", "--output=x", "src/../src", "src/./store", "src//store", "src/store/", "src\\store", "", "src/\u0000"]) {
      assert.equal(await status(`folder=${encodeURIComponent(odd)}`), 400, `${JSON.stringify(odd)} is refused as no folder name`);
    }
    assert.equal(await status(""), 400, "a request naming no folder is refused");
    const state = await firstLoad(server);
    assert.equal(state.relief?.kind, "read");
    const relief = state.relief as Extract<NonNullable<ShellState["relief"]>, { kind: "read" }>;
    assert.equal(JSON.stringify(relief).includes("write.ts"), false, "the first load names no file");
    const store = relief.components.find((c) => c.folder === "src/store")!;
    const answer = (await server.get(`/api/relief/files?folder=src%2Fstore&folder=.`)) as { stamp: string; folders: Record<string, { file: string; lines: number }[]> };
    assert.equal(answer.stamp, relief.stamp);
    assert.deepEqual(Object.keys(answer.folders).sort(), [".", "src/store"], "each folder asked for, and only those");
    assert.equal(answer.folders["src/store"]!.length, store.files);
    assert.ok(answer.folders["src/store"]!.some((f) => f.file === "src/store/write.ts" && f.lines === 1));
    // A name of a folder's shape that the relief did not read is refused by lookup, and with it every folder the request named.
    for (const unknown of ["src/nowhere", "node_modules", "src/store/write.ts", ".git"]) assert.equal(await status(`folder=${encodeURIComponent(unknown)}`), 404, `${unknown} is no folder the relief read`);
    assert.equal(await status("folder=src%2Fstore&folder=..%2Fetc"), 400, "one odd name refuses the whole request");
    assert.equal(await status("folder=src%2Fstore&folder=src%2Fnowhere"), 404, "one unknown folder refuses the whole request");

    // A spec edit rereads the relief; the file written meanwhile is in the new reading, under a new stamp.
    writeFileSync(join(fixture.root, "src/store/later.ts"), "export const later = 1;\nexport const again = 2;\n");
    appendFileSync(join(fixture.root, "src/store/Store.spec.md"), "\n");
    let after: { stamp: string; folders: Record<string, { file: string }[]> } | undefined;
    for (const deadline = Date.now() + 20_000; Date.now() < deadline; await new Promise((r) => setTimeout(r, 100))) {
      after = (await server.get(`/api/relief/files?folder=src%2Fstore`)) as typeof after;
      if (after!.stamp !== relief.stamp) break;
    }
    assert.notEqual(after!.stamp, relief.stamp, "the reread answers under a new stamp");
    assert.ok(after!.folders["src/store"]!.some((f) => f.file === "src/store/later.ts"), "with the files as they now stand");
  } finally {
    await server.stop();
    fixture.remove();
  }
});

test("every file the spec model reads by name refreshes the live reading: each spec and practice file it read for a project with components and a practice, and the config", async () => {
  // A project shaped as Coherence's own is (a root spec, components, a practice beside a spec), never Coherence's whole tree, whose listing costs more with every merge.
  const root = mkdtempSync(join(tmpdir(), "coherence-live-model-"));
  const files: Record<string, string> = {
    [CONFIG_FILE]: JSON.stringify({ name: "model" }),
    "Model.spec.md": "# Model\n\nThe project.\n",
    "src/gadget/Gadget.spec.md": "# Gadget\n\nThe gadget.\n",
    "src/gadget/Gadget.practice.md": "- tune the gadget: A gadget is tuned before it ships.\n  when: command gadget tune\n  step: tune it\n  because: an untuned gadget rattles\n",
    "src/gadget/gadget.ts": "export const gadget = 1;\n",
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const scope = openWork();
  try {
    loadSpecModel(root, { runs: false });
  } finally {
    closeWork(scope);
    rmSync(root, { recursive: true, force: true });
  }
  const named = scope.work.reads.filter((read) => read.startsWith("spec ") || read.startsWith("practice ")).map((read) => relative(root, read.slice(read.indexOf(" ") + 1)));
  assert.ok(named.some((file) => file.endsWith(".practice.md")), "the model read a practice file");
  for (const file of named) assert.equal(storeOf(file, []), "model", `${file} is read by the model, so a change to it refreshes the reading`);
  assert.equal(storeOf(CONFIG_FILE, []), "model");
  assert.equal(storeOf("src/widget/Widget.practice.md", []), "model", "a practice file not yet written refreshes the reading once it is");
  assert.equal(storeOf("src/widget/widget.ts", []), undefined, "a source file is no file the model reads by name");
  // The lexicons are located as the state's load locates them: a config that names one elsewhere is followed.
  const project = mkdtempSync(join(tmpdir(), "coherence-live-lexicon-"));
  try {
    writeFileSync(join(project, CONFIG_FILE), JSON.stringify({ lexicon: "vocab/terms.json" }));
    const lexicons = await watchedLexicons(project, { lexiconPath: COHERENCE_LEXICON });
    assert.equal(storeOf("vocab/terms.json", lexicons), "model", "the lexicon the config names refreshes the reading");
    assert.equal(storeOf("lexicon.json", lexicons), "model", "and one written later at the default name");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("a page source that does not build leaves the last good page served and open pages where they are, and the next build tries again", async () => {
  const said: string[] = [];
  let broken = false;
  let builds = 0;
  // An injected bundler: the sources build until a save breaks them.
  const make = async (): Promise<Shell> => {
    builds++;
    if (broken) throw new Error("page.ts:3:1: Unexpected end of file");
    return { html: `page ${builds}`, scriptHash: `h${builds}` };
  };
  const shell = new PageShell(make, () => {}, (line) => said.push(line));
  // A first build that fails answers that request with the error and is never kept.
  broken = true;
  await assert.rejects(shell.current(), /Unexpected end of file/);
  broken = false;
  assert.equal((await shell.current()).html, "page 2");
  assert.equal((await shell.current()).html, "page 2", "kept once it built");
  // Saved mid-edit with a syntax error: no reload, the last good page served, the failure said once.
  broken = true;
  assert.equal(await shell.rebuild(), false, "open pages are not told to reload onto a page that did not build");
  assert.equal(await shell.rebuild(), false);
  assert.equal((await shell.current()).html, "page 2");
  assert.equal(said.length, 1, "a failure is said once, not once per save");
  // Fixed: the next save builds, replaces the page, and reloads open pages.
  broken = false;
  assert.equal(await shell.rebuild(), true);
  assert.equal((await shell.current()).html, "page 5");
  // Saves in quick succession build once, from the newest sources.
  const before = builds;
  assert.deepEqual(await Promise.all([shell.rebuild(), shell.rebuild(), shell.rebuild()]), [false, false, true]);
  assert.equal(builds, before + 1);

  // The bundle beneath the page keeps a result, never a failure.
  let attempts = 0;
  const bundle = keptUnlessRejected(async () => {
    attempts++;
    if (attempts === 1) throw new Error("broken");
    return `bundle ${attempts}`;
  });
  await assert.rejects(bundle.get(), /broken/);
  assert.equal(await bundle.get(), "bundle 2", "a failed bundle is made again");
  assert.equal(await bundle.get(), "bundle 2", "a good one is kept");
  bundle.forget();
  assert.equal(await bundle.get(), "bundle 3");
});

/** The relief a state or a snapshot carries, by its stamp; "" when it holds none that was read. */
const stampOf = (state: ShellState): string => (state.relief?.kind === "read" ? state.relief.stamp : "");
const snapshots = (events: readonly StreamEvent[]): ShellState[] => events.filter((e) => e.event === "snapshot").map((e) => (JSON.parse(e.data) as { state: ShellState }).state);

test("a spec edit sends the model at once and the relief as a snapshot of its own when it lands, and a page that loaded between them is sent the relief when its stream opens", async () => {
  const fixture = makeFixture();
  // The relief read as the server reads it, then held until the model's snapshot is in: on a slow machine it could otherwise land first, which the server allows.
  let hold: Promise<void> | undefined;
  let release = (): void => {};
  const reliefReading = async (root: string, signal: AbortSignal): Promise<ReliefRead> => {
    const read = await readReliefApart(root, signal);
    if (hold !== undefined) await hold;
    return read;
  };
  const server = await live(fixture.root, { reliefReading });
  try {
    const state = await firstLoad(server);
    const held = stampOf(state);
    hold = new Promise((resolve) => (release = resolve));
    assert.notEqual(held, "", "the first load carries the relief");
    const stream = await openStream(server, state);
    assert.ok(await stream.until((events) => events.some((e) => e.event === "ready")));
    const from = stream.events.length;
    // A file the relief counts, and a spec edit that reads the model again.
    writeFileSync(join(fixture.root, "src/store/later.ts"), "export const later = 1;\n");
    appendFileSync(join(fixture.root, "src/store/Store.spec.md"), "\n");
    assert.ok(await stream.until((events) => snapshots(events.slice(from)).length >= 1, 20_000), "the model's snapshot arrives");
    // A second page loads now, before the relief has landed; its stream must leave it holding the newest relief.
    const second = await firstLoad(server);
    release();
    assert.ok(await stream.until((events) => snapshots(events.slice(from)).some((s) => stampOf(s) !== held), 20_000), "the relief's own snapshot arrives");
    const sent = snapshots(stream.events.slice(from));
    assert.equal(stampOf(sent[0]!), held, "the model's snapshot never waited on the relief: it carries the relief held until then");
    const fresh = stampOf(sent.at(-1)!);
    assert.notEqual(fresh, held, "and the relief lands after it, under a new stamp");
    fold(state, stream.events, 0);
    assert.equal(stampOf(state), fresh, "the first page merged it");
    const back = await openStream(server, second);
    assert.ok(await back.until((events) => events.some((e) => e.event === "ready")));
    fold(second, back.events);
    assert.equal(stampOf(second), fresh, "a page that loaded before the relief landed holds it once its stream opens");
    stream.close();
    back.close();
  } finally {
    await server.stop();
    fixture.remove();
  }
});

test("a rebuild never holds the live routes: while the model is read again every route answers from the state held, each rebuild lands as one snapshot, edits meanwhile fold into one more, and every record appended meanwhile reaches the page once", async () => {
  const fixture = makeFixture();
  let held: Promise<void> | undefined;
  let release = (): void => {};
  let loads = 0;
  // The model read as the server reads it, then held: whatever is appended while it is held, this read never saw.
  const load = async (options: BuildOptions): Promise<ShellState> => {
    loads += 1;
    const state = await scopeState(options);
    if (held !== undefined) await held;
    return state;
  };
  const server = await live(fixture.root, { load });
  // An answer, or 0 when none came within three seconds: a route held behind the rebuild says so on the assertion that asked it.
  const answer = async (path: string): Promise<{ status: number; body: unknown }> => {
    const asked = fetch(`${server.base}${path}`, { headers: { authorization: `Bearer ${server.token}` } }).then(async (response) => ({ status: response.status, body: (await response.json()) as unknown }));
    asked.catch(() => {});
    return Promise.race([asked, new Promise<{ status: number; body: unknown }>((r) => setTimeout(() => r({ status: 0, body: {} }), 3_000))]);
  };
  const spec = join(fixture.root, "src/store/Store.spec.md");
  try {
    const state = await firstLoad(server);
    const first = state.connection!.version!;
    const stream = await openStream(server, state);
    assert.ok(await stream.until((events) => events.some((e) => e.event === "ready")));
    const from = stream.events.length;
    const loaded = loads;
    held = new Promise((resolve) => (release = resolve));
    appendFileSync(spec, "\n");
    for (let i = 0; i < 400 && loads === loaded; i++) await new Promise((r) => setTimeout(r, 25));
    assert.equal(loads, loaded + 1, "the spec edit began a rebuild");

    // While it reads: the first load, history and a record answer at once, from the state held.
    const during = (await answer("/api/state")) as { status: number; body: { version: string } };
    assert.equal(during.status, 200, "the state route answered during the rebuild");
    assert.equal(during.body.version, first, "with the state held, under its version");
    for (const path of ["/api/journal", "/api/runs"]) assert.equal((await answer(path)).status, 200, `${path} answered during the rebuild`);
    const appended = decision(fixture, "d-4eb00001", new Date().toISOString(), "appended while the model is read again");
    appendJournal(fixture, appended);
    const run = new Date(Date.now() + 1000).toISOString();
    appendRun(fixture, run);
    assert.ok(await stream.until((events) => events.some((e) => e.event === "journal" && e.data.includes(appended.id)) && events.some((e) => e.event === "runs" && e.data.includes(run))), "an append is pushed while the rebuild reads");
    assert.equal((await answer(`/api/record?id=${appended.id}`)).status, 200, "and its record answers by id");
    // Two more edits while it reads: they ask for one rebuild more between them.
    appendFileSync(spec, "\n");
    await new Promise((r) => setTimeout(r, 500));
    appendFileSync(spec, "\n");
    await new Promise((r) => setTimeout(r, 500));
    const later = decision(fixture, "d-4eb00002", new Date(Date.now() + 2000).toISOString(), "appended after the edits that wait");
    appendJournal(fixture, later);
    assert.ok(await stream.until((events) => events.some((e) => e.event === "journal" && e.data.includes(later.id))));
    assert.equal(loads, loaded + 1, "no second rebuild starts while one reads");
    assert.equal(snapshots(stream.events.slice(from)).length, 0, "nothing lands while the rebuild reads");

    held = undefined;
    release();
    assert.ok(await stream.until((events) => snapshots(events.slice(from)).length >= 2, 20_000), "the rebuild lands, then the one the later edits asked for");
    await new Promise((r) => setTimeout(r, 800));
    assert.equal(loads, loaded + 2, "the edits made during the rebuild were read once more, together");
    const landed = snapshots(stream.events.slice(from));
    assert.equal(landed.length, 2, "each rebuild landed as one snapshot");
    for (const snapshot of landed) {
      for (const record of [appended, later]) assert.ok(snapshot.journal.records.some((r) => r.id === record.id), `the landed state holds ${record.id}, which the rebuild's own read never saw`);
      assert.ok(snapshot.runs.records.some((r) => r.at === run), "and the run");
    }
    const sent = (id: string): number => stream.events.filter((e) => e.event === "journal").flatMap((e) => (JSON.parse(e.data) as { records: JournalRecord[] }).records).filter((r) => r.id === id).length;
    for (const record of [appended, later]) assert.equal(sent(record.id), 1, `${record.id} was sent once as an append, never again across the landing`);
    const history = (await answer("/api/journal")) as { body: { records: JournalRecord[] } };
    for (const record of [appended, later]) assert.ok(history.body.records.some((r) => r.id === record.id), `history answers ${record.id} after the landing`);
    fold(state, stream.events);
    for (const record of [appended, later]) assert.equal(ids(state).filter((id) => id === record.id).length, 1, `the page holds ${record.id} once`);
    assert.equal(state.runs.records.filter((r) => r.at === run).length, 1, "and the run once");
    const now = (await answer("/api/state")) as { body: { version: string } };
    assert.equal(state.connection?.version, now.body.version, "the page holds the version the server now answers");
    stream.close();
  } finally {
    held = undefined;
    release();
    await server.stop();
    fixture.remove();
  }
});

test("the component interfaces reach a page that loaded the state before they were read and opened its stream after: the reading moves the state's version", async () => {
  const fixture = makeFixture();
  let release = (): void => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  const read: InterfaceReading = { kind: "unread", because: "the test's own reading, landed" };
  const server = await live(fixture.root, { interfaces: true, interfaceReading: async () => (await held, read) });
  try {
    const early = await firstLoad(server);
    const late = await firstLoad(server);
    assert.notEqual(early.componentInterfaces.kind === "unread" ? early.componentInterfaces.because : "", read.because, "the first load goes before the reading lands");
    const stream = await openStream(server, early);
    assert.ok(await stream.until((events) => events.some((e) => e.event === "ready")));
    release();
    assert.ok(await stream.until((events) => events.some((e) => e.event === "interfaces")), "a connected page is sent the reading");
    fold(early, stream.events);
    assert.deepEqual(early.componentInterfaces, read);
    const back = await openStream(server, late);
    assert.ok(await back.until((events) => events.some((e) => e.event === "ready")));
    assert.ok(back.events.some((e) => e.event === "snapshot"), "a page that loaded before the reading landed is sent a snapshot when its stream opens");
    fold(late, back.events);
    assert.deepEqual(late.componentInterfaces, read, "and holds the reading");
    const again = await openStream(server, early);
    assert.ok(await again.until((events) => events.some((e) => e.event === "ready")));
    assert.ok(!again.events.some((e) => e.event === "snapshot"), "a page that merged the reading holds the version it moved to, so it is sent no snapshot again");
    for (const s of [stream, back, again]) s.close();
  } finally {
    release();
    await server.stop();
    fixture.remove();
  }
});

test("a commit reads the relief again, in a worktree whose git folders lie outside it", async () => {
  const fixture = makeFixture();
  const elsewhere = mkdtempSync(join(tmpdir(), "coherence-live-worktree-"));
  const run = (cwd: string, ...args: string[]): string => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const worktree = join(elsewhere, "side");
  let server: Live | undefined;
  try {
    run(fixture.root, "init", "-q");
    run(fixture.root, "add", "-A");
    run(fixture.root, "commit", "-q", "-m", "the fixture");
    run(fixture.root, "worktree", "add", "-q", "-b", "side", worktree);
    server = await live(worktree);
    const state = await firstLoad(server);
    const held = state.relief?.kind === "read" ? state.relief : undefined;
    assert.equal(held?.landings.length, 1, "the worktree's one landing");
    const stream = await openStream(server, state);
    assert.ok(await stream.until((events) => events.some((e) => e.event === "ready")));
    // A commit in the worktree moves a ref in the repository's common folder, outside the root the server watches.
    writeFileSync(join(worktree, "src/api/more.ts"), "export const more = 1;\nexport const again = 2;\n");
    run(worktree, "add", "-A");
    run(worktree, "commit", "-q", "-m", "a second landing");
    const landed = (s: ShellState): boolean => s.relief?.kind === "read" && s.relief.landings.length === 2;
    assert.ok(await stream.until((events) => snapshots(events).some(landed), 20_000), "the commit is read as a landing without a spec edit");
    fold(state, stream.events);
    assert.equal(state.relief?.kind === "read" ? state.relief.landings[0]!.subject : "", "a second landing");
    stream.close();
  } finally {
    await server?.stop();
    rmSync(elsewhere, { recursive: true, force: true });
    fixture.remove();
  }
});

test("agent activity reaches a connected page once per line, and the traces before the server or while no page was connected are never sent", async () => {
  const fixture = makeFixture();
  const traces = join(fixture.root, ".coherence", "traces");
  const line = (session: string, file: string): string => `${JSON.stringify({ kind: "read", at: new Date().toISOString(), session, file })}\n`;
  mkdirSync(traces, { recursive: true });
  writeFileSync(join(traces, "s-old.jsonl"), line("s-old", "src/history.ts"));
  const server = await live(fixture.root);
  try {
    const state = await firstLoad(server);
    const touched = (events: readonly StreamEvent[]): string[] => events.filter((e) => e.event === "touch").flatMap((e) => (JSON.parse(e.data) as { touches: Touch[] }).touches.flatMap((t) => t.files));
    let stream = await openStream(server, state);
    assert.ok(await stream.until((events) => events.some((e) => e.event === "ready")));
    appendFileSync(join(traces, "s-old.jsonl"), line("s-old", "src/one.ts"));
    writeFileSync(join(traces, "s-new.jsonl"), line("s-new", "src/two.ts"));
    assert.ok(await stream.until((events) => touched(events).length >= 2), "each appended line arrives");
    // A beat or two more: nothing is sent twice.
    await new Promise((r) => setTimeout(r, 400));
    assert.deepEqual(touched(stream.events).sort(), ["src/one.ts", "src/two.ts"], "each once, and the trace's history never");
    stream.close();

    // No page connected: what is appended is never read, and is history to the next page.
    // The server sees the stream end, and the beat after it passes.
    await new Promise((r) => setTimeout(r, 300));
    appendFileSync(join(traces, "s-old.jsonl"), line("s-old", "src/away.ts"));
    await new Promise((r) => setTimeout(r, 600));
    stream = await openStream(server, state);
    assert.ok(await stream.until((events) => events.some((e) => e.event === "ready")));
    appendFileSync(join(traces, "s-old.jsonl"), line("s-old", "src/back.ts"));
    assert.ok(await stream.until((events) => touched(events).includes("src/back.ts")), "a line appended once a page is back arrives");
    assert.deepEqual(touched(stream.events), ["src/back.ts"], "the line appended while no page was connected never does");
    stream.close();
  } finally {
    await server.stop();
    fixture.remove();
  }
});

test("a close during the first load is final: no watcher is left open, and the state's worker and the relief's are stopped", async () => {
  const fixture = makeFixture();
  const watchers = (): number => process.getActiveResourcesInfo().filter((kind) => kind === "FSEventWrap").length;
  const before = watchers();
  const said: string[] = [];
  const app = scopeApp({ interfaces: false, debounceMs: 30 })({ root: fixture.root, adapter: {} as LanguageAdapter, log: (line) => said.push(line), keepAlive: () => {} });
  const answered: number[] = [];
  const response = { writeHead: (status: number) => answered.push(status), end: () => {} } as unknown as ServerResponse;
  try {
    // The first load starts with the request, and the close comes while its state and relief are still being read.
    const asked = app.handle({ method: "GET" } as IncomingMessage, response, new URL("http://127.0.0.1/api/state"));
    await app.close();
    // The request in flight is refused with the stop, or answered had the state been read before it.
    await Promise.resolve(asked).catch((error: unknown) => assert.match(String(error), /was stopped/));
    assert.equal(watchers(), before, "nothing the first load would have watched is open");
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(watchers(), before, "and nothing opens later");
    assert.deepEqual(said, [], `nothing failed: ${said.join("; ")}`);
  } finally {
    fixture.remove();
  }
});

test("agent activity is sent on a beat while an agent keeps working, never held until it pauses, and the last of it is never dropped", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const fired: number[] = [];
  const look = throttle(() => fired.push(Date.now()), 120);
  // A trace appended every 20 ms for a second: a settle that restarts on each append would send nothing until it stops.
  for (let at = 0; at <= 1000; at += 20) {
    look.call();
    for (let ms = 0; ms < 20; ms++) t.mock.timers.tick(1);
  }
  assert.ok(fired.length >= 8, `sent ${fired.length} times during a second of activity`);
  assert.ok(fired[0]! <= 1, "the first append after a quiet spell is sent at once");
  for (let i = 1; i < fired.length; i++) assert.ok(fired[i]! - fired[i - 1]! >= 120, "never more often than the beat");
  t.mock.timers.tick(200);
  assert.ok(fired.at(-1)! >= 1000, "the last append, after the last send, is sent too");
  const count = fired.length;
  look.call();
  look.cancel();
  t.mock.timers.tick(500);
  assert.equal(fired.length, count, "a stopped server sends nothing more");
});
