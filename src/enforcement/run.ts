/**
 * The run: the chokepoint check for every chokepoint-form enforcement and
 * the totality oracle pass for every totality-oracle-form enforcement in
 * the spec model, appended as one record. A selection (one form, some
 * invariants) still appends one record; the enforcements it skipped keep
 * their prior dated verdict in the status view.
 *
 * The totality pass runs the project's whole test suite before the first
 * question the instrument is asked, and the warm server's idle timer only
 * resets on a request line: a suite longer than the idle timeout used to kill
 * the instrument mid-run, record not run for every chokepoint, and exit 0. The
 * run now keeps the instrument alive across the test pass with a heartbeat and
 * asks it again afterwards; a run whose instrument died says so in every entry
 * and in `instrumentDied`, and the command exits non-zero.
 */

import type { LanguageAdapter } from "../adapters/adapter.ts";
import { gitState } from "../journal/store.ts";
import { workBinding } from "../journal/work.ts";
import { loadSpecModel, type ModelInvariant, type SpecModel } from "../spec/model.ts";
import { checkChokepoint, type ChokepointResult } from "./check.ts";
import { readEnforcementConfig, type EnforcementConfig } from "./config.ts";
import { appendRun, entryKey, loadRuns, type Form, type RunEntry, type RunRecord } from "./record.ts";
import { connectAdapter, type RemoteAdapter } from "./server.ts";
import { runTotalityBatch, runTotalityOracle, type TotalityResult } from "./totality.ts";
import { createObserver, recordObservation, type ObservationOutcome, type TotalityVia } from "../observation/index.ts";

export interface RunOptions {
  session: string;
  agent: string;
  /** One form only, when given. */
  form?: Form | undefined;
  /** Only invariants with these names, when given. */
  invariants?: readonly string[] | undefined;
  /** Files (project-relative) whose text changed since the instrument last read them; the warm server re-reads them first. */
  refresh?: readonly string[] | undefined;
  /** An adapter to use instead of the warm server (tests, and `--no-server`). */
  adapter?: LanguageAdapter | undefined;
  /** Whether to talk to the warm server (default true when no adapter is given). */
  server?: boolean | undefined;
  model?: SpecModel | undefined;
  now?: (() => Date) | undefined;
  /** The idle timeout to spawn the warm server with, when this run spawns it. */
  idleMs?: number | undefined;
  /** How often to keep the warm server awake during the test pass; the default is well inside the shortest sane idle. */
  heartbeatMs?: number | undefined;
  /** Observe the batched pass (src/observation): coverage rides the same one invocation, and one observation record is appended. */
  observe?: boolean | undefined;
  /** How long the one test invocation may run before its whole process tree is killed and its totality oracles read unfinished (default TOTALITY_TIMEOUT_MS). */
  timeoutMs?: number | undefined;
  /**
   * After the batched pass, run each batched totality oracle's test again in its own invocation through the
   * config's `test` command, and append those verdicts as a second run record (every entry mode one-at-a-time).
   */
  each?: boolean | undefined;
}

/** The per-test confirmation `run --each` adds: the second record, and the totality oracles it caught. */
export interface EachOutcome {
  record: RunRecord;
  file: string;
  details: EntryDetail[];
  /** Totality oracles whose test passed in the batched invocation and failed in its own: it passed on what its neighbors left behind. */
  hidden: EntryDetail[];
  /** Totality oracles whose test the batched invocation passed and its own invocation could not run (no test command, or it never started). */
  unconfirmed: EntryDetail[];
}

/** How often the run touches the instrument while the test suite holds the floor. */
export const HEARTBEAT_MS = 20_000;

export interface EntryDetail {
  entry: RunEntry;
  chokepoint?: ChokepointResult;
  totality?: TotalityResult;
  /** A totality oracle's test filter as the runner was given it, so a second pass re-runs this test and no other. */
  filter?: string;
}

export interface RunOutcome {
  record: RunRecord;
  file: string | undefined;
  details: EntryDetail[];
  /** Why the instrument was unavailable, when it was. */
  instrumentReason: string | undefined;
  /** True when the instrument was needed and could not answer: the run proved nothing and must not exit 0. */
  instrumentDied: boolean;
  /** The observation appended, when the run was observed and the batched pass ran. */
  observation?: ObservationOutcome;
  /** Why an observed run appended no observation. */
  observationSkipped?: string;
  /** With `each`: the second record, one invocation per totality oracle the batched pass ran. */
  each?: EachOutcome;
  /** With `each`: why no per-test record was appended (no totality oracle ran batched). */
  eachSkipped?: string;
}

function chokepointEnforcements(invariant: ModelInvariant): { protects: string; chokepoint: string }[] {
  return invariant.enforcements.flatMap((e) => (e.form === "chokepoint" ? [{ protects: e.protects, chokepoint: e.chokepoint }] : []));
}

