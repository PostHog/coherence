#!/usr/bin/env node
/**
 * The status line command: `coherence-statusline [-- <another status line command>]`.
 * Claude Code passes the session's JSON on stdin; this prints Coherence's
 * line. Given another command after `--`, the one a user already had, it
 * runs that with the same stdin and prints its lines first, so installing
 * Coherence's line never takes the user's away. Its own entry, not a verb of
 * the CLI, so a render loads one small module and not every one the CLI
 * holds.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { readStatus, statusText, type StatusInput } from "./lifecycle/statusline.ts";

const args = process.argv.slice(2);
const then = args[0] === "--" ? args.slice(1).join(" ") : "";
let stdin = "";
try {
  stdin = readFileSync(0, "utf8");
} catch {
  // No input: nothing to read the session from, and nothing to pass on.
}

if (then !== "") {
  // The user's own line, as their shell would run it, given the same session.
  const theirs = spawnSync(then, { shell: true, input: stdin, encoding: "utf8", timeout: 5000 });
  const out = (theirs.stdout ?? "").replace(/\n+$/, "");
  if (out !== "") process.stdout.write(`${out}\n`);
}

let input: StatusInput = {};
try {
  input = JSON.parse(stdin) as StatusInput;
} catch {
  // A status line that cannot read its session prints nothing of Coherence's.
}
const line = statusText(readStatus(input), process.env["NO_COLOR"] === undefined);
if (line !== "") process.stdout.write(`${line}\n`);
