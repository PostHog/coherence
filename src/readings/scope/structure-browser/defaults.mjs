import { defaultRank } from './ranking.mjs';
import { defaultLayout } from './layout.mjs';
import { route } from './routing.mjs';

export function defaultRoute({ cards, relationships, annotations = [], fixedLabels = [] }) {
  if (!relationships.length) return [];
  return route(cards, relationships, annotations, fixedLabels.length ? fixedLabels : undefined);
}

export const defaultMechanisms = { rank: defaultRank, layout: defaultLayout, route: defaultRoute };
