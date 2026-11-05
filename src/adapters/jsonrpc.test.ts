/**
 * The JSON-RPC client over a language server's stdio: a server that stops
 * reading is a server gone, never an uncaught error in the process that
 * talks to it.
 */

import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { JsonRpcClient, RpcError, SERVER_WORDS_LIMIT } from "./jsonrpc.ts";

test("a write to a server that closed its input fails the client and ends the server, never the process", async () => {
  const client = JsonRpcClient.spawn(process.execPath, ["-e", "require(\"node:fs\").closeSync(0); setInterval(() => {}, 1000);"], tmpdir());
  try {
    await new Promise((resolve) => setTimeout(resolve, 300));
    for (let i = 0; i < 5; i++) client.notify("exit", null);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await assert.rejects(client.request("shutdown", null, 1_000), /EPIPE|exited|write after end/);
    assert.equal(client.alive, false, "a broken pipe is a server gone");
    const pid = client.pid!;
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.throws(() => process.kill(pid, 0), /ESRCH/, "the server whose input broke is ended, since no caller will kill a client that is not alive");
  } finally {
    client.kill();
  }
});

/** A server that answers each request with the error its method names, framed as a language server frames it. */
const FAILING_SERVER = `
let buffer = Buffer.alloc(0);
const answers = {
  stack: { error: { code: -32603, message: "<main> TypeScript Server Error (5.9.3)\\nMaximum call stack size exceeded\\nRangeError: Maximum call stack size exceeded\\n    at trackExistingEntityName (/host/node_modules/typescript/lib/typescript.js:94992:14)\\n    at isSymbolAccessible (/host/node_modules/typescript/lib/typescript.js:57448:23)" } },
  wordless: { error: { code: -32603 } },
  long: { error: { code: -32603, message: "x".repeat(40000) } },
  bare: { error: "the server said only this" },
  answered: { error: null, result: 7 },
};
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const end = buffer.indexOf("\\r\\n\\r\\n");
    if (end < 0) return;
    const length = Number(/Content-Length: (\\d+)/i.exec(buffer.subarray(0, end).toString())[1]);
    if (buffer.length < end + 4 + length) return;
    const request = JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString());
    buffer = buffer.subarray(end + 4 + length);
    const body = JSON.stringify({ jsonrpc: "2.0", id: request.id, ...answers[request.method] });
    process.stdout.write("Content-Length: " + Buffer.byteLength(body) + "\\r\\n\\r\\n" + body);
  }
});
`;

test("a server's error rejects its request with the server's words on one line, never its stack, and a malformed error never reaches the process", async () => {
  const client = JsonRpcClient.spawn(process.execPath, ["-e", FAILING_SERVER], tmpdir());
  try {
    await assert.rejects(client.request("stack", null, 5_000), (error: unknown) => {
      assert.ok(error instanceof RpcError);
      assert.equal(error.message, "stack: <main> TypeScript Server Error (5.9.3) Maximum call stack size exceeded RangeError: Maximum call stack size exceeded (-32603)", "the server's words, never its stack");
      return true;
    });
    await assert.rejects(client.request("wordless", null, 5_000), /wordless: no message \(-32603\)/, "an error with no message rejects its request");
    await assert.rejects(client.request("long", null, 5_000), (error: unknown) => {
      assert.ok(error instanceof RpcError);
      assert.ok(error.message.length <= SERVER_WORDS_LIMIT + "long:  (-32603)".length, `the words are cut to ${SERVER_WORDS_LIMIT}, got ${error.message.length}`);
      assert.match(error.message, /^long: x+… \(-32603\)$/);
      return true;
    });
    await assert.rejects(client.request("bare", null, 5_000), /bare: the server said only this \(-32603\)/, "an error that is only words is still an error");
    assert.equal(await client.request("answered", null, 5_000), 7, "a null error beside a result is an answer");
    assert.equal(client.alive, true, "no malformed error broke the client");
  } finally {
    client.kill();
  }
});
