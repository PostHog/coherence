/**
 * Stops the warm servers a test started for a fixture project. A hook or a
 * run in a test reaches the instrument through the warm server, which starts
 * detached and outlives the test; it ends on its own only once its root is
 * gone and its next check notices, after the test has finished. A test that
 * starts one stops it before removing the root.
 */

import { execFileSync } from "node:child_process";
import { realpathSync, rmSync } from "node:fs";
import { serverPaths } from "./server.ts";

const WAIT_MS = 10_000;

/** Every `serve` process whose root is `real` or a folder inside it, whatever its language, with that root. */
function servers(real: string): { pid: number; root: string }[] {
  const table = execFileSync("ps", ["-axww", "-o", "pid=,command="], { encoding: "utf8" });
  const found: { pid: number; root: string }[] = [];
  for (const line of table.split("\n")) {
    const match = /^\s*(\d+)\s+.*cli\.ts serve .*--root (\S+)/.exec(line);
    if (match === null) continue;
    const root = match[2]!;
    if (root === real || root.startsWith(`${real}/`)) found.push({ pid: Number(match[1]), root });
  }
  return found;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Ask every warm server for `root`, or for a project inside it, to stop (SIGTERM, its clean shutdown), wait for each, and kill one that will not go. */
export async function stopWarmServers(root: string): Promise<void> {
  let real: string;
  try {
    real = realpathSync(root);
  } catch {
    return;
  }
  const found = servers(real);
  // Taken while each root still exists: a socket too long for its root lives in the temp folder.
  const sockets = [...new Set([serverPaths(real).socket, ...found.map((s) => serverPaths(s.root).socket)])];
  for (const { pid } of found) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  }
  const deadline = Date.now() + WAIT_MS;
  while (found.some((s) => alive(s.pid)) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  for (const { pid } of found.filter((s) => alive(s.pid))) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Gone between the check and the signal.
    }
  }
  // A killed server never unlinked its socket.
  for (const socket of sockets) rmSync(socket, { force: true });
}
