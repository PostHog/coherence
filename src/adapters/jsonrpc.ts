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

import { spawn, type ChildProcess } from "node:child_process";

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  method: string;
}

export class RpcError extends Error {
  readonly method: string;
  readonly code: number;
  constructor(method: string, code: number, message: string) {
    super(`${method}: ${message} (${code})`);
    this.method = method;
    this.code = code;
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
    child.on("exit", (code, signal) => {
      this.exited = new Error(`language server exited (${code ?? signal})`);
      for (const p of this.pending.values()) p.reject(this.exited);
      this.pending.clear();
    });
    child.on("error", (error) => {
      this.exited = error;
      for (const p of this.pending.values()) p.reject(error);
      this.pending.clear();
    });
  }

  static spawn(command: string, args: string[], cwd: string): JsonRpcClient {
    const child = spawn(command, args, { cwd, stdio: ["pipe", "pipe", "ignore"] });
    return new JsonRpcClient(child);
  }

  get alive(): boolean {
    return this.exited === undefined && this.child.exitCode === null;
  }

  request<T>(method: string, params: unknown, timeoutMs = 60_000): Promise<T> {
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
    const error = message["error"] as { code: number; message: string } | undefined;
    if (error !== undefined) pending.reject(new RpcError(pending.method, error.code, error.message));
    else pending.resolve(message["result"]);
  }
}
