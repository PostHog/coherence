import { defaultLayout } from './layout.mjs';
import { wrap } from './routing.mjs';

// The shipped browser layout includes its content measurement. Calling
// defaults.layout(context) therefore inherits the same geometry as selecting
// the default registration directly.
export function defaultBrowserLayout(context) {
  const { model, options } = context;
  const layout = defaultLayout(context);
  const measured = layout.cards.map(card => {
    const contentWidth = card.width - 36;
    const title = wrap(card.label, contentWidth, '650 26px system-ui').length * 31 + 10;
    const intent = card.downtown && options.cardFields.includes('intent') ? Math.min(5, wrap(card.intent || '', contentWidth, '19px system-ui').length) * 25 + 12 : 0;
    const metrics = wrap(`${card.counts.guarantees} promises · ${card.counts.peers} connected components`, contentWidth, '15px system-ui').length * 21 + 12;
    const extra = options.cardFields.filter(field => ['rationale', 'boundaries', 'resources', 'entrances'].includes(field)).length * 42;
    const height = Math.max(card.downtown ? 280 : card.height, title + intent + metrics + extra + 66);
    return { ...card, baseHeight: height, height };
  });
  const rows = [...new Set(measured.map(card => card.y))].sort((a, b) => a - b), placed = [];
  for (const rowY of rows) {
    const row = measured.filter(card => card.y === rowY);
    const shift = Math.max(0, ...row.flatMap(card => {
      const top = card.y - (model.relationships.some(edge => edge.kind === 'guarantee-reliance' && edge.target === card.id) ? 62 : 0);
      return placed.filter(previous => previous.x < card.x + card.width + 20 && previous.x + previous.width + 20 > card.x).map(previous => previous.y + previous.height + 20 - top);
    }));
    placed.push(...row.map(card => ({ ...card, y: card.y + shift })));
  }
  if (!placed.length) return { ...layout, cards: placed };
  const minX = Math.min(...placed.map(card => card.x)), minY = Math.min(...placed.map(card => card.y));
  const maxX = Math.max(...placed.map(card => card.x + card.width)), maxY = Math.max(...placed.map(card => card.y + card.height));
  return { ...layout, cards: placed, bounds: { x: minX - 260, y: minY - 220, width: maxX - minX + 520, height: maxY - minY + 440 } };
}
