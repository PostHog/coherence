const BASE_WEIGHTS = Object.freeze({ peers: 3, guarantees: 2, security: 1, consumers: 2 });

export function defaultRank({ model, options = {} }) {
  const weights = { ...BASE_WEIGHTS, ...(options.rankingWeights ?? options.weights ?? {}) };
  return model.components.map(component => {
    const incident = model.relationships.filter(edge => edge.source === component.id || edge.target === component.id);
    const peers = [...new Set(incident.map(edge => edge.source === component.id ? edge.target : edge.source))];
    const consumers = [...new Set(model.relationships.filter(edge => edge.kind === 'guarantee-reliance' && edge.target === component.id).map(edge => edge.source))];
    const counts = {
      peers: peers.length,
      guarantees: new Set(component.guarantees.map(guarantee => guarantee.id)).size,
      security: new Set(component.boundaries.filter(boundary => boundary.attributes.security === true).map(boundary => boundary.id)).size,
      consumers: consumers.length,
    };
    const terms = Object.fromEntries(Object.entries(weights).map(([key, weight]) => [key, Number(weight) * Math.log1p(counts[key] ?? 0)]));
    return { ...component, peers, consumers, counts, terms, score: Object.values(terms).reduce((sum, value) => sum + value, 0) };
  }).sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
}

export const DEFAULT_RANKING_WEIGHTS = BASE_WEIGHTS;
