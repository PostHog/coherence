/**
 * The JSON-RPC client over a language server's stdio: a server that stops
 * reading is a server gone, never an uncaught error in the process that
 * talks to it.
 */

import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { JsonRpcClient } from "./jsonrpc.ts";

test("a write to a server that closed its input fails the client, never the process", async () => {
  const client = JsonRpcClient.spawn(process.execPath, ["-e", "require(\"node:fs\").closeSync(0); setInterval(() => {}, 1000);"], tmpdir());
  try {
    await new Promise((resolve) => setTimeout(resolve, 300));
    for (let i = 0; i < 5; i++) client.notify("exit", null);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await assert.rejects(client.request("shutdown", null, 1_000), /EPIPE|exited|write after end/);
    assert.equal(client.alive, false, "a broken pipe is a server gone");
  } finally {
    client.kill();
  }
});
