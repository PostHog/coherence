import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defaultRank } from '../src/readings/scope/structure-browser/ranking.mjs';
import { defaultLayout } from '../src/readings/scope/structure-browser/layout.mjs';
import { createStructureRegistry, validateLayout, validateRanked, validateRoutes } from '../src/readings/scope/structure-browser/registry.mjs';

const options = { rankingWeights: { peers: 3, guarantees: 2, security: 1, consumers: 2 }, downtownCount: 3, downtownThreshold: .65, spacing: { x: 480, y: 420 } };
const component = (id: string, parent: string | null = 'component:root') => ({ id, label: id, parent, guarantees: [], boundaries: [], resources: [], entrances: [], density: { total: 0 } });
function model(size: number) {
  const components = [component('component:root', null), ...Array.from({ length: size }, (_, index) => ({ ...component(`component:${String(index).padStart(2, '0')}`), entrances: index === 0 ? [{ id: 'entrance:main' }] : [], guarantees: index % 3 ? [] : [{ id: `guarantee:${index}` }] }))];
  const relationships = components.slice(2).map((item, index) => ({ id: `relationship:${index}`, kind: index % 4 ? 'architecture' : 'guarantee-reliance', source: components[index + 1].id, target: item.id }));
  return { components, relationships };
}

test('Structure layout — the approved small population keeps exact downtown and periphery geometry', () => {
  const value = model(6), ranked = defaultRank({ model: value, options, defaults: {} });
  const layout = defaultLayout({ model: value, ranked, options, defaults: {} });
  assert.equal(layout.exact, true); assert.equal(layout.cards.length, 6); assert.equal(layout.coreIds.length, 3);
  assert.deepEqual(layout.cards.filter(card => card.downtown).map(card => [card.width, card.height]), [[320, 254], [320, 254], [320, 254]]);
  assert.ok(layout.cards.filter(card => !card.downtown).every(card => card.width === 260 && card.height === 174));
  assert.ok(layout.cards.find(card => card.entrances.length)!.y < 530, 'entrance stays in the upper periphery');
});

for (const fixture of ['structure-downtown', 'mnemion-structure']) test(`Structure layout — ${fixture} preserves the approved study geometry`, () => {
  const scene = JSON.parse(readFileSync(new URL(`../docs/prototypes/${fixture}/scene.json`, import.meta.url), 'utf8'));
  const fixtureOptions = { rankingWeights: scene.policy.weights, downtownCount: scene.policy.centers, downtownThreshold: scene.policy.coreFloor, spacing: scene.policy.pitch, origin: scene.policy.origin, downtownSize: scene.policy.coreSize, peripherySize: scene.policy.outerSize };
  const ranked = defaultRank({ model: scene.model, options: fixtureOptions, defaults: {} });
  const actual = defaultLayout({ model: scene.model, ranked, options: fixtureOptions, defaults: {} });
  const geometry = (cards: Array<{ id: string; x: number; y: number; width: number; height: number }>) => cards.map(({ id, x, y, width, height }) => ({ id, x, y, width, height })).sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(geometry(actual.cards), geometry(scene.layout.cards));
});

for (const size of [24, 64]) test(`Structure layout — ${size} components use a bounded deterministic heuristic`, () => {
  const value = model(size), ranked = defaultRank({ model: value, options, defaults: {} });
  const first = defaultLayout({ model: value, ranked, options, defaults: {} });
  const second = defaultLayout({ model: value, ranked, options, defaults: {} });
  assert.equal(first.exact, false); assert.deepEqual(first, second); assert.equal(first.cards.length, size);
});

test('Structure layout — empty and single-component populations stay inspectable', () => {
  const empty = { components: [], relationships: [] };
  assert.deepEqual(defaultLayout({ model: empty, ranked: [], options, defaults: {} }).cards, []);
  const single = { components: [component('component:only', null)], relationships: [] };
  const ranked = defaultRank({ model: single, options, defaults: {} });
  assert.equal(defaultLayout({ model: single, ranked, options, defaults: {} }).cards[0].id, 'component:only');
});

test('Structure registry — defaults and project mechanisms share one guarded namespace', () => {
  const defaults = { rank: () => [], layout: () => ({ cards: [] }), route: () => [], card: () => null, view: () => null };
  const extension = { apiVersion: 1, rankers: { 'fixture.rank': () => [] }, layouts: { 'fixture.layout': () => ({ cards: [] }) }, routers: {}, cards: { 'fixture.card': () => null }, views: { 'fixture.view': () => null } };
  const registry = createStructureRegistry(defaults, [extension]);
  assert.equal(registry.resolve('rank', 'fixture.rank'), extension.rankers['fixture.rank']); assert.deepEqual(registry.defaults.rank({}), []);
  assert.throws(() => registry.resolve('rank', 'missing.rank'), /Unknown Structure/);
  assert.throws(() => createStructureRegistry(defaults, [{ ...extension, apiVersion: 2 }]), /apiVersion/);
  assert.throws(() => createStructureRegistry(defaults, [extension, extension]), /Duplicate/);
  assert.throws(() => createStructureRegistry(defaults, [{ apiVersion: 1, rankers: { default: () => [] } }]), /namespaced/);
  assert.throws(() => createStructureRegistry(defaults, [{ apiVersion: 1, routres: {} }]), /unknown registration field/);
});

test('Structure registry — malformed mechanism outputs fail visibly', () => {
  const value = model(2), ranked = defaultRank({ model: value, options, defaults: {} });
  assert.deepEqual(validateRanked(ranked, value), ranked); assert.throws(() => validateRanked(ranked.slice(1), value), /every component/);
  const forged = ranked.map((item, index) => index ? item : { ...item, label: 'forged', guarantees: [{ id: 'forged' }] });
  const restored = validateRanked(forged, value); assert.equal(restored[0].label, value.components.find(item => item.id === restored[0].id)!.label); assert.ok(!restored[0].guarantees.some((item: { id: string }) => item.id === 'forged'));
  assert.throws(() => validateLayout({ cards: [{ id: ranked[1].id, x: 0, y: 0, width: -1, height: 2 }] }, ranked), /malformed/);
  assert.throws(() => validateLayout({ cards: ranked.filter(item => item.parent !== null).map((item, index) => ({ ...item, x: index * 20, y: 0, width: 10, height: 10, downtown: false })), coreIds: [ranked[1].id] }, ranked), /disagree/);
  assert.throws(() => validateRoutes([], value.relationships), /every requested/);
  const edge = value.relationships[0];
  assert.throws(() => validateRoutes([{ ...edge, target: 'component:forged', path: 'M 0 0 L 1 1', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }], [edge]), /semantic endpoints/);
  assert.throws(() => validateRoutes([{ ...edge, path: '', points: [] }], [edge]), /malformed geometry/);
});
