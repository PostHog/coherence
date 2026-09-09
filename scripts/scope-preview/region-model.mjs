import cytoscape from 'cytoscape';
import { scopeScene } from './scene.mjs';

// A reading of declared flows, not call-graph inference. Identity is the canonical
// address, so one symbol playing several roles is still one node.
export function regionScene(model, { owner = model.center, page = 0 } = {}) {
  const lens = scopeScene(model);
  const bindings = model.catalogBindings?.items ?? [];
  const candidates = model.nodes.filter(n => bindings.some(b => b.owner === n.id && b.binding?.flow));
  const focus = candidates.find(n => n.id === owner) ?? candidates.find(n => n.id === model.center) ?? candidates[0];
  const population = bindings.filter(b => b.owner === focus?.id && b.binding?.flow);
  const pages = Math.max(1, Math.ceil(population.length / 2));
  const currentPage = Math.min(Math.max(0, page), pages - 1);
  const rows = population.slice(currentPage * 2, currentPage * 2 + 2);
  const symbols = new Map();
  for (const row of rows) for (const endpoint of [row.binding.flow.from, row.binding.flow.to]) {
    const symbol = symbols.get(endpoint.subject) ?? { id: endpoint.subject, roles: [] };
    if (!symbol.roles.includes(endpoint.title)) symbol.roles.push(endpoint.title);
    symbols.set(endpoint.subject, symbol);
  }
  const context = model.nodes.filter(n => n.id !== focus?.id && n.role !== 'project' && n.role !== 'evidence'
    && model.relations.some(r => r.source === focus?.id && r.target === n.id));
  return { project: lens.project, focus, candidates, rows, symbols: [...symbols.values()], page: currentPage, pages, total: population.length,
    context: context.slice(0, 3), withheldContext: Math.max(0, context.length - 3),
    elsewhere: bindings.length - population.length, evidence: lens.evidence };
}

// Library-owned grid placement inside two reading regions. No force simulation,
// layout on evidence changes, or bespoke collision/edge-routing engine.
function grid(ids, width, height, cols) {
  if (!ids.length) return [];
  const cy = cytoscape({ headless: true, styleEnabled: true,
    elements: ids.map(id => ({ data: { id } })), style: [{ selector: 'node', style: { width, height } }] });
  try {
    cy.layout({ name: 'grid', cols, fit: false, animate: false, avoidOverlap: true, avoidOverlapPadding: 40,
      nodeDimensionsIncludeLabels: false, condense: true }).run();
    return ids.map(id => ({ id, ...cy.getElementById(id).position() }));
  } finally { cy.destroy(); }
}

export function regionGeometry({ symbols, context, expanded }) {
  const inner = expanded ? grid(symbols, 420, 310, 2) : [];
  const width = expanded ? Math.max(940, ...inner.map(p => p.x + 220)) : 560;
  const height = expanded ? Math.max(700, ...inner.map(p => p.y + 370)) : 390;
  const nodes = inner.map(p => ({ id: p.id, x: p.x - 140, y: p.y + 160 }));
  const providers = grid(context, 310, 190, 1).map(p => ({ id: p.id, x: width + 70, y: p.y - 95 }));
  return { width, height, symbols: nodes, context: providers,
    bounds: { x: 0, y: 0, width: width + (providers.length ? 380 : 0), height: Math.max(height, ...providers.map(p => p.y + 190)) } };
}
