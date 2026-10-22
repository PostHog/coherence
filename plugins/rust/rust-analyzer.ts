/**
 * Where rust-analyzer is: a binary found on the machine, since it is no npm
 * package, so the package resolver (installed.ts) cannot find it.
 */

import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import type { ServerLocation } from "../../src/adapters/installed.ts";
import { spawnSync } from "../../src/lifecycle/work-meter.ts";

/** The first line a failed program printed, for a looked string. */
function firstLine(run: { stderr?: string | null; stdout?: string | null; error?: Error | undefined; status: number | null }): string {
  if (run.error !== undefined) return run.error.message;
  return `${run.stderr ?? ""}${run.stdout ?? ""}`.trim().split("\n")[0] || `exit ${run.status}`;
}

/**
 * rust-analyzer's binary, which is no npm package and so is found on the
 * machine, the way tach is: COHERENCE_RUST_ANALYZER when it names a file;
 * else `rustup which rust-analyzer` run from the project root, so its
 * rust-toolchain.toml is honoured; else the first rust-analyzer on PATH that
 * answers `--version`, since rustup's proxy at ~/.cargo/bin exists without
 * the component and fails only when run. Absent, every place looked is named.
 */
export function locateRustAnalyzer(root: string, bin = "rust-analyzer", env: NodeJS.ProcessEnv = process.env): ServerLocation {
  const looked: string[] = [];
  const explicit = env["COHERENCE_RUST_ANALYZER"];
  if (explicit !== undefined && explicit !== "") {
    if (existsSync(explicit)) return { found: true, command: explicit, args: [], path: explicit, looked: [...looked, `COHERENCE_RUST_ANALYZER (${explicit})`] };
    looked.push(`COHERENCE_RUST_ANALYZER (${explicit}): no such file`);
  } else looked.push("COHERENCE_RUST_ANALYZER: unset");
  const dirs = (env["PATH"] ?? "").split(delimiter).filter((dir) => dir !== "");
  const childEnv = { ...process.env, ...env };
  const rustup = dirs.map((dir) => join(dir, "rustup")).find((candidate) => existsSync(candidate));
  if (rustup === undefined) looked.push(`rustup which ${bin}: no rustup on PATH`);
  else {
    const which = spawnSync(rustup, ["which", bin], { cwd: root, encoding: "utf8", env: childEnv, timeout: 30_000 });
    const path = which.status === 0 ? which.stdout.trim() : "";
    if (path !== "" && existsSync(path)) return { found: true, command: path, args: [], path, looked: [...looked, `rustup which ${bin} (${path})`] };
    looked.push(`rustup which ${bin}: ${firstLine(which)}`);
  }
  let onPath = false;
  for (const dir of dirs) {
    const candidate = join(dir, bin);
    if (!existsSync(candidate)) continue;
    onPath = true;
    const probe = spawnSync(candidate, ["--version"], { cwd: root, encoding: "utf8", env: childEnv, timeout: 30_000 });
    if (probe.status === 0) return { found: true, command: candidate, args: [], path: candidate, looked: [...looked, `${bin} on PATH (${candidate})`] };
    const said = firstLine(probe);
    looked.push(`${bin} on PATH (${candidate}): ${/unknown binary/i.test(said) ? `a rustup proxy without the ${bin} component (${said})` : said}`);
  }
  if (!onPath) looked.push(`${bin} on PATH: none`);
  return { found: false, looked };
}
