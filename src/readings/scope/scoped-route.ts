/**
 * Whether a scoped reading's routes stand for the whole reading's.
 *
 * A scoped reading (readComponentInterfaces with a scope) reads the
 * interfaces of the components its entrances' routes enter, whole, and
 * nothing else. Each route's own facts are then exact: the handler's reach,
 * every interface the reach uses with all of its symbols' callers, the
 * chokepoints standing on the interfaces into what it read, the guards the
 * handler passes, and every entrance that could share the route. Two facts
 * the route rule reads are not the route's own: whether a component is a
 * core dependency (counted over every interface into and out of it) and a
 * component's column (its distance from where work enters, over every
 * interface). An interface into a component the reading did not read may
 * exist; the word index names every caller that could have one (`maybe`).
 *
 * So each fact is settled over every tree the unread interfaces allow: a
 * component is a core dependency, or not, only when it is so with every
 * maybe interface present or absent, and a column comparison holds, or not,
 * only when the shortest distance with every maybe interface present and the
 * one with none agree on it. The route rule is then replayed for every
 * entrance the reading started from, each step taken only on settled facts.
 * Settled, the scoped routes are the whole reading's routes, and so are the
 * closures proposed on them; unsettled, the reason names the fact, and the
 * caller reads whole.
 */

import type { ReachReference, ShellState } from "./model.ts";
import { flowEntranceId, flowRepresentOf, type FlowModel } from "./structure-flow.ts";

type Settled = "yes" | "no" | "unknown";

