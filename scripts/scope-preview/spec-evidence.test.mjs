import { test } from 'node:test';
import assert from 'node:assert/strict';
import { specEvidence } from './spec-evidence.mjs';

test('spec evidence keeps unanchored declarations, multiple gates and exact authored text', () => {
  const subject = { invariants: ['access', 'unanchored'],
    why: '**access.** Original reason.\n\nUnmatched reason.',
    refutations: ['access: removed check; red', 'access elsewhere: not this invariant'] };
  const gates = [{ invariant: 'access', verdict: 'stale' }, { invariant: 'access', verdict: 'fail' }, { invariant: 'undeclared', verdict: 'unknown' }];
  const rows = specEvidence(subject, gates);
  assert.deepEqual(rows[0], { name: 'access', declared: true, rationale: ['**access.** Original reason.'], refutations: ['access: removed check; red'], gates: gates.slice(0, 2) });
  assert.deepEqual(rows[1], { name: 'unanchored', declared: true, rationale: [], refutations: [], gates: [] });
  assert.equal(rows[2].declared, false);
  assert.deepEqual(specEvidence({}, []), []);
});
