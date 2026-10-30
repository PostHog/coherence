/**
 * The relief's place on the page: one relief, built from the state the first
 * time Structure shows and kept across renders, re-attached to the host each
 * render leaves behind. Only a change to what it draws builds it afresh: the
 * old scene is disposed and the new one opens on the reader's view (the
 * camera, the slice, the measures, the diff), so a spec edit or a run that
 * leaves the drawing as it was leaves the scene, its camera and its slice as
 * they were.
 */

import type { ShellState } from "../model.ts";
import { reliefData, reliefInputs, type ReliefData } from "./data.ts";
import { createRelief, type Relief, type ReliefIO, type ReliefView, type Touch } from "./scene.ts";

export type { Touch };

/** What the scene on the page was built from: the state's inputs, and the data they joined to, as text. */
export interface Built {
  inputs: readonly unknown[];
  key: string;
}

/** What a render does with the relief: keep the scene (noting what it now stands for), build it from new data, or draw none. */
export type ReliefStep = { kind: "keep"; built: Built } | { kind: "build"; data: ReliefData; built: Built } | { kind: "absent" };

/**
 * Whether the scene must be built again. The same input objects are the same
 * data, so nothing is joined; otherwise the data is joined and compared whole,
 * since a snapshot replaces the spec and the interfaces on every spec edit
 * while what the relief draws from them is most often unchanged.
 */
export function reliefStep(built: Built | undefined, state: ShellState): ReliefStep {
  const inputs = reliefInputs(state);
  if (built !== undefined && inputs.length === built.inputs.length && inputs.every((input, i) => input === built.inputs[i])) return { kind: "keep", built };
  const data = reliefData(state);
  if ("absent" in data) return { kind: "absent" };
  const key = JSON.stringify(data);
  return built !== undefined && key === built.key ? { kind: "keep", built: { inputs, key } } : { kind: "build", data, built: { inputs, key } };
}

let current: { relief: Relief; built: Built } | undefined;

/** Put the relief into the host the render left, building it first when what it draws changed. `create` is the scene's maker, given by tests. */
export function mountRelief(root: HTMLElement, state: ShellState, io: ReliefIO, create: (data: ReliefData, io: ReliefIO, carried?: ReliefView) => Relief = createRelief): void {
  const host = root.querySelector<HTMLElement>("[data-relief-host]");
  if (host === null) return;
  const step = reliefStep(current?.built, state);
  if (step.kind === "absent") {
    current?.relief.dispose();
    current = undefined;
    return;
  }
  if (step.kind === "build") {
    const carried = current?.relief.view();
    current?.relief.dispose();
    current = { relief: create(step.data, io, carried), built: step.built };
  } else if (current !== undefined) current.built = step.built;
  if (current === undefined) return;
  if (current.relief.root.parentElement !== host) host.replaceChildren(current.relief.root);
  current.relief.resume();
}

/** Light what an agent just read or wrote, when the relief has been built; activity before it was is not replayed. */
export function touchRelief(touches: readonly Touch[]): void {
  current?.relief.touch(touches);
}
