// scope-model.ts — the pure, deterministic projection behind Scope.
// It composes the already-derived structural and promise models; it never walks source,
// reads a clock, or grades a guarantee. Position is structural, while mass keeps every
// contribution visible so the picture's centre can be audited from the emitted model.
import type { Grade, PromiseModel } from "./promise-model.ts";
import type { Config, Graph, GraphNode } from "../types.ts";
import { crossingOwners } from "./index-model.ts";
import { guaranteeRef } from "../verification/boundary.ts";
import { resolveGuaranteeLinks, type GuaranteeLinks, type GuaranteeTaxonomy } from "../verification/guarantees.ts";

export interface ScopeMass {
  ownedFiles: number;
  ownedLines: number;
  ownedSurface: number;
  inboundReliance: number;
  boundaryAuthority: number;
  guaranteeResponsibility: number;
  total: number;
}

export interface ScopeNode extends Pick<GraphNode, "prose" | "why" | "invariants" | "refutations" | "claims" | "claimKinds"> {
  id: string;                 // component dir; the PromiseModel's stable component key
  graphNodeId: string;
  parent?: string | null;    // canonical spec containment, never an import dependency
  role?: "project" | "assembly" | "evidence";
  label: string;
  intent: string;
  mass: ScopeMass;
  ring: number;
  angle: number;              // radians, zero at twelve o'clock
  x: number;
  y: number;
  disconnected?: boolean;    // no reliance path to the selected center
}

export interface ScopeRelation {
  id: string;
  source: string;
  target: string;
  kind: "reliance" | "evidence-import";
  crossing: { from: string; to: string } | null;
  via: string | null;
}

export interface ScopeGuarantee {
  id: string;
  component: string;
  invariant: string;
  chokepoint: string;
  grade: Grade;
  verdict: "pass" | "fail" | "stale" | "unknown";
  crossing: { from: string; to: string } | null;
  oracle: string;
}

export interface ScopeModel {
  guaranteeLinks?: GuaranteeLinks;
  root: string;
  center: string | null;
  nodes: ScopeNode[];
  relations: ScopeRelation[];
  guarantees: ScopeGuarantee[];
  containment: { parent: string; child: string }[];
  charts: Record<string, string> | null;
  transitions: ScopeTransition[];
}

/** Project-authored atlas semantics. No tier or verdict is inferred from this text. */
export interface ScopeTransition {
  symbol: string;
  from: string;
  to: string;
  translates: string;
  security: boolean;
  component: string | null;
  ownerWhy: string | null;
  declaredAnchor: string | null;
  guarantees: string[];
}

export const SCOPE_CARD_WIDTH = 304;
export const SCOPE_CARD_HEIGHT = 184;
export const SCOPE_RING_RADIUS = 300;

const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/** An integer compression of source extent: files remain visible and line mass grows
 * logarithmically, so one generated-sized component cannot erase all topology. */
function ownedSurface(files: number, lines: number): number {
  return files + Math.ceil(Math.log2(lines + 1));
}

function shortestDistances(origin: string, adjacency: Map<string, Set<string>>): Map<string, number> {
  const distances = new Map<string, number>([[origin, 0]]);
  const queue = [origin];
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    const next = [...(adjacency.get(current) ?? [])].sort(cmp);
    for (const id of next) if (!distances.has(id)) {
      distances.set(id, distances.get(current)! + 1);
      queue.push(id);
    }
  }
  return distances;
}

/** Weighted graph medoid. Disconnected vertices receive one stable step beyond the
 * largest possible connected distance: they influence the choice without inventing a
 * path. Lexical component identity breaks exact ties. */
export function scopeCenter(
  ids: string[], masses: ReadonlyMap<string, number>, adjacency: Map<string, Set<string>>,
): string | null {
  if (ids.length === 0) return null;
  const ordered = [...ids].sort(cmp);
  const disconnectedDistance = ordered.length + 1;
  let winner = ordered[0], winningCost = Number.POSITIVE_INFINITY;
  for (const candidate of ordered) {
    const distances = shortestDistances(candidate, adjacency);
    const cost = ordered.reduce((sum, id) =>
      sum + (masses.get(id) ?? 1) * (distances.get(id) ?? disconnectedDistance), 0);
    if (cost < winningCost) { winner = candidate; winningCost = cost; }
  }
  return winner;
}

