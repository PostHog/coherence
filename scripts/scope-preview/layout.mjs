import cytoscape from 'cytoscape';

// Cytoscape owns angular placement and relative ring radii. A uniform rectangular
// clearance projection owns density; the canonical model owns center/membership.
export const defaults = Object.freeze({ width: 560, height: 614, gap: 24, rotation: -90, sweep: 320 });
const compare = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

export function layoutScope(model, options = defaults) {
  const config = { ...defaults, ...options };
  if (!model.nodes.length) return { nodes: [], connections: [], rings: [], bounds: { x: -200, y: -200, width: 400, height: 400 } };
  const subjects = [...model.nodes].sort(compare);
  const maxRing = Math.max(...subjects.map(n => n.ring));
  // Reserve the rectangle's circumscribed diameter: max(width,height) alone lets
  // diagonal cards collide (observed at 360×300, gap 48, rotation -35, sweep 200).
  const footprint = Math.hypot(config.width, config.height);
  const cy = cytoscape({ headless: true, styleEnabled: true,
    elements: [
      ...subjects.map(n => ({ data: { id: n.id, ring: n.ring } })),
      ...model.relations.map(r => ({ data: { id: r.id, source: r.source, target: r.target } })),
    ],
    style: [{ selector: 'node', style: { width: footprint, height: footprint } }],
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
        disconnected: n.disconnected ?? !connected.nodes().some(c => c.id() === n.id) };
    });
    // Cytoscape owns ordering, angles and relative ring radii. Its circular
    // exclusion area is conservative for our rectangular cards. One uniform
    // radial scale fits the actual rectangles, retaining every angle and ring.
    // A pair clears when EITHER axis clears; the worst pair sets the common scale.
    let clearance = nodes.length > 1 ? 0 : 1;
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const dx = Math.abs(nodes[i].x - nodes[j].x), dy = Math.abs(nodes[i].y - nodes[j].y);
      const required = Math.min((config.width + config.gap) / dx, (config.height + config.gap) / dy);
      if (!Number.isFinite(required)) throw new Error('Scope layout produced coincident component centers');
      clearance = Math.max(clearance, required);
    }
    for (const node of nodes) { node.x *= clearance; node.y *= clearance; }
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
    const connections = [...pairs.entries()].map(([key, members]) => ({
      id: `connection-${encodeURIComponent(key)}`, source: members[0].source, target: members[0].target, members,
      mutual: members.some(r => r.source === members[0].target && r.target === members[0].source),
    }));
    const left = Math.min(...nodes.map(n => n.x - config.width / 2));
    const top = Math.min(...nodes.map(n => n.y - config.height / 2));
    const right = Math.max(...nodes.map(n => n.x + config.width / 2));
    const bottom = Math.max(...nodes.map(n => n.y + config.height / 2));
    return { nodes, connections, rings, bounds: { x: left, y: top, width: right - left, height: bottom - top } };
  } finally { cy.destroy(); }
}

export function lightOf(guarantees) {
  if (!guarantees.length) return 'unmeasured';
  return ['fail', 'stale', 'unknown', 'pass'].find(state => guarantees.some(g => g.verdict === state)) ?? 'unknown';
}
