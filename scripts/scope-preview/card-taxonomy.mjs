// Display aggregation only. A file/symbol role never becomes its owner's classification.
export function taxonomyWithin(readings, owner) {
  const error = readings.errors?.find(e => e.source === 'taxonomy');
  const taxonomy = readings.taxonomy;
  if (error || !taxonomy) return { available: false, message: error ? 'Taxonomy unavailable' : 'Taxonomy not captured', items: [], roles: [], facets: [] };
  const items = taxonomy.items.filter(item => item.record.snapshot.subject.owner === owner);
  const aggregate = (field, label) => {
    const counts = new Map();
    for (const item of items) for (const id of new Set(item.classification[field])) {
      const entry = counts.get(id) ?? { id, label: label(id), count: 0, stale: 0 };
      entry.count++; if (item.status === 'stale') entry.stale++;
      counts.set(id, entry);
    }
    return [...counts.values()].sort((a, b) => b.count - a.count || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  };
  const states = new Map();
  for (const item of items) {
    const state = item.classification.assessment;
    states.set(state, (states.get(state) ?? 0) + 1);
  }
  const stale = items.filter(item => item.status === 'stale').length;
  const issues = [...(stale ? [`${stale} stale`] : []), ...[...states.entries()].sort().filter(([state]) => !['classified', 'composite'].includes(state)).map(([state, count]) => `${count} ${state}`)];
  return { available: true, items, stale, issues,
    roles: aggregate('roles', id => taxonomy.catalog.roles.find(r => r.id === id)?.label ?? id),
    facets: aggregate('facets', id => id.replace(/^facet:/, '').replaceAll('-', ' ')),
  };
}