export function buildScopeModel(graph: Graph, promise: PromiseModel, context: Pick<Config, "atlas" | "testDir"> = {}, taxonomy?: GuaranteeTaxonomy): ScopeModel {
  const { atlas } = context;
  const components = [...promise.components].sort((a, b) => cmp(a.dir, b.dir));
  const ids = new Set(components.map((component) => component.dir));
  const graphComponentIds = graph.nodes.filter((node) => node.kind === "component")
    .map((node) => node.id.startsWith("c:") ? node.id.slice(2) : node.id).sort(cmp);
  const promiseComponentIds = components.map((component) => component.dir);
  if (graphComponentIds.length !== promiseComponentIds.length ||
      graphComponentIds.some((id, index) => id !== promiseComponentIds[index])) {
    throw new Error(`scope component parity failed: graph=[${graphComponentIds.join(", ")}] promise=[${promiseComponentIds.join(", ")}]`);
  }
  const testDir = context.testDir?.replace(/^\.\//, "").replace(/\/+$/, "");
  const roles = new Map(components.map(c => [c.dir,
    testDir && (`/${c.dir}/`).includes(`/${testDir}/`) ? "evidence" as const :
      c.dir === "." && c.mass.files === 0 && c.gates.length === 0 && c.relies.length === 0 &&
        graph.nodes.some(n => n.kind === "component" && n.parent === "c:.") ? "project" as const : "assembly" as const]));

  const relations: ScopeRelation[] = [];
  for (const component of components) {
    const relies = [...component.relies].sort((a, b) => cmp(a.to, b.to));
    for (let i = 0; i < relies.length; i++) {
      const reliance = relies[i];
      if (!ids.has(reliance.to)) {
        throw new Error(`scope reliance target is not a component: ${component.dir} -> ${reliance.to}`);
      }
      relations.push({
        id: `r:${component.dir}->${reliance.to}:${i}`,
        source: component.dir, target: reliance.to, kind: roles.get(component.dir) === "evidence" ? "evidence-import" : "reliance",
        crossing: reliance.crossing, via: reliance.via,
      });
    }
  }

  const adjacency = new Map(components.map((component) => [component.dir, new Set<string>()]));
  const inbound = new Map(components.map((component) => [component.dir, 0]));
  for (const relation of relations) {
    if (relation.kind !== "reliance") continue;
    adjacency.get(relation.source)!.add(relation.target);
    adjacency.get(relation.target)!.add(relation.source);
    inbound.set(relation.target, inbound.get(relation.target)! + 1);
  }

  const masses = new Map<string, ScopeMass>();
  for (const component of components) {
    const boundaryAuthority = component.gates.filter((gate) => gate.crossing !== null).length;
    const guaranteeResponsibility = component.gates.length;
    const surface = ownedSurface(component.mass.files, component.mass.lines);
    const mass: ScopeMass = {
      ownedFiles: component.mass.files,
      ownedLines: component.mass.lines,
      ownedSurface: surface,
      inboundReliance: inbound.get(component.dir) ?? 0,
      boundaryAuthority,
      guaranteeResponsibility,
      total: surface + (inbound.get(component.dir) ?? 0) + boundaryAuthority + guaranteeResponsibility,
    };
    // Even an empty declared component has gravitational presence.
    if (mass.total === 0) mass.total = 1;
    masses.set(component.dir, mass);
  }

  const assemblyIds = components.filter(c => roles.get(c.dir) === "assembly").map(c => c.dir);
  const center = scopeCenter(assemblyIds.length ? assemblyIds : components.map(c => c.dir),
    new Map([...masses].map(([id, mass]) => [id, mass.total])), adjacency);
  const distances = center === null ? new Map<string, number>() : shortestDistances(center, adjacency);
  const maxConnected = Math.max(0, ...distances.values());
  const ringOf = (id: string) => distances.get(id) ?? maxConnected + 1;
  const byRing = new Map<number, string[]>();
  for (const component of components) {
    const ring = ringOf(component.dir);
    (byRing.get(ring) ?? byRing.set(ring, []).get(ring)!).push(component.dir);
  }
  for (const ring of byRing.values()) ring.sort(cmp);

  // Equal-distance peers share one radius. Stagger successive rings so sparse graphs
  // occupy the field instead of collapsing onto one axis. A whole ring expands until
  // all of its cards clear previously placed cards, retaining concentric geometry.
  const positions = new Map<string, { x: number; y: number; angle: number }>();
  let previousRadius = 0;
  for (const [ring, peers] of [...byRing].sort(([a], [b]) => a - b)) {
    if (ring === 0) { positions.set(peers[0], { x: 0, y: 0, angle: 0 }); continue; }
    const phase = Math.PI / 4 + (ring - 1) * Math.PI / 2;
    let radius = Math.max(SCOPE_RING_RADIUS, previousRadius + SCOPE_CARD_HEIGHT + 48);
    for (;;) {
      const candidates = peers.map((id, index) => {
        const angle = phase + 2 * Math.PI * index / peers.length;
        return { id, angle, x: Math.round(Math.sin(angle) * radius), y: Math.round(-Math.cos(angle) * radius) };
      });
      const occupied = [...positions.values()];
      const overlaps = candidates.some((candidate, index) =>
        [...occupied, ...candidates.slice(0, index)].some(other =>
          Math.abs(candidate.x - other.x) < SCOPE_CARD_WIDTH + 40 &&
          Math.abs(candidate.y - other.y) < SCOPE_CARD_HEIGHT + 40));
      if (!overlaps) {
        for (const candidate of candidates) positions.set(candidate.id, candidate);
        previousRadius = radius;
        break;
      }
      radius += 24;
    }
  }

  const nodes: ScopeNode[] = components.map((component) => {
    const source = graph.nodes.find(node => node.kind === "component" &&
      (node.id === `c:${component.dir}` || node.id === component.dir))!;
    const ring = ringOf(component.dir);
    const position = positions.get(component.dir)!;
    return {
      id: component.dir,
      graphNodeId: `c:${component.dir}`,
      parent: source.parent?.startsWith("c:") ? source.parent.slice(2) : null,
      role: roles.get(component.dir)!,
      label: component.label,
      intent: component.intent,
      prose: source.prose ?? "", why: source.why ?? "",
      invariants: source.invariants ?? [], refutations: source.refutations ?? [],
      claims: source.claims ?? [], claimKinds: source.claimKinds ?? {},
      mass: masses.get(component.dir)!,
      ring, angle: position.angle, x: position.x, y: position.y,
      ...(!distances.has(component.dir) ? { disconnected: true } : {}),
    };
  });

  const guarantees: ScopeGuarantee[] = components.flatMap((component) =>
    component.gates.map((gate) => ({
      id: guaranteeRef(component.dir, gate),
      component: component.dir,
      invariant: gate.inv,
      chokepoint: gate.chokepoint,
      grade: gate.grade,
      verdict: gate.verdict,
      crossing: gate.crossing,
      oracle: gate.oracle,
    })),
  );

  const containment = nodes.filter(n => n.parent !== null).map(n => {
    if (!n.parent || !ids.has(n.parent) || n.parent === n.id)
      throw new Error(`scope containment parent is not a distinct component: ${n.id} -> ${n.parent}`);
    return { parent: n.parent, child: n.id };
  });
  const fileOwners = new Map(graph.nodes.filter(n => n.kind === "file").map(n => [n.id, n.parent?.slice(2)]));
  const symbolOwners = new Map<string, Set<string>>();
  for (const symbol of graph.nodes.filter(n => n.kind === "symbol")) {
    const owner = symbol.parent ? fileOwners.get(symbol.parent) : undefined;
    if (owner) (symbolOwners.get(symbol.label) ?? symbolOwners.set(symbol.label, new Set()).get(symbol.label)!).add(owner);
  }
  const declared = Object.entries(atlas?.transitions ?? {}).sort(([a], [b]) => cmp(a, b));
  const owners = crossingOwners(declared.map(([sym]) => ({ sym, present: true })), symbolOwners,
    new Map(components.map(c => [c.dir, c.label])));
  const transitions = declared.map(([symbol, declaration]): ScopeTransition => ({
    symbol, from: declaration.from, to: declaration.to, translates: declaration.translates,
    security: declaration.security === true, component: owners.get(symbol)!.dir,
    ownerWhy: owners.get(symbol)!.why ?? null, declaredAnchor: declaration.anchoredBy ?? null,
    guarantees: guarantees.filter(g => g.chokepoint === symbol || g.chokepoint === declaration.anchoredBy).map(g => g.id),
  }));
  return { root: graph.root, center, nodes, relations, guarantees, containment,
    ...(taxonomy ? { guaranteeLinks: resolveGuaranteeLinks(graph, guarantees, relations, taxonomy) } : {}),
    charts: atlas?.charts ?? null, transitions };
}
