const GROUPS = Object.freeze({ rank: 'rankers', layout: 'layouts', route: 'routers', card: 'cards', view: 'views' });
const NAME = /^[a-z0-9][a-z0-9_-]*(?:\.[a-z0-9][a-z0-9_-]*)+$/i;

export function createStructureRegistry(defaults, extensions = []) {
  const maps = Object.fromEntries(Object.keys(GROUPS).map(kind => [kind, new Map([['default', defaults[kind]]])]));
  for (const [index, registration] of extensions.entries()) {
    if (!registration || typeof registration !== 'object' || Array.isArray(registration)) throw new Error(`Structure extension ${index} must export an object`);
    if (registration.apiVersion !== 1) throw new Error(`Structure extension ${index} has incompatible apiVersion ${String(registration.apiVersion)}; expected 1`);
    const allowed = new Set(['apiVersion', ...Object.values(GROUPS)]);
    const unknown = Object.keys(registration).filter(key => !allowed.has(key));
    if (unknown.length) throw new Error(`Structure extension ${index} has unknown registration field ${JSON.stringify(unknown[0])}`);
    for (const [kind, plural] of Object.entries(GROUPS)) {
      const entries = registration[plural] ?? {};
      if (!entries || typeof entries !== 'object' || Array.isArray(entries)) throw new Error(`Structure extension ${index}.${plural} must be a name-to-implementation object`);
      for (const [name, implementation] of Object.entries(entries)) {
        if (!NAME.test(name)) throw new Error(`Structure ${plural} registration ${JSON.stringify(name)} must be a namespaced identifier such as project.${kind}`);
        if (maps[kind].has(name)) throw new Error(`Duplicate Structure ${plural} registration ${JSON.stringify(name)}`);
        if (typeof implementation !== 'function') throw new Error(`Structure ${plural} registration ${JSON.stringify(name)} must be a function or React component`);
        maps[kind].set(name, implementation);
      }
    }
  }
  const direct = Object.fromEntries(Object.keys(GROUPS).map(kind => [kind, context => defaults[kind](context)]));
  return {
    defaults: direct,
    resolve(kind, name = 'default') {
      const implementation = maps[kind]?.get(name);
      if (!implementation) throw new Error(`Unknown Structure ${GROUPS[kind] ?? kind} implementation ${JSON.stringify(name)}`);
      return implementation;
    },
    names(kind) { return [...(maps[kind]?.keys() ?? [])]; },
  };
}

export function validateRanked(value, model) {
  if (!Array.isArray(value) || value.length !== model.components.length) throw new Error('Structure ranker must return every component exactly once');
  const ids = value.map(component => component?.id);
  if (ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length || ids.some(id => !model.components.some(component => component.id === id))) throw new Error('Structure ranker returned invalid or duplicate component identities');
  const canonical = new Map(model.components.map(component => [component.id, component]));
  return value.map(item => {
    const component = canonical.get(item.id);
    const metadata = {};
    for (const key of ['score', 'counts', 'terms', 'peers', 'consumers']) if (Object.hasOwn(item, key)) metadata[key] = item[key];
    if (metadata.score !== undefined && !Number.isFinite(metadata.score)) throw new Error(`Structure ranker returned a non-finite score for ${item.id}`);
    return { ...component, ...metadata };
  });
}

export function validateLayout(value, ranked) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.cards)) throw new Error('Structure layout must return an object with cards');
  const frame = ranked.length > 1 ? ranked.find(item => item.parent === null) : undefined;
  const expected = frame ? ranked.filter(item => item.id !== frame.id) : ranked;
  const ids = new Set(expected.map(item => item.id));
  if (value.cards.length !== ids.size || value.cards.some(card => !ids.has(card?.id) || !['x','y','width','height'].every(key => Number.isFinite(card[key])) || card.width <= 0 || card.height <= 0)) throw new Error('Structure layout returned malformed or incomplete card geometry');
  if (new Set(value.cards.map(card => card.id)).size !== value.cards.length) throw new Error('Structure layout returned duplicate card identities');
  const coreIds = value.coreIds ?? value.cards.filter(card => card.downtown).map(card => card.id);
  if (!Array.isArray(coreIds) || new Set(coreIds).size !== coreIds.length || coreIds.some(id => !ids.has(id))) throw new Error('Structure layout returned invalid downtown component identities');
  const core = new Set(coreIds);
  if (value.cards.some(card => Boolean(card.downtown) !== core.has(card.id))) throw new Error('Structure layout downtown flags disagree with coreIds');
  const canonical = new Map(expected.map(component => [component.id, component]));
  return { ...value, coreIds, cards: value.cards.map(card => ({ ...canonical.get(card.id), x: card.x, y: card.y, width: card.width, height: card.height, downtown: core.has(card.id) })) };
}

export function validateRoutes(value, relationships) {
  if (!Array.isArray(value)) throw new Error('Structure router must return an array');
  const canonical = new Map(relationships.map(edge => [edge.id, edge]));
  if (value.length !== canonical.size || new Set(value.map(edge => edge?.id)).size !== value.length || value.some(edge => !canonical.has(edge?.id))) throw new Error('Structure router must return every requested relationship exactly once');
  return value.map(edge => {
    const relation = canonical.get(edge.id);
    if (edge.source !== relation.source || edge.target !== relation.target) throw new Error(`Structure router changed semantic endpoints for ${edge.id}`);
    if (typeof edge.path !== 'string' || !/^M\s*-?\d/.test(edge.path.trim()) || !Array.isArray(edge.points) || edge.points.length < 2 || edge.points.some(point => !Number.isFinite(point?.x) || !Number.isFinite(point?.y))) throw new Error(`Structure router returned malformed geometry for ${edge.id}`);
    return { ...relation, path: edge.path, points: edge.points, ...(edge.labelBox ? { labelBox: edge.labelBox } : {}) };
  });
}
