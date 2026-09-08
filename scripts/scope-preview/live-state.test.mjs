import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shareReadings } from './live-state.mjs';

test('live scheduling preserves unchanged domains without hiding evidence, damage or recovery', () => {
  const initial = { structure: { status: 'current', model: { nodes: [{ id: 'a', verdict: 'pass' }] } },
    taxonomy: { records: [] }, journal: { records: ['old'] }, errors: [] };
  const wire = value => JSON.parse(JSON.stringify(value));
  const journal = shareReadings(initial, { ...wire(initial), journal: { records: ['old', 'new'] } });
  assert.equal(journal.structure, initial.structure);
  assert.equal(journal.taxonomy, initial.taxonomy);
  assert.notEqual(journal.journal, initial.journal);
  const damaged = shareReadings(journal, { ...wire(journal), structure: { ...wire(journal.structure), status: 'unavailable' } });
  assert.notEqual(damaged.structure, journal.structure);
  assert.equal(damaged.structure.model, journal.structure.model);
  assert.equal(shareReadings(damaged, wire(journal)).structure.status, 'current');
  const changed = wire(journal); changed.structure.model.nodes[0].verdict = 'fail';
  assert.notEqual(shareReadings(journal, changed).structure.model, journal.structure.model);
  assert.equal(initial.structure.model.nodes[0].verdict, 'pass');
});
