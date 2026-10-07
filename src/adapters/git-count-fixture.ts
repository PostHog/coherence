/**
 * A git that counts: a shim placed first on this process's PATH logs each
 * invocation and hands it to the real git. A spawn is a spawn whatever the
 * machine's load, so a test can hold a path to a fixed number of them where a
 * timing would flake.
 */

import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

export interface CountingGit {
  /** The invocations since the last reset, one argument line each. */
  calls(): string[];
  reset(): void;
  /** Takes the shim off the PATH and removes it. */
  restore(): void;
}

export function countingGit(): CountingGit {
  const real = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
  if (real === "") throw new Error("no git on the PATH to count");
  const dir = mkdtempSync(join(tmpdir(), "coherence-git-count-"));
  const log = join(dir, "calls");
  writeFileSync(join(dir, "git"), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nexec '${real}' "$@"\n`);
  chmodSync(join(dir, "git"), 0o755);
  const path = process.env["PATH"];
  process.env["PATH"] = `${dir}${delimiter}${path ?? ""}`;
  return {
    calls: () => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter((line) => line !== "") : []),
    reset: () => rmSync(log, { force: true }),
    restore: () => {
      if (path === undefined) delete process.env["PATH"];
      else process.env["PATH"] = path;
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