function totalityEnforcements(invariant: ModelInvariant): { over: string; via: string }[] {
  return invariant.enforcements.flatMap((e) => (e.form === "totality oracle" ? [{ over: e.over, via: e.via }] : []));
}

/** Whether a chokepoint invariant may involve a file: its latest run touched it, or the file's text carries one of its names. */
export function mayTouch(invariant: ModelInvariant, file: string, text: string | undefined): boolean {
  const latest = invariant.latest.find((l) => l.form === "chokepoint");
  if (latest !== undefined && latest.files.includes(file)) return true;
  if (text === undefined) return false;
  for (const { protects, chokepoint } of chokepointEnforcements(invariant)) {
    for (const value of [protects, chokepoint]) {
      const name = /^([A-Za-z_$][A-Za-z0-9_$]*)(\s+in\s+\S+)?$/.exec(value.trim())?.[1];
      if (name !== undefined && new RegExp(`\\b${name.replace(/\$/g, "\\$")}\\b`).test(text)) return true;
      if (name === undefined && file.endsWith(value.trim())) return true;
    }
  }
  return false;
}

export async function performRun(root: string, options: RunOptions): Promise<RunOutcome> {
  const now = options.now ?? (() => new Date());
  const started = Date.now();
  const model = options.model ?? loadSpecModel(root);
  const config = readEnforcementConfig(root);
  const wantChokepoints = options.form === undefined || options.form === "chokepoint";
  const wantTotality = options.form === undefined || options.form === "totality oracle";
  const chosen = new Set(options.invariants ?? []);

  const selected = model.components.flatMap((c) =>
    c.invariants.filter((i) => (chosen.size === 0 || chosen.has(i.name)) && i.enforcements.length > 0).map((i) => ({ component: c.folder, invariant: i })),
  );

  const details: EntryDetail[] = [];
  const needsAdapter = wantChokepoints && selected.some(({ invariant }) => chokepointEnforcements(invariant).length > 0);
  // A totality oracle's refutation is the record `refute` wrote, never the bullet's own refuted: line.
  const recorded = new Set(loadRuns(root).refutations.map((r) => entryKey(r.component, r.name, r.form)));

  // The pass itself, once the instrument question is settled: an adapter, where it came from, or why there is none.
  const pass = async (adapter: LanguageAdapter | undefined, instrument: RunRecord["instrument"], unavailable: string | undefined): Promise<RunOutcome> => {
  let instrumentReason = unavailable;
  if (adapter !== undefined && instrumentReason === undefined && needsAdapter) {
    const state = await adapter.ready();
    if (!state.ok) instrumentReason = state.reason;
  }

  // Every test a bullet names in one invocation, when the runner can report per test; else one at a time below.
  let batched: Map<string, TotalityResult> | undefined;
  let batchLatency = 0;
  // An observed run rides the same one invocation: the observer only adds coverage to it.
  const observing = options.observe === true && wantTotality && config.testJson !== undefined ? createObserver(root, config) : undefined;
  const vias: TotalityVia[] = selected.flatMap(({ component, invariant }) => totalityEnforcements(invariant).map(({ via }) => ({ component, name: invariant.name, filter: adapter?.testFilter(via) ?? via })));
  if (wantTotality) {
    const filters = vias.map((o) => o.filter);
    const t0 = Date.now();
    // The test suite can outlast the warm server's idle timeout, and its timer only resets on a request line.
    const beat = adapter === undefined || (!needsAdapter && observing === undefined) ? undefined : setInterval(() => void adapter.ready().catch(() => {}), options.heartbeatMs ?? HEARTBEAT_MS);
    beat?.unref();
    try {
      batched = await runTotalityBatch(root, config, filters, options.timeoutMs, observing?.observer);
    } finally {
      if (beat !== undefined) clearInterval(beat);
    }
    batchLatency = Date.now() - t0;
    // The instrument is asked again before the first chokepoint: a suite that outlived it must not read as not run.
    if (adapter !== undefined && instrumentReason === undefined && needsAdapter) {
      let alive: { ok: true } | { ok: false; reason: string };
      try {
        alive = await adapter.ready();
      } catch (error) {
        alive = { ok: false, reason: error instanceof Error ? error.message : String(error) };
      }
      if (!alive.ok) instrumentReason = `the instrument did not survive the test pass (${Math.round(batchLatency / 1000)} s): ${alive.reason}`;
    }
  }

  for (const { component, invariant } of selected) {
    if (wantChokepoints) {
      for (const { protects, chokepoint } of chokepointEnforcements(invariant)) {
        const t0 = Date.now();
        if (adapter === undefined || instrumentReason !== undefined) {
          details.push({
            entry: entryOf(component, invariant.name, "chokepoint", {
              verdict: "not run",
              grade: undefined,
              refutation: "missing",
              bypasses: [],
              testReferences: 0,
              files: [],
              latency: Date.now() - t0,
              reason: `instrument unavailable: ${instrumentReason ?? "no adapter"}`,
            }),
          });
          continue;
        }
        let result: ChokepointResult;
        try {
          result = await checkChokepoint(adapter, { protects, chokepoint, component, testFolders: config.testFolders, root });
        } catch (error) {
          details.push({
            entry: entryOf(component, invariant.name, "chokepoint", {
              verdict: "not run",
              grade: undefined,
              refutation: "missing",
              bypasses: [],
              testReferences: 0,
              files: [],
              latency: Date.now() - t0,
              reason: `instrument failed: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`,
            }),
          });
          instrumentReason ??= error instanceof Error ? error.message.split("\n")[0] : String(error);
          continue;
        }
        details.push({
          entry: entryOf(component, invariant.name, "chokepoint", {
            verdict: result.verdict,
            grade: result.grade,
            ...(result.enforcer === undefined ? {} : { enforcer: result.enforcer }),
            refutation: result.refutation,
            bypasses: result.bypasses,
            ...(result.siteEvidence !== "complete" ? {} : { sites: result.sites.map((site) => ({
              file: site.file,
              line: site.line,
              symbol: site.symbol ?? "module top level",
              class: site.class,
              of: site.of,
              test: site.test,
              ...(site.form === undefined ? {} : { form: site.form }),
            })) }),
            testReferences: result.counts.test,
            files: result.files,
            latency: Date.now() - t0,
            reason: result.reason,
          }),
          chokepoint: result,
        });
      }
    }
    if (wantTotality) {
      for (const { via } of totalityEnforcements(invariant)) {
        const t0 = Date.now();
        const filter = adapter?.testFilter(via) ?? via;
        const fromBatch = batched?.get(filter);
        const result = fromBatch ?? (await runTotalityOracle(root, config, filter, options.timeoutMs));
        details.push({
          entry: {
            ...entryOf(component, invariant.name, "totality oracle", {
              verdict: result.verdict,
              grade: undefined,
              refutation: recorded.has(entryKey(component, invariant.name, "totality oracle")) ? "witnessed" : "missing",
              bypasses: [],
              testReferences: 0,
              files: [],
              latency: fromBatch === undefined ? Date.now() - t0 : batchLatency,
              reason: result.reason,
            }),
            mode: fromBatch === undefined ? "one-at-a-time" : "batched",
          },
          totality: result,
          filter,
        });
      }
    }
  }

  const { commit, dirty } = gitState(root);
  const record: RunRecord = {
    at: now().toISOString(),
    session: options.session,
    agent: options.agent,
    ...workBinding(root, options.session),
    commit,
    dirty,
    instrument,
    latency: Date.now() - started,
    invariants: details.map((d) => d.entry),
  };
  const file = appendRun(root, record);
  const outcome: RunOutcome = { record, file, details, instrumentReason, instrumentDied: needsAdapter && instrumentReason !== undefined };
  if (options.observe === true) {
    if (observing === undefined || batched === undefined) {
      outcome.observationSkipped = !wantTotality
        ? "the run checked no totality oracle, so no test ran to observe"
        : config.testJson === undefined
          ? "no testJson command: observation rides only the one batched invocation"
          : "no bullet names a test, so no batched pass ran";
      observing?.collect();
    } else {
      outcome.observation = await recordObservation({
        root,
        capture: observing.collect(),
        adapter,
        instrumentReason: needsAdapter ? instrumentReason : unavailable,
        model,
        config,
        vias,
        session: options.session,
        agent: options.agent,
        at: record.at,
        passLatency: batchLatency,
        commit,
      });
    }
  }
  if (options.each === true) {
    const batchedDetails = details.filter((d) => d.entry.form === "totality oracle" && d.entry.mode === "batched");
    if (batchedDetails.length === 0) {
      outcome.eachSkipped = !wantTotality ? "the run checked no totality oracle" : "no totality oracle ran in the batched invocation, so each already ran in its own";
    } else {
      // The one function that performs a pass is the only one that appends: confirmEach builds the second record, performRun writes it.
      const each = await confirmEach(root, config, options, batchedDetails, instrument, recorded, now);
      outcome.each = { ...each, file: appendRun(root, each.record) };
    }
  }
  return outcome;
  };

  if ((needsAdapter || options.observe === true) && options.adapter === undefined && options.server !== false) {
    return withWarmAdapter(root, (remote, server, reason) => pass(remote, { language: remote?.language ?? config.language, server: server ?? "none" }, reason), {
      refresh: options.refresh ?? [],
      idleMs: options.idleMs,
    });
  }
  const given = options.adapter;
  if (given !== undefined) {
    // An adapter handed in lives in this process: no server was warm before it.
    await given.forget(options.refresh ?? []);
    return pass(given, { language: given.language, server: "cold" }, undefined);
  }
  return pass(undefined, { language: config.language, server: "none" }, undefined);
}

