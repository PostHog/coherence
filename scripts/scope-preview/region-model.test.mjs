import { test } from 'node:test';
import assert from 'node:assert/strict';
import { regionScene, regionGeometry } from './region-model.mjs';

const row = (id, from, to, title = 'Role') => ({ id, owner: 'cache', binding: { flow: { from: { subject: from, title }, to: { subject: to, title } } }, observation: { verdict: 'pass' } });
const model = { center: 'cache', nodes: [{ id: '.', role: 'project' }, { id: 'cache', role: 'assembly', parent: '.' }, { id: 'redis', role: 'assembly', parent: '.' }],
  relations: [{ source: 'cache', target: 'redis' }], catalogBindings: { items: [row('one', 'a#upload', 'b#publish'), row('two', 'b#publish', 'a#upload', 'Other role')] } };
test('region graph — explicit edges conserve identity and roles do not duplicate symbols', () => {
  const scene = regionScene(model);
  assert.deepEqual(scene.rows.map(r => r.id), ['one', 'two']);
  assert.deepEqual(scene.symbols.map(n => n.id), ['a#upload', 'b#publish']);
  assert.deepEqual(scene.symbols[0].roles, ['Role', 'Other role']);
  assert.deepEqual(scene.context.map(n => n.id), ['redis']);
  assert.equal(scene.elsewhere, 0);
  const input = { symbols: scene.symbols.map(n => n.id), context: scene.context.map(n => n.id), expanded: true };
  assert.deepEqual(regionGeometry(input), regionGeometry(input));
  const collapsed = regionGeometry({ ...input, expanded: false });
  assert.equal(collapsed.symbols.length, 0);
  assert.equal(collapsed.context.length, 1);
  const geometry = regionGeometry(input);
  assert.ok(geometry.symbols.every(n => n.x >= 0 && n.y >= 320 && n.x + 280 <= geometry.width && n.y + 145 <= geometry.height - 40));
  model.catalogBindings.items[0].observation.verdict = 'stale';
  assert.deepEqual(regionGeometry(input), regionGeometry(input), 'evidence is not geometry input');
  assert.equal(regionScene(model).rows[0].observation.verdict, 'stale');
});
test('region graph — absent declarations remain absent and provider tails are counted', () => {
  assert.equal(regionScene({ ...model, catalogBindings: undefined }).symbols.length, 0);
  const expanded = { ...model, nodes: [...model.nodes], relations: [...model.relations] };
  for (let i = 0; i < 5; i++) { expanded.nodes.push({ id: `p${i}`, role: 'assembly' }); expanded.relations.push({ source: 'cache', target: `p${i}` }); }
  assert.equal(regionScene(expanded).context.length, 3);
  assert.equal(regionScene(expanded).withheldContext, 3);
  expanded.catalogBindings = { items: [...model.catalogBindings.items, row('three', 'c#other', 'd#next')] };
  assert.equal(regionScene(expanded).total, 3);
  assert.equal(regionScene(expanded).rows.length, 2);
  assert.equal(regionScene(expanded, { page: 1 }).rows[0].id, 'three');
});
