/**
 * Scaffold control: the closure for an entrance with no traced control
 * (d-a1095ef2), proposed from the Structure reading, in the spec's own terms.
 *
 * Three closures, ranked for each entrance:
 *
 *   guard      a verified chokepoint its handler passes, or whose symbol its
 *              handler's declaration calls, while some route-mates do not:
 *              the exact guard: line. Entrances that declare different
 *              guard: lines never share a route, so the ones it names take
 *              a route of their own, whose control counts, and the rest are
 *              left to close by their own route or trust.
 *   invariant  its reach meets no verified control (or meets an unverified
 *              one, which is named first: verify it): an invariant bullet in
 *              the scaffold invariant shape, owned by the component that
 *              declares the entrance, its crossing entering from the trust
 *              the entrance carries in.
 *   none       it plausibly needs none: its handler reaches no component
 *              beyond its own, or its name says static or public content, a
 *              health check. The control: none line, with a reason the
 *              caller supplies; never written with a placeholder.
 *
 * Writing follows scaffold invariant: printed by default, applied only with
 * --write, and only where safe: a guard: line or a control: none line goes
 * under the entrance's bullet (never beside one it already has), an
 * invariant bullet is appended as a requirement with its placeholders.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { declarationsOf } from "../economy/source.ts";
import type { Language } from "../adapters/index.ts";
import { languageOfFile } from "../enforcement/config.ts";
import { NO_CONTROL, NO_CONTROL_FORM } from "../spec/grammar.ts";
import { declaresAtTop } from "../spec/model.ts";
import { loadSeed } from "../spec/seed.ts";
import { CLOSE_WAYS } from "../readings/scope/gaps.ts";
import { allInvariants, invariantVerdict } from "../readings/scope/derive.ts";
import type { ShellState, SpecEntrance, SpecInvariant } from "../readings/scope/model.ts";
import { CONTROL_WORDS, type FlowEntrance, type FlowModel, type FlowRoute } from "../readings/scope/structure-flow.ts";
import { appendInvariant, renderInvariant, ScaffoldError } from "./scaffold.ts";

/** Names that say static or public content, or a health check: an entrance that plausibly needs no control. */
const PLAINLY_PUBLIC = /(?:^|[^a-z])(health|healthz|ready|readiness|liveness|ping|robots|well-known|sitemap|favicon|manifest|static|assets?|openapi|llms)(?:[^a-z]|$)/i;

export interface GuardClosure {
  kind: "guard";
  symbol: string;
  component: string;
  invariant: string;
  sentence: string;
  /** Traced: the reading saw the handler pass it. Called: the handler's declaration calls a symbol of it, which the reading confirms once declared. */
  how: "traced" | "called";
  /** For a chokepoint module: every symbol of it some entrance on the route calls, when more than one; the caller chooses. */
  rivals: string[];
  line: string;
}

export interface InvariantClosure {
  kind: "invariant";
  component: string;
  specPath: string;
  bullet: string;
  /** An unverified chokepoint the handler's reach already meets: verifying it closes the gap first. */
  unverified: { component: string; name: string; state: string }[];
  /** The levels inside the system's control, one of which the crossing's far side names. */
  inside: string[];
}

export interface NoneClosure {
  kind: "none";
  why: string;
  line: string;
}

export type Closure = GuardClosure | InvariantClosure | NoneClosure;

export interface Proposal {
  entrance: FlowEntrance;
  declared: SpecEntrance;
  specPath: string;
  route: FlowRoute;
  /** Ranked: the first is the proposed closure, the rest the alternatives. */
  closures: Closure[];
}

function namedSymbol(value: string): string | undefined {
  return /^([A-Za-z_$][\w$]*)(?:\s+in\s+\S+)?$/.exec(value.trim())?.[1];
}

function isModule(value: string): boolean {
  return /^[A-Za-z0-9_./@-]+\.[A-Za-z]+$/.test(value.trim());
}

