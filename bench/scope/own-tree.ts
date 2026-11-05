/**
 * The Scope page over Coherence's own tree: it builds to the default path and
 * stays under 5 MB with every component, run and journal record embedded or
 * counted and the relief with as many files as its budget holds, while the
 * live first load lists no file; and its first load carries at most the site
 * window's reference sites while every latest verdict and every chokepoint's
 * sites read as the whole runs give them. The unit suite proves both on fixtures
 * (src/readings/scope/check.test.ts); this is the same on the real project,
 * run in the bench job because it reads the whole tree and every record, and
 * so costs more with every merge.
 *
 * usage: node bench/scope/own-tree.ts
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRuns } from "../../src/enforcement/record.ts";
import { loadJournal } from "../../src/journal/store.ts";
import { DEFAULTS, buildScopePage, writeScopePage, type BuildOptions } from "../../src/readings/scope/build.ts";
import { SITE_WINDOW, latestOf, sitesLeftCount } from "../../src/readings/scope/derive.ts";
import type { LatestEntry, ShellState } from "../../src/readings/scope/model.ts";
import { flowOf } from "../../src/readings/scope/structure-flow.ts";
import { loadSpecModel } from "../../src/spec/model.ts";
import { startParsers } from "../../src/plugins/syntax-trees.ts";
import { SNAPSHOT_FILES_BYTES, readRelief, withSnapshotFiles } from "../../src/readings/relief/relief.ts";

// A reading through a language's parser needs its runtime started first, as the CLI starts it.
await startParsers();

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
process.chdir(root);
const started = performance.now();
// The relief as the snapshot carries it: its totals, and the files its budget holds.
const relief = await readRelief(root);
const options: BuildOptions = { lexiconPath: DEFAULTS.lexiconPath, project: DEFAULTS.project, relief: withSnapshotFiles(relief) };
const FIVE_MB = 5 * 1024 * 1024;

// The page builds to the default path and stays under 5 MB with Coherence's own data, the relief's included.
const { bytes, state } = await writeScopePage(options, DEFAULTS.outPath);
const onDisk = await readFile(DEFAULTS.outPath, "utf8");
assert.equal(Buffer.byteLength(onDisk, "utf8"), bytes);
assert.ok(bytes < FIVE_MB, `page is ${bytes} bytes, must be under ${FIVE_MB}`);
assert.equal(state.spec.components.length, loadSpecModel(root).components.length, "every component of Coherence's own tree is in the state");
assert.equal(state.runs.records.length + (state.runs.omitted ?? 0), loadRuns(root).records.length, "every run record is embedded or counted");
assert.equal(state.journal.records.length + (state.journal.omitted ?? 0), loadJournal(root).records.length, "every journal record is embedded or counted");
assert.equal(state.relief?.kind, "read", `the relief is read: ${state.relief?.kind === "unread" ? state.relief.because : ""}`);
const reliefBytes = Buffer.byteLength(JSON.stringify(state.relief));
const embedded = Object.values(state.relief.kind === "read" ? (state.relief.files ?? {}) : {}).reduce((n, files) => n + Buffer.byteLength(JSON.stringify(files)), 0);
assert.ok(embedded <= SNAPSHOT_FILES_BYTES, `the snapshot embeds ${embedded} bytes of files, at most ${SNAPSHOT_FILES_BYTES}`);
// The live first load carries the relief without its files, which load by folder.
const live = (await buildScopePage({ ...options, relief: relief.reading })).state;
const liveBytes = Buffer.byteLength(JSON.stringify(live.relief));
assert.ok(live.relief?.kind === "read" && live.relief.files === undefined, "the live first load lists no file");

// Over Coherence's own runs: every latest verdict, and every chokepoint's sites carried or counted.
const own = (await buildScopePage(options)).state;
const ownWhole = (await buildScopePage({ ...options, window: false })).state;
const bare = (e: LatestEntry) => (({ sites: _s, sitesLeft: _l, ...rest }) => rest)(e);
for (const invariant of own.spec.components.flatMap((c) => c.invariants)) {
  const [a, b] = [latestOf(invariant, own.runs.records), latestOf(invariant, ownWhole.runs.records)];
  assert.deepEqual(a.map(bare), b.map(bare), `${invariant.name}: the latest entries are the same over the window`);
  a.forEach((e, i) => {
    if (b[i]!.sites !== undefined) assert.equal(e.sites!.length + sitesLeftCount(e), b[i]!.sites!.length, `${invariant.name}: every site carried or counted`);
  });
}
const carried = own.runs.records.flatMap((r) => r.invariants).reduce((sum, e) => sum + (e.sites?.filter((s) => s.class !== "bypass").length ?? 0), 0);
assert.ok(carried <= SITE_WINDOW, "Coherence's own page carries at most the window");
const weights = (shell: ShellState) => flowOf(shell).edges.map((edge) => [edge.id, edge.sites]);
assert.deepEqual(weights(own), weights(ownWhole), "and its map's weights are the whole runs'");

console.log(`the Scope page over Coherence's own tree: ${bytes} bytes (the relief ${reliefBytes}, of them ${embedded} of files; ${liveBytes} in the live first load), ${state.spec.components.length} components, ${carried} reference sites carried of the window's ${SITE_WINDOW}, in ${((performance.now() - started) / 1000).toFixed(1)} s`);
