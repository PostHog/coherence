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
 *
 * One server per root: the lock file .coherence/run/server.lock, created
 * exclusively (O_EXCL) and holding its owner's pid, is taken before anything
 * spawns; a client that loses the race waits for the winner's socket, a lock
 * whose owner is dead (or alive but never listened) is reclaimed, and serve()
 * refuses a root another live server holds. Only the lock's owner unlinks the
 * socket, the pointer, and the lock.
 *
 * Never stale code: the server reports the fingerprint of the Coherence code
 * it runs (a hash of the source files beside this one and of package.json);
 * a client whose fingerprint differs asks it to stop and starts a fresh one.
 *
 * An idle server shuts down after a few minutes, and a server whose root is
 * gone (a removed worktree) or whose lock is no longer its own shuts down at
 * its next check.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import type { Definition, Ladder, LanguageAdapter, Refutation, ReferenceSite, ResolveHint, Resolved, Visibility } from "../adapters/adapter.ts";
import { adapterFor } from "../adapters/index.ts";
import { readEnforcementConfig } from "./config.ts";

export const RUN_DIR = join(".coherence", "run");
export const DEFAULT_IDLE_MS = 5 * 60 * 1000;
const SOCKET_PATH_LIMIT = 100;
const SPAWN_WAIT_MS = 20_000;
/** A lock whose live owner has not listened for this long is not a server; it is reclaimed. */
const LOCK_GRACE_MS = SPAWN_WAIT_MS;
/** How often a server checks that its root still exists and its lock is still its own. */
const CHECK_MS = 5_000;
/** How long a client waits for a stale server to exit after asking it to stop, before signalling it. */
const STOP_WAIT_MS = 5_000;
/** Spawns one client attempts before it reports failure: a server that dies at start is not respawned forever. */
const SPAWN_ATTEMPTS = 3;
const CODE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(CODE_DIR, "cli.ts");
const PACKAGE_JSON = join(CODE_DIR, "..", "package.json");
const CODE_FILE = /\.(ts|mts|cts|js|mjs|cjs|json)$/;

/* ------------------------------------------------------ code fingerprint */

/**
 * Mixed into the fingerprint when set: a test's way to make two processes
 * disagree about their code without editing it. Inherited by a spawned server.
 */
export const CODE_SALT_ENV = "COHERENCE_CODE_SALT";

function codeFiles(dir: string, into: string[]): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) codeFiles(path, into);
    else if (entry.isFile() && CODE_FILE.test(entry.name) && !entry.name.includes(".test.")) into.push(path);
  }
  return into;
}

/**
 * The identity of the Coherence code on disk: a hash of every source file
 * under this installation's src (tests aside) and of package.json. Read from
 * disk each time, so a client compares a running server with the code as it
 * is now.
 */
export function codeFingerprint(): string {
  const hash = createHash("sha256");
  const files = codeFiles(CODE_DIR, []).sort();
  if (existsSync(PACKAGE_JSON)) files.push(PACKAGE_JSON);
  for (const file of files) {
    hash.update(relative(CODE_DIR, file)).update("\0");
    try {
      hash.update(readFileSync(file));
    } catch {
      hash.update("<unreadable>");
    }
    hash.update("\0");
  }
  const salt = process.env[CODE_SALT_ENV];
  if (salt !== undefined && salt !== "") hash.update(`salt\0${salt}`);
  return hash.digest("hex").slice(0, 16);
}

/* ---------------------------------------------------------------- paths */

export interface ServerPaths {
  root: string;
  dir: string;
  pointer: string;
  socket: string;
  lock: string;
}

/**
 * The root as the file system names it: a client in /var/... and a server
 * whose cwd reads /private/var/... must compute the same socket, or each
 * finds nothing listening where it looks.
 */
function canonicalRoot(rootGiven: string): string {
  const root = resolve(rootGiven);
  try {
    return realpathSync(root);
  } catch {
    return root;
  }
}

export function serverPaths(rootGiven: string): ServerPaths {
  const root = canonicalRoot(rootGiven);
  const dir = join(root, RUN_DIR);
  const local = join(dir, "adapter.sock");
  const socket = Buffer.byteLength(local) <= SOCKET_PATH_LIMIT ? local : join(tmpdir(), `coherence-${createHash("sha1").update(root).digest("hex").slice(0, 12)}.sock`);
  return { root, dir, pointer: join(dir, "server.json"), socket, lock: join(dir, "server.lock") };
}

interface Pointer {
  pid: number;
  socket: string;
  language: string;
  startedAt: string;
  fingerprint: string;
}

/* ----------------------------------------------------------------- lock */

interface LockRecord {
  pid: number;
  at: string;
}

