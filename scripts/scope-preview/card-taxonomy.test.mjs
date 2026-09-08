import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { taxonomyWithin } from './card-taxonomy.mjs';

test('card taxonomy is exact-owner, selected-only, subject-counted and honest about stale unresolved evidence', () => {
  const item = (target, owner, roles, facets, assessment, status = assessment) => ({
    record: { id: target, snapshot: { subject: { target, owner } } },
    classification: { roles, facets, assessment, candidates: [{ id: 'role:guessed' }] }, status,
  });
  const readings = { errors: [], taxonomy: { catalog: { roles: [{ id: 'role:parser', label: 'Parser' }] }, items: [
    item('src/a.ts', 'c:src', ['role:parser'], ['facet:boundary'], 'classified'),
    item('src/a.ts#parse', 'c:src', ['role:parser'], ['facet:boundary', 'facet:deterministic'], 'classified', 'stale'),
    item('src/b.ts', 'c:src', [], [], 'ambiguous', 'stale'),
    item('src/c.ts', 'c:src', [], [], 'no-fit'),
    item('src/sub/d.ts', 'c:src/sub', ['role:parser'], ['facet:persistence'], 'classified'),
    item('loose.ts', null, ['role:parser'], [], 'classified'),
  ] } };
  const before = structuredClone(readings), result = taxonomyWithin(readings, 'c:src');
  assert.equal(result.items.length, 4, 'file and symbol assessments are separate subjects, not a coverage denominator');
  assert.deepEqual(result.roles, [{ id: 'role:parser', label: 'Parser', count: 2, stale: 1 }]);
  assert.deepEqual(result.facets.map(f => [f.id, f.count, f.stale]), [['facet:boundary', 2, 1], ['facet:deterministic', 1, 1]]);
  assert.deepEqual(result.issues, ['2 stale', '1 ambiguous', '1 no-fit']);
  assert.deepEqual(readings, before, 'presentation must not mutate the canonical assessment');
  assert.equal(taxonomyWithin(readings, 'c:.').items.length, 0, 'root does not inherit descendant roles');
  assert.equal(taxonomyWithin(readings, 'c:src/sub').items.length, 1);
  assert.deepEqual(taxonomyWithin({ ...readings, errors: [{ source: 'taxonomy', message: 'damaged' }] }, 'c:src').roles, []);
  assert.equal(taxonomyWithin({ errors: [], taxonomy: null }, 'c:src').message, 'Taxonomy not captured');
});

test('actual card rollups conserve the current ledger population and show every selected role in their full breakdown', () => {
  const readings = JSON.parse(readFileSync(new URL('../../public/scope-readings.json', import.meta.url)));
  const model = JSON.parse(readFileSync(new URL('../../public/scope.json', import.meta.url)));
  const counts = model.nodes.map(node => {
    const expected = readings.taxonomy.items.filter(item => item.record.snapshot.subject.owner === node.graphNodeId);
    const result = taxonomyWithin(readings, node.graphNodeId);
    assert.deepEqual(result.items, expected);
    assert.equal(result.roles.reduce((n, role) => n + role.count, 0), expected.reduce((n, item) => n + item.classification.roles.length, 0));
    assert.deepEqual(new Set(result.facets.map(f => f.id)), new Set(expected.flatMap(item => item.classification.facets)));
    return result.items.length;
  });
  const owners = new Set(model.nodes.map(node => node.graphNodeId));
  assert.equal(counts.reduce((n, count) => n + count, 0), readings.taxonomy.items.filter(item => owners.has(item.record.snapshot.subject.owner)).length);
});
