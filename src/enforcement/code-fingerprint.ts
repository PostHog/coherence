/**
 * The identity of the Coherence code on disk: a hash of every source file
 * under this installation's src (tests aside) and of package.json. The warm
 * server reports it so a client never talks to stale code, and every parse
 * Coherence keeps across hook calls is keyed by it, so a release that
 * changes a parser can never serve a parse the old one made.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CODE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_JSON = join(CODE_DIR, "..", "package.json");
const CODE_FILE = /\.(ts|mts|cts|js|mjs|cjs|json)$/;

/**
 * Mixed into the fingerprint when set: a test's way to make two processes
 * disagree about their code without editing it. Inherited by a spawned server.
 */
export const CODE_SALT_ENV = "COHERENCE_CODE_SALT";

function codeFiles(dir: string, into: string[]): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) codeFiles(path, into);
    else if (entry.isFile() && CODE_FILE.test(entry.name) && !entry.name.includes(".test.")) into.push(path);
  }
  return into;
}

function allCodeFiles(): string[] {
  const files = codeFiles(CODE_DIR, []).sort();
  if (existsSync(PACKAGE_JSON)) files.push(PACKAGE_JSON);
  return files;
}

function salted(hash: ReturnType<typeof createHash>): string {
  const salt = process.env[CODE_SALT_ENV];
  if (salt !== undefined && salt !== "") hash.update(`salt\0${salt}`);
  return hash.digest("hex").slice(0, 16);
}

/** The fingerprint, read from disk each time, so a client compares a running server with the code as it is now. */
export function codeFingerprint(): string {
  const hash = createHash("sha256");
  for (const file of allCodeFiles()) {
    hash.update(relative(CODE_DIR, file)).update("\0");
    try {
      hash.update(readFileSync(file));
    } catch {
      hash.update("<unreadable>");
    }
    hash.update("\0");
  }
  return salted(hash);
}

let held: string | undefined;

/**
 * The fingerprint as a hook can afford it: hashed again only when a code
 * file's device, inode, size, modification or change time moved since the
 * hash kept under `cacheDir` (a change time no tool can set back), and once
 * per process. Without a folder to keep it in, the full fingerprint.
 */
export function codeIdentity(cacheDir?: string): string {
  if (held !== undefined) return held;
  if (cacheDir === undefined) return (held = codeFingerprint());
  const stats = createHash("sha256");
  for (const file of allCodeFiles()) {
    try {
      const s = statSync(file);
      stats.update(`${file}\0${s.dev}\0${s.ino}\0${s.size}\0${s.mtimeMs}\0${s.ctimeMs}\0`);
    } catch {
      stats.update(`${file}\0gone\0`);
    }
  }
  const key = salted(stats);
  const path = join(cacheDir, "code-identity.json");
  try {
    const kept = JSON.parse(readFileSync(path, "utf8")) as { key?: unknown; fingerprint?: unknown };
    if (kept.key === key && typeof kept.fingerprint === "string") return (held = kept.fingerprint);
  } catch {
    // Missing or torn: hashed again below.
  }
  held = codeFingerprint();
  try {
    mkdirSync(cacheDir, { recursive: true });
    const aside = `${path}.${process.pid}.tmp`;
    writeFileSync(aside, JSON.stringify({ key, fingerprint: held }));
    renameSync(aside, path);
  } catch {
    // Without the kept hash the next call hashes again; nothing is lost but time.
  }
  return held;
}

/** Forget the identity held for this process: a test that changes the salt asks again. */
export function forgetCodeIdentity(): void {
  held = undefined;
}
