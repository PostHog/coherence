import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { challengeCommand, bindingLabel } from './binding-reading.mjs';

test('binding challenge — explicit drafts are shell-safe data and no UI state invents recording or delivery', () => {
  const row = { id: 'b-test', status: 'current', binding: { definition: 'guarantee:supersession-safety', subject: "src/a'file.ts",
    falsifier: 'Observe $(echo BAD) and `whoami` as text' }, observation: { verdict: 'unverified' } };
  assert.equal(challengeCommand(row, '', 'session'), null);
  assert.equal(challengeCommand(row, 'observation', ''), null);
  assert.equal(challengeCommand(row, 'line\nbreak', 'session'), null);
  const command = challengeCommand(row, "Literal '$()`; payload", 'reader-session');
  const argumentsRead = execFileSync('/bin/sh', ['-c', 'npx() { printf "%s\\n" "$@"; }; ' + command], { encoding: 'utf8' });
  assert.ok(argumentsRead.includes("Literal '$()`; payload"));
  assert.ok(argumentsRead.includes(row.binding.falsifier));
  assert.match(bindingLabel(row), /No input-bound run/);
  assert.match(bindingLabel({ ...row, status: 'stale', observation: { verdict: 'pass' } }), /support unavailable/);
});
