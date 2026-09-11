import cytoscape from 'cytoscape';

// The only geometry mechanism. Asset kinds and view names never enter layout.
export function layoutProjection(assets, relations, configuration, valueAt) {
  const width = configuration.width ?? 330, height = configuration.height ?? 220, gap = configuration.gap ?? 48;
  const columns = Math.ceil(Math.sqrt(assets.length * 1.5 * height / width)), rows = Math.ceil(assets.length / columns);
  if (!assets.length) return { positions: {}, bounds: { x: 0, y: 0, width: 400, height: 300 }, width, height };
  const cy = cytoscape({ headless: true, styleEnabled: true,
    elements: [
      ...assets.map(a => ({ data: { id: a.id, weight: Number(valueAt(a, configuration.weight ?? 'attributes.mass.total')) || 1 } })),
      ...relations.map(r => ({ data: { id: r.id, source: r.source, target: r.target } })),
    ], style: [{ selector: 'node', style: { width, height } }],
  });
  try {
    cy.layout({ name: configuration.layout, animate: false, fit: false, avoidOverlap: true,
      nodeDimensionsIncludeLabels: false, minNodeSpacing: gap, spacingFactor: 1.2,
      boundingBox: { x1: 0, y1: 0, w: columns * (width + gap), h: rows * (height + gap) }, cols: columns, rows,
      concentric: node => node.data('weight'), levelWidth: () => Math.max(1, (cy.nodes().max(n => n.data('weight')).value || 1) / 4),
      directed: true, grid: false,
    }).run();
    const points = assets.map(a => ({ id: a.id, ...cy.getElementById(a.id).position() }));
    // One scale enforces actual rectangle clearance, including diagonal neighbors.
    let scale = points.length > 1 ? 0 : 1;
    for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
      const dx = Math.abs(points[i].x - points[j].x), dy = Math.abs(points[i].y - points[j].y);
      const required = Math.min((width + gap) / dx, (height + gap) / dy);
      if (!Number.isFinite(required)) throw new Error('Scope layout produced coincident assets');
      scale = Math.max(scale, required);
    }
    const positions = Object.fromEntries(points.map(p => [p.id, { x: p.x * scale - width / 2, y: p.y * scale - height / 2 }]));
    const left = Math.min(...Object.values(positions).map(p => p.x)), top = Math.min(...Object.values(positions).map(p => p.y));
    return { positions, width, height, bounds: { x: left, y: top,
      width: Math.max(...Object.values(positions).map(p => p.x)) + width - left,
      height: Math.max(...Object.values(positions).map(p => p.y)) + height - top } };
  } finally { cy.destroy(); }
}
