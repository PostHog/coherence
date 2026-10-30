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
import type { Touch } from "../relief/relief.ts";
import { loadRuns } from "../../enforcement/record.ts";
import { connectAdapter, serve, type Serving } from "../../enforcement/server.ts";
import { loadJournal } from "../../journal/store.ts";
import { COHERENCE_LEXICON } from "../../lifecycle/project.ts";
import { closeWork, openWork } from "../../lifecycle/work-meter.ts";
import { CONFIG_FILE, loadSpecModel } from "../../spec/model.ts";
import { keptUnlessRejected, scopeState, type Shell } from "./build.ts";
import { makeFixture, type Fixture } from "./check-fixture.ts";
import { latestOf } from "./derive.ts";
import { PageShell, scopeApp, storeOf, throttle, watchedLexicons } from "./live.ts";
import type { JournalRecord, PageEntry, RecordedSite, RunRecord, ShellState } from "./model.ts";
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
async function live(root: string): Promise<Live> {
  const serving = await serve(root, { idleMs: 60_000, http: scopeApp({ interfaces: false, debounceMs: 30 }) });
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
  const server = await live(fixture.root);
  try {
    const state = await firstLoad(server);
    const held = stampOf(state);
    assert.notEqual(held, "", "the first load carries the relief");
    const stream = await openStream(server, state);
    assert.ok(await stream.until((events) => events.some((e) => e.event === "ready")));
    const from = stream.events.length;
    // A file the relief counts, and a spec edit that reads the model again.
    writeFileSync(join(fixture.root, "src/store/later.ts"), "export const later = 1;\n");
    appendFileSync(join(fixture.root, "src/store/Store.spec.md"), "\n");
    assert.ok(await stream.until((events) => snapshots(events.slice(from)).length >= 1, 20_000), "the model's snapshot arrives");
    // A second page loads now, likely before the relief has landed; whichever, its stream must leave it holding the newest relief.
    const second = await firstLoad(server);
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

test("a close during the first load is final: no watcher is left open and the relief's worker is stopped", async () => {
  const fixture = makeFixture();
  const watchers = (): number => process.getActiveResourcesInfo().filter((kind) => kind === "FSEventWrap").length;
  const before = watchers();
  const said: string[] = [];
  const app = scopeApp({ interfaces: false, debounceMs: 30 })({ root: fixture.root, adapter: {} as LanguageAdapter, log: (line) => said.push(line), keepAlive: () => {} });
  const answered: number[] = [];
  const response = { writeHead: (status: number) => answered.push(status), end: () => {} } as unknown as ServerResponse;
  try {
    // The first load starts with the request, and the close comes while its relief is still being read.
    const asked = app.handle({ method: "GET" } as IncomingMessage, response, new URL("http://127.0.0.1/api/state"));
    await app.close();
    await asked;
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
