/**
 * The observation's one entry from the run: map a captured pass through the
 * language adapter and append the record. The run owns the one invocation
 * and the adapter; this owns the mapping and the store.
 */

import { realpathSync } from "node:fs";
import type { LanguageAdapter } from "../adapters/adapter.ts";
import type { EnforcementConfig } from "../enforcement/config.ts";
import { gitState } from "../journal/store.ts";
import { workBinding } from "../journal/work.ts";
import type { SpecModel } from "../spec/model.ts";
import type { Capture } from "./capture.ts";
import { readInterfaceMap, type InterfaceMap } from "./interfaces.ts";
import { buildObservation, type TotalityVia } from "./observe.ts";
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
}

export async function recordObservation(input: RecordInput): Promise<ObservationOutcome> {
  const t0 = Date.now();
  let map: InterfaceMap = { symbols: [], entrances: [] };
  let reason = input.instrumentReason;
  if (input.adapter !== undefined && reason === undefined) {
    const ready = await input.adapter.ready();
    if (ready.ok) map = await readInterfaceMap(input.root, input.adapter, input.model, input.config);
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
  const { commit, dirty } = gitState(input.root);
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
  });
  return { record, file: appendObservation(input.root, record) };
}
