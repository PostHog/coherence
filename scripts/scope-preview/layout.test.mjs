import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defaults, layoutScope, lightOf } from './layout.mjs';

const actual = JSON.parse(readFileSync(new URL('../../public/scope.json', import.meta.url)));
function checkGeometry(model, config = defaults) {
  const view = layoutScope(model, config);
  assert.deepEqual(view.nodes.map(n => n.id).sort(), model.nodes.map(n => n.id).sort());
  assert.deepEqual(view.connections.flatMap(c => c.members).sort((a,b) => a.id.localeCompare(b.id)),
    [...model.relations].sort((a,b) => a.id.localeCompare(b.id)));
  if (!model.nodes.length) return;
  const center = view.nodes.find(n => n.id === model.center);
  assert.deepEqual([center.x, center.y], [0, 0]);
  for (const n of view.nodes) {
    assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y));
    const radius = view.rings.find(r => r.ring === n.ring)?.radius ?? 0;
    assert.ok(Math.abs(Math.hypot(n.x, n.y) - radius) < 0.00001);
    for (const other of view.nodes) if (n.id < other.id) {
      assert.ok(Math.abs(n.x - other.x) >= config.width || Math.abs(n.y - other.y) >= config.height,
        `overlap: ${n.id}, ${other.id}; ${JSON.stringify(config)}`);
    }
  }
}

test('actual snapshot: population parity, centered rings, and non-overlapping cards', () => {
  const copy = structuredClone(actual);
  checkGeometry(actual);
  assert.deepEqual(actual, copy, 'view must not mutate canonical evidence');
  assert.ok(layoutScope(actual).nodes.find(n => n.id === '.').disconnected);
  assert.ok(layoutScope(actual).connections.some(c => c.mutual && c.members.length === 2));
});

test('library geometry repeats exactly and ignores previous hand-written coordinates', () => {
  const shuffled = structuredClone(actual);
  shuffled.nodes.reverse().forEach(n => { n.x = 9999; n.y = -9999; });
  shuffled.relations.reverse();
  assert.deepEqual(layoutScope(actual), layoutScope(shuffled));
});

test('all exposed parameter extremes retain non-overlap and centered rings', () => {
  for (const gap of [48, 80, 180]) for (const rotation of [-180, -35, 0, 90, 180]) for (const sweep of [200, 270, 330]) {
    checkGeometry(actual, { ...defaults, gap, rotation, sweep });
  }
});

test('empty, singleton, cyclic, dense rings and islands run through the same engine', () => {
  checkGeometry({ nodes: [], relations: [], guarantees: [], center: null });
  checkGeometry({ nodes: [{ id: 'center', ring: 0 }], relations: [], guarantees: [], center: 'center' });
  const nodes = [{ id: 'center', ring: 0 }, ...Array.from({ length: 24 }, (_, i) => ({ id: `peer-${i}`, ring: i < 12 ? 1 : 2 })), { id: 'island', ring: 3 }];
  const relations = nodes.slice(1, -1).map((n, i) => ({ id: `r-${i}`, source: n.id, target: i < 12 ? 'center' : nodes[i - 11].id }));
  relations.push({ id: 'cycle', source: 'center', target: 'peer-0' });
  const model = { nodes, relations, guarantees: [], center: 'center' };
  checkGeometry(model);
  assert.ok(layoutScope(model).nodes.find(n => n.id === 'island').disconnected);
});

test('missing evidence is never a pass; stale and failures outrank passes', () => {
  assert.equal(lightOf([]), 'unmeasured');
  for (const state of ['unknown', 'stale', 'fail']) assert.equal(lightOf([{ verdict: 'pass' }, { verdict: state }]), state);
  assert.equal(lightOf([{ verdict: 'pass' }]), 'pass');
});
