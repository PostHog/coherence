import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { readdirSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { newTailState, tailJournal } from '../../src/journal.ts';
import { readScopeReadings } from './readings.mjs';

const digestOf = value => createHash('sha256').update(value).digest('hex');
function ledgerStamp(cfg, evidenceFiles = []) {
  const ledgers = ['decisions', 'defects', 'experiments', 'hooks', 'taxonomy'].map(name => {
    const dir = join(cfg.root, '.coherence', name);
    try { return readdirSync(dir).sort().map(file => {
      const s = statSync(join(dir, file)); return `${name}/${file}:${s.size}:${s.mtimeMs}`;
    }).join('|'); } catch (error) { return `${name}:${error.code}`; }
  }).join('|');
  return ledgers + evidenceFiles.map(file => {
    try { const s = statSync(join(cfg.root, file)); return `|${file}:${s.size}:${s.mtimeMs}`; }
    catch (error) { return `|${file}:${error.code}`; }
  }).join('');
}

export async function startScopeServer({ cfg, htmlPath, port = 0, intervalMs = 750 }) {
  const html = await readFile(htmlPath, 'utf8');
  const token = randomBytes(24).toString('hex');
  const basePath = `/${token}/`;
  const clients = new Set();
  const tailState = newTailState();
  let tailDamage = tailJournal(cfg, tailState).unreadable;
  let stamp = ledgerStamp(cfg), packet = '', digest = '', origin, retryRead = false;
  let evidenceFiles = [];
  function refresh(force = false) {
    const readings = readScopeReadings(cfg);
    evidenceFiles = [...new Set((readings.taxonomy?.records ?? []).flatMap(r => Object.keys(r.snapshot.files)))].sort();
    const raw = JSON.stringify(readings), next = digestOf(raw);
    if (next === digest && !force) return;
    digest = next;
    packet = `event: readings\nid: ${digest}\ndata: ${JSON.stringify({ digest, ...readings })}\n\n`;
    for (const client of clients) {
      // Slow clients reconnect to a complete current snapshot, not an unbounded queue.
      if (client.writableLength > 4 * 1024 * 1024) { client.destroy(); clients.delete(client); }
      else client.write(packet);
    }
  }
  refresh();
  const server = createServer((req, res) => {
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
      try { refresh(); } catch (error) { res.writeHead(503).end(`Readings unavailable: ${error.message}`); return; }
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
  const timer = setInterval(() => {
    if (!clients.size) return;
    try {
      const tail = tailJournal(cfg, tailState), nextStamp = ledgerStamp(cfg, evidenceFiles);
      if (retryRead || tail.fresh.length || tail.unreadable !== tailDamage || nextStamp !== stamp) {
        refresh(retryRead); retryRead = false; stamp = nextStamp; tailDamage = tail.unreadable;
      }
    } catch (error) {
      retryRead = true;
      for (const client of clients) client.write(`event: unavailable\ndata: ${JSON.stringify({ message: error.message })}\n\n`);
    }
  }, intervalMs);
  const heartbeat = setInterval(() => { for (const client of clients) client.write(': heartbeat\n\n'); }, 15000);
  return { url: origin + basePath, origin, server,
    async close() {
      clearInterval(timer); clearInterval(heartbeat);
      for (const client of clients) client.end();
      clients.clear(); server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    },
  };
}
