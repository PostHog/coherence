/**
 * A JSON-RPC 2.0 client over a child process's stdio, framed the way the
 * language server protocol frames it: `Content-Length: N\r\n\r\n` then N
 * bytes of JSON. Requests carry an id and await a response; notifications
 * carry none. Server-to-client requests are answered with null so the
 * server never waits on us; notifications from the server are ignored.
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
      // A request from the server (window/workDoneProgress/create, client/registerCapability, ...): answer so it never waits.
      if (id !== undefined && id !== null) this.send({ jsonrpc: "2.0", id, result: null });
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
