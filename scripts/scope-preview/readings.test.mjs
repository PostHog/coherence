import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpProject, cleanup, cfg } from '../../test/_helpers.ts';
import { LIFECYCLE_HOOK_EVENTS, inspectLifecycleHook } from '../../src/lifecycle/control.ts';
import { recordActivity } from '../../src/lifecycle/activity.ts';
import { readJournal, resolve as resolveJournal } from '../../src/evidence/decisions.ts';
import { readDefects } from '../../src/evidence/defects.ts';
import { readExperiments } from '../../src/evidence/experiment.ts';
import { readScopeReadings } from './readings.mjs';
import { journalEntries, filterEntries } from './journal-view.mjs';

const row = (id, kind, extra = {}) => ({ id, kind, session: 'owner', agent: 'fixture', job: '-',
  at: '2026-09-04T12:00:00.000Z', chose: id, because: 'Recorded evidence', over: [], branch: null, commit: null, dirty: false, ...extra });
const rows = [row('open', 'conjecture'), row('answered', 'conjecture'),
  row('answer', 'resolution', { session: 'reviewer', supersedes: 'answered' }),
  row('dismissed', 'conjecture'), row('dismiss', 'dismissal', { supersedes: 'dismissed' }), row('block', 'blocked')];
const fixtureFiles = { '.coherence/decisions/fixture.jsonl': rows.map(r => JSON.stringify(r)).join('\n') + '\n' };

test('reading snapshot retains canonical populations and resolves before session filtering', async () => {
  const root = await tmpProject(fixtureFiles);
  try {
    const config = cfg(root), value = readScopeReadings(config);
    assert.deepEqual(value.journal.records, readJournal(config).records);
    assert.deepEqual(value.defects, readDefects(config).records);
    assert.deepEqual(value.experiments, readExperiments(config).records);
    for (const [state, entries] of Object.entries(resolveJournal(rows))) for (const entry of entries) {
      assert.equal(value.journal.states[(entry.rec ?? entry).id].state, state);
    }
    assert.equal(value.journal.states.answered.state, 'resolved');
    assert.equal(value.journal.states.dismissed.state, 'dismissed');
    const view = filterEntries(journalEntries(value), { session: 'owner', mode: 'outstanding' });
    assert.deepEqual(view.map(e => e.id).sort(), ['block', 'open']);
    assert.equal(journalEntries(value).length, rows.length);
    assert.deepEqual(readScopeReadings(config), value, 'same frozen inputs repeat exactly');
  } finally { await cleanup(root); }
});

test('hook templates retain silence, overrides, additions, and all canonical event names', async () => {
  const root = await tmpProject({ ...fixtureFiles,
    '.coherence/hooks/SessionStart.override.md': '',
    '.coherence/hooks/SessionStart.append.md': 'Project addition {{session}}',
  });
  try {
    const value = readScopeReadings(cfg(root));
    assert.deepEqual(value.hooks.events.map(e => e.event), [...LIFECYCLE_HOOK_EVENTS]);
    const start = value.hooks.events.find(e => e.event === 'SessionStart');
    assert.equal(start.override.text, '');
    assert.equal(start.template, 'Project addition {{session}}');
    assert.equal(start.runtimeDependent, false);
    assert.equal(value.hooks.events.find(e => e.event === 'Stop').template, '');
    assert.equal(value.hooks.events.find(e => e.event === 'SubagentStop').runtimeDependent, true);
    assert.equal(value.hooks.hosts.find(h => h.host === 'codex').control.present, false);
  } finally { await cleanup(root); }
});

test('direct and stale hook observations cannot become exact-bundle activation', async () => {
  const root = await tmpProject(fixtureFiles);
  try {
    const config = cfg(root), control = inspectLifecycleHook(config, 'codex');
    const payload = { session_id: 'owner' };
    const observation = () => readScopeReadings(config).hooks.hosts.find(h => h.host === 'codex').sessions.owner;
    recordActivity(config, 'SessionStart', payload, { host: 'codex', transport: 'direct', bundleHash: control.bundleFingerprint });
    assert.equal(observation().state, 'unobserved');
    recordActivity(config, 'SessionStart', payload, { host: 'codex', transport: 'launcher', bundleHash: 'old-bundle' });
    assert.equal(observation().state, 'stale');
    recordActivity(config, 'SessionStart', payload, { host: 'codex', transport: 'launcher', bundleHash: control.bundleFingerprint });
    assert.equal(observation().state, 'observed');
    assert.equal(readScopeReadings(config).hooks.hosts.find(h => h.host === 'codex').control.present, false,
      'historical activity cannot redeem absent current wiring');
  } finally { await cleanup(root); }
});

test('damaged ledgers are visible, never quietly reclassified as empty history', async () => {
  const root = await tmpProject({ '.coherence/decisions/bad.jsonl': 'not-json\n',
    '.coherence/defects/bad.jsonl': '{}\n', '.coherence/experiments/bad.jsonl': '{}\n' });
  try {
    const value = readScopeReadings(cfg(root));
    assert.equal(value.journal.unreadable, 1);
    assert.deepEqual(value.errors.map(e => e.source).sort(), ['defects', 'experiments']);
    assert.equal(journalEntries(value).length, 0);
  } finally { await cleanup(root); }
});

test('journal filters search original evidence and keep identical decision ids in different sessions addressable', () => {
  const a = row('same', 'decision', { because: 'a falsifier after a long explanation' });
  const b = { ...a, session: 'second' };
  const value = { journal: { records: [a, b], states: {} }, defects: [], experiments: [], openExperiments: [] };
  const entries = journalEntries(value);
  assert.equal(new Set(entries.map(e => e.key)).size, 2);
  assert.equal(filterEntries(entries, { query: 'falsifier' }).length, 2);
  assert.equal(filterEntries(entries, { session: 'second', source: 'journal' }).length, 1);
  assert.equal(filterEntries(entries, { query: 'absent' }).length, 0);
});
