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
import { reliefData, reliefInputs, type ReliefData, type ReliefFileLanded } from "./data.ts";
import { createRelief, WebGLUnavailable, type Relief, type ReliefIO, type ReliefView, type Touch } from "./scene.ts";

export type { Touch };

/** What the scene on the page was built from: the state's inputs, and the data they joined to, as text. */
export interface Built {
  inputs: readonly unknown[];
  key: string;
}

/** What a render does with the relief: keep the scene (noting what it now stands for), build it from new data, or draw none. */
export type ReliefStep = { kind: "keep"; built: Built } | { kind: "build"; data: ReliefData; built: Built } | { kind: "absent" };

/**
 * Whether the scene must be built again. The same inputs (the same objects,
 * and the same open defects of the journal) are the same data, so nothing is
 * joined, and a journal append that opens or closes no defect is that;
 * otherwise the data is joined and compared whole, since a snapshot replaces
 * the spec and the interfaces on every spec edit while what the relief draws
 * from them is most often unchanged.
 */
export function reliefStep(built: Built | undefined, state: ShellState): ReliefStep {
  const inputs = reliefInputs(state);
  if (built !== undefined && inputs.length === built.inputs.length && inputs.every((input, i) => input === built.inputs[i])) return { kind: "keep", built };
  const data = reliefData(state);
  if ("absent" in data) return { kind: "absent" };
  const key = JSON.stringify(data);
  return built !== undefined && key === built.key ? { kind: "keep", built: { inputs, key } } : { kind: "build", data, built: { inputs, key } };
}

/** The longest query one fetch of files carries: folders past it go in a fetch of their own, so no address outgrows a server's limit. */
const QUERY_MAX = 4000;

/**
 * The relief's files on a live page, each folder fetched once per reading:
 * asked again under the same stamp a folder is answered from what was fetched,
 * and a reading with another stamp (a reread that changed what it read) drops
 * everything fetched under the last. A folder whose fetch failed, or whose
 * answer came from another reading, is left out of the answer and forgotten,
 * so a later ask fetches it again.
 */
export function filesCache(get: (path: string) => Promise<unknown>): (stamp: string, folders: readonly string[]) => Promise<Record<string, ReliefFileLanded[]>> {
  let held = { stamp: "", folders: new Map<string, Promise<ReliefFileLanded[] | undefined>>() };
  const fetch = (stamp: string, batch: string[]): Promise<Record<string, ReliefFileLanded[]> | undefined> =>
    get(`/api/relief/files?${batch.map((folder) => `folder=${encodeURIComponent(folder)}`).join("&")}`).then(
      (answer) => {
        const { stamp: from, folders } = answer as { stamp?: string; folders?: Record<string, ReliefFileLanded[]> };
        return from === stamp ? folders : undefined;
      },
      () => undefined,
    );
  return async (stamp, folders) => {
    if (stamp !== held.stamp) held = { stamp, folders: new Map() };
    const mine = held;
    const batches: string[][] = [];
    let length = Infinity;
    for (const folder of new Set(folders)) {
      if (mine.folders.has(folder)) continue;
      const part = `folder=${encodeURIComponent(folder)}&`.length;
      if (length + part > QUERY_MAX) {
        batches.push([]);
        length = 0;
      }
      batches.at(-1)!.push(folder);
      length += part;
    }
    for (const batch of batches) {
      const asked = fetch(stamp, batch);
      for (const folder of batch) {
        const one = asked.then((answer) => answer?.[folder]);
        mine.folders.set(folder, one);
        void one.then((files) => {
          if (files === undefined && mine.folders.get(folder) === one) mine.folders.delete(folder);
        });
      }
    }
    const answers = await Promise.all(folders.map(async (folder) => [folder, await mine.folders.get(folder)] as const));
    return Object.fromEntries(answers.filter((entry): entry is readonly [string, ReliefFileLanded[]] => entry[1] !== undefined));
  };
}

let fetched: { get: (path: string) => Promise<unknown>; files: ReturnType<typeof filesCache> } | undefined;

/** Where the scene built from `data` gets files: the live server through the page's one cache, or a snapshot's embedded folders. */
function filesFor(state: ShellState, data: ReliefData, io: ReliefIO): NonNullable<ReliefIO["files"]> {
  const get = io.get;
  if (get === undefined) {
    const embedded = state.relief?.kind === "read" ? (state.relief.files ?? {}) : {};
    return async (folders) => Object.fromEntries(folders.flatMap((folder) => (embedded[folder] === undefined ? [] : [[folder, embedded[folder]!]])));
  }
  if (fetched?.get !== get) fetched = { get, files: filesCache(get) };
  const files = fetched.files;
  return (folders) => files(data.stamp, folders);
}

let current: { relief: Relief; built: Built } | undefined;
/** The data a scene could not be built from, why, and whether the browser's WebGL was what failed: kept so a render does not try again until the data changes. */
let failed: { built: Built; why: string; webgl: boolean } | undefined;

/**
 * Say in the host that the relief could not be drawn, leaving every other view
 * as it is: WebGL is blamed only when the browser could not start it; any
 * other failure is the relief's own, given with its error.
 */
function sayUnbuilt(host: HTMLElement, why: string, webgl: boolean): void {
  const line = host.ownerDocument.createElement("p");
  line.className = "absence";
  const said = why.replace(/\.+$/, "");
  line.textContent = webgl
    ? `The relief could not be drawn in this browser: ${said}. It needs WebGL; every other view works without it, and Connections shows how the components connect.`
    : `The relief failed while it was built: ${said}. Every other view works without it, and Connections shows how the components connect.`;
  host.replaceChildren(line);
}

