import { createServer, type ServerResponse } from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { readdir, lstat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Config } from "../../types.ts";
import { loadConfig } from "../../config.ts";
import { codeFiles } from "../../derivation/walk.ts";
import { BUILTIN_LANGUAGES } from "../../adapters/tree-sitter.ts";
import { captureScope, type ScopeSnapshot } from "./capture.ts";
import { renderScope } from "../render-scope.ts";

// Metadata schedules reads; only canonical readers define the asset population.
async function inputStamp(cfg: Config, inputs: string[] = []): Promise<string> {
  const files = await codeFiles(cfg.root, new Set([...cfg.ignore, cfg.outputDir]), /./, () => false);
  async function evidence(dir: string): Promise<string[]> {
    let entries;
    try { entries = await readdir(join(cfg.root, dir), { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
    const result: string[] = [];
    for (const entry of entries) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) result.push(...await evidence(path)); else result.push(path);
    }
    return result;
  }
  const paths = [...new Set([...files, ...await evidence(".coherence"), ...await evidence(".claude"), ...await evidence(".codex"),
    "coherence.config.json", "coherence.scope.json", ".git/HEAD", ".git/index",
    ...inputs,
    ...["mass-baseline.json", "sinks-baseline.json", "conventions-baseline.json"].map(p => join(cfg.outputDir, p)),
  ])].sort();
  const rows = await Promise.all(paths.map(async path => {
    try { const s = await lstat(resolve(cfg.root, path)); return [path, s.size, s.mtimeMs, s.ctimeMs, s.mode]; }
    catch (error) { return [path, (error as NodeJS.ErrnoException).code]; }
  }));
  return JSON.stringify([cfg, rows]);
}
export async function startScopeServer({ cfg, port = 0, intervalMs = 750 }: { cfg: Config; port?: number; intervalMs?: number }) {
  const clients = new Set<ServerResponse>();
  const basePath = `/${randomBytes(24).toString("hex")}/`;
  let origin = "", stamp = "", packet = "", html = "", closed = false;
  let inFlight: Promise<void> | null = null;
  let snapshot: ScopeSnapshot | undefined;
  async function refreshOnce() {
    try {
      const current = await loadConfig(cfg.root);
      if (!Object.hasOwn(BUILTIN_LANGUAGES, current.language)) throw new Error("Live Scope requires a built-in language; project adapter code is not executed on browser connections.");
      const before = await inputStamp(current, snapshot?.inputs);
      if (before === stamp) return;
      let next = await captureScope(current);
      let after = await inputStamp(current, snapshot?.inputs);
      if (before !== after) throw new Error("Project changed during capture; retaining the previous snapshot until the next stable read.");
      // Newly discovered pinned files may live outside the source walk. Establish
      // their interval before a second capture instead of retroactively calling it stable.
      if (JSON.stringify(next.inputs) !== JSON.stringify(snapshot?.inputs)) {
        const discovered = await inputStamp(current, next.inputs);
        const confirmed = await captureScope(current);
        after = await inputStamp(current, confirmed.inputs);
        if (discovered !== after) throw new Error("Pinned evidence changed during capture; retrying.");
        next = confirmed;
      }
      const raw = JSON.stringify(next), digest = createHash("sha256").update(raw).digest("hex");
      stamp = after;
      snapshot = next; cfg = current;
      packet = `event: snapshot\nid: ${digest}\ndata: ${raw}\n\n`;
      html = await renderScope(next);
    } catch (error) {
      packet = `event: unavailable\ndata: ${JSON.stringify({ message: String((error as Error).message) })}\n\n`;
      if (!snapshot) throw error;
    }
    for (const client of clients) {
      if (client.writableLength > 4 * 1024 * 1024) { client.destroy(); clients.delete(client); }
      else client.write(packet);
    }
  }
  function refresh(): Promise<void> {
    return inFlight ??= refreshOnce().finally(() => { inFlight = null; });
  }
  await refresh();
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store"); res.setHeader("X-Content-Type-Options", "nosniff"); res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src data:; font-src data:; frame-ancestors 'none'; base-uri 'none'");
    if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin) || req.headers["sec-fetch-site"] === "cross-site") { res.writeHead(403).end("Forbidden"); return; }
    if (req.method !== "GET") { res.writeHead(405, { Allow: "GET" }).end("Read-only"); return; }
    if (req.url === basePath) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html.replace('<div id="root">', '<meta name="scope-live" content="events"><div id="root">'));
    } else if (req.url === basePath + "events") {
      if (clients.size >= 8) { res.writeHead(503).end("Too many viewers"); return; }
      try { await refresh(); } catch { res.writeHead(503).end("Snapshot unavailable"); return; }
      if (closed || res.destroyed) return;
      if (clients.size >= 8) { res.writeHead(503).end("Too many viewers"); return; }
      res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", Connection: "keep-alive" });
      res.write(`retry: 1000\n${packet}`); clients.add(res); req.on("close", () => clients.delete(res));
    } else res.writeHead(404).end("Not found");
  });
  server.requestTimeout = 5000; server.headersTimeout = 5000; server.maxHeadersCount = 30;
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const timer = setInterval(() => { if (clients.size && !closed) void refresh().catch(() => {}); }, intervalMs);
  const heartbeat = setInterval(() => { for (const client of clients) client.write(": heartbeat\n\n"); }, 15000);
  return { url: origin + basePath, origin, server, async close() {
    closed = true; clearInterval(timer); clearInterval(heartbeat); await inFlight?.catch(() => {});
    for (const client of clients) client.end(); clients.clear(); server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  } };
}
