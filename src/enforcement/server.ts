/**
 * The warm server: one process per project that holds the language server
 * open across hook invocations, because a hook is short-lived and a cold
 * TypeScript project load is too slow for a check at the edit.
 *
 *   node src/cli.ts serve [--idle <seconds>]   runs it in the foreground
 *
 * A client connects over a unix socket under .coherence/run/ (or, when that
 * path is too long for a socket, under the system temp folder, with the
 * pointer file .coherence/run/server.json naming it); when nothing listens
 * the client spawns the server detached and waits for it. The protocol is
 * one line of JSON per request, `{id, method, params}`, answered by one line
 * `{id, result}` or `{id, error}`; the methods are the adapter's questions.
 * An idle server shuts down after a few minutes.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import type { Definition, Ladder, LanguageAdapter, Refutation, ReferenceSite, ResolveHint, Resolved, Visibility } from "../adapters/adapter.ts";
import { adapterFor } from "../adapters/index.ts";
import { readEnforcementConfig } from "./config.ts";

export const RUN_DIR = join(".coherence", "run");
export const DEFAULT_IDLE_MS = 5 * 60 * 1000;
const SOCKET_PATH_LIMIT = 100;
const SPAWN_WAIT_MS = 20_000;
const CLI = resolve(dirname(fileURLToPath(import.meta.url)), "..", "cli.ts");

export interface ServerPaths {
  dir: string;
  pointer: string;
  socket: string;
}

export function serverPaths(rootGiven: string): ServerPaths {
  const root = resolve(rootGiven);
  const dir = join(root, RUN_DIR);
  const local = join(dir, "adapter.sock");
  const socket = Buffer.byteLength(local) <= SOCKET_PATH_LIMIT ? local : join(tmpdir(), `coherence-${createHash("sha1").update(root).digest("hex").slice(0, 12)}.sock`);
  return { dir, pointer: join(dir, "server.json"), socket };
}

interface Pointer {
  pid: number;
  socket: string;
  language: string;
  startedAt: string;
}

/* ---------------------------------------------------------------- server */

interface Request {
  id: number;
  method: string;
  params: unknown[];
}

export interface ServeOptions {
  idleMs?: number;
  /** Called once the socket listens, with the paths. */
  onListen?: (paths: ServerPaths) => void;
  log?: (line: string) => void;
}

export interface Serving {
  paths: ServerPaths;
  /** Resolves when the server has shut down. */
  done: Promise<void>;
  stop: () => Promise<void>;
}

