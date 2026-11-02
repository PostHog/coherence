/**
 * Replay on the Structure view: one session's replay record played back in
 * order on the relief, through the same touch path the live lighting uses,
 * at a speed the reader picks, with a scrubber to move through it and the
 * call at the play head said in one line (when, which agent, which tool,
 * what it did). It needs the live server, which reads the record; a
 * snapshot carries none, so a snapshot shows no replay.
 *
 * The player is kept apart from the page so its order and timing can be
 * tested without a browser: it is given the calls, a sink and a clock.
 */

import type { CallLine } from "../../../economy/replay.ts";
import type { Touch } from "./scene.ts";

export type { CallLine };

/** The touches one call lights: what it read, then what it wrote. */
export function touchesOfCall(call: CallLine): Touch[] {
  const touches: Touch[] = [];
  if (call.read !== undefined && call.read.length > 0) touches.push({ kind: "read", files: call.read, session: call.session, at: call.at });
  if (call.wrote !== undefined && call.wrote.length > 0) touches.push({ kind: "write", files: call.wrote, session: call.session, at: call.at });
  return touches;
}

/** The shortest and longest pause between two calls at 1×: a burst still reads as calls one after another, and a long think does not stall the play. */
export const PAUSE_MIN_MS = 120;
export const PAUSE_MAX_MS = 2400;

/** The speeds the reader can pick. */
export const SPEEDS: readonly number[] = [1, 2, 4, 8, 16, 32];

/** The pause before `next` once `from` has played: the real gap between them, held between the bounds, divided by the speed; a speed that is no positive number plays at 1×, so no pause outlasts the longest. */
export function pauseBetween(from: CallLine, next: CallLine, speed: number): number {
  const gap = Date.parse(next.at) - Date.parse(from.at);
  return Math.min(PAUSE_MAX_MS, Math.max(PAUSE_MIN_MS, Number.isFinite(gap) ? gap : PAUSE_MIN_MS)) / (Number.isFinite(speed) && speed > 0 ? speed : 1);
}

export interface Clock {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const realClock: Clock = { set: (run, ms) => setTimeout(run, ms), clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) };

/** What the player tells the page: light these touches, the play head is at this call, the play started or stopped. */
export interface PlayerSink {
  touch(touches: Touch[]): void;
  show(index: number): void;
  playing(on: boolean): void;
}

/**
 * One session's calls played in order. `next` is the call the play plays
 * next; each played call lights its touches and moves the head to it. A play
 * that reaches the end stops there, and a play asked for at the end starts
 * again from the first call. Moving the head (seek) lights the call it lands
 * on, and a play under way carries on from there.
 */
export class ReplayPlayer {
  private next = 0;
  private timer: unknown;
  private speedNow = 1;
  private on = false;
  readonly calls: readonly CallLine[];
  private readonly sink: PlayerSink;
  private readonly clock: Clock;

  constructor(calls: readonly CallLine[], sink: PlayerSink, clock: Clock = realClock) {
    this.calls = calls;
    this.sink = sink;
    this.clock = clock;
  }

  /** The call the head is at: the last one played, or the first before any was. */
  get head(): number {
    return Math.max(0, this.next - 1);
  }

  get running(): boolean {
    return this.on;
  }

  get speed(): number {
    return this.speedNow;
  }

  /** A new speed takes effect from the next pause. */
  set speed(value: number) {
    this.speedNow = value;
    if (this.on && this.next > 0 && this.next < this.calls.length) this.schedule();
  }

  play(): void {
    if (this.on || this.calls.length === 0) return;
    if (this.next >= this.calls.length) this.next = 0;
    this.on = true;
    this.sink.playing(true);
    this.step();
  }

  pause(): void {
    if (!this.on) return;
    this.on = false;
    this.clock.clear(this.timer);
    this.timer = undefined;
    this.sink.playing(false);
  }

  /** Move the head to call `index` and light it. */
  seek(index: number): void {
    if (this.calls.length === 0) return;
    this.next = Math.min(this.calls.length - 1, Math.max(0, Math.trunc(index)));
    this.clock.clear(this.timer);
    this.light();
    if (this.on) this.carryOn();
  }

  /** Stop for good: nothing more is lit, and the page is told the play ended. */
  dispose(): void {
    this.pause();
  }

  private light(): void {
    const call = this.calls[this.next]!;
    this.sink.touch(touchesOfCall(call));
    this.sink.show(this.next);
    this.next += 1;
  }

  private step(): void {
    this.light();
    this.carryOn();
  }

  /** After a call is lit in a play: wait for the next, or stop at the end. */
  private carryOn(): void {
    if (this.next >= this.calls.length) {
      this.on = false;
      this.timer = undefined;
      this.sink.playing(false);
      return;
    }
    this.schedule();
  }

  private schedule(): void {
    this.clock.clear(this.timer);
    this.timer = this.clock.set(() => this.step(), pauseBetween(this.calls[this.next - 1]!, this.calls[this.next]!, this.speedNow));
  }
}

/** A session the server lists for replay. */
export interface ReplaySessionEntry {
  session: string;
  from: "replay" | "trace";
  at: string;
  bytes: number;
}

