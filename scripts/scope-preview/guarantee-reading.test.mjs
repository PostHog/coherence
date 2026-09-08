import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relianceReading, connectionLabel } from './guarantee-reading.mjs';

test('guarantee presentation preserves direction, damage and evidence without inferred links', () => {
  const forward = { source: 'a', target: 'b' }, reverse = { source: 'b', target: 'a' };
  const model = { guarantees: [{ id: 'g', invariant: 'A skipped run preserves the recorded verdict', verdict: 'fail' }],
    guaranteeLinks: { links: [{ kind: 'relies', owner: 'a', provider: 'b', claim: 'g', status: 'current' }] } };
  assert.equal(relianceReading(model, reverse).length, 0);
  assert.equal(relianceReading(model, forward)[0].guarantee.verdict, 'fail');
  assert.equal(connectionLabel(model, [forward, reverse]), model.guarantees[0].invariant);
  assert.equal(connectionLabel(model, [reverse]), 'No guarantee linked');
  model.guaranteeLinks.links[0].status = 'stale';
  assert.equal(connectionLabel(model, [forward]), 'Guarantee link needs repair');
  assert.equal(relianceReading(model, forward)[0].link.status, 'stale');
});