/** Start the server for a root; resolves once it listens. */
export async function serve(rootGiven: string, options: ServeOptions = {}): Promise<Serving> {
  const root = resolve(rootGiven);
  const paths = serverPaths(root);
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
  const log = options.log ?? (() => {});
  const config = readEnforcementConfig(root);
  const adapter = adapterFor(config.language, root);
  const startedAt = new Date().toISOString();
  let warm = false;
  void adapter.ready().then((state) => {
    warm = state.ok;
    log(state.ok ? `${config.language} adapter ready` : `${config.language} adapter not ready: ${state.reason}`);
  });

  mkdirSync(paths.dir, { recursive: true });
  if (existsSync(paths.socket)) rmSync(paths.socket, { force: true });

  let queue: Promise<unknown> = Promise.resolve();
  let idle: NodeJS.Timeout | undefined;
  let server: Server;
  let finish: () => void = () => {};
  const done = new Promise<void>((r) => (finish = r));
  let stopping = false;
  const connections = new Set<Socket>();

  const stop = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    if (idle !== undefined) clearTimeout(idle);
    log("stopping");
    await adapter.close();
    // server.close waits for every connection to end; a client that never said goodbye must not hold the server up.
    for (const socket of connections) socket.destroy();
    await new Promise<void>((r) => server.close(() => r()));
    rmSync(paths.socket, { force: true });
    try {
      const pointer = JSON.parse(readFileSync(paths.pointer, "utf8")) as Pointer;
      if (pointer.pid === process.pid) rmSync(paths.pointer, { force: true });
    } catch {
      // No pointer to remove.
    }
    finish();
  };

  const touch = (): void => {
    if (idle !== undefined) clearTimeout(idle);
    idle = setTimeout(() => void stop(), idleMs);
    idle.unref();
  };

  const dispatch = async (method: string, sent: unknown[]): Promise<unknown> => {
    // JSON has no undefined: an absent optional argument arrives as null.
    const params = sent.map((p) => (p === null ? undefined : p));
    switch (method) {
      case "status":
        return { language: adapter.language, ladder: adapter.ladder, warm, pid: process.pid, startedAt };
      case "ready":
        return adapter.ready();
      case "resolve":
        return adapter.resolve(params[0] as string, params[1] as ResolveHint);
      case "references":
        return adapter.references(params[0] as Definition);
      case "visibility":
        return adapter.visibility(params[0] as Definition);
      case "testFilter":
        return adapter.testFilter(params[0] as string);
      case "refute":
        return adapter.refute(params[0] as Definition, params[1] as Definition | undefined);
      case "forget":
        if ("forget" in adapter && typeof adapter.forget === "function") (adapter as { forget: (files?: readonly string[]) => void }).forget((params[0] as string[] | undefined) ?? []);
        return null;
      case "stop":
        setTimeout(() => void stop(), 10);
        return null;
      default:
        throw new Error(`unknown method ${method}`);
    }
  };

  server = createServer((socket: Socket) => {
    connections.add(socket);
    socket.on("close", () => connections.delete(socket));
    const lines = createInterface({ input: socket });
    lines.on("line", (line) => {
      let request: Request;
      try {
        request = JSON.parse(line) as Request;
      } catch {
        socket.write(JSON.stringify({ id: null, error: "not JSON" }) + "\n");
        return;
      }
      touch();
      queue = queue.then(async () => {
        try {
          const result = await dispatch(request.method, request.params ?? []);
          if (!socket.destroyed) socket.write(JSON.stringify({ id: request.id, result: result ?? null }) + "\n");
        } catch (error) {
          if (!socket.destroyed) socket.write(JSON.stringify({ id: request.id, error: error instanceof Error ? error.message : String(error) }) + "\n");
        }
      });
    });
    socket.on("error", () => {});
  });

  await new Promise<void>((r, reject) => {
    server.once("error", reject);
    server.listen(paths.socket, () => r());
  });
  const pointer: Pointer = { pid: process.pid, socket: paths.socket, language: config.language, startedAt };
  writeFileSync(paths.pointer, JSON.stringify(pointer) + "\n", "utf8");
  touch();
  options.onListen?.(paths);
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => void stop());
  return { paths, done, stop };
}

/* ---------------------------------------------------------------- client */

class LineClient {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private readonly socket: Socket;
  private closed: Error | undefined;

  constructor(socket: Socket) {
    this.socket = socket;
    const lines = createInterface({ input: socket });
    lines.on("line", (line) => {
      let message: { id: number | null; result?: unknown; error?: string };
      try {
        message = JSON.parse(line) as typeof message;
      } catch {
        return;
      }
      if (message.id === null) return;
      const pending = this.pending.get(message.id);
      if (pending === undefined) return;
      this.pending.delete(message.id);
      if (message.error !== undefined) pending.reject(new Error(message.error));
      else pending.resolve(message.result);
    });
    const fail = (error: Error): void => {
      this.closed = error;
      for (const p of this.pending.values()) p.reject(error);
      this.pending.clear();
    };
    socket.on("error", fail);
    socket.on("close", () => fail(new Error("the warm server closed the connection")));
  }

  request<T>(method: string, params: unknown[] = []): Promise<T> {
    if (this.closed !== undefined) return Promise.reject(this.closed);
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (v) => resolve(v as T), reject });
      this.socket.write(JSON.stringify({ id, method, params }) + "\n");
    });
  }

  end(): void {
    this.socket.end();
  }
}