/** Why a scoped reading's routes may differ from the whole reading's, or undefined when they cannot (or the reading is whole). */
export function scopedUnsettled(state: ShellState, model: FlowModel): string | undefined {
  const reading = state.componentInterfaces;
  if (reading.kind !== "read" || reading.scoped === undefined) return undefined;
  const scoped = reading.scoped;
  const represent = flowRepresentOf(state);
  const components = state.spec.components;
  const known = new Set(components.map((c) => c.folder));
  const visible = model.nodes.map((n) => n.folder);
  const read = new Set(scoped.components);
  // A visible component whose every folded component was read: every interface into it is known.
  const whole = new Set(visible.filter((v) => components.every((c) => represent(c.folder) !== v || read.has(c.folder))));
  const key = (from: string, to: string): string => `${from}\u0000${to}`;
  const present = new Set(model.edges.map((e) => key(e.from, e.to)));
  const maybe = new Set<string>();
  for (const m of scoped.maybe) {
    if (!known.has(m.from) || !known.has(m.to)) continue;
    const from = represent(m.from);
    const to = represent(m.to);
    if (from === to || present.has(key(from, to)) || whole.has(to)) continue;
    maybe.add(key(from, to));
  }

  // A core dependency, as flowOf counts one: more callers count for it, more callees against it.
  const others = visible.length - 1;
  const isCore = (callers: number, callees: number): boolean => callers >= 3 && callers * 2 > others && callers * 4 >= 3 * (callers + callees);
  const core = new Map<string, Settled>();
  for (const v of visible) {
    const callers = visible.filter((u) => present.has(key(u, v))).length;
    const callees = visible.filter((u) => present.has(key(v, u))).length;
    const moreCallers = callers + visible.filter((u) => maybe.has(key(u, v))).length;
    const moreCallees = callees + visible.filter((u) => maybe.has(key(v, u))).length;
    core.set(v, isCore(callers, moreCallees) ? "yes" : !isCore(moreCallers, callees) ? "no" : "unknown");
  }

  // Columns: the distance from where work enters, never through a core dependency. With fewer interfaces and every
  // unsettled component closed, a distance can only be longer; with every maybe interface and every unsettled one open,
  // only shorter. A component the first reaches is reached from where work enters in every tree the reading allows.
  const enters = model.nodes.filter((n) => n.declaresEntrance).map((n) => n.folder);
  const distances = (open: (v: string) => boolean, edge: (from: string, to: string) => boolean): Map<string, number> => {
    const column = new Map<string, number>();
    const queue = enters.filter(open);
    for (const v of queue) column.set(v, 0);
    while (queue.length > 0) {
      const at = queue.shift()!;
      for (const next of visible) {
        if (column.has(next) || !open(next) || !edge(at, next)) continue;
        column.set(next, column.get(at)! + 1);
        queue.push(next);
      }
    }
    return column;
  };
  const longest = distances((v) => core.get(v) === "no", (a, b) => present.has(key(a, b)));
  const shortest = distances((v) => core.get(v) !== "yes", (a, b) => present.has(key(a, b)) || maybe.has(key(a, b)));
  /** Whether `to` stands in a column left of `at`'s, the step a route never takes back. */
  const behind = (at: string, to: string): Settled => {
    const atFar = longest.get(at);
    const toFar = longest.get(to);
    if (atFar === undefined || toFar === undefined) return "unknown";
    if (toFar < shortest.get(at)!) return "yes";
    if (shortest.get(to)! >= atFar) return "no";
    return "unknown";
  };

  // A symbol another component also calls is a utility, never a step: exact, since every symbol a reach uses was asked.
  const callersOfSymbol = new Map<string, Set<string>>();
  for (const s of reading.symbols) {
    if (!known.has(s.from) || !known.has(s.to)) continue;
    const k = `${represent(s.to)}\u0000${s.symbol}\u0000${s.file}`;
    const set = callersOfSymbol.get(k) ?? new Set<string>();
    set.add(represent(s.from));
    callersOfSymbol.set(k, set);
  }
  const follows = (from: string, to: string, r: ReachReference): boolean => present.has(key(from, to)) && (callersOfSymbol.get(`${to}\u0000${r.symbol}\u0000${r.file}`)?.size ?? 1) <= 1;

  for (const started of scoped.entrances) {
    const entrance = model.entrances.find((e) => e.id === flowEntranceId(started.component, started.name));
    if (entrance === undefined || !entrance.reachable || entrance.start === undefined) continue;
    const { declaredBy, start, name } = entrance;
    const declaredCore = core.get(declaredBy);
    if (declaredCore === "unknown") return `whether ${declaredBy}, where ${name} is declared, is a core dependency`;
    if (declaredCore === "yes") continue;
    const startCore = core.get(start);
    if (startCore === "unknown") return `whether ${start}, where ${name} is handled, is a core dependency`;
    let stops: string[];
    let rail: string | undefined;
    if (startCore === "yes") {
      stops = [declaredBy];
      rail = start;
    } else {
      if (entrance.reach === undefined) return `${name}'s reach, which the reading did not finish`;
      stops = declaredBy === start ? [start] : [declaredBy, start];
      for (;;) {
        const at = stops[stops.length - 1]!;
        const weight = new Map<string, number>();
        for (const r of entrance.reach) {
          if (!known.has(r.from) || !known.has(r.to)) continue;
          const from = represent(r.from);
          const to = represent(r.to);
          if (from !== at || to === at || stops.includes(to) || !follows(from, to, r)) continue;
          const toCore = core.get(to);
          if (toCore === "unknown") return `whether ${to}, which ${name}'s reach enters, is a core dependency`;
          if (toCore === "yes") continue;
          const back = behind(at, to);
          if (back === "unknown") return `whether ${to} stands left of ${at} on ${name}'s route`;
          if (back === "yes") continue;
          weight.set(to, (weight.get(to) ?? 0) + r.sites);
        }
        const next = [...weight.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
        if (next === undefined) break;
        stops.push(next[0]);
      }
    }
    // A chokepoint stands on an interface by the symbols it carries: every interface the route takes must be read whole.
    for (const to of [...stops.slice(1), ...(rail === undefined ? [] : [rail])]) {
      if (!whole.has(to)) return `the interfaces into ${to}, on ${name}'s route, of which the reading read only some`;
    }
    const drawn = model.routes.find((r) => r.entrances.includes(entrance.id));
    if (drawn === undefined || drawn.stops.join("\u0000") !== stops.join("\u0000") || drawn.rail !== rail) return `${name}'s route as the map draws it, which its replay does not reproduce`;
  }
  return undefined;
}
