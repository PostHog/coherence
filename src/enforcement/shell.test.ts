/**
 * A string test command runs under /bin/sh. The billing adoption's command
 * sourced .env with a fallback (`. ./.env || . ./.env.template`); with no
 * .env, sh exits on the failed `.` before the `||` is read, the runner never
 * starts, and every test read "not run" with nothing saying why
 * (PostHog/billing#2703). The reason now says the shell ran it and what it
 * printed first.
 */

import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { readEnforcementConfig } from "./config.ts";
import { runTotalityBatch } from "./totality.ts";

const made: string[] = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

test("a string test command that exits before its runner says it ran under /bin/sh and what it printed first", { skip: process.platform === "win32" }, async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "coherence-shell-")));
  made.push(root);
  writeFileSync(join(root, ".env.template"), "TOKEN=template\n");
  const runner = `node -e "require('node:fs').writeFileSync(process.argv[1], '<testsuites/>')" {out} {filter}`;
  writeFileSync(join(root, "coherence.config.json"), JSON.stringify({ language: "python", testFilterForm: "pytest", test: "true {filter}", testJson: `. ./.env || . ./.env.template; ${runner}` }));
  const batch = await runTotalityBatch(root, readEnforcementConfig(root), ["a forged webhook is refused"]);
  assert.ok(batch !== undefined);
  const result = batch.get("a forged webhook is refused")!;
  assert.equal(result.verdict, "not run");
  assert.match(result.reason, /wrote no report at \{out\}; the command ran under \/bin\/sh, not your login shell, and the first line it printed was: .*\.env/, result.reason);

  // A command that checks before it sources reaches its runner, and the reason never mentions the shell.
  writeFileSync(join(root, "coherence.config.json"), JSON.stringify({ language: "python", testFilterForm: "pytest", test: "true {filter}", testJson: `if [ -f ./.env ]; then . ./.env; else . ./.env.template; fi; ${runner}` }));
  const fixed = (await runTotalityBatch(root, readEnforcementConfig(root), ["a forged webhook is refused"]))!.get("a forged webhook is refused")!;
  assert.doesNotMatch(fixed.reason, /\/bin\/sh/, fixed.reason);
});