/**
 * `run --each`: every totality oracle the batched invocation ran, run again in its own invocation through the
 * config's `test` command, appended as a second record so each record stays one pass. A test that passed batched
 * and fails alone passed on what an earlier test left behind (df-9e673484); the second record's verdict is the
 * latest, so the status view shows it as a structural defect.
 */
async function confirmEach(
  root: string,
  config: EnforcementConfig,
  options: RunOptions,
  batchedDetails: readonly EntryDetail[],
  instrument: RunRecord["instrument"],
  recorded: ReadonlySet<string>,
  now: () => Date,
): Promise<Omit<EachOutcome, "file">> {
  const started = Date.now();
  const details: EntryDetail[] = [];
  const hidden: EntryDetail[] = [];
  const unconfirmed: EntryDetail[] = [];
  // Each batched detail carries the filter it ran under, so the confirmation re-runs that test, whichever of an invariant's vias it was.
  for (const batched of batchedDetails) {
    const { component, name } = batched.entry;
    const filter = batched.filter;
    if (filter !== undefined) {
      const t0 = Date.now();
      const result = await runTotalityOracle(root, config, filter, options.timeoutMs);
      const reason = batched.entry.verdict === "pass" && result.verdict !== "pass" ? `passed in the batched invocation, ${result.verdict === "fail" ? "failed" : "did not run"} in its own: ${result.reason}` : result.reason;
      const detail: EntryDetail = {
        entry: {
          ...entryOf(component, name, "totality oracle", {
            verdict: result.verdict,
            grade: undefined,
            refutation: recorded.has(entryKey(component, name, "totality oracle")) ? "witnessed" : "missing",
            bypasses: [],
            testReferences: 0,
            files: [],
            latency: Date.now() - t0,
            reason,
          }),
          mode: "one-at-a-time",
        },
        totality: result,
      };
      details.push(detail);
      if (batched.entry.verdict === "pass" && result.verdict === "fail") hidden.push(detail);
      if (batched.entry.verdict === "pass" && result.verdict === "not run") unconfirmed.push(detail);
    }
  }
  const { commit, dirty } = gitState(root);
  const record: RunRecord = {
    at: now().toISOString(),
    session: options.session,
    agent: options.agent,
    ...workBinding(root, options.session),
    commit,
    dirty,
    instrument,
    latency: Date.now() - started,
    invariants: details.map((d) => d.entry),
  };
  return { record, details, hidden, unconfirmed };
}

