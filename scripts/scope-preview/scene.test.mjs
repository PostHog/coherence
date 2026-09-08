import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scopeScene } from './scene.mjs';

test('assembly lens keeps project/evidence distinct and accounts for every withheld subject and edge', () => {
  const nodes = [{ id: '.', role: 'project' }, { id: 'src', role: 'assembly', parent: '.' },
    ...Array.from({ length: 8 }, (_, i) => ({ id: `src/${i}`, role: 'assembly', parent: 'src' })),
    { id: 'test', role: 'evidence', parent: '.' }];
  const model = { nodes, center: 'src/0', relations: nodes.slice(2, -1).map(n => ({ id: n.id, source: n.id, target: 'src' })),
    guarantees: [], containment: nodes.filter(n => n.parent).map(n => ({ parent: n.parent, child: n.id })) };
  const copy = structuredClone(model), first = scopeScene(model);
  assert.equal(first.project.id, '.'); assert.equal(first.evidence[0].id, 'test');
  assert.equal(first.model.nodes.length, 4); assert.equal(first.withheld, 5);
  assert.equal(first.model.center, model.center);
  const seen = new Set();
  for (let page = 0; page < first.pages; page++) {
    const scene = scopeScene(model, { page });
    scene.model.nodes.forEach(n => seen.add(n.id));
    assert.equal(scene.model.relations.length + scene.omittedRelations, model.relations.length);
  }
  assert.deepEqual([...seen].sort(), nodes.filter(n => n.role === 'assembly').map(n => n.id).sort());
  assert.equal(scopeScene(model, { all: true }).withheld, 0);
  const containerCenter = { ...model, center: 'src' };
  const containerScene = scopeScene(containerCenter);
  assert.equal(containerScene.owner, 'src');
  assert.equal(containerScene.model.nodes.length, 4, 'a composition-root center opens its children, not a one-card parent group');
  assert.equal(containerScene.groupTotal, 9);
  assert.deepEqual(scopeScene(containerCenter, { owner: 'removed' }), containerScene,
    'a removed group falls back to the current canonical group');
  assert.deepEqual(model, copy);
});
