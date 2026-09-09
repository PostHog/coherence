// Browser projection only. Shell arguments are single-quoted data, never code.
const quote = value => "'" + value.replace(/'/g, "'\\''") + "'";
export function challengeCommand(row, observation, session) {
  if (!row.binding || !observation.trim() || !session.trim() || /[\x00-\x1f\x7f]/u.test(observation + session)) return null;
  return ['npx coherence conjecture', quote(`${row.id} (${row.binding.definition}; ${row.binding.subject}): ${observation.trim()}`),
    '--could-be', quote('The scoped guarantee is contradicted; applicability, implementation or oracle needs review'),
    '--discriminated-by', quote(row.binding.falsifier), '--session', quote(session.trim()), '--agent', quote('scope-reader')].join(' ');
}
export function bindingLabel(row) {
  if (row.status !== 'current') return `${row.status} binding · support unavailable`;
  return ({ pass: 'Named oracle passed · scoped evidence', fail: 'Oracle check failed · inspect verification detail', stale: 'Stale run inputs · rerun required', unverified: 'No input-bound run recorded' })[row.observation.verdict];
}
