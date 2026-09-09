import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { appendFile, rename, writeFile, mkdir, unlink, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpProject, cleanup, cfg } from '../../test/_helpers.ts';
import { startScopeServer } from './server.mjs';
import { loadConfig } from '../../src/config.ts';
import { buildGraph } from '../../src/derivation/derive.ts';
import { buildPromiseModel } from '../../src/readings/promise.ts';
import { buildScopeModel } from '../../src/readings/scope-model.ts';
import { readStatus } from '../../src/evidence/status.ts';
import { layoutScope } from './layout.mjs';
import { readGuaranteeTaxonomy } from '../../src/verification/guarantees-cli.ts';
import { recordTaxonomy } from '../../src/taxonomy/taxonomy-ledger.ts';
import { guaranteeRef, parseBoundary } from '../../src/verification/boundary.ts';
import { bindingDigest } from '../../src/verification/guarantee-bindings.ts';
import { GUARANTEE_CATALOG } from '../../src/verification/guarantee-catalog.ts';
import { createHash } from 'node:crypto';

const record = id => ({ id, session: 'fixture', agent: 'fixture', job: '-', kind: 'decision',
  at: '2026-09-04T12:00:00.000Z', chose: id, because: 'test evidence', over: [], branch: null, commit: null, dirty: false });