/** The text of a handler's top-level declaration: from its line to the next top-level declaration. The whole file for a module handler. */
export function handlerText(root: string, file: string | undefined, handler: string | undefined, language: Language): string {
  if (file === undefined || !existsSync(join(root, file))) return "";
  const text = readFileSync(join(root, file), "utf8");
  const symbol = handler === undefined ? undefined : namedSymbol(handler);
  if (symbol === undefined) return text;
  const declarations = declarationsOf(text, language);
  const at = declarations.findIndex((d) => d.name === symbol);
  if (at === -1) return "";
  const lines = text.split("\n");
  const end = declarations[at + 1]?.line ?? lines.length + 1;
  return lines.slice(declarations[at]!.line - 1, end - 1).join("\n");
}

/** The lowercase words of an identifier: mutationRpc is mutation and rpc. */
export function symbolWords(symbol: string): string[] {
  return symbol.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[^A-Za-z0-9]+/).filter((w) => w !== "").map((w) => w.toLowerCase());
}

function named(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w !== ""));
}

/** The symbols a chokepoint names: its symbol, or every top-level name its module declares. */
function chokepointSymbols(root: string, owner: string, chokepoint: string): string[] {
  const symbol = namedSymbol(chokepoint);
  if (symbol !== undefined) return [symbol];
  if (!isModule(chokepoint)) return [];
  const path = [owner === "." ? chokepoint : `${owner}/${chokepoint}`, chokepoint].map((p) => join(root, p)).find((p) => existsSync(p));
  if (path === undefined) return [];
  const text = readFileSync(path, "utf8");
  const tokens = new Set(text.match(/[A-Za-z_$][\w$]*/g) ?? []);
  return [...tokens].filter((t) => declaresAtTop(text, t)).sort();
}

function spells(text: string, symbol: string): boolean {
  return new RegExp(`(^|[^\\w$])${symbol.replace(/\$/g, "\\$")}\\s*[(<]`).test(text);
}

interface Verified {
  invariant: SpecInvariant;
  chokepoint: string;
  symbols: string[];
}

/** Every verified chokepoint invariant, with the symbols a handler could call it by. */
function verifiedChokepoints(root: string, state: ShellState): Verified[] {
  const out: Verified[] = [];
  for (const invariant of allInvariants(state.spec.components)) {
    if (invariantVerdict(invariant, state.runs.records).state !== "verified") continue;
    for (const e of invariant.enforcements) {
      if (e.form !== "chokepoint") continue;
      out.push({ invariant, chokepoint: e.chokepoint, symbols: chokepointSymbols(root, invariant.component, e.chokepoint) });
    }
  }
  return out;
}

/**
 * The closures for every entrance on a route marked no traced control, one
 * proposal per entrance, in route order. `languages` name how a handler's
 * declaration is read; `inside` defaults to the levels not marked outside.
 */