/** The adapter's questions asked of the warm server over the socket. */
export class RemoteAdapter implements LanguageAdapter {
  readonly language: string;
  readonly ladder: Ladder;
  private readonly client: LineClient;

  constructor(client: LineClient, language: string, ladder: Ladder) {
    this.client = client;
    this.language = language;
    this.ladder = ladder;
  }

  ready(): Promise<{ ok: true } | { ok: false; reason: string }> {
    return this.client.request("ready");
  }
  resolve(name: string, hint: ResolveHint): Promise<Resolved> {
    return this.client.request("resolve", [name, hint]);
  }
  references(definition: Definition): Promise<ReferenceSite[]> {
    return this.client.request("references", [definition]);
  }
  visibility(definition: Definition): Promise<Visibility> {
    return this.client.request("visibility", [definition]);
  }
  testFilter(via: string): string {
    return via;
  }
  refute(protectedThing: Definition, outsideOf: Definition | undefined): Promise<Refutation> {
    return this.client.request("refute", [protectedThing, outsideOf]);
  }
  /** Drop what the server cached about file contents and re-read the named files; the edit hook calls it before re-checking. */
  forget(files: readonly string[] = []): Promise<null> {
    return this.client.request("forget", [files]);
  }
  status(): Promise<{ language: string; ladder: Ladder; warm: boolean; pid: number; startedAt: string }> {
    return this.client.request("status");
  }
  /** Ask the server to shut down. */
  stopServer(): Promise<null> {
    return this.client.request("stop");
  }
  /** Ends this connection; the server stays warm. */
  async close(): Promise<void> {
    this.client.end();
  }
}

function connectOnce(socketPath: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** The socket the pointer names when a server is recorded, else the computed path. */
function socketFor(paths: ServerPaths): string {
  try {
    const pointer = JSON.parse(readFileSync(paths.pointer, "utf8")) as Pointer;
    if (typeof pointer.socket === "string") return pointer.socket;
  } catch {
    // No pointer, or unreadable: use the computed path.
  }
  return paths.socket;
}

export interface ConnectOptions {
  /** Spawn the server when none listens (default true). */
  spawn?: boolean;
  idleMs?: number;
}

export interface Connected {
  adapter: RemoteAdapter;
  /** cold when this call had to spawn the server or the instrument had not finished loading. */
  server: "cold" | "warm";
}

/** Connect to the project's warm server, spawning it detached when none listens. */
export async function connectAdapter(rootGiven: string, options: ConnectOptions = {}): Promise<Connected> {
  const root = resolve(rootGiven);
  const paths = serverPaths(root);
  let spawned = false;
  let socket: Socket | undefined;
  try {
    socket = await connectOnce(socketFor(paths));
  } catch {
    if (options.spawn === false) throw new Error(`no warm server listening for ${root}; start one with: serve`);
    rmSync(paths.socket, { force: true });
    rmSync(paths.pointer, { force: true });
    mkdirSync(paths.dir, { recursive: true });
    const args = ["--disable-warning=ExperimentalWarning", CLI, "serve", ...(options.idleMs === undefined ? [] : ["--idle", String(Math.ceil(options.idleMs / 1000))])];
    const child = spawn(process.execPath, args, { cwd: root, detached: true, stdio: "ignore" });
    child.unref();
    spawned = true;
    const deadline = Date.now() + SPAWN_WAIT_MS;
    let lastError: unknown;
    while (Date.now() < deadline) {
      await sleep(50);
      try {
        socket = await connectOnce(socketFor(paths));
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (socket === undefined) throw new Error(`the warm server did not answer within ${SPAWN_WAIT_MS / 1000} s (${lastError instanceof Error ? lastError.message : String(lastError)})`);
  }
  const client = new LineClient(socket);
  const status = await client.request<{ language: string; ladder: Ladder; warm: boolean }>("status");
  return { adapter: new RemoteAdapter(client, status.language, status.ladder), server: spawned || !status.warm ? "cold" : "warm" };
}