/**
 * The one door to the warm instrument, for the run and for a reading that
 * needs the adapter itself (the economy's closure): connects over the
 * socket, spawning the server detached when none listens, re-reads the
 * named files, hands the adapter to `fn` with whether the server was warm,
 * and ends the connection after. When no server answers, `fn` gets no
 * adapter and the reason, so a caller records not run rather than crashing.
 */
export async function withWarmAdapter<T>(
  root: string,
  fn: (adapter: RemoteAdapter | undefined, server: "cold" | "warm" | undefined, reason: string | undefined) => Promise<T>,
  options: { refresh?: readonly string[] | undefined; idleMs?: number | undefined } = {},
): Promise<T> {
  let remote: RemoteAdapter | undefined;
  let server: "cold" | "warm" | undefined;
  let reason: string | undefined;
  try {
    const connected = await connectAdapter(root, options.idleMs === undefined ? {} : { idleMs: options.idleMs });
    remote = connected.adapter;
    server = connected.server;
    await remote.forget(options.refresh ?? []);
  } catch (error) {
    reason = error instanceof Error ? error.message : String(error);
  }
  try {
    return await fn(remote, server, reason);
  } finally {
    if (remote !== undefined) await remote.close();
  }
}

/**
 * Warm the project's instrument: connect to its warm server, which a
 * connection spawns when none listens and which loads the project as it
 * starts, then let go. A hook starts this detached at a session's start and
 * at each prompt, so the stop that ends the turn finds the server loaded and
 * its idle timer fresh. Nothing is printed and nothing is recorded.
 */
export async function warmInstrument(root: string): Promise<void> {
  await withWarmAdapter(root, async () => {});
}

function entryOf(component: string, name: string, form: Form, rest: Omit<RunEntry, "component" | "name" | "form" | "grade"> & { grade: RunEntry["grade"] | undefined }): RunEntry {
  const { grade, ...others } = rest;
  return grade === undefined ? { component, name, form, ...others } : { component, name, form, grade, ...others };
}

/** The configuration the run reads, for callers that print it. */
export function enforcementConfigFor(root: string): EnforcementConfig {
  return readEnforcementConfig(root);
}
