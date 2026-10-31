/**
 * Replay on the Structure view, without a browser: the player is given a
 * session's calls, a sink and a clock it can step by hand, and the mount's
 * touch path is driven as the page drives it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReliefReading } from "../../relief/relief.ts";
import type { ShellState } from "../model.ts";
import { mountRelief, touchRelief } from "./mount.ts";
import { callLine, pauseBetween, PAUSE_MAX_MS, PAUSE_MIN_MS, ReplayPlayer, touchesOfCall, type CallLine, type Clock } from "./replay.ts";
import type { Relief, Touch } from "./scene.ts";

const call = (s: number, tool: string, more: Partial<CallLine> = {}): CallLine => ({ kind: "call", at: new Date(Date.UTC(2026, 9, 30, 12, 0, s)).toISOString(), session: "s1", agent: "main", tool, summary: `${tool} ${s}`, ...more });

/** A clock whose one pending timer runs when the test says, with the pause it was set for. */
function handClock(): Clock & { pending: { run: () => void; ms: number } | undefined; fire: () => number } {
  const clock = {
    pending: undefined as { run: () => void; ms: number } | undefined,
    set(run: () => void, ms: number) {
      clock.pending = { run, ms };
      return clock.pending;
    },
    clear(handle: unknown) {
      if (handle === clock.pending) clock.pending = undefined;
    },
    fire() {
      const due = clock.pending!;
      clock.pending = undefined;
      due.run();
      return due.ms;
    },
  };
  return clock;
}

test("a replay plays a session's calls in order through the touch path, each pause the real gap held between bounds over the speed, and a seek lights the call it lands on", () => {
  const calls = [call(0, "Read", { read: ["src/a.ts"] }), call(1, "Bash"), call(30, "Edit", { wrote: ["src/a.ts"] }), call(30, "Write", { read: ["src/b.ts"], wrote: ["src/c.ts"] })];
  const lit: Touch[][] = [], shown: number[] = [], states: boolean[] = [];
  const clock = handClock();
  const player = new ReplayPlayer(calls, { touch: (t) => lit.push(t), show: (i) => shown.push(i), playing: (on) => states.push(on) }, clock);
  player.speed = 2;
  player.play();
  assert.deepEqual(shown, [0], "the first call is lit at once");
  assert.deepEqual(lit[0], [{ kind: "read", files: ["src/a.ts"], session: "s1", at: calls[0]!.at }]);
  assert.equal(clock.fire(), 1000 / 2, "a one-second gap at 2×");
  assert.deepEqual(lit[1], [], "a call that read and wrote nothing lights nothing, and still moves the head");
  assert.equal(clock.fire(), PAUSE_MAX_MS / 2, "a long think is held to the longest pause");
  assert.equal(clock.fire(), PAUSE_MIN_MS / 2, "calls at one time keep the shortest pause between them");
  assert.deepEqual(shown, [0, 1, 2, 3], "every call, in order");
  assert.deepEqual(lit[3]!.map((t) => t.kind), ["read", "write"]);
  assert.equal(clock.pending, undefined, "the play stops at the end");
  assert.deepEqual(states, [true, false]);
  assert.equal(player.running, false);

  player.seek(1);
  assert.deepEqual(shown.at(-1), 1, "a seek lights the call it lands on");
  assert.equal(clock.pending, undefined, "a seek while paused plays nothing more");
  player.play();
  assert.deepEqual(shown.at(-1), 2, "a play carries on after the head");
  player.seek(99);
  assert.equal(shown.at(-1), 3, "a seek past the end lands on the last call");
  assert.equal(player.running, false, "and a play under way ends there");
  player.play();
  assert.equal(shown.at(-1), 0, "a play asked for at the end starts again from the first call");
  player.pause();
  assert.equal(clock.pending, undefined, "a pause leaves nothing pending");

  assert.equal(pauseBetween(call(0, "a"), { ...call(0, "b"), at: "not a time" }, 1), PAUSE_MIN_MS);
  assert.equal(pauseBetween(call(0, "a"), call(9, "b"), 0), PAUSE_MAX_MS, "a speed that is no positive number plays at 1×, never a pause past the longest");
  assert.equal(callLine({ ...call(5, "Bash"), session: "child-1234567", agent: "Explore", description: "List files", summary: "ls" }, "s1").replace(/^\S+ \S+ · /, ""), "Explore child-12 · Bash · List files — ls", "a subagent's call names its own session");
  assert.deepEqual(touchesOfCall(call(0, "Grep")), []);
});

