/**
 * The observation's one entry from the run: map a captured pass through the
 * language adapter and append the record. The run owns the one invocation
 * and the adapter; this owns the mapping and the store.
 */

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import type { LanguageAdapter } from "../adapters/adapter.ts";
import { primaryOnly } from "../readings/scope/languages-read.ts";
import type { EnforcementConfig } from "../enforcement/config.ts";
import { workBinding } from "../journal/work.ts";
import type { SpecModel } from "../spec/model.ts";
import type { Capture } from "./capture.ts";
import { readInterfaceMap, type InterfaceMap } from "./interfaces.ts";
import { buildObservation, OBSERVED_PRIMARY_ONLY, type TotalityVia } from "./observe.ts";
import { appendObservation, type ObservationRecord } from "./record.ts";

export { createObserver, type Capture } from "./capture.ts";
export type { TotalityVia } from "./observe.ts";
export type { ObservationRecord } from "./record.ts";

export interface ObservationOutcome {
  record: ObservationRecord;
  file: string;
}

export interface RecordInput {
  root: string;
  capture: Capture;
  /** Undefined when no instrument answered: components are still mapped, component interfaces and entrances are not. */
  adapter: LanguageAdapter | undefined;
  /** Why no instrument answered, for the record. */
  instrumentReason?: string | undefined;
  model: SpecModel;
  config: EnforcementConfig;
  vias: readonly TotalityVia[];
  session: string;
  agent: string;
  at: string;
  passLatency: number;
  /** The commit the run recorded. */
  commit: string | null;
}

/**
 * Whether the code the pass ran differs from the commit: a change anywhere
 * but under .coherence, whose records (journal, runs, work) every session
 * appends to and which never execute. Counted with them, every observation
 * after the first run of a session would be dirty, and so stale.
 */
export function codeDirty(root: string): boolean {
  const status = spawnSync("git", ["status", "--porcelain", "--", ".", ":(exclude).coherence"], { cwd: root, encoding: "utf8" });
  return status.status === 0 && status.stdout.trim() !== "";
}

export async function recordObservation(input: RecordInput): Promise<ObservationOutcome> {
  const t0 = Date.now();
  let map: InterfaceMap = { symbols: [], entrances: [] };
  let reason = input.instrumentReason;
  // One language: a multi-language project's others are named as not read, on the record and in the line the run prints.
  const { language, languages } = primaryOnly(input.config, OBSERVED_PRIMARY_ONLY);

  if (input.adapter !== undefined && reason === undefined) {
    const ready = await input.adapter.ready();
    if (ready.ok) map = await readInterfaceMap(input.root, input.adapter, input.model, input.config, language);
    else reason = ready.reason;
  }
  const unread = reason ?? (input.adapter === undefined ? "no adapter" : undefined);
  const capture: Capture = unread === undefined ? input.capture : { ...input.capture, note: `${input.capture.note}; component interfaces and entrances not read: instrument unavailable (${unread})` };
  let realRoot = input.root;
  try {
    realRoot = realpathSync(input.root);
  } catch {
    realRoot = input.root;
  }
  const commit = input.commit;
  const dirty = commit !== null && codeDirty(input.root);
  const record = buildObservation({
    root: input.root,
    realRoot,
    capture,
    map,
    model: input.model,
    config: input.config,
    vias: input.vias,
    at: input.at,
    session: input.session,
    agent: input.agent,
    binding: workBinding(input.root, input.session),
    commit,
    dirty,
    latency: { pass: input.passLatency, map: Date.now() - t0 },
    languages,
  });
  return { record, file: appendObservation(input.root, record) };
}