export function proposeClosures(root: string, state: ShellState, model: FlowModel, languages: Language | readonly Language[]): Proposal[] {
  const each = typeof languages === "string" ? [languages] : languages;
  // A handler's declaration is read in its own file's language: a Python view and a TypeScript route alike.
  const languageOf = (file: string | undefined): Language => (file === undefined ? undefined : languageOfFile(file, each)) ?? each[0]!;
  const verified = verifiedChokepoints(root, state);
  const inside = state.spec.trustLevels.filter((l) => l.outside !== true).map((l) => l.name);
  const seed = loadSeed();
  const proposals: Proposal[] = [];
  // Which verified chokepoint symbol each handler in the project calls, so a module's several symbols stay a choice
  // even after the entrances that call one of them have taken a route of their own.
  const calls = new Map<string, { verified: Verified; symbol: string }[]>();
  for (const entrance of model.entrances) {
    const component = entrance.owners[0] ?? entrance.declaredBy;
    const declared = state.spec.components.find((c) => c.folder === component)?.entrances.find((e) => e.name === entrance.name);
    const text = handlerText(root, declared?.file, entrance.handler, languageOf(declared?.file));
    const found: { verified: Verified; symbol: string }[] = [];
    for (const v of verified) for (const symbol of v.symbols) if (text !== "" && spells(text, symbol)) found.push({ verified: v, symbol });
    calls.set(entrance.id, found);
  }
  for (const route of model.routes) {
    if (!route.noTracedControl) continue;
    const members = route.entrances.map((id) => model.entrances.find((e) => e.id === id)!).filter((e) => e !== undefined);
    for (const entrance of members) {
      const component = entrance.owners[0] ?? entrance.declaredBy;
      const spec = state.spec.components.find((c) => c.folder === component);
      const declared = spec?.entrances.find((e) => e.name === entrance.name);
      if (spec === undefined || declared === undefined) continue;
      const closures: Closure[] = [];
      // (a) Traced: a verified chokepoint this entrance passes that its route-mates do not all pass (the route's partial list).
      for (const partial of route.partial) {
        // Only a wrapper: its guard: line is confirmed where the handler is registered; one inside the reach is not spelled there.
        if (partial.kind !== "wrapper") continue;
        if (!(entrance.guards ?? []).some((g) => g.component === partial.component && g.name === partial.name)) continue;
        const invariant = allInvariants(state.spec.components).find((i) => i.component === partial.component && i.name === partial.name);
        const chokepoint = invariant?.enforcements.find((e) => e.form === "chokepoint");
        const symbol = chokepoint?.form === "chokepoint" ? (namedSymbol(chokepoint.chokepoint) ?? calls.get(entrance.id)?.find((c) => c.verified.invariant === invariant)?.symbol) : undefined;
        if (invariant === undefined || symbol === undefined) continue;
        closures.push({ kind: "guard", symbol, component: invariant.component, invariant: invariant.name, sentence: invariant.sentence, how: "traced", rivals: [], line: `guard: ${symbol}` });
      }
      // (a) Called: its handler's declaration calls a symbol of a verified chokepoint.
      for (const call of calls.get(entrance.id) ?? []) {
        if (closures.some((c) => c.kind === "guard" && c.invariant === call.verified.invariant.name && c.component === call.verified.invariant.component)) continue;
        const rivals = [...new Set(model.entrances.flatMap((m) => (calls.get(m.id) ?? []).filter((c) => c.verified === call.verified).map((c) => c.symbol)))].sort();
        closures.push({ kind: "guard", symbol: call.symbol, component: call.verified.invariant.component, invariant: call.verified.invariant.name, sentence: call.verified.invariant.sentence, how: "called", rivals: rivals.length > 1 ? rivals : [], line: `guard: ${call.symbol}` });
      }
      // (b) An invariant whose crossing enters from its trust, owned where the entrance is declared, so it counts as the entrance's own.
      const unverified = (entrance.guards ?? [])
        .map((g) => ({ g, invariant: allInvariants(state.spec.components).find((i) => i.component === g.component && i.name === g.name) }))
        .filter(({ invariant }) => invariant !== undefined && invariantVerdict(invariant, state.runs.records).state !== "verified")
        .map(({ g, invariant }) => ({ component: g.component, name: g.name, state: invariant!.state }));
      const from = entrance.trust[0] ?? "<trust level>";
      const { bullet } = renderInvariant(seed, {
        sentence: `<what every ${entrance.name} request must satisfy before its work runs>`,
        name: undefined,
        kinds: undefined,
        form: "totality oracle",
        crossing: { from, to: "<trust level>" },
      });
      const invariantClosure: InvariantClosure = { kind: "invariant", component, specPath: spec.specPath, bullet, unverified, inside };
      // (c) Plausibly none: reaching no component beyond its own, or named for static or public content, a health check.
      const reachBeyond = entrance.reach === undefined ? undefined : entrance.reach.some((r) => !entrance.owners.includes(r.to));
      const hinted = PLAINLY_PUBLIC.test(`${entrance.name} ${entrance.handler ?? ""}`);
      const plain = (entrance.guards ?? []).length === 0 && (hinted || reachBeyond === false);
      const noneClosure: NoneClosure = {
        kind: "none",
        why: hinted ? "its name says static or public content, or a health check" : reachBeyond === false ? "its handler reaches no component beyond its own" : "only if it serves the same thing to every caller",
        line: `control: none — <why ${entrance.name} needs no control>`,
      };
      if (plain) closures.push(noneClosure, invariantClosure);
      else closures.push(invariantClosure, noneClosure);
      // A module symbol the invariant's own words name less than a rival does is a choice, not a proposal: it follows the invariant.
      const lead = closures[0];
      if (lead?.kind === "guard" && lead.rivals.length > 0) {
        const words = named(`${lead.invariant} ${lead.sentence}`);
        const score = (symbol: string): number => symbolWords(symbol).filter((w) => words.has(w)).length;
        if (lead.rivals.some((r) => score(r) > score(lead.symbol))) closures.push(closures.shift()!);
      }
      proposals.push({ entrance, declared, specPath: spec.specPath, route, closures });
    }
  }
  return proposals;
}