/** The least of a document the bar is built from: elements that hold children, a value and listeners, each kept in the order made. */
function fakeDocument(): { doc: Document; made: Record<string, unknown>[] } {
  const made: Record<string, unknown>[] = [];
  const createElement = (tag: string): Record<string, unknown> => {
    const listeners = new Map<string, () => void>();
    const e: Record<string, unknown> = { tag, children: [], parentElement: null, value: "", textContent: "", className: "", listeners };
    e["append"] = (...c: unknown[]) => void (e["children"] as unknown[]).push(...c);
    e["replaceChildren"] = (...c: unknown[]) => void (e["children"] = c);
    e["setAttribute"] = () => {};
    e["remove"] = () => {};
    e["addEventListener"] = (name: string, run: () => void) => void listeners.set(name, run);
    made.push(e);
    return e;
  };
  return { doc: { createElement } as unknown as Document, made };
}

const fire = (e: Record<string, unknown> | undefined, name: string): void => (e!["listeners"] as Map<string, () => void>).get(name)!();

test("while a replay plays, a live touch lights nothing, and once it stops live touches light again", async () => {
  const relief: ReliefReading = { kind: "read", head: "abc1234 2026-10-30", leftOut: [], stamp: "stamp", landings: [], components: [{ folder: ".", name: "root", files: 1, lines: 10, unreached: 10 }] };
  const state = { project: "p", views: [], activeView: "structure", lexicon: { query: "", layers: [] }, spec: { components: [], trustLevels: [] }, runs: { records: [], damaged: [] }, journal: { records: [], damaged: [], work: { kind: "absent", because: "none" } }, componentInterfaces: { kind: "unread", because: "test" }, structure: { preview: [] }, relief } as unknown as ShellState;
  const lit: Touch[][] = [];
  // The scene's root takes the bar in under the scene, before its notes.
  const sceneRoot: { parentElement: unknown; querySelector: () => null; insertBefore: (child: { parentElement: unknown }) => void } = { parentElement: null, querySelector: () => null, insertBefore: (child) => void (child.parentElement = sceneRoot) };
  const scene: Relief = { root: sceneRoot as unknown as HTMLElement, resume() {}, touch: (t) => void lit.push([...t]), view: () => ({}) as never, dispose() {} };
  const { doc, made } = fakeDocument();
  const host = { ownerDocument: doc, replaceChildren(...children: { parentElement: unknown }[]) { for (const c of children) c.parentElement = host; } };
  const root = { querySelector: () => host } as unknown as HTMLElement;
  const calls = [call(0, "Read", { read: ["a.ts"] }), call(1, "Edit", { wrote: ["a.ts"] })];
  const get = async (path: string): Promise<unknown> => (path === "/api/relief/sessions" ? { sessions: [{ session: "s1", from: "replay", at: calls[1]!.at, bytes: 300 }] } : { session: "s1", from: "replay", calls });
  (globalThis as { Option?: unknown }).Option = function (text: string, value: string) {
    return { text, value };
  };
  try {
    mountRelief(root, state, { get }, () => scene);
    const live: Touch[] = [{ kind: "write", files: ["live.ts"], session: "other", at: "now" }];
    touchRelief(live);
    assert.deepEqual(lit, [live], "with no replay, a live touch lights the relief");
    await new Promise((r) => setTimeout(r, 0));
    // The reader picks the session (the first select the bar made) and plays it.
    const picker = made.find((e) => e["tag"] === "select")!, button = made.find((e) => e["tag"] === "button");
    picker["value"] = "s1";
    fire(picker, "change");
    await new Promise((r) => setTimeout(r, 0));
    lit.length = 0;
    fire(button, "click");
    assert.deepEqual(lit, [[{ kind: "read", files: ["a.ts"], session: "s1", at: calls[0]!.at }]], "the play lights its first call through the scene's touch");
    touchRelief(live);
    assert.equal(lit.length, 1, "a live touch during the play lights nothing");
    fire(button, "click");
    touchRelief(live);
    assert.deepEqual(lit.at(-1), live, "once paused, live touches light again");
  } finally {
    delete (globalThis as { Option?: unknown }).Option;
  }
});