/** The time of a call or session as the bar shows it: local date and time, to the second. */
function when(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at;
  const two = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

/** A session in the picker: when it last grew, its id's start, and how large its record is. */
export function sessionLabel(entry: ReplaySessionEntry): string {
  const size = entry.bytes < 1024 ? `${entry.bytes} B` : entry.bytes < 1024 * 1024 ? `${Math.round(entry.bytes / 1024)} KB` : `${(entry.bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${when(entry.at)} · ${entry.session.slice(0, 8)} · ${size}${entry.from === "trace" ? " · reads and writes only" : ""}`;
}

/** The line said for the call at the head: when, which agent (and its session where it is not the record's), the tool, and what it did. */
export function callLine(call: CallLine, record: string): string {
  const agent = call.agent === "" ? "" : `${call.agent}${call.session !== "" && call.session !== record ? ` ${call.session.slice(0, 8)}` : ""}`;
  const what = [call.description, call.summary].filter((part): part is string => part !== undefined && part !== "").join(" — ");
  return [when(call.at), agent, call.tool, what].filter((part) => part !== "").join(" · ");
}

/** The replay bar: its element, kept across renders and rebuilt scenes, and its end. */
export interface ReplayBar {
  root: HTMLElement;
  /** Whether a play is under way, while which live touches wait. */
  playing(): boolean;
  dispose(): void;
}

/**
 * The bar below the relief: a session picker, play and pause, the speed, a
 * scrubber over the session's calls, and the line for the call at the head.
 * `touch` lights the relief; `onPlaying` is told when a play starts and stops.
 */
export function createReplayBar(doc: Document, get: (path: string) => Promise<unknown>, touch: (touches: Touch[]) => void, onPlaying: (on: boolean) => void = () => {}): ReplayBar {
  const root = doc.createElement("div");
  root.className = "relief replay";
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
    const e = doc.createElement(tag);
    if (cls !== undefined) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const label = el("span", "replay-name", "Replay");
  const pick = el("select");
  pick.setAttribute("aria-label", "Session to replay");
  const button = el("button", undefined, "Play");
  button.type = "button";
  const speed = el("select");
  speed.setAttribute("aria-label", "Replay speed");
  speed.title = `At 1× each pause between calls is kept, between ${PAUSE_MIN_MS / 1000} s and ${PAUSE_MAX_MS / 1000} s.`;
  for (const s of SPEEDS) speed.append(new Option(`${s}×`, String(s), s === 4, s === 4));
  const scrub = el("input");
  scrub.type = "range";
  scrub.min = "0";
  // At the start until a session is picked: a range with no value stands at its middle.
  scrub.max = "0";
  scrub.value = "0";
  scrub.setAttribute("aria-label", "Call in the session");
  const count = el("span", "replay-count");
  const line = el("div", "replay-line");
  line.setAttribute("aria-live", "polite");
  const controls = el("div", "replay-controls");
  controls.append(label, pick, button, speed, scrub, count);
  root.append(controls, line);

  let player: ReplayPlayer | undefined;
  let record = "";
  let disposed = false;
  const idle = (): void => {
    line.textContent = "Live: the relief lights what agents read and write as they work. Pick a session to play back everything it did.";
  };
  const enable = (on: boolean): void => {
    button.disabled = !on;
    speed.disabled = !on;
    scrub.disabled = !on;
  };
  enable(false);
  idle();
  pick.append(new Option("Loading sessions…", ""));

  const sink: PlayerSink = {
    touch,
    show: (index) => {
      const call = player!.calls[index]!;
      scrub.value = String(index);
      count.textContent = `${index + 1} / ${player!.calls.length}`;
      line.textContent = callLine(call, record);
    },
    playing: (on) => {
      button.textContent = on ? "Pause" : "Play";
      button.setAttribute("aria-pressed", String(on));
      onPlaying(on);
    },
  };

  void get("/api/relief/sessions").then(
    (answer) => {
      if (disposed) return;
      const sessions = ((answer as { sessions?: ReplaySessionEntry[] }).sessions ?? []);
      pick.replaceChildren(new Option(sessions.length === 0 ? "No session recorded yet" : "Choose a session…", ""));
      for (const s of sessions) pick.append(new Option(sessionLabel(s), s.session));
      pick.disabled = sessions.length === 0;
    },
    (error: unknown) => {
      if (disposed) return;
      pick.replaceChildren(new Option(`Sessions could not be listed: ${error instanceof Error ? error.message : String(error)}`, ""));
      pick.disabled = true;
    },
  );

  pick.addEventListener("change", () => {
    player?.dispose();
    player = undefined;
    enable(false);
    count.textContent = "";
    const chosen = pick.value;
    if (chosen === "") {
      idle();
      return;
    }
    line.textContent = "Loading the session's record…";
    void get(`/api/relief/replay?session=${encodeURIComponent(chosen)}`).then(
      (answer) => {
        if (disposed || pick.value !== chosen) return;
        const { calls = [], session = chosen, from } = answer as { calls?: CallLine[]; session?: string; from?: string };
        record = session;
        if (calls.length === 0) {
          line.textContent = "This session's record holds no call to play.";
          return;
        }
        player = new ReplayPlayer(calls, sink);
        player.speed = Number(speed.value);
        scrub.max = String(calls.length - 1);
        scrub.value = "0";
        count.textContent = `0 / ${calls.length}`;
        line.textContent = `${calls.length} calls${from === "trace" ? " (an older session: its read trace holds only what it read and wrote)" : ""}. Play lights each in order.`;
        enable(true);
      },
      (error: unknown) => {
        if (disposed || pick.value !== chosen) return;
        line.textContent = `The session's record could not be read: ${error instanceof Error ? error.message : String(error)}`;
      },
    );
  });
  button.addEventListener("click", () => {
    if (player === undefined) return;
    if (player.running) player.pause();
    else player.play();
  });
  speed.addEventListener("change", () => {
    if (player !== undefined) player.speed = Number(speed.value);
  });
  scrub.addEventListener("input", () => player?.seek(Number(scrub.value)));

  return {
    root,
    playing: () => player?.running === true,
    dispose: () => {
      disposed = true;
      player?.dispose();
      root.remove();
    },
  };
}
