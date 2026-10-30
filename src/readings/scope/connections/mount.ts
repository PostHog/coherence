/**
 * The connections view's place on the page, as the relief's is
 * (relief/mount.ts): one view, built from the state the first time Structure
 * shows it and kept across renders, re-attached to the host each render
 * leaves behind. A state whose flow model inputs are the same objects draws
 * the same model, so it is kept as it is; otherwise the model is derived
 * again and drawn on the reader's origin, spawns and pins.
 */

import type { ShellState } from "../model.ts";
import { flowOf } from "../structure-flow.ts";
import { createConnections, type Connections } from "./drawing.ts";

/** What flowOf reads from the state, each the object the state holds: while every one is the same, the model is too. */
function inputsOf(state: ShellState): readonly unknown[] {
  return [state.spec, state.componentInterfaces, state.runs.records, state.journal.records, state.structure.expanded];
}

let current: { view: Connections; inputs: readonly unknown[] } | undefined;
/** The origin a deep link named before the view was on the page: applied at the next mount. */
let landing: string | undefined;

/** Root the view at the origin a deep link names, now when it is built, else when it is first mounted. */
export function landConnections(id: string): void {
  if (current === undefined || !current.view.land(id)) landing = id;
}

/** Put the view into the host the render left, building it first, or drawing it again when what it draws changed. */
export function mountConnections(root: HTMLElement, state: ShellState): void {
  const host = root.querySelector<HTMLElement>("[data-connections-host]");
  if (host === null) return;
  const inputs = inputsOf(state);
  if (current === undefined) current = { view: createConnections(flowOf(state)), inputs };
  else if (inputs.length !== current.inputs.length || inputs.some((input, i) => input !== current!.inputs[i])) {
    current.view.update(flowOf(state));
    current.inputs = inputs;
  }
  if (current.view.root.parentElement !== host) host.replaceChildren(current.view.root);
  if (landing !== undefined) {
    current.view.land(landing);
    landing = undefined;
  }
  current.view.resume();
}
