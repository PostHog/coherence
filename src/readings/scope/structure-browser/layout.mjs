const DEFAULTS = Object.freeze({
  downtownCount: 3,
  downtownThreshold: 0.65,
  spacing: { x: 480, y: 420 },
  origin: { x: 440, y: 530 },
  downtownSize: { width: 320, height: 254 },
  peripherySize: { width: 260, height: 174 },
});

function permutations(items) {
  if (items.length < 2) return [items];
  return items.flatMap((item, index) => permutations(items.filter((_, other) => index !== other)).map(rest => [item, ...rest]));
}

function arrangementCost(model, positions, outer, originY) {
  if (outer.some(component => component.entrances.length && positions[component.id] && positions[component.id].y > originY)) return Infinity;
  let cost = 0;
  for (const edge of model.relationships) {
    const a = positions[edge.source], b = positions[edge.target];
    if (!a || !b) continue;
    const entrance = outer.some(component => component.id === edge.source && component.entrances.length);
    cost += (Math.abs(a.x - b.x) + Math.abs(a.y - b.y)) * (edge.kind === 'guarantee-reliance' ? 2 : entrance ? 3 : 1);
    if (entrance) cost += Math.max(0, a.x - b.x) * 2;
    if (edge.kind === 'architecture' && a.y === originY && b.y === originY && a.x > b.x) cost += 1800;
  }
  return cost;
}

function deterministicOrder(items, slots, fixed, model, outer, originY) {
  let order = [...items];
  const positionsFor = values => ({ ...fixed, ...Object.fromEntries(values.map((component, index) => [component.id, slots[index]])) });
  let cost = arrangementCost(model, positionsFor(order), outer, originY);
  // A bounded pair-swap descent replaces factorial enumeration for larger populations.
  // Stable input ordering and strict improvement make the result deterministic.
  for (let pass = 0; pass < Math.min(8, order.length); pass++) {
    let improved = false;
    for (let left = 0; left < order.length; left++) for (let right = left + 1; right < order.length; right++) {
      const trial = [...order]; [trial[left], trial[right]] = [trial[right], trial[left]];
      const trialCost = arrangementCost(model, positionsFor(trial), outer, originY);
      if (trialCost < cost) { order = trial; cost = trialCost; improved = true; }
    }
    if (!improved) break;
  }
  return { order, cost, positions: positionsFor(order) };
}

function assign(items, slots, fixed, model, outer, originY, exact) {
  if (!items.length) return { order: [], cost: arrangementCost(model, fixed, outer, originY), positions: fixed };
  if (!exact) return deterministicOrder(items, slots, fixed, model, outer, originY);
  let best;
  for (const order of permutations(items)) {
    const positions = { ...fixed, ...Object.fromEntries(order.map((component, index) => [component.id, slots[index]])) };
    const cost = arrangementCost(model, positions, outer, originY);
    if (!best || cost < best.cost || (cost === best.cost && order.map(item => item.id).join('\0') < best.order.map(item => item.id).join('\0'))) best = { order, cost, positions };
  }
  return best;
}

function exactArrangement(core, coreSlots, outer, outerSlots, model, originY) {
  let best;
  for (const coreOrder of permutations(core)) {
    const corePositions = Object.fromEntries(coreOrder.map((component, index) => [component.id, coreSlots[index]]));
    for (const outerOrder of permutations(outer)) {
      const positions = { ...corePositions, ...Object.fromEntries(outerOrder.map((component, index) => [component.id, outerSlots[index]])) };
      const cost = arrangementCost(model, positions, outer, originY);
      // Preserve the blockout's first-minimum tie behavior and input permutation order.
      if (!best || cost < best.cost) best = { cost, positions };
    }
  }
  return best ?? { cost: arrangementCost(model, {}, outer, originY), positions: {} };
}

export function defaultLayout({ model, ranked, options = {} }) {
  const config = {
    ...DEFAULTS, ...options,
    spacing: { ...DEFAULTS.spacing, ...(options.spacing ?? options.pitch ?? {}) },
    origin: { ...DEFAULTS.origin, ...(options.origin ?? {}) },
    downtownSize: { ...DEFAULTS.downtownSize, ...(options.downtownSize ?? options.coreSize ?? {}) },
    peripherySize: { ...DEFAULTS.peripherySize, ...(options.peripherySize ?? options.outerSize ?? {}) },
  };
  const root = ranked.find(component => component.parent === null) ?? null;
  const population = ranked.length > 1 && root ? ranked.filter(component => component.id !== root.id) : ranked;
  if (!population.length) return { ranked, root, coreIds: [], cost: 0, cards: [], bounds: { x: 0, y: 0, width: 960, height: 560 } };
  const eligible = population.filter(component => component.score >= population[0].score * config.downtownThreshold);
  const count = Math.max(1, Math.min(config.downtownCount, eligible.length || 1, population.length));
  const core = population.slice(0, count), outer = population.slice(count);
  const coreSlots = core.map((_, index) => ({ x: config.origin.x + index * config.spacing.x, y: config.origin.y }));
  const centerX = (coreSlots[0].x + coreSlots.at(-1).x) / 2 - 10;
  const topCount = Math.max(Math.ceil(outer.length / 2), outer.filter(component => component.entrances.length).length);
  const row = (size, y) => Array.from({ length: size }, (_, index) => ({ x: centerX + (index - (size - 1) / 2) * config.spacing.x, y }));
  const outerSlots = [...row(topCount, config.origin.y - config.spacing.y), ...row(outer.length - topCount, config.origin.y + config.spacing.y)];
  const exact = core.length <= 3 && outer.length <= 8;
  const placed = exact ? exactArrangement(core, coreSlots, outer, outerSlots, model, config.origin.y) : (() => {
    const placedCore = assign(core, coreSlots, {}, model, outer, config.origin.y, false);
    return assign(outer, outerSlots, placedCore.positions, model, outer, config.origin.y, false);
  })();
  const cards = population.map(component => {
    const downtown = core.some(item => item.id === component.id);
    const size = downtown ? config.downtownSize : config.peripherySize;
    const point = placed.positions[component.id];
    return { ...component, downtown, x: point.x - size.width / 2, y: point.y - size.height / 2, ...size };
  });
  const minX = Math.min(...cards.map(card => card.x)), minY = Math.min(...cards.map(card => card.y));
  const maxX = Math.max(...cards.map(card => card.x + card.width)), maxY = Math.max(...cards.map(card => card.y + card.height));
  return { ranked, root, coreIds: core.map(component => component.id), cost: placed.cost, cards, exact,
    bounds: { x: minX - 260, y: minY - 220, width: maxX - minX + 520, height: maxY - minY + 440 } };
}

export const DEFAULT_LAYOUT_OPTIONS = DEFAULTS;
