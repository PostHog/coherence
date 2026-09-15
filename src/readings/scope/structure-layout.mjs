export { defaultLayout, DEFAULT_LAYOUT_OPTIONS } from './structure-browser/layout.mjs';
export { defaultRank, DEFAULT_RANKING_WEIGHTS } from './structure-browser/ranking.mjs';

// Compatibility for callers of the prototype's former grid helper. New Structure
// rendering goes through the frozen context interface above.
export function structureLayout(components, expanded, options, relationshipCounts = {}) {
  const model = { components, relationships: [] };
  const ranked = components.map(component => ({ ...component, score: component.density?.total ?? 0, counts: { peers: relationshipCounts[component.id] ?? 0, guarantees: component.guarantees?.length ?? 0, security: 0, consumers: 0 } }));
  return defaultCompat(model, ranked, options);
}

function defaultCompat(model, ranked, options) {
  const count = Math.max(1, Number(options?.columns ?? 3));
  const spacing = { x: 312, y: 214 };
  const cards = ranked.map((component, index) => ({ ...component, x: 28 + (index % count) * spacing.x, y: 28 + Math.floor(index / count) * spacing.y, width: 292, height: 142 }));
  return { positions: Object.fromEntries(cards.map(card => [card.id, card])), regions: {}, cards, columns: Math.min(count, Math.max(1, cards.length)), rows: Math.ceil(cards.length / count), bounds: { x: 0, y: 0, width: Math.min(count, Math.max(1, cards.length)) * spacing.x + 28, height: Math.max(260, Math.ceil(cards.length / count) * spacing.y + 28) } };
}
