/**
 * A JSON-RPC 2.0 client over a child process's stdio, framed the way the
 * language server protocol frames it: `Content-Length: N\r\n\r\n` then N
 * bytes of JSON. Requests carry an id and await a response; notifications
 * carry none. Server-to-client requests are answered by `onRequest` when an
 * adapter sets one (Pyright asks workspace/configuration) and with null
 * otherwise, so the server never waits on us; notifications from the
 * server reach `onNotification` (Pyright logs when its enumeration is done)
 * and are otherwise ignored.
 */

import { countWork, spawn, type ChildProcess } from "../lifecycle/work-meter.ts";

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  method: string;
}

/** The most of a server's words an error keeps: a stack in a form the frame filter misses (Python's, Go's) or a message with no frames still ends here. */
export const SERVER_WORDS_LIMIT = 500;

/**
 * A server's error message on one line: the Node stack frames it appends to
 * an internal error dropped, and the rest cut to SERVER_WORDS_LIMIT. A
 * message that is not a string (a server that sends none) is said as what
 * it is, never thrown on, since this runs inside the stdout listener.
 */
function serverWordsWithoutStack(message: unknown): string {
  const words = (typeof message === "string" ? message : String(message ?? "no message"))
    .split("\n")
    .filter((line) => !/^\s+at\s/.test(line))
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .join(" ");
  return words.length > SERVER_WORDS_LIMIT ? `${words.slice(0, SERVER_WORDS_LIMIT - 1)}…` : words;
}

export class RpcError extends Error {
  readonly method: string;
  readonly code: number;
  /** The server's words as this error says them (one line, capped): with method and code, all a thread needs to rebuild the same error. */
  readonly detail: string;
  constructor(method: string, code: number, message: unknown) {
    const words = serverWordsWithoutStack(message);
    super(`${method}: ${words} (${code})`);
    this.method = method;
    this.code = code;
    this.detail = words;
  }
}

export class JsonRpcClient {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private buffer = Buffer.alloc(0);
  private exited: Error | undefined;
  private readonly child: ChildProcess;
  /** Called for every notification the server sends (a progress report, a log line); nothing is awaited. */
  onNotification: ((method: string, params: unknown) => void) | undefined;
  /** Answers a request from the server by method, at once or later; undefined (or no handler) answers null so the server never waits. */
  onRequest: ((method: string, params: unknown) => unknown | Promise<unknown>) | undefined;

  constructor(child: ChildProcess) {
    this.child = child;
    child.stdout!.on("data", (chunk: Buffer) => this.receive(chunk));
    child.on("exit", (code, signal) => this.fail(new Error(`language server exited (${code ?? signal})`)));
    child.on("error", (error) => this.fail(error));
    child.stdin!.on("error", (error) => {
      this.fail(error);
      this.kill();
    });
  }

  private fail(error: Error): void {
    this.exited ??= error;
    for (const p of this.pending.values()) p.reject(error);
    this.pending.clear();
  }

  static spawn(command: string, args: string[], cwd: string, env?: Record<string, string>): JsonRpcClient {
    const child = spawn(command, args, { cwd, stdio: ["pipe", "pipe", "ignore"], ...(env === undefined ? {} : { env: { ...process.env, ...env } }) });
    return new JsonRpcClient(child);
  }

  /** The server process's id, for a reading that bounds its memory. */
  get pid(): number | undefined {
    return this.child.pid;
  }

  get alive(): boolean {
    return this.exited === undefined && this.child.exitCode === null;
  }

  request<T>(method: string, params: unknown, timeoutMs = 60_000): Promise<T> {
    countWork("server request");
    if (this.exited !== undefined) return Promise.reject(this.exited);
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method}: no answer in ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(id, {
        method,
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value as T);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: string, params: unknown): void {
    if (this.exited !== undefined) return;
    this.send({ jsonrpc: "2.0", method, params });
  }

  kill(): void {
    if (this.child.exitCode === null) this.child.kill();
  }

  private send(message: object): void {
    const body = Buffer.from(JSON.stringify(message), "utf8");
    const head = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii");
    this.child.stdin!.write(Buffer.concat([head, body]));
  }

  private receive(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const header = this.buffer.subarray(0, headerEnd).toString("ascii");
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (match === null) {
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      const start = headerEnd + 4;
      if (this.buffer.length < start + length) return;
      const body = this.buffer.subarray(start, start + length).toString("utf8");
      this.buffer = this.buffer.subarray(start + length);
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(body) as Record<string, unknown>;
      } catch {
        continue;
      }
      this.dispatch(message);
    }
  }

  private dispatch(message: Record<string, unknown>): void {
    const id = message["id"];
    const hasMethod = typeof message["method"] === "string";
    if (hasMethod) {
      const method = message["method"] as string;
      // A request from the server (workspace/configuration, window/workDoneProgress/create, ...): answer so it never waits.
      if (id !== undefined && id !== null) {
        let answer: unknown;
        try {
          answer = this.onRequest?.(method, message["params"]);
        } catch {
          answer = null;
        }
        Promise.resolve(answer)
          .catch(() => null)
          .then((result) => {
            if (this.exited === undefined) this.send({ jsonrpc: "2.0", id, result: result ?? null });
          });
        return;
      }
      try {
        this.onNotification?.(method, message["params"]);
      } catch {
        // A listener's failure must not break the framing loop.
      }
      return;
    }
    if (typeof id !== "number") return;
    const pending = this.pending.get(id);
    if (pending === undefined) return;
    this.pending.delete(id);
    // A server's error is read loosely (no message, no code, not even an object): a malformed one still rejects its request, never the process.
    const error = message["error"];
    if (error !== undefined && error !== null) {
      const { code, message: words } = typeof error === "object" ? (error as { code?: unknown; message?: unknown }) : { code: undefined, message: error };
      pending.reject(new RpcError(pending.method, typeof code === "number" ? code : -32603, words));
    }
    else pending.resolve(message["result"]);
  }
}
