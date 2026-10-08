/**
 * The pnpm adopter test over the network: `npm run test:pnpm`. It packs this
 * checkout, installs it with pnpm into a project on TypeScript 7, and runs a
 * chokepoint the way an adopter does. Under pnpm, Coherence's own
 * dependencies sit beside its package in the store rather than inside it, and
 * TypeScript 7 ships no tsserver, so a language server or tsserver located
 * by a path built by hand names nothing and the TypeScript instrument cannot
 * start; every reading that needs it fails (an adopter on 1.5.2 reported it).
 *
 * It needs the npm registry and pnpm, so `npm test` leaves it out; the Upgrade
 * workflow (.github/workflows/upgrade.yml) runs it with pnpm pinned. The
 * offline half, the resolution order over fake pnpm and npm layouts, is
 * installed.test.ts.
 *
 *   COHERENCE_PNPM_KEEP  set to keep the fixture folder for inspection
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const CHECKOUT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TYPESCRIPT_7 = "typescript@7.0.2";

interface Ran {
  label: string;
  code: number;
  stdout: string;
  stderr: string;
}

function sh(label: string, command: string, args: string[], cwd: string, input?: string): Ran {
  const inherited = { ...process.env };
  delete inherited["NODE_TEST_CONTEXT"];
  delete inherited["COHERENCE_HOME"];
  const result = spawnSync(command, args, { cwd, input, encoding: "utf8", env: { ...inherited, COHERENCE_NO_WARM_UP: "1", COHERENCE_TELEMETRY: "0" }, maxBuffer: 64 * 1024 * 1024, timeout: 600_000 });
  return { label, code: result.status ?? (result.error ? 127 : 1), stdout: result.stdout ?? "", stderr: (result.stderr ?? "") + (result.error ? `\n${result.error.message}` : "") };
}

function shown(ran: Ran): string {
  return `$ ${ran.label}\n  exit ${ran.code}\n  stdout:\n${ran.stdout.trimEnd()}\n  stderr:\n${ran.stderr.trimEnd()}`;
}

function write(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

/** This checkout, built and packed as npm publishes it. */
function tarball(scratch: string): string {
  const out = join(scratch, "pack");
  mkdirSync(out, { recursive: true });
  const built = sh("npm run build", "npm", ["run", "build"], CHECKOUT);
  assert.equal(built.code, 0, shown(built));
  const packed = sh("npm pack", "npm", ["pack", CHECKOUT, "--ignore-scripts", "--pack-destination", out, "--json"], CHECKOUT);
  assert.equal(packed.code, 0, shown(packed));
  const tarballs = readdirSync(out).filter((f) => f.endsWith(".tgz"));
  assert.equal(tarballs.length, 1, shown(packed));
  return join(out, tarballs[0]!);
}

const SPEC = `# Vault

The fixture's one component.

## invariants

- sealed reads: Every read of SECRET goes through reveal.
  protects: SECRET in vault.ts
  chokepoint: reveal
  over: every read of SECRET
  because: a read outside reveal would show the secret unsealed
  kinds: none
`;

test("a pnpm project on TypeScript 7 starts the TypeScript instrument and grades a chokepoint, told once that Coherence reads with its own TypeScript", { timeout: 1_200_000 }, () => {
  const pnpm = sh("pnpm --version", "pnpm", ["--version"], CHECKOUT);
  assert.equal(pnpm.code, 0, `pnpm is not installed; this test needs it (the Upgrade workflow installs it pinned)\n${shown(pnpm)}`);
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "coherence-pnpm-")));
  const root = join(scratch, "vault");
  try {
    const packed = tarball(scratch);
    write(root, "package.json", JSON.stringify({ name: "vault", private: true, type: "module" }, null, 2));
    write(root, "tsconfig.json", JSON.stringify({ compilerOptions: { strict: true, module: "nodenext", noEmit: true }, include: ["src"] }));
    write(root, "coherence.config.json", JSON.stringify({ name: "vault", language: "typescript" }));
    write(root, "src/vault/Vault.spec.md", SPEC);
    write(root, "src/vault/vault.ts", "const SECRET = 42;\nexport function reveal(): number {\n  return SECRET;\n}\n");
    write(root, "src/vault/page.ts", 'import { reveal } from "./vault.ts";\nexport const shown = reveal();\n');
    assert.equal(sh("git init", "git", ["init", "-q"], root).code, 0);
    const installed = sh(`pnpm add -D ${packed} ${TYPESCRIPT_7}`, "pnpm", ["add", "--save-dev", "--save-exact", packed, TYPESCRIPT_7], root);
    assert.equal(installed.code, 0, shown(installed));

    const cli = join(root, "node_modules", "@posthog", "coherence", "dist", "cli.js");
    const run = sh("coherence run --form chokepoint", process.execPath, [cli, "run", "--form", "chokepoint", "--no-server", "--session", "pnpm-e2e", "--agent", "pnpm-e2e"], root);
    assert.doesNotMatch(run.stdout + run.stderr, /failed to initialize|not found; looked|Could not find a valid TypeScript/, shown(run));
    assert.match(run.stdout, /chokepoint reveal protects SECRET in vault\.ts: visibility-choked \(enforced by the compiler\) — pass/, shown(run));
    assert.equal(run.code, 0, shown(run));

    const start = sh("hook SessionStart", process.execPath, [cli, "hook", "SessionStart"], root, JSON.stringify({ session_id: "pnpm-e2e", hook_event_name: "SessionStart", source: "startup", cwd: root }));
    assert.equal(start.code, 0, shown(start));
    const said = start.stdout.match(/TypeScript: this project's TypeScript 7\.0\.2 ships no tsserver, so Coherence is using its own TypeScript \d+\.\d+\.\d+ for readings/g) ?? [];
    assert.equal(said.length, 1, `orient names Coherence's own TypeScript exactly once\n${shown(start)}`);
  } finally {
    if (process.env["COHERENCE_PNPM_KEEP"] === undefined) rmSync(scratch, { recursive: true, force: true });
    else process.stderr.write(`kept ${scratch}\n`);
  }
});