/** Put the relief into the host the render left, building it first when what it draws changed. `create` is the scene's maker, given by tests. */
export function mountRelief(root: HTMLElement, state: ShellState, io: ReliefIO, create: (data: ReliefData, io: ReliefIO, carried?: ReliefView) => Relief = createRelief, files = false): void {
  const host = root.querySelector<HTMLElement>("[data-relief-host]");
  if (host === null) return;
  // A replay holds the scene: a render puts it back into its host and builds nothing; the replay's end builds what the state holds.
  if (replaying !== undefined && current !== undefined) {
    if (current.relief.root.parentElement !== host) host.replaceChildren(current.relief.root);
    current.relief.files?.(files);
    current.relief.resume();
    return;
  }
  const step = reliefStep(current?.built ?? failed?.built, state);
  if (step.kind === "absent") {
    current?.relief.dispose();
    current = undefined;
    failed = undefined;
    return;
  }
  if (step.kind === "build") {
    const carried = current?.relief.view();
    current?.relief.dispose();
    current = undefined;
    // A browser without WebGL (no GPU, or one switched off) throws here, and so does a scene that fails on its data: either is said in the relief's own host, and the page stands.
    try {
      current = { relief: create(step.data, { ...io, files: filesFor(state, step.data, io) }, carried), built: step.built };
      failed = undefined;
    } catch (error) {
      failed = { built: step.built, why: error instanceof Error ? error.message : String(error), webgl: error instanceof WebGLUnavailable };
    }
  } else if (current !== undefined) current.built = step.built;
  else if (failed !== undefined) failed.built = step.built;
  if (current === undefined) {
    if (failed !== undefined) sayUnbuilt(host, failed.why, failed.webgl);
    return;
  }
  if (current.relief.root.parentElement !== host) host.replaceChildren(current.relief.root);
  current.relief.files?.(files);
  current.relief.resume();
}

/** Light what an agent just read or wrote, when the relief has been built; activity before it was is not replayed. */
export function touchRelief(touches: readonly Touch[]): void {
  current?.relief.touch(touches);
}

let replaying: { stop: boolean } | undefined;
/** How long the picture takes to fade out of today and into the replay's first step. */
const FADE_MS = 450;

/** How the reader looks at a scene, without where anything in it stood: a build from it lays everything out afresh. */
function lookOf(view: ReliefView): ReliefView {
  const { files: _files, platforms: _platforms, owners: _owners, world: _world, outlines: _outlines, tints: _tints, glows: _glows, ...look } = view;
  return look;
}

/** Whether a replay holds the scene now. */
export function isReplaying(): boolean {
  return replaying !== undefined;
}

/** Stop a replay at its next step; the state's own relief is built then. */
export function stopReplay(): void {
  if (replaying !== undefined) replaying.stop = true;
}

/**
 * Replay how the project took shape in the scene on the page (home-replay.ts):
 * every folder's files are loaded, then the scene is built from each step in
 * turn, each build carrying where the files stood from the one before, so
 * the project is seen to divide. `say` is told each step's caption, and null
 * at the end, when the scene is built from the state as it now stands.
 */
export async function replayRelief(
  root: HTMLElement,
  state: ShellState,
  io: ReliefIO,
  frames: (all: ReliefFileLanded[]) => { caption: string; named: { name: string; intent: string }[]; data: ReliefData; files: Record<string, ReliefFileLanded[]> }[],
  say: (caption: string | null, step: number, of: number, named?: readonly { name: string; intent: string }[]) => void,
  create: (data: ReliefData, io: ReliefIO, carried?: ReliefView) => Relief = createRelief,
): Promise<void> {
  if (replaying !== undefined) return;
  const data = reliefData(state);
  if ("absent" in data) return;
  const mine = { stop: false };
  replaying = mine;
  try {
    const folders = state.relief?.kind === "read" ? state.relief.components.map((c) => c.folder) : [];
    const loaded = await filesFor(state, data, io)(folders);
    const steps = frames(Object.values(loaded).flat());
    const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
    for (const [i, frame] of steps.entries()) {
      if (mine.stop) break;
      const host = root.querySelector<HTMLElement>("[data-relief-host]");
      if (host === null) break;
      const held = current?.relief.view();
      // The first step is no move from today: the picture fades out and comes back as the project stood before any component
      // was named, laid out afresh, carrying only how the reader looks at it.
      let carried = held;
      if (i === 0 && held !== undefined) {
        carried = { ...lookOf(held), layout: {} };
        host.style.transition = `opacity ${FADE_MS}ms ease`;
        host.style.opacity = "0";
        await wait(FADE_MS);
        if (mine.stop) { host.style.opacity = ""; break; }
      }
      current?.relief.dispose();
      current = { relief: create(frame.data, { ...io, files: async (want) => Object.fromEntries(want.flatMap((f) => (frame.files[f] === undefined ? [] : [[f, frame.files[f]!]]))) }, carried), built: { inputs: [], key: "" } };
      host.replaceChildren(current.relief.root);
      current.relief.files?.(true);
      current.relief.resume();
      if (i === 0) host.style.opacity = "1";
      say(frame.caption, i + 1, steps.length, frame.named);
      await wait(i === 0 ? 3000 : 4200);
    }
  } finally {
    replaying = undefined;
    say(null, 0, 0);
    // The scene stands for no state now: the next mount builds the state's own, carrying the last step's places into it.
    // Every step stood on today's kept places, so a replay played through ends on today and nothing moves; one stopped
    // part way moves on to today as any rebuild does.
    if (current !== undefined) current.built = { inputs: [], key: "" };
    mountRelief(root, state, io, create, root.querySelector("[data-relief-host]")?.closest(".home") !== null);
    const after = root.querySelector<HTMLElement>("[data-relief-host]");
    if (after !== null) after.style.opacity = "";
  }
}
