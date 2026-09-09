import cytoscape from 'cytoscape';
import { relianceReading } from './guarantee-reading.mjs';

export const detailLevel = zoom => zoom < 0.48 ? 'overview' : zoom < 0.85 ? 'summary' : 'detail';

// Never turn a selected evidence population into whole-component health.
export function attention(guarantees, bindings = [], linkIssues = 0) {
  const states = ['fail', 'stale', 'unknown'].map(state => ({ state,
    count: guarantees.filter(g => g.verdict === state).length }));
  const damaged = bindings.filter(b => b.status !== 'current' || b.observation?.verdict !== 'pass').length;
  const parts = states.filter(s => s.count).map(s => `${s.count} ${s.state}`);
  if (damaged) parts.push(`${damaged} binding${damaged === 1 ? '' : 's'} need attention`);
  if (linkIssues) parts.push(`${linkIssues} broken links`);
  return parts.join(' · ') || (guarantees.length ? 'Scoped evidence only' : 'No guarantees declared');
}

// Authored directions are separate edges; import adjacency remains background.
export function mapConnections(model, connections) {
  return connections.flatMap(c => {
    const directions = new Map();
    for (const r of c.members) {
      const rows = relianceReading(model, r);
      if (!rows.length) continue;
      const key = JSON.stringify([r.source, r.target]);
      const entry = directions.get(key) ?? { id: `promise-${key}`, source: r.source, target: r.target, members: [], promises: [] };
      entry.members.push(r);
      for (const row of rows) if (!entry.promises.some(p => p.link === row.link)) entry.promises.push(row);
      directions.set(key, entry);
    }
    return [{ ...c, kind: 'import' }, ...[...directions.values()].map(c => ({ ...c, kind: 'promise' }))];
  });
}

export function declaredSubjects(guarantees, bindings) {
  const subjects = new Map(), edges = [];
  function add(id, label, claim, grade) {
    const s = subjects.get(id) ?? { id, label, grade, claims: new Set() };
    s.claims.add(claim); subjects.set(id, s);
  }
  const boundClaims = new Set();
  for (const row of bindings) {
    const b = row.binding;
    if (!b) continue;
    boundClaims.add(b.claim);
    const endpoints = b.flow ? [b.flow.from, b.flow.to] : [{ subject: b.subject, title: b.subject }];
    for (const e of endpoints) add(e.subject, e.subject.split('#').at(-1), b.claim, 'Binding address');
    if (b.flow) edges.push({ id: row.id, source: b.flow.from.subject, target: b.flow.to.subject,
      label: row.definition?.title ?? b.claim, row });
  }
  for (const g of guarantees) if (!boundClaims.has(g.id) && g.chokepoint) {
    add(`anchor:${g.chokepoint}`, g.chokepoint, g.id, 'Declared enforcement anchor; not a resolved symbol');
  }
  const nodes = [...subjects.values()].map(s => ({ ...s, claims: [...s.claims], mass: s.claims.size }));
  const max = Math.max(0, ...nodes.map(s => s.mass));
  return { nodes, edges, centers: nodes.filter(s => s.mass === max).map(s => s.id) };
}

export function subjectGeometry(subjects) {
  // Bounded inspection: all incidence leaders first; report any withheld tail.
  const nodes = [...subjects.nodes].sort((a, b) => b.mass - a.mass || a.id.localeCompare(b.id)).slice(0, 6);
  if (!nodes.length) return { nodes: [], edges: [], withheld: 0, bounds: '0 0 520 300' };
  const ids = new Set(nodes.map(n => n.id));
  const edges = subjects.edges.filter(e => ids.has(e.source) && ids.has(e.target));
  const cy = cytoscape({ headless: true, styleEnabled: true,
    elements: nodes.map(n => ({ data: { id: n.id, mass: n.mass } })),
    style: [{ selector: 'node', style: { width: 170, height: 70 } }] });
  try {
    cy.layout({ name: 'concentric', fit: false, animate: false, minNodeSpacing: 35,
      startAngle: 0, concentric: n => n.data('mass'), levelWidth: () => 1, avoidOverlap: true }).run();
    const placed = nodes.map(n => ({ ...n, ...cy.getElementById(n.id).position() }));
    const x = Math.min(...placed.map(n => n.x)) - 95, y = Math.min(...placed.map(n => n.y)) - 45;
    return { nodes: placed, edges, withheld: subjects.nodes.length - placed.length,
      bounds: `${x} ${y} ${Math.max(...placed.map(n => n.x)) + 95 - x} ${Math.max(...placed.map(n => n.y)) + 45 - y}` };
  } finally { cy.destroy(); }
}
