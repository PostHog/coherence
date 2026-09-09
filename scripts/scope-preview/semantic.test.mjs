import test from 'node:test';
import assert from 'node:assert/strict';
import { detailLevel, attention, declaredSubjects, subjectGeometry, mapConnections } from './semantic.mjs';

test('semantic zoom has three content levels, independent of geometry', () => {
  assert.deepEqual([.2, .6, 1].map(detailLevel), ['overview', 'summary', 'detail']);
});
test('attention never turns missing or partial evidence into component health', () => {
  assert.equal(attention([]), 'No guarantees declared');
  assert.equal(attention([{ verdict: 'pass' }]), 'Scoped evidence only');
  assert.match(attention([{ verdict: 'pass' }, { verdict: 'stale' }], [], 3), /1 stale.*3 broken links/);
  assert.match(attention([], [{ status: 'stale' }]), /binding.*attention/);
});
test('local incidence deduplicates subjects and claims, retains tied centers and explicit direction', () => {
  const row = { id: 'b', binding: { claim: 'g', flow: { from: { subject: 'a#run' }, to: { subject: 'b#write' } } } };
  const result = declaredSubjects([{ id: 'g', chokepoint: 'run' }, { id: 'g2', chokepoint: 'other' }], [row]);
  assert.equal(result.nodes.length, 3);
  assert.equal(result.centers.length, 3);
  assert.equal(result.edges[0].source, 'a#run');
  assert.equal(result.edges[0].target, 'b#write');
  assert.equal(result.nodes.find(n => n.id === 'anchor:other').grade, 'Declared enforcement anchor; not a resolved symbol');
  const geometry = subjectGeometry(result);
  assert.deepEqual(subjectGeometry(result), geometry);
  assert.equal(geometry.nodes.length, 3);
});
test('unlinked imports stay background and do not invent guarantees', () => {
  const r = { id: 'r', source: 'a', target: 'b' };
  const result = mapConnections({ guarantees: [] }, [{ id: 'c', source: 'a', target: 'b', members: [r] }]);
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, 'import');
});
test('mutual reliance renders separate directed promises and retains damaged links', () => {
  const members = [{ id: 'ab', source: 'a', target: 'b' }, { id: 'ba', source: 'b', target: 'a' }];
  const model = { guarantees: [{ id: 'g1', invariant: 'one' }, { id: 'g2', invariant: 'two' }], guaranteeLinks: { links: [
    { kind: 'relies', owner: 'a', provider: 'b', claim: 'g1', status: 'current' },
    { kind: 'relies', owner: 'b', provider: 'a', claim: 'g2', status: 'stale' },
  ] } };
  const result = mapConnections(model, [{ id: 'pair', members }]).filter(c => c.kind === 'promise');
  assert.deepEqual(result.map(c => [c.source, c.target]), [['a', 'b'], ['b', 'a']]);
  assert.equal(result[1].promises[0].link.status, 'stale');
  assert.equal(new Set(result.map(c => c.id)).size, 2);
});
