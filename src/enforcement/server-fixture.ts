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

/** The pids of every `serve` process for this root, whatever its language. */
function servePids(real: string): number[] {
  const marker = `--root ${real}`;
  const table = execFileSync("ps", ["-axww", "-o", "pid=,command="], { encoding: "utf8" });
  return table
    .split("\n")
    .filter((line) => line.includes("cli.ts serve") && (line.endsWith(marker) || line.includes(`${marker} `)))
    .map((line) => Number(line.trim().split(/\s+/)[0]));
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Ask every warm server for the root to stop (SIGTERM, its clean shutdown), wait for each, and kill one that will not go. */
export async function stopWarmServers(root: string): Promise<void> {
  let real: string;
  try {
    real = realpathSync(root);
  } catch {
    return;
  }
  const socket = serverPaths(root).socket;
  const pids = servePids(real);
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  }
  const deadline = Date.now() + WAIT_MS;
  while (pids.some(alive) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  for (const pid of pids.filter(alive)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Gone between the check and the signal.
    }
  }
  // A killed server never unlinked its socket, which may live outside the root.
  rmSync(socket, { force: true });
}