/* --------------------------------------------------------------- words */

function routeWords(route: FlowRoute): string {
  const others = route.names.length - 1;
  return `${route.names[0]}${others > 0 ? ` and ${others} more` : ""}, ${route.stops.join(" -> ")}`;
}

function guardWords(c: GuardClosure): string {
  const how = c.how === "traced" ? `its handler passes it (${CONTROL_WORDS.wrapper})` : `its handler's declaration calls ${c.symbol}`;
  return `${c.invariant} (${c.component === "." ? "the root" : c.component}, verified) guards this: ${how}. ${c.sentence}`;
}

/** One entrance's proposal in words: the gap, the proposed closure with the exact lines, and the alternatives. */
export function renderProposal(p: Proposal, cli: string): string {
  const [first, ...rest] = p.closures;
  const lines = [`${p.entrance.name}  (${p.specPath}:${p.declared.line}, trust ${p.entrance.trust.length === 0 ? "unknown" : p.entrance.trust.join(", ")})`, `  no traced control on its route: ${routeWords(p.route)}`];
  const say = (c: Closure, proposed: boolean): void => {
    const lead = proposed ? "  proposed:" : "  or:";
    if (c.kind === "guard") {
      lines.push(`${lead} ${c.line}`);
      if (!proposed) return;
      lines.push(`    ${guardWords(c)}`);
      if (c.rivals.length > 0) lines.push(`    the project's handlers call ${c.rivals.join(", ")}, each a symbol of that chokepoint's module: declare guard: only where the symbol applies the check (--guard <symbol> chooses)`);
      lines.push(`    add under its handler: line in ${p.specPath}; entrances that declare different guard: lines take their own route, so route-mates that do not pass it no longer count against it`);
    } else if (c.kind === "invariant") {
      if (c.unverified.length > 0 && proposed) lines.push(`  proposed first: verify ${c.unverified.map((u) => `${u.name} (${u.component}, ${u.state})`).join(", ")}, which its reach already meets; run it and refute it, and it controls this route`);
      lines.push(`${proposed && c.unverified.length === 0 ? lead : "  or:"} an invariant in ${c.specPath} whose crossing enters from ${p.entrance.trust[0] ?? "its trust (declare trust: first)"}${proposed ? ":" : ` (--as invariant prints it)`}`);
      if (!proposed && c.unverified.length === 0) return;
      for (const l of c.bullet.trimEnd().split("\n")) lines.push(`    ${l}`);
      lines.push(`    the crossing's far side is a level inside the system's control (${c.inside.join(", ") || "declare one"}); --chokepoint instead of the totality oracle form when one symbol every such request passes guards it`);
    } else {
      lines.push(`${lead} ${c.line}${proposed ? "" : "  if it needs none (--as none --reason \"<why>\")"}`);
      if (proposed) lines.push(`    plausibly none: ${c.why}; say why in the reason, and a human can challenge it in Scope`);
    }
  };
  if (first !== undefined) say(first, true);
  for (const c of rest) say(c, false);
  const choice = first?.kind === "none" ? ' --reason "<why>"' : first?.kind === "guard" && first.rivals.length > 0 ? ` --guard ${first.symbol}` : "";
  lines.push(`  write it: ${cli} scaffold control ${JSON.stringify(p.entrance.name)} --write${choice}`);
  return lines.join("\n");
}

