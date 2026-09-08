// Targeted field probes over throwaway repositories, never the live project's record.
// Reports observations rather than pinning current defects as desirable test outcomes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { tmpProject, cfg, cleanup } from '../test/_helpers.ts';
import { recordAtlas, recordMass, readStatus } from '../src/evidence/status.ts';
import { readCalibrationSamples, calibrationStats } from '../src/diagnostics/calibration.ts';

const atlas = { tiers: { enshrined: 1, checked: 0, convention: 0 }, crossings: [], drift: [], dangling: [], overclaimed: [], tier3Security: [] };
const mass = { dims: [{ key: 'probe', value: 1, unit: 'items' }] };
async function statusProbe(overlap) {
  const root = await tmpProject({ '.coherence/status.json': '{"version":1}\n' });
  try {
    const config = cfg(root);
    if (overlap) await Promise.all([recordAtlas(config, atlas), recordMass(config, mass)]);
    else { await recordAtlas(config, atlas); await recordMass(config, mass); }
    try {
      const reading = await readStatus(config);
      return { writersReturned: true, readable: true, atlas: !!reading.atlas, mass: !!reading.mass };
    } catch {
      return { writersReturned: true, readable: false, atlas: false, mass: false };
    }
  } finally { await cleanup(root); }
}
const control = await statusProbe(false);
assert.ok(control.readable && control.atlas && control.mass, 'Sequential control must preserve both reports');
const trials = [];
for (let i = 0; i < 20; i++) trials.push(await statusProbe(true));

const idFor = patch => 'r-' + createHash('sha256').update('field-probe\0' + patch).digest('hex').slice(0, 12);
const sample = { id: idFor('fixture'), at: '2026-09-04T00:00:00.000Z', session: 'field-probe', patch: 'fixture',
  changed: ['src/a.ts'], predicted: ['src/a.ts'], observed: ['src/a.ts'], outcome: 'defect', attribution: 'session-writes' };
const root = await tmpProject({ '.coherence/calibration/field-probe.jsonl':
  JSON.stringify(sample) + '\n' + JSON.stringify({ ...sample, id: idFor('invalid'), patch: 'invalid', outcome: 'not-an-outcome' }) + '\n{torn\n' });
let calibration;
try {
  const rows = readCalibrationSamples(cfg(root));
  calibration = { inputRows: 3, validOutcomeRows: 1, returnedRows: rows.length,
    returnedOutcomes: rows.map(row => row.outcome), reported: calibrationStats(rows),
    note: 'Fixture contains one valid defect sample, one invalid outcome label and one torn JSON row.' };
} catch (error) {
  calibration = { refused: true, error: String(error) };
} finally { await cleanup(root); }
console.log(JSON.stringify({
  grade: 'observed fixture behavior, not a proof of all schedules or real-world incidence',
  status: { sequentialControl: control, overlappingTrials: trials.length,
    preservedBoth: trials.filter(t => t.readable && t.atlas && t.mass).length,
    readableButLostReport: trials.filter(t => t.readable && (!t.atlas || !t.mass)).length,
    unreadable: trials.filter(t => !t.readable).length }, calibration,
}, null, 2));