async function start() {
  const root = await tmpProject({ 'index.html': '<!doctype html><div id="root"></div>',
    '.coherence/decisions/fixture.jsonl': JSON.stringify(record('one')) + '\n' });
  const live = await startScopeServer({ cfg: cfg(root), htmlPath: join(root, 'index.html'), intervalMs: 40 });
  return { root, live, async close() { await live.close(); await cleanup(root); } };
}
function get(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = request(url, options, res => {
      let body = ''; res.on('data', chunk => body += chunk); res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    }); req.on('error', reject); req.end();
  });
}
async function feed(url) {
  const response = await fetch(url + 'events', { signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 200);
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '';
  return { async next() {
    for (;;) {
      const end = buffer.indexOf('\n\n');
      if (end >= 0) {
        const block = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        const data = block.split('\n').find(l => l.startsWith('data: '));
        if (data) return JSON.parse(data.slice(6));
      } else {
        const { value, done } = await reader.read();
        if (done) throw new Error('feed ended');
        buffer += decoder.decode(value, { stream: true });
      }
    }
  }, close: () => reader.cancel() };
}

test('live declared aliases repopulate canonical component relations after a config edit', { timeout: 15000 }, async () => {
  const root = await tmpProject({ 'coherence.config.json': '{}', 'root.spec.md': '# Project\n',
    'a/component.spec.md': '# Consumer\n', 'b/component.spec.md': '# Provider\n',
    'a/main.ts': 'import "~/b/value";', 'b/value.ts': 'export const value = 1;',
    'index.html': '<div id="root"></div>' });
  const live = await startScopeServer({ cfg: await loadConfig(root), htmlPath: join(root, 'index.html'), intervalMs: 30 });
  const stream = await feed(live.url);
  try {
    const initial = await stream.next();
    assert.equal(initial.structure.model.relations.length, 0);
    await writeFile(join(root, 'coherence.config.json'), JSON.stringify({ importAliases: { '~/b/*': ['b/*'] } }));
    let updated;
    do { updated = await stream.next(); } while (!updated.structure.model.relations.length);
    assert.deepEqual(updated.structure.model.relations.map(r => [r.source, r.target]), [['a', 'b']]);
  } finally { await stream.close(); await live.close(); await cleanup(root); }
});

test('live server refuses foreign origin/host, wrong capability, arbitrary paths and writes', async () => {
  const f = await start();
  try {
    assert.equal(f.live.server.address().address, '127.0.0.1');
    assert.equal((await get(f.live.url)).status, 200);
    assert.match((await get(f.live.url)).body, /scope-live/);
    assert.equal((await get(f.live.origin + '/')).status, 404);
    assert.equal((await get(f.live.url + '../../package.json')).status, 404);
    assert.equal((await get(f.live.url, { method: 'POST' })).status, 405);
    assert.equal((await get(f.live.url, { headers: { Origin: 'https://foreign.example' } })).status, 403);
    assert.equal((await get(f.live.url, { headers: { Origin: 'null' } })).status, 403);
    assert.equal((await get(f.live.url, { headers: { Host: 'foreign.example' } })).status, 403);
    assert.equal((await get(f.live.url, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    assert.equal((await get(f.live.url, { headers: { Origin: f.live.origin } })).status, 200);
  } finally { await f.close(); }
});

test('live catalog bindings refresh ignored explicit evidence without camera geometry changes', { timeout: 15000 }, async () => {
  const claim = 'boundary "late work loses" at publish via guard "publish test"';
  const source = 'export function publish() { return true; }\n';
  const root = await tmpProject({ 'coherence.config.json': '{"ignore":["hidden"]}', 'core.spec.md': '# Cache\n',
    'core.ts': source, 'hidden/evidence.txt': 'first', 'index.html': '<div id="root"></div>' });
  const definition = GUARANTEE_CATALOG.definitions.find(d => d.id === 'guarantee:supersession-safety');
  const sha = s => createHash('sha256').update(s).digest('hex');
  const binding = { claim: guaranteeRef('.', parseBoundary(claim)), definition: definition.id, definitionDigest: bindingDigest(definition),
    subject: 'core.ts', assessor: 'test', because: 'Competing writes', parameters: Object.fromEntries(definition.parameters.map(k => [k, k])),
    excludes: 'external runtime', falsifier: 'old result wins', evidence: { 'core.ts': sha(source), 'hidden/evidence.txt': sha('first') } };
  await writeFile(join(root, 'core.spec.md'), `# Cache\n\n## works when\n- ${claim}\n\n## guarantee bindings\n- ${JSON.stringify(binding)}\n`);
  const live = await startScopeServer({ cfg: await loadConfig(root), htmlPath: join(root, 'index.html'), intervalMs: 30 });
  const stream = await feed(live.url);
  try {
    const initial = await stream.next();
    assert.equal(initial.structure.model.catalogBindings.items[0].status, 'current');
    await writeFile(join(root, 'hidden/evidence.txt'), 'second');
    let updated;
    do { updated = await stream.next(); } while (updated.structure.model.catalogBindings.items[0].status === 'current');
    assert.equal(updated.structure.model.catalogBindings.items[0].status, 'stale');
    assert.deepEqual(updated.structure.model.nodes, initial.structure.model.nodes);
    assert.equal(updated.structure.model.catalogBindings.items[0].observation.verdict, 'unverified');
  } finally { await stream.close(); await live.close(); await cleanup(root); }
});

test('live guarantee links repopulate on spec declarations and expire on assessment revisions and source edits', { timeout: 15000 }, async () => {
  const claim = 'boundary "stable session" at session via guard "session oracle"';
  const spec = `# Core\n\nSession owner.\n\n## works when\n- ${claim}\n`;
  const root = await tmpProject({ 'coherence.config.json': '{}\n', 'core.spec.md': spec,
    'core.ts': 'export function session() { return 1; }\n', 'index.html': '<div id="root"></div>' });
  const config = await loadConfig(root), graph = await buildGraph(config);
  const input = { target: 'core.ts', expected: null, session: 'fixture', because: 'Owns this session',
    evidence: ['core.ts'], answers: { 'signal:continuity': 'yes' }, roles: ['role:session-subscription-owner'] };
  const record = recordTaxonomy(config, graph, input);
  const live = await startScopeServer({ cfg: config, htmlPath: join(root, 'index.html'), intervalMs: 30 });
  const stream = await feed(live.url);
  const until = async predicate => { for (;;) { const v = await stream.next(); if (predicate(v)) return v; } };
  try {
    const first = await stream.next();
    assert.equal(first.structure.model.guaranteeLinks.obligations[0].mapping, 'unlinked');
    const link = { claim: guaranteeRef('.', parseBoundary(claim)), subject: 'core.ts', assessment: record.id,
      obligation: 'guarantee:G-SESSION', because: 'Addresses identity only' };
    const linkedSpec = () => `${spec}\n## addresses\n- ${JSON.stringify(link)}\n`;
    await writeFile(join(root, 'core.spec.md'), linkedSpec());
    const linked = await until(v => v.structure.model.guaranteeLinks.links[0]?.status === 'current');
    assert.equal(linked.structure.model.guaranteeLinks.obligations[0].mapping, 'linked');
    const revised = recordTaxonomy(config, graph, { ...input, expected: record.id, because: 'Reassessed the same scope explicitly' });
    const expired = await until(v => v.structure.model.guaranteeLinks.links[0]?.status === 'stale');
    assert.ok(expired.structure.model.guaranteeLinks.links[0].problems.includes('Assessment revision changed'));
    link.assessment = revised.id;
    await writeFile(join(root, 'core.spec.md'), linkedSpec());
    await until(v => v.structure.model.guaranteeLinks.links[0]?.status === 'current');
    await writeFile(join(root, 'core.ts'), 'export function session() { return 2; }\n');
    const changed = await until(v => v.structure.model.guaranteeLinks.links[0]?.status === 'stale');
    assert.equal(changed.structure.model.guaranteeLinks.obligations[0].mapping, 'unlinked');
    assert.equal(changed.structure.model.guaranteeLinks.obligations[0].satisfaction, 'unverified');
    assert.equal(changed.structure.model.guarantees[0].verdict, 'unknown');
    assert.deepEqual(changed.structure.model.nodes.map(n => [n.id, n.ring, n.x, n.y]), linked.structure.model.nodes.map(n => [n.id, n.ring, n.x, n.y]));
  } finally { await stream.close(); await live.close(); await cleanup(root); }
});

test('live structure follows canonical additions, edits, status publication and removals without artifact writes', { timeout: 15000 }, async () => {
  const claim = 'boundary "named property" at run via guard "named oracle"';
  const spec = '# Core\n\nInitial intent.\n\n## works when\n- ' + claim + '\n';
  const root = await tmpProject({ 'coherence.config.json': '{}\n', 'core.spec.md': spec,
    'core.ts': 'export function run() { return 1; }\n', 'index.html': '<div id="root"></div>' });
  const config = await loadConfig(root);
  const live = await startScopeServer({ cfg: config, htmlPath: join(root, 'index.html'), intervalMs: 30 });
  const stream = await feed(live.url);
  const until = async predicate => { for (;;) { const value = await stream.next(); if (predicate(value)) return value; } };
  const canonical = async () => { const c = await loadConfig(root), g = await buildGraph(c); return buildScopeModel(g, await buildPromiseModel(c, g, await readStatus(c)), c, readGuaranteeTaxonomy(c)); };
  try {
    const first = await stream.next();
    assert.equal(first.structure.status, 'current');
    assert.deepEqual(first.structure.model, await canonical());
    assert.equal(first.structure.model.guarantees[0].verdict, 'unknown');
    await mkdir(join(root, 'child'));
    await writeFile(join(root, 'child/child.spec.md'), '# Child\n\nA new component.\n');
    await writeFile(join(root, 'child/index.ts'), 'import { run } from "../core.ts";\nexport const child = run;\n');
    const added = await until(v => v.structure.model.nodes.length === 2 && v.structure.model.relations.length === 1);
    assert.deepEqual(added.structure.model, await canonical());
    await writeFile(join(root, 'core.spec.md'), spec.replace('Initial intent.', 'Changed intent.'));
    const edited = await until(v => v.structure.model.nodes.some(n => n.intent === 'Changed intent.'));
    assert.deepEqual(edited.structure.model, await canonical());
    await mkdir(join(root, '.coherence'), { recursive: true });
    const status = { verify: { claims: [{ node: 'Core', claim, kind: 'fail', at: '2026-09-08T12:00:00.000Z' }] } };
    await writeFile(join(root, '.coherence/status.json'), JSON.stringify(status));
    const failed = await until(v => v.structure.model.guarantees[0]?.verdict === 'fail');
    assert.deepEqual(failed.structure.model, await canonical());
    assert.equal(await readFile(join(root, '.coherence/status.json'), 'utf8'), JSON.stringify(status), 'watching cannot change the verification record');
    await unlink(join(root, 'child/index.ts')); await unlink(join(root, 'child/child.spec.md'));
    const removed = await until(v => v.structure.model.nodes.length === 1);
    assert.deepEqual(removed.structure.model, await canonical());
    await assert.rejects(access(join(root, 'public/scope.json')), 'watching does not generate artifacts');
  } finally { await stream.close(); await live.close(); await cleanup(root); }
});

test('live structure retains a visibly unavailable last model through damage and refuses project adapter execution', { timeout: 15000 }, async () => {
  const root = await tmpProject({ 'coherence.config.json': '{}\n', 'core.spec.md': '# Core\n',
    'index.html': '<div id="root"></div>', 'adapter.mjs': 'throw new Error("PROJECT CODE EXECUTED");\n' });
  const live = await startScopeServer({ cfg: await loadConfig(root), htmlPath: join(root, 'index.html'), intervalMs: 30 });
  const stream = await feed(live.url);
  const until = async predicate => { for (;;) { const value = await stream.next(); if (predicate(value)) return value; } };
  try {
    const first = await stream.next();
    await writeFile(join(root, 'coherence.config.json'), '{');
    const broken = await until(v => v.structure.status === 'unavailable');
    assert.deepEqual(broken.structure.model, first.structure.model);
    assert.match(broken.structure.message, /coherence.config.json/);
    await mkdir(join(root, '.coherence/decisions'), { recursive: true });
    await writeFile(join(root, '.coherence/decisions/fixture.jsonl'), JSON.stringify(record('during-damage')) + '\n');
    const journal = await until(v => v.journal.records.length === 1);
    assert.equal(journal.structure.status, 'unavailable', 'journal updates cannot redeem broken structure');
    await writeFile(join(root, 'coherence.config.json'), JSON.stringify({ language: './adapter.mjs' }));
    const custom = await until(v => v.structure.message?.includes('built-in language'));
    assert.doesNotMatch(custom.structure.message, /PROJECT CODE EXECUTED/);
    await writeFile(join(root, 'coherence.config.json'), '{}\n');
    const repaired = await until(v => v.structure.status === 'current');
    assert.deepEqual(repaired.structure.model, first.structure.model);
    await writeFile(join(root, '.coherence/status.json'), '{');
    const torn = await until(v => v.structure.status === 'unavailable');
    assert.match(torn.structure.message, /status.json/);
    await writeFile(join(root, '.coherence/status.json'), JSON.stringify({ verify: { claims: [{ node: 'Core', claim: 'remembered', kind: 'pass' }] } }));
    const empty = await until(v => v.structure.message?.includes('Refusing to grade'));
    assert.equal(empty.structure.status, 'unavailable', 'remembered claims cannot vanish into success');
    await writeFile(join(root, '.coherence/status.json'), '{}\n');
    assert.equal((await until(v => v.structure.status === 'current')).structure.model.nodes.length, 1);
  } finally { await stream.close(); await live.close(); await cleanup(root); }
});

test('live connection identity survives unrelated relationship insertion', () => {
  const model = { center: 'a', nodes: ['a', 'b', 'c'].map((id, i) => ({ id, ring: i ? 1 : 0 })),
    relations: [{ id: 'z', source: 'a', target: 'b' }] };
  const before = layoutScope(model).connections[0];
  const after = layoutScope({ ...model, relations: [{ id: 'earlier', source: 'a', target: 'c' }, ...model.relations] });
  assert.equal(after.connections.find(c => c.members[0].id === 'z').id, before.id);
});

test('live journal append, compaction overlap, and reconnect retain canonical content identities', { timeout: 10000 }, async () => {
  const f = await start();
  let stream;
  try {
    stream = await feed(f.live.url);
    assert.deepEqual((await stream.next()).journal.records.map(r => r.id), ['one']);
    const path = join(f.root, '.coherence/decisions/fixture.jsonl');
    await appendFile(path, JSON.stringify(record('two')) + '\n');
    assert.deepEqual((await stream.next()).journal.records.map(r => r.id), ['one', 'two']);
    // The compactor can expose a copied destination before it removes the source.
    await writeFile(join(f.root, '.coherence/decisions/copy.jsonl'), JSON.stringify(record('two')) + '\n');
    await appendFile(path, JSON.stringify(record('three')) + '\n');
    assert.deepEqual((await stream.next()).journal.records.map(r => r.id), ['one', 'three', 'two']);
    await rename(path, join(f.root, '.coherence/decisions/moved.jsonl'));
    await stream.close();
    stream = await feed(f.live.url);
    const current = await stream.next();
    assert.equal(current.journal.records.length, 3);
    assert.equal(new Set(current.journal.records.map(r => r.id)).size, 3);
  } finally { await stream?.close(); await f.close(); }
});
