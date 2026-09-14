// Geometry only. Architectural identity, prominence, and relationships come from
// structure-model.ts; this module deliberately accepts plain projection-shaped data.
export function structureLayout(components, expanded, options, relationshipCounts = {}) {
  const open = expanded instanceof Set ? expanded : new Set(expanded);
  const columns = Math.min(options.columns, Math.max(1, components.length));
  const gap = 20, width = 292, closedHeight = 142;
  const positions = {}, regions = {};
  let cursorY = 28;
  for (let start = 0; start < components.length; start += columns) {
    const row = components.slice(start, start + columns);
    const heights = row.map(component => closedHeight + (open.has(component.id) ? detailHeight(component, options, relationshipCounts[component.id] ?? 0) : 0));
    const rowHeight = Math.max(...heights);
    row.forEach((component, index) => {
      const x = 28 + index * (width + gap), height = heights[index];
      positions[component.id] = { x, y: cursorY, width, height };
      if (open.has(component.id)) regions[component.id] = { x: x - 10, y: cursorY - 34, width: width + 20, height: height + 44, label: component.label };
    });
    cursorY += rowHeight + gap;
  }
  const rows = Math.ceil(components.length / columns);
  return { positions, regions, width, height: closedHeight, bounds: { x: 0, y: 0, width: columns * (width + gap) + 28, height: Math.max(260, cursorY - gap + 28) }, rows, columns };
}

function detailHeight(component, options, relationships) {
  const guarantees = Math.min(component.guarantees?.length ?? 0, options.summaryGuarantees);
  const local = (component.boundaries?.length ?? 0) + (component.resources?.length ?? 0) + (component.entrances?.length ?? 0);
  return 82 + guarantees * 31 + Math.min(local, 3) * 26 + Math.min(relationships, 4) * 25;
}
