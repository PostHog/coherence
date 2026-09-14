// Trial policy, not a security score. All counts come from canonical declarations.
export const policy = {
  weights: { peers: 3, guarantees: 2, security: 1, consumers: 2 },
  centers: 3,
  coreFloor: 0.65,
  coreSize: { width: 320, height: 254 },
  outerSize: { width: 260, height: 174 },
  pitch: { x: 480, y: 420 },
  origin: { x: 440, y: 530 },

};

export function rankComponents(model, config = policy) {
  return model.components.map(c => {
    const peers = [...new Set(model.relationships.filter(e => e.source === c.id || e.target === c.id)
      .map(e => e.source === c.id ? e.target : e.source))];
    const consumers = [...new Set(model.relationships.filter(e => e.kind === 'guarantee-reliance' && e.target === c.id).map(e => e.source))];
    const counts = { peers: peers.length, guarantees: new Set(c.guarantees.map(g => g.id)).size,
      security: new Set(c.boundaries.filter(b => b.attributes.security === true).map(b => b.id)).size, consumers: consumers.length };
    const terms = Object.fromEntries(Object.entries(config.weights).map(([key, weight]) => [key, weight * Math.log1p(counts[key])]));
    return { ...c, peers, consumers, counts, terms, score: Object.values(terms).reduce((a, b) => a + b, 0) };
  }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

function permutations(items) {
  if (items.length < 2) return [items];
  return items.flatMap((item, i) => permutations(items.filter((_, j) => i !== j)).map(rest => [item, ...rest]));
}

export function place(model, config = policy) {
  // The root is the project frame, still selectable in the header.
  const ranked = rankComponents(model, config);
  const root = ranked.find(c => c.parent === null);
  const population = ranked.filter(c => c.id !== root?.id);
  if (!population.length) throw new Error('Structure needs at least one component beneath the project spec.');
  const count = Math.max(1, Math.min(config.centers, population.filter(c=>c.score>=population[0].score*config.coreFloor).length));
  const core = population.slice(0, count), outer = population.slice(count);
  const coreSlots = core.map((_, i) => ({x: config.origin.x + i * config.pitch.x, y: config.origin.y}));
  const centerX = (coreSlots[0].x + coreSlots.at(-1).x) / 2 - 10;
  const topCount = Math.max(Math.ceil(outer.length / 2), outer.filter(c=>c.entrances.length).length), bottomCount = outer.length - topCount;
  const row = (n, y) => Array.from({length:n}, (_,i) => ({x:centerX + (i-(n-1)/2)*config.pitch.x,y}));
  const outerSlots = [...row(topCount,config.origin.y-config.pitch.y),...row(bottomCount,config.origin.y+config.pitch.y)];
  let best;
  if(core.length>3 || outer.length>8) throw new Error('This study bounds exact placement to three core and eight peripheral stacks; larger-graph placement is not implemented.');
  for (const order of permutations(core)) {
    const positions = Object.fromEntries(order.map((c, i) => [c.id, coreSlots[i]]));
    // A directed core path reads left to right where declarations support one.
    const coreCost = model.relationships.filter(e => e.kind === 'architecture' && positions[e.source] && positions[e.target])
      .reduce((sum, e) => sum + (positions[e.source].x > positions[e.target].x ? 1800 : 0), 0);
    const score = arrangement => {
      const p = { ...positions, ...Object.fromEntries(arrangement.map((c, i) => [c.id, outerSlots[i]])) };
      if(outer.some(c=>c.entrances.length&&p[c.id].y>config.origin.y)) return {cost:Infinity,positions:p};
      let cost = coreCost;
      for (const e of model.relationships) {
        if (!p[e.source] || !p[e.target]) continue;
        const a = p[e.source], b = p[e.target];
        const entrance = outer.some(c => c.id === e.source && c.entrances.length);
        cost += (Math.abs(a.x - b.x) + Math.abs(a.y - b.y)) * (e.kind === 'guarantee-reliance' ? 2 : entrance ? 3 : 1);
        if (entrance) cost += Math.max(0, a.x - b.x) * 2;
      }
      return {cost, positions:p};
    };
    for (const arrangement of permutations(outer)) {
      const trial = score(arrangement);
      if (!best || trial.cost < best.cost) best = trial;
    }
  }
  return { ranked, root, coreIds: core.map(c => c.id), cost: best.cost,
    cards: population.map(c => {
      const downtown = core.some(v => v.id === c.id);
      const size = downtown ? config.coreSize : config.outerSize;
      const p = best.positions[c.id];
      return { ...c, downtown, x: p.x - size.width / 2, y: p.y - size.height / 2, ...size };
    }) };
}
