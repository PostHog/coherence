/**
 * The run: the chokepoint check for every chokepoint-form enforcement and
 * the totality oracle pass for every totality-oracle-form enforcement in
 * the spec model, appended as one record. A selection (one form, some
 * invariants) still appends one record; the enforcements it skipped keep
 * their prior dated verdict in the status view.
 */

import type { LanguageAdapter } from "../adapters/adapter.ts";
import { gitState } from "../journal/store.ts";
import { workBinding } from "../journal/work.ts";
import { loadSpecModel, type ModelInvariant, type SpecModel } from "../spec/model.ts";
import { checkChokepoint, type ChokepointResult } from "./check.ts";
import { readEnforcementConfig, type EnforcementConfig } from "./config.ts";
import { appendRun, type Form, type RunEntry, type RunRecord } from "./record.ts";
import { connectAdapter, type RemoteAdapter } from "./server.ts";
import { runTotalityBatch, runTotalityOracle, type TotalityResult } from "./totality.ts";

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
}

export interface EntryDetail {
  entry: RunEntry;
  chokepoint?: ChokepointResult;
  totality?: TotalityResult;
}

export interface RunOutcome {
  record: RunRecord;
  file: string | undefined;
  details: EntryDetail[];
  /** Why the instrument was unavailable, when it was. */
  instrumentReason: string | undefined;
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
  if (wantTotality) {
    const filters = selected.flatMap(({ invariant }) => totalityEnforcements(invariant).map(({ via }) => adapter?.testFilter(via) ?? via));
    const t0 = Date.now();
    batched = await runTotalityBatch(root, config, filters);
    batchLatency = Date.now() - t0;
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
          result = await checkChokepoint(adapter, { protects, chokepoint, component, testFolders: config.testFolders });
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
          continue;
        }
        details.push({
          entry: entryOf(component, invariant.name, "chokepoint", {
            verdict: result.verdict,
            grade: result.grade,
            ...(result.enforcer === undefined ? {} : { enforcer: result.enforcer }),
            refutation: result.refutation,
            bypasses: result.bypasses,
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
        const result = fromBatch ?? (await runTotalityOracle(root, config, filter));
        details.push({
          entry: {
            ...entryOf(component, invariant.name, "totality oracle", {
              verdict: result.verdict,
              grade: undefined,
              refutation: invariant.refutations.length > 0 ? "witnessed" : "missing",
              bypasses: [],
              testReferences: 0,
              files: [],
              latency: fromBatch === undefined ? Date.now() - t0 : batchLatency,
              reason: result.reason,
            }),
            mode: fromBatch === undefined ? "one-at-a-time" : "batched",
          },
          totality: result,
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
  return { record, file, details, instrumentReason };
  };

  if (needsAdapter && options.adapter === undefined && options.server !== false) {
    return withWarmAdapter(root, (remote, server, reason) => pass(remote, { language: remote?.language ?? config.language, server: server ?? "none" }, reason), { refresh: options.refresh ?? [] });
  }
  const given = options.adapter;
  if (given !== undefined) {
    // An adapter handed in lives in this process: no server was warm before it.
    if ("forget" in given && typeof given.forget === "function") (given as { forget: (files?: readonly string[]) => void }).forget(options.refresh ?? []);
    return pass(given, { language: given.language, server: "cold" }, undefined);
  }
  return pass(undefined, { language: config.language, server: "none" }, undefined);
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

function entryOf(component: string, name: string, form: Form, rest: Omit<RunEntry, "component" | "name" | "form" | "grade"> & { grade: RunEntry["grade"] | undefined }): RunEntry {
  const { grade, ...others } = rest;
  return grade === undefined ? { component, name, form, ...others } : { component, name, form, grade, ...others };
}

/** The configuration the run reads, for callers that print it. */
export function enforcementConfigFor(root: string): EnforcementConfig {
  return readEnforcementConfig(root);
}
