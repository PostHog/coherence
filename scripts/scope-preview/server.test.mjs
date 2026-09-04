import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { appendFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpProject, cleanup, cfg } from '../../test/_helpers.ts';
import { startScopeServer } from './server.mjs';

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
  const response = await fetch(url + 'events');
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
