import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { newTailState, tailJournal } from '../../src/evidence/journal.ts';
import { readScopeReadings } from './readings.mjs';
import { loadConfig } from '../../src/config.ts';
import { buildGraph } from '../../src/derivation/derive.ts';
import { buildPromiseModel } from '../../src/readings/promise.ts';
import { buildScopeModel } from '../../src/readings/scope-model.ts';
import { gitStamp, readStatus } from '../../src/evidence/status.ts';
import { readSurface, vacuityRefusal } from '../../src/verification/floor.ts';
import { codeFiles } from '../../src/derivation/walk.ts';
import { BUILTIN_LANGUAGES } from '../../src/adapters/tree-sitter.ts';

const digestOf = value => createHash('sha256').update(value).digest('hex');
function ledgerStamp(cfg, evidenceFiles = []) {
  const ledgers = ['decisions', 'defects', 'experiments', 'hooks', 'taxonomy', 'activity'].map(name => {
    const dir = join(cfg.root, '.coherence', name);
    try { return readdirSync(dir).sort().map(file => {
      const s = statSync(join(dir, file)); return `${name}/${file}:${s.size}:${s.mtimeMs}`;
    }).join('|'); } catch (error) { return `${name}:${error.code}`; }
  }).join('|');
  return JSON.stringify(cfg) + ledgers + evidenceFiles.map(file => {
    try { const s = statSync(join(cfg.root, file)); return `|${file}:${s.size}:${s.mtimeMs}:${s.ctimeMs}:${s.mode}`; }
    catch (error) { return `|${file}:${error.code}`; }
  }).join('');
}

// Scheduling only: a conservative superset, NOT a second source/spec population.
// Reuse the canonical walker; the full derivation alone decides what Scope shows.
async function projectStamp(cfg) {
  const files = await codeFiles(cfg.root, new Set(cfg.ignore), /./, () => false);
  const paths = [...files, 'coherence.config.json', '.coherence/status.json'];
  const git = gitStamp(cfg.root);
  return { git, value: JSON.stringify([cfg, git, paths.sort().map(file => {
    try { const s = statSync(join(cfg.root, file)); return [file, s.size, s.mtimeMs, s.ctimeMs]; }
    catch (error) { return [file, error.code]; }
  })]) };
}

export async function startScopeServer({ cfg, htmlPath, port = 0, intervalMs = 750 }) {
  const html = await readFile(htmlPath, 'utf8');
  const token = randomBytes(24).toString('hex');
  const basePath = `/${token}/`;
  const clients = new Set();
  const tailState = newTailState();
  let tailDamage = tailJournal(cfg, tailState).unreadable;
  const reloadConfig = existsSync(join(cfg.root, 'coherence.config.json'));
  let stamp = '', sourceStamp = '', packet = '', digest = '', origin, retryRead = false;
  let readings, structure = { status: 'unavailable', model: null, message: 'Waiting for project derivation' };
  let refreshing = null, stopped = false;
  let evidenceFiles = [];
  async function refreshOnce() {
    try {
      const current = reloadConfig ? await loadConfig(cfg.root) : cfg;
      // Live inspection must not execute a repository-provided adapter module.
      if (!Object.hasOwn(BUILTIN_LANGUAGES, current.language)) throw new Error('Live Structure requires a built-in language adapter; custom project code is not executed.');
      const probe = await projectStamp(current);
      if (probe.value !== sourceStamp || structure.status !== 'current') {
        const status = await readStatus(current), graph = await buildGraph(current);
        const refusal = vacuityRefusal(readSurface(graph, status));
        if (refusal) throw new Error(refusal.join('\n'));
        const model = buildScopeModel(graph, await buildPromiseModel(current, graph, status), current);
        if ((await projectStamp(current)).value !== probe.value) throw new Error('Project changed during derivation; retrying after the edit burst.');
        structure = { status: 'current', model, git: probe.git,
          evidence: 'Recorded verification only. Watching never runs tests; uncommitted edits are not reverified.' };
        sourceStamp = probe.value;
      }
      cfg = current;
    } catch (error) {
      structure = { ...structure, status: 'unavailable', message: String(error.message ?? error) };
    }
    const tail = tailJournal(cfg, tailState), nextStamp = ledgerStamp(cfg, evidenceFiles);
    if (!readings || retryRead || tail.fresh.length || tail.unreadable !== tailDamage || nextStamp !== stamp) {
      readings = readScopeReadings(cfg);
      evidenceFiles = [...new Set([
        ...(readings.taxonomy?.records ?? []).flatMap(r => Object.keys(r.snapshot.files)),
        ...readings.hooks.hosts.flatMap(({ control }) => [
          ...control.files.map(file => file.path), control.launcher?.path,
          control.launcher?.mappingPath, control.launcher?.targetPath, control.codexConfig?.path,
        ].filter(Boolean).map(path => relative(cfg.root, path))),
      ])].sort();
      stamp = ledgerStamp(cfg, evidenceFiles); tailDamage = tail.unreadable;
    }
    const raw = JSON.stringify({ ...readings, structure }), next = digestOf(raw);
    if (next === digest && !retryRead) return;
    digest = next;
    packet = `event: readings\nid: ${digest}\ndata: ${JSON.stringify({ ...readings, structure, digest, updatedAt: new Date().toISOString() })}\n\n`;
    for (const client of clients) {
      // Slow clients reconnect to a complete current snapshot, not an unbounded queue.
      if (client.writableLength > 4 * 1024 * 1024) { client.destroy(); clients.delete(client); }
      else client.write(packet);
    }
  }
  // Connection bursts and edit bursts share one in-flight derivation. Polls never overlap.
  function refresh() {
    if (!refreshing) refreshing = refreshOnce().finally(() => { refreshing = null; });
    return refreshing;
  }
  await refresh();
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src data:; font-src data:; frame-ancestors 'none'; base-uri 'none'");
    if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin)
      || req.headers['sec-fetch-site'] === 'cross-site') { res.writeHead(403).end('Forbidden'); return; }
    if (req.method !== 'GET') { res.writeHead(405, { Allow: 'GET' }).end('Read-only'); return; }
    if (req.url === basePath) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      // Only this fixed server route enables live mode. Opening the same artifact
      // as a file (or on another host) never discovers a server or starts a feed.
      res.end(html.replace('<div id="root">', '<meta name="scope-live" content="events"><div id="root">'));
    } else if (req.url === basePath + 'events') {
      if (clients.size >= 8) { res.writeHead(503).end('Too many viewers'); return; }
      try { await refresh(); } catch { res.writeHead(503).end('Readings unavailable'); return; }
      if (stopped || res.destroyed) return;
      if (clients.size >= 8) { res.writeHead(503).end('Too many viewers'); return; }
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive' });
      res.write(`retry: 1000\n${packet}`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
    } else res.writeHead(404).end('Not found');
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.maxHeadersCount = 30;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  const timer = setInterval(async () => {
    if (!clients.size || refreshing || stopped) return;
    try {
      await refresh(); retryRead = false;
    } catch (error) {
      retryRead = true;
      for (const client of clients) client.write(`event: unavailable\ndata: ${JSON.stringify({ message: error.message })}\n\n`);
    }
  }, intervalMs);
  const heartbeat = setInterval(() => { for (const client of clients) client.write(': heartbeat\n\n'); }, 15000);
  return { url: origin + basePath, origin, server,
    async close() {
      stopped = true;
      clearInterval(timer); clearInterval(heartbeat);
      await refreshing?.catch(() => {});
      for (const client of clients) client.end();
      clients.clear(); server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    },
  };
}
