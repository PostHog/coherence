import cytoscape from 'cytoscape';

// Presentation parameters, not another layout algorithm. Cytoscape owns placement
// and overlap avoidance; the model continues to own center and ring membership.
export const defaults = Object.freeze({ width: 280, height: 164, gap: 80, rotation: -35, sweep: 270 });
const compare = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

export function layoutScope(model, options = defaults) {
  const config = { ...defaults, ...options };
  if (!model.nodes.length) return { nodes: [], connections: [], rings: [], extent: { x: 200, y: 200 } };
  const subjects = [...model.nodes].sort(compare);
  const maxRing = Math.max(...subjects.map(n => n.ring));
  const cy = cytoscape({ headless: true, styleEnabled: true,
    elements: [
      ...subjects.map(n => ({ data: { id: n.id, ring: n.ring } })),
      ...model.relations.map(r => ({ data: { id: r.id, source: r.source, target: r.target } })),
    ],
    style: [{ selector: 'node', style: { width: config.width, height: config.height } }],
  });
  try {
    cy.layout({ name: 'concentric', animate: false, fit: false,
      boundingBox: { x1: 0, y1: 0, w: 1, h: 1 },
      concentric: n => maxRing - n.data('ring'), levelWidth: () => 1,
      startAngle: config.rotation * Math.PI / 180,
      sweep: config.sweep * Math.PI / 180,
      minNodeSpacing: config.gap, avoidOverlap: true, equidistant: false,
    }).run();
    const origin = cy.getElementById(model.center).position();
    const connected = cy.elements().components().find(c => c.nodes().some(n => n.id() === model.center));
    const nodes = subjects.map(n => {
      const p = cy.getElementById(n.id).position();
      return { ...n, x: p.x - origin.x, y: p.y - origin.y,
        disconnected: !connected.nodes().some(c => c.id() === n.id) };
    });
    const rings = [...new Set(nodes.map(n => n.ring))].filter(r => r > 0).map(ring => {
      const peers = nodes.filter(n => n.ring === ring);
      return { ring, radius: Math.hypot(peers[0].x, peers[0].y), disconnected: peers.every(n => n.disconnected) };
    });
    // Group display edges only; retain every directed canonical record for inspection.
    const pairs = new Map();
    for (const relation of [...model.relations].sort(compare)) {
      const key = JSON.stringify([relation.source, relation.target].sort());
      const members = pairs.get(key) ?? []; members.push(relation); pairs.set(key, members);
    }
    const connections = [...pairs.values()].map((members, index) => ({
      id: `connection-${index}`, source: members[0].source, target: members[0].target, members,
      mutual: members.some(r => r.source === members[0].target && r.target === members[0].source),
    }));
    return { nodes, connections, rings, extent: {
      x: Math.max(...nodes.map(n => Math.abs(n.x) + config.width / 2)) + 36,
      y: Math.max(...nodes.map(n => Math.abs(n.y) + config.height / 2)) + 36,
    } };
  } finally { cy.destroy(); }
}

export function lightOf(guarantees) {
  if (!guarantees.length) return 'unmeasured';
  return ['fail', 'stale', 'unknown', 'pass'].find(state => guarantees.some(g => g.verdict === state)) ?? 'unknown';
}
