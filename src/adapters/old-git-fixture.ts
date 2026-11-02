/**
 * A git older than 2.31: a shim placed first on this process's PATH that
 * hands each call to the real git, except that it does not know
 * --path-format. As those gits do, it prints that argument back on a line of
 * its own ahead of the answer and exits 0, the way rev-parse prints back any
 * option it does not know, so a caller that asked for absolute paths reads a
 * line that is no path and an answer that may be relative.
 */

import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

/** Put the old git first on the PATH; the function returned takes it off and removes it. */
export function oldGit(): () => void {
  const real = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
  if (real === "") throw new Error("no git on the PATH to age");
  const dir = mkdtempSync(join(tmpdir(), "coherence-old-git-"));
  const script = [
    `#!${process.execPath}`,
    `const { spawnSync } = require("node:child_process");`,
    `const args = process.argv.slice(2);`,
    `const unknown = args.filter((a) => a.startsWith("--path-format"));`,
    `const ran = spawnSync(${JSON.stringify(real)}, args.filter((a) => !unknown.includes(a)), { stdio: ["inherit", "pipe", "inherit"] });`,
    `if (ran.status === 0) for (const a of unknown) process.stdout.write(a + "\\n");`,
    `process.stdout.write(ran.stdout ?? "");`,
    `process.exit(ran.status ?? 1);`,
  ].join("\n");
  writeFileSync(join(dir, "git"), `${script}\n`);
  chmodSync(join(dir, "git"), 0o755);
  const path = process.env["PATH"];
  process.env["PATH"] = `${dir}${delimiter}${path ?? ""}`;
  return () => {
    process.env["PATH"] = path;
    rmSync(dir, { recursive: true, force: true });
  };
}
