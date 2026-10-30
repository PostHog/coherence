/**
 * The relief's place on the page: one relief, built from the state the first
 * time Structure shows and kept across renders, re-attached to the host each
 * render leaves behind. A new relief reading or a new interface reading builds
 * it afresh; any other update leaves the scene, its camera and its slice as
 * they were.
 */

import type { ShellState } from "../model.ts";
import { reliefData } from "./data.ts";
import { createRelief, type Relief, type ReliefIO, type Touch } from "./scene.ts";

export type { Touch };

let current: { relief: Relief; reading: unknown; interfaces: unknown } | undefined;

export function mountRelief(root: HTMLElement, state: ShellState, io: ReliefIO): void {
  const host = root.querySelector<HTMLElement>("[data-relief-host]");
  if (host === null) return;
  if (current === undefined || current.reading !== state.relief || current.interfaces !== state.componentInterfaces) {
    const data = reliefData(state);
    if ("absent" in data) return;
    current = { relief: createRelief(data, io), reading: state.relief, interfaces: state.componentInterfaces };
  }
  if (current.relief.root.parentElement !== host) host.replaceChildren(current.relief.root);
  current.relief.resume();
}

/** Light what an agent just read or wrote, when the relief has been built; activity before it was is not replayed. */
export function touchRelief(touches: readonly Touch[]): void {
  current?.relief.touch(touches);
}