/** Lock files a serve() in this process holds: the same pid in the lock does not make a second serve() its owner. */
const heldHere = new Set<string>();

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readLock(path: string): LockRecord | undefined {
  try {
    const record = JSON.parse(readFileSync(path, "utf8")) as LockRecord;
    return typeof record.pid === "number" ? record : undefined;
  } catch {
    return undefined;
  }
}

function lockAge(path: string): number | undefined {
  try {
    return Date.now() - statSync(path).mtimeMs;
  } catch {
    return undefined;
  }
}

/** Create the lock exclusively, naming pid; false when it already exists. */
function tryLock(paths: ServerPaths, pid: number): boolean {
  mkdirSync(paths.dir, { recursive: true });
  let fd: number;
  try {
    fd = openSync(paths.lock, "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
  try {
    writeSync(fd, JSON.stringify({ pid, at: new Date().toISOString() } satisfies LockRecord) + "\n");
  } finally {
    closeSync(fd);
  }
  return true;
}

/** Hand a lock this process created to the server it spawned. */
function handLock(paths: ServerPaths, pid: number): void {
  writeFileSync(paths.lock, JSON.stringify({ pid, at: new Date().toISOString() } satisfies LockRecord) + "\n", "utf8");
}

/** Why the lock is stale, or undefined while its owner may still be a server. */
function staleness(paths: ServerPaths, listening: boolean): string | undefined {
  const age = lockAge(paths.lock);
  if (age === undefined) return undefined;
  const held = readLock(paths.lock);
  if (held === undefined) return age > LOCK_GRACE_MS ? "an unreadable lock" : undefined;
  if (!pidAlive(held.pid)) return `a lock whose owner (pid ${held.pid}) is dead`;
  if (!listening && age > LOCK_GRACE_MS && !(held.pid === process.pid && heldHere.has(paths.lock))) return `a lock whose owner (pid ${held.pid}) never listened`;
  return undefined;
}

/**
 * Remove a stale lock, under a short-lived exclusive guard so two reclaimers
 * cannot both remove it and one of them remove the other's fresh lock. True
 * when the lock is gone after the call.
 */
function reclaim(paths: ServerPaths, listening: boolean): boolean {
  if (staleness(paths, listening) === undefined) return !existsSync(paths.lock);
  const guard = `${paths.lock}.reclaim`;
  let fd: number;
  try {
    fd = openSync(guard, "wx");
  } catch {
    // Another reclaimer is at work; a guard left by a reclaimer that died is removed after a moment.
    const age = lockAge(guard);
    if (age !== undefined && age > 2_000) rmSync(guard, { force: true });
    return false;
  }
  try {
    closeSync(fd);
    // Checked again under the guard: the lock may have been reclaimed and retaken since.
    if (staleness(paths, listening) === undefined) return !existsSync(paths.lock);
    rmSync(paths.lock, { force: true });
    return true;
  } finally {
    rmSync(guard, { force: true });
  }
}

async function listens(paths: ServerPaths): Promise<boolean> {
  try {
    const socket = await connectOnce(socketFor(paths));
    socket.destroy();
    return true;
  } catch {
    return false;
  }
}

/**
 * Take the root for this server process: create the lock, accept it from the
 * client that spawned this process, or reclaim a stale one. Refuses when a
 * live server holds the root.
 */
async function takeRoot(paths: ServerPaths): Promise<void> {
  if (heldHere.has(paths.lock)) throw new Error(`a live warm server (pid ${process.pid}, this process) holds this root: ${paths.root}`);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (tryLock(paths, process.pid)) return;
    const held = readLock(paths.lock);
    // The spawning client created the lock and handed it to this process as soon as spawn returned. (Were this
    // process ever to start first, it refuses, dies, and the client reclaims the dead pid's lock and spawns again.)
    if (held !== undefined && held.pid === process.pid) {
      handLock(paths, process.pid);
      return;
    }
    if (reclaim(paths, await listens(paths))) continue;
    const live = readLock(paths.lock);
    if (live !== undefined && pidAlive(live.pid)) throw new Error(`a live warm server (pid ${live.pid}) holds this root: ${paths.root}`);
    await sleep(50);
  }
  throw new Error(`could not take the lock ${paths.lock}`);
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
  /** How often the server checks that its root exists and its lock is its own (default 5 s). */
  checkMs?: number;
}

export interface Serving {
  paths: ServerPaths;
  /** Resolves when the server has shut down. */
  done: Promise<void>;
  stop: () => Promise<void>;
}

/** Start the server for a root; resolves once it listens. */
export async function serve(rootGiven: string, options: ServeOptions = {}): Promise<Serving> {
  const paths = serverPaths(rootGiven);
  const root = paths.root;
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
  const log = options.log ?? (() => {});
  // The code this process runs, read before anything else can change it further.
  const fingerprint = codeFingerprint();
  // The root is taken before a language server starts: a refused server costs nothing.
  await takeRoot(paths);
  heldHere.add(paths.lock);
  /** Whether this server still owns the root; only the owner unlinks the socket, the pointer, and the lock. */
  const owns = (): boolean => heldHere.has(paths.lock) && readLock(paths.lock)?.pid === process.pid;
  let config: ReturnType<typeof readEnforcementConfig>;
  let adapter: LanguageAdapter;
  try {
    config = readEnforcementConfig(root);
    adapter = adapterFor(config.language, root);
  } catch (error) {
    if (owns()) rmSync(paths.lock, { force: true });
    heldHere.delete(paths.lock);
    throw error;
  }
  const startedAt = new Date().toISOString();
  let warm = false;
  void adapter.ready().then((state) => {
    warm = state.ok;
    log(state.ok ? `${config.language} adapter ready` : `${config.language} adapter not ready: ${state.reason}`);
    // An adapter whose instrument enumerates the workspace (Pyright) reports when that is done, for the measurement.
    const enumerating = (adapter as { indexed?: () => Promise<unknown>; enumeration?: { sourceFiles: number; latency: number } }).indexed;
    if (state.ok && typeof enumerating === "function") {
      void enumerating.call(adapter).then(() => {
        const e = (adapter as { enumeration?: { sourceFiles: number; latency: number } }).enumeration;
        if (e !== undefined) log(`${config.language} instrument enumerated ${e.sourceFiles} source files in ${e.latency} ms`);
      }, () => {});
    }
  });

  mkdirSync(paths.dir, { recursive: true });
  // This process holds the lock, so a socket file left here belongs to a dead or displaced owner.
  if (existsSync(paths.socket)) rmSync(paths.socket, { force: true });

  let queue: Promise<unknown> = Promise.resolve();
  let idle: NodeJS.Timeout | undefined;
  let check: NodeJS.Timeout | undefined;
  let server: Server;
  let finish: () => void = () => {};
  const done = new Promise<void>((r) => (finish = r));
  let stopping = false;
  const connections = new Set<Socket>();

  const stop = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    if (idle !== undefined) clearTimeout(idle);
    if (check !== undefined) clearInterval(check);
    log("stopping");
    await adapter.close();
    // server.close waits for every connection to end; a client that never said goodbye must not hold the server up.
    for (const socket of connections) socket.destroy();
    await new Promise<void>((r) => server.close(() => r()));
    // A server that lost the root leaves the socket, the pointer, and the lock to their new owner.
    if (owns()) {
      rmSync(paths.socket, { force: true });
      try {
        const pointer = JSON.parse(readFileSync(paths.pointer, "utf8")) as Pointer;
        if (pointer.pid === process.pid) rmSync(paths.pointer, { force: true });
      } catch {
        // No pointer to remove.
      }
      // The lock goes last: until it does, a client waits rather than spawning beside this server.
      rmSync(paths.lock, { force: true });
    }
    heldHere.delete(paths.lock);
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
        return { language: adapter.language, ladder: adapter.ladder, warm, pid: process.pid, startedAt, fingerprint, root, enumeration: (adapter as { enumeration?: { sourceFiles: number; latency: number } }).enumeration ?? null };
      case "ready":
        return adapter.ready();
      case "resolve":
        return adapter.resolve(params[0] as string, params[1] as ResolveHint);
      case "references":
        return adapter.references(params[0] as Definition);
      case "visibility":
        return adapter.visibility(params[0] as Definition, params[1] as Definition | undefined);
      case "testFilter":
        return adapter.testFilter(params[0] as string);
      case "refute":
        return adapter.refute(params[0] as Definition, params[1] as Definition | undefined);
      case "forget":
        // Answered only once the instrument has acknowledged the current text, so the client's next question cannot be stale.
        await adapter.forget((params[0] as string[] | undefined) ?? []);
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

  try {
    await new Promise<void>((r, reject) => {
      server.once("error", reject);
      server.listen(paths.socket, () => r());
    });
  } catch (error) {
    await adapter.close();
    if (owns()) rmSync(paths.lock, { force: true });
    heldHere.delete(paths.lock);
    throw error;
  }
  const pointer: Pointer = { pid: process.pid, socket: paths.socket, language: config.language, startedAt, fingerprint };
  writeFileSync(paths.pointer, JSON.stringify(pointer) + "\n", "utf8");
  touch();
  // Lifetime beyond idleness: a removed root (a deleted worktree) or a lock taken by another server ends this one.
  check = setInterval(() => {
    if (stopping) return;
    if (!existsSync(root)) {
      log(`root ${root} no longer exists`);
      void stop();
    } else if (!owns()) {
      log("the root's lock is no longer this server's");
      void stop();
    }
  }, options.checkMs ?? CHECK_MS);
  check.unref();
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
  visibility(definition: Definition, chokepoint?: Definition): Promise<Visibility> {
    return this.client.request("visibility", [definition, chokepoint]);
  }
  testFilter(via: string): string {
    return via;
  }
  refute(protectedThing: Definition, outsideOf: Definition | undefined): Promise<Refutation> {
    return this.client.request("refute", [protectedThing, outsideOf]);
  }
  /** Drop what the server cached about file contents and re-read the named files; the edit hook calls it before re-checking. */
  async forget(files: readonly string[] = []): Promise<void> {
    await this.client.request("forget", [files]);
  }
  status(): Promise<ServerStatus> {
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

/** Wait for a process to exit; signal it when asking was not enough. True once it is gone. */
async function awaitExit(pid: number): Promise<boolean> {
  const gone = async (ms: number): Promise<boolean> => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (!pidAlive(pid)) return true;
      await sleep(50);
    }
    return !pidAlive(pid);
  };
  if (await gone(STOP_WAIT_MS)) return true;
  for (const signal of ["SIGTERM", "SIGKILL"] as const) {
    try {
      process.kill(pid, signal);
    } catch {
      return true;
    }
    if (await gone(2_000)) return true;
  }
  return false;
}

/**
 * Connect to the project's warm server, spawning it detached when none listens.
 *
 * Only the client that takes the root's lock spawns; every other client waits
 * for the winner's socket. A server that answers with another code
 * fingerprint is asked to stop, and the client then starts a fresh one.
 */
export async function connectAdapter(rootGiven: string, options: ConnectOptions = {}): Promise<Connected> {
  const paths = serverPaths(rootGiven);
  const root = paths.root;
  const want = codeFingerprint();
  let spawns = 0;
  let deadline = Date.now() + SPAWN_WAIT_MS;
  let lastError: unknown;
  for (;;) {
    let socket: Socket | undefined;
    try {
      socket = await connectOnce(socketFor(paths));
    } catch (error) {
      lastError = error;
    }
    if (socket !== undefined) {
      const client = new LineClient(socket);
      let status: ServerStatus | undefined;
      try {
        status = await client.request<ServerStatus>("status");
      } catch (error) {
        // A server that closed on us is shutting down; the loop finds its successor.
        lastError = error;
        client.end();
      }
      if (status !== undefined) {
        if (status.fingerprint === want) return { adapter: new RemoteAdapter(client, status.language, status.ladder), server: spawns > 0 || !status.warm ? "cold" : "warm" };
        if (options.spawn === false) {
          client.end();
          throw new Error(`the warm server for ${root} (pid ${status.pid}) runs other code than this checkout; connect with spawning on to replace it`);
        }
        // Stale code: ask the server to go, and make sure it has before starting its replacement.
        try {
          await client.request("stop");
        } catch {
          // It went already.
        }
        client.end();
        if (!(await awaitExit(status.pid))) throw new Error(`the warm server for ${root} (pid ${status.pid}) runs other code and would not exit`);
        deadline = Date.now() + SPAWN_WAIT_MS;
        continue;
      }
    }
    if (options.spawn === false) throw new Error(`no warm server listening for ${root}; start one with: serve`);
    if (Date.now() > deadline) {
      throw new Error(`the warm server did not answer within ${SPAWN_WAIT_MS / 1000} s (${lastError instanceof Error ? lastError.message : String(lastError)})`);
    }
    // Only the client that takes the lock spawns; a dead or never-listening owner's lock is reclaimed first.
    if (spawns < SPAWN_ATTEMPTS && (tryLock(paths, process.pid) || (reclaim(paths, false) && tryLock(paths, process.pid)))) {
      const args = ["--disable-warning=ExperimentalWarning", CLI, "serve", "--root", root, ...(options.idleMs === undefined ? [] : ["--idle", String(Math.ceil(options.idleMs / 1000))])];
      const child = spawn(process.execPath, args, { cwd: root, detached: true, stdio: "ignore" });
      child.unref();
      if (child.pid !== undefined) handLock(paths, child.pid);
      else rmSync(paths.lock, { force: true });
      spawns += 1;
    }
    await sleep(50);
  }
}

interface ServerStatus {
  language: string;
  ladder: Ladder;
  warm: boolean;
  pid: number;
  startedAt: string;
  /** Absent on a server that predates the fingerprint: it counts as other code. */
  fingerprint?: string;
  root?: string;
}