/** Every gap, grouped by route: each route once, then its entrances' proposed closures, guard lines grouped by symbol. */
export function renderAll(proposals: readonly Proposal[], cli: string): string {
  if (proposals.length === 0) return "No spec gap: every entrance carrying outside or unknown trust in has a traced control on its route or declares control: none.";
  const lines = [`${proposals.length} entrance${proposals.length === 1 ? "" : "s"} with no traced control. To close one, ${CLOSE_WAYS}.`];
  const byRoute = new Map<string, Proposal[]>();
  for (const p of proposals) byRoute.set(p.route.id, [...(byRoute.get(p.route.id) ?? []), p]);
  for (const group of byRoute.values()) {
    const route = group[0]!.route;
    lines.push("", `the route of ${routeWords(route)} (${group.length} entrance${group.length === 1 ? "" : "s"}, trust ${route.trust.join(", ") || "unknown"}):`);
    const guards = new Map<string, Proposal[]>();
    const invariants: Proposal[] = [];
    const nones: Proposal[] = [];
    for (const p of group) {
      const c = p.closures[0]!;
      if (c.kind === "guard") guards.set(`${c.invariant}\u0000${c.symbol}`, [...(guards.get(`${c.invariant}\u0000${c.symbol}`) ?? []), p]);
      else if (c.kind === "none") nones.push(p);
      else invariants.push(p);
    }
    for (const members of guards.values()) {
      const c = members[0]!.closures[0] as GuardClosure;
      lines.push(`  ${members.length} of ${route.entrances.length}: ${c.line}   ${c.invariant} (${c.component}, verified): ${c.how === "traced" ? "their handlers pass it" : `their handlers call ${c.symbol}`}${c.rivals.length > 1 ? `; the project's handlers call ${c.rivals.join(", ")}, all symbols of its module: choose with --guard` : ""}`);
      for (const p of members.slice(0, 12)) lines.push(`    ${p.specPath}:${p.declared.line}  ${p.entrance.name}`);
      if (members.length > 12) lines.push(`    and ${members.length - 12} more`);
    }
    if (guards.size > 0 && invariants.length + nones.length > 0) lines.push(`  the other ${invariants.length + nones.length} keep a route of their own once those guard: lines are written; close them by an invariant, control: none, or a trust: level of their own:`);
    if (invariants.length > 0) {
      const c = invariants[0]!.closures[0] as InvariantClosure;
      lines.push(`  ${invariants.length}: an invariant in ${[...new Set(invariants.map((p) => p.specPath))].join(", ")} whose crossing enters from ${route.trust[0] ?? "their trust"}; one bullet covers every entrance its spec declares:`);
      for (const l of c.bullet.trimEnd().split("\n")) lines.push(`    ${l.replace(/<what every .* request must satisfy before its work runs>/, "<what every request on this route must satisfy before its work runs>")}`);
      lines.push(`    ${invariants.slice(0, 6).map((p) => p.entrance.name).join(", ")}${invariants.length > 6 ? ` and ${invariants.length - 6} more` : ""}`);
      const choices = invariants.flatMap((p) => p.closures.filter((c): c is GuardClosure => c.kind === "guard"));
      if (choices.length > 0) {
        const bySymbol = new Map<string, number>();
        for (const c of choices) bySymbol.set(c.symbol, (bySymbol.get(c.symbol) ?? 0) + 1);
        lines.push(`    of these, ${[...bySymbol].map(([symbol, n]) => `${n} call ${symbol}`).join(", ")}, a symbol of ${choices[0]!.invariant}'s chokepoint module its words do not name; if it applies that check, guard: it instead (--all --write --guard <symbol>)`);
      }
    }
    if (nones.length > 0) {
      lines.push(`  ${nones.length}: plausibly need no control (${(nones[0]!.closures[0] as NoneClosure).why}); if so: control: none — <reason>`);
      for (const p of nones.slice(0, 12)) lines.push(`    ${p.specPath}:${p.declared.line}  ${p.entrance.name}`);
      if (nones.length > 12) lines.push(`    and ${nones.length - 12} more`);
    }
  }
  lines.push("", `One entrance in full: ${cli} scaffold control "<entrance>". --all --write writes the guard: lines above whose symbol is not a choice (--guard <symbol> makes the choice); an invariant or control: none is written one entrance at a time.`);
  return lines.join("\n");
}

/* ------------------------------------------------------------- writing */

/** Insert one indented line under an entrance's bullet, after its handler:, trust: and guard: lines. Refused when the bullet already carries that key. */
export function insertEntranceLine(root: string, specPath: string, entrance: SpecEntrance, line: string): string {
  const path = join(root, specPath);
  const lines = readFileSync(path, "utf8").split("\n");
  const at = entrance.line - 1;
  if (!/^[-*]\s/.test(lines[at] ?? "")) throw new ScaffoldError(`${specPath}:${entrance.line} is not the bullet of entrance ${entrance.name}; the spec changed since it was read`);
  const keyOf = (l: string): string | undefined => /^\s+([a-z]+):/.exec(l)?.[1];
  const wanted = keyOf(`  ${line}`);
  let end = at + 1;
  let indent = "  ";
  while (end < lines.length && /^\s+\S/.test(lines[end]!) && keyOf(lines[end]!) !== undefined) {
    indent = /^(\s+)/.exec(lines[end]!)![1]!;
    if (keyOf(lines[end]!) === wanted) throw new ScaffoldError(`entrance ${entrance.name} already has a ${wanted}: line`);
    end += 1;
  }
  if ((wanted === "guard" && entrance.noControl !== undefined) || (wanted === "control" && entrance.guard !== undefined)) {
    throw new ScaffoldError(`entrance ${entrance.name} already declares ${wanted === "guard" ? "control: none" : "a guard:"}; a guard is a control, so it cannot carry both`);
  }
  lines.splice(end, 0, `${indent}${line}`);
  writeFileSync(path, lines.join("\n"), "utf8");
  return `${specPath}:${end + 1}  ${line}`;
}

/** Apply one closure for one entrance: the guard: line, the control: none line with its reason, or the invariant bullet. */
export function writeClosure(root: string, p: Proposal, c: Closure, reason?: string): string {
  if (c.kind === "guard") return insertEntranceLine(root, p.specPath, p.declared, c.line);
  if (c.kind === "none") {
    const text = reason?.trim() ?? "";
    const line = `control: none — ${text}`;
    if (text === "" || NO_CONTROL.exec(`none — ${text}`)?.[1]?.trim() !== text || /<[a-z][^<>]*>/.test(text)) throw new ScaffoldError(`control: none is written only with its reason: --reason "<why ${p.entrance.name} needs no control>" (${NO_CONTROL_FORM})`);
    return insertEntranceLine(root, p.specPath, p.declared, line);
  }
  appendInvariant(join(root, c.specPath), c.bullet);
  return `appended to ${c.specPath}: a requirement with its placeholders; fill them, then run and refute it`;
}
