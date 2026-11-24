/**
 * Peers: the other repositories a project's invariants rely on across a
 * repository boundary. A service that spans repositories (an issuer in one,
 * the verifier that owns the token vectors in another) keeps each side a
 * project of its own, with its own lexicon, specs and journal; what crosses
 * between them is a file one side owns and the other side's check reads.
 *
 * The config names each peer once:
 *
 *   "peers": { "hoglake": { "repository": "PostHog/hoglake", "checkout": "../hoglake" } }
 *
 * `checkout` is a folder relative to the project root where a clone of the
 * peer lives (CI checks it out beside the project); `env` names the variable
 * the project's tests read the checkout's absolute path from, by default
 * <NAME>_CHECKOUT. A bullet names what its check reads from a peer, one
 * `peer: <name> <path>` line per file, and the run hands every test the
 * variable, runs the check only when each named file is there, and records
 * the peer's commit and the file's blob beside the verdict: a cross-repository
 * verdict says which version of the other side it was read against, and a
 * missing checkout reads not run with how to get it, never pass.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, join, resolve } from "node:path";
import { spawnSync } from "../lifecycle/work-meter.ts";
import { CONFIG_NAME, CONFIG_NAME_FORM } from "./config-name.ts";

export interface Peer {
  /** The name a bullet's peer: line uses. */
  name: string;
  /** The peer's repository, owner/name, for the reason a missing checkout gives. */
  repository: string;
  /** The checkout as the config writes it, relative to the project root. */
  checkout: string;
  /** The checkout's absolute path. */
  root: string;
  /** The variable every test command is given the checkout's absolute path in. */
  env: string;
}

/** A peer file a bullet names: `peer: <name> <path>`. */
export interface PeerFile {
  peer: string;
  path: string;
  line: number;
}

/** What a run read of one peer file: the commit the checkout stood at, whether its tree was dirty, and the file's git blob id. */
export interface PeerReading {
  peer: string;
  path: string;
  repository: string;
  commit: string | undefined;
  dirty: boolean;
  blob: string;
}

const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const ENV = /^[A-Z_][A-Z0-9_]*$/;

/** The variable a peer's checkout is handed in when the config names none: hoglake's is HOGLAKE_CHECKOUT. */
export function defaultPeerEnv(name: string): string {
  return `${name.toUpperCase().replace(/-/g, "_")}_CHECKOUT`;
}

/** The config's peers key, read; a value no form reads is refused with the config's path. */
export function readPeers(root: string, value: unknown, path: string): Peer[] {
  if (value === undefined) return [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${path}: peers maps each peer's name to { "repository": "<owner/name>", "checkout": "<folder relative to the root>" }`);
  const peers: Peer[] = [];
  const envs = new Map<string, string>();
  for (const [name, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!CONFIG_NAME.test(name)) throw new Error(`${path}: peers.${name}: a peer's name is ${CONFIG_NAME_FORM}`);
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error(`${path}: peers.${name} is { "repository": "<owner/name>", "checkout": "<folder relative to the root>" }`);
    const record = raw as Record<string, unknown>;
    const repository = record["repository"];
    if (typeof repository !== "string" || !REPOSITORY.test(repository)) throw new Error(`${path}: peers.${name}.repository is <owner>/<name>, as GitHub writes it`);
    const checkout = record["checkout"];
    if (typeof checkout !== "string" || checkout === "" || isAbsolute(checkout)) throw new Error(`${path}: peers.${name}.checkout is a folder relative to the project root, where a clone of ${repository} lives`);
    const env = record["env"] ?? defaultPeerEnv(name);
    if (typeof env !== "string" || !ENV.test(env)) throw new Error(`${path}: peers.${name}.env names an environment variable, upper case letters, digits and underscores`);
    const unknown = Object.keys(record).filter((key) => key !== "repository" && key !== "checkout" && key !== "env");
    if (unknown.length > 0) throw new Error(`${path}: peers.${name} carries repository, checkout and env; ${unknown.join(", ")} is none of them`);
    const other = envs.get(env);
    if (other !== undefined) throw new Error(`${path}: peers ${other} and ${name} both hand their checkout in ${env}; name one env apart`);
    envs.set(env, name);
    peers.push({ name, repository, checkout, root: resolve(root, checkout), env });
  }
  return peers;
}

/** A peer: line's value, `<name> <path>`: the peer's name, as the config keys it, then the path. */
const PEER_FILE = new RegExp(`^(${CONFIG_NAME.source.slice(1, -1)})\\s+(\\S.*)$`);

/** A peer: line's value, `<name> <path>`, or undefined when it is not that. */
export function parsePeerFile(value: string): { peer: string; path: string } | undefined {
  const match = PEER_FILE.exec(value.trim());
  if (match === null) return undefined;
  const path = match[2]!.trim();
  if (isAbsolute(path) || path.split("/").includes("..")) return undefined;
  return { peer: match[1]!, path };
}

/** Every test command's peer variables: each checkout's absolute path under its env name. */
export function peerEnvironment(peers: readonly Peer[]): Record<string, string> {
  return Object.fromEntries(peers.map((peer) => [peer.env, peer.root]));
}

function git(cwd: string, args: string[]): string | undefined {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return result.status === 0 ? String(result.stdout).trim() : undefined;
}

/** The blob id git gives a file's bytes, so a reading names the version of the file it read whether or not the checkout committed it. */
function blobOf(bytes: Buffer): string {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

/**
 * Read the peer files a bullet names: each reading, or the reason the check
 * cannot run here (a peer the config does not name, a checkout that is not
 * there, a file the checkout does not hold). A reason is a not run, never a
 * pass: the other side was not read.
 */
export function readPeerFiles(peers: readonly Peer[], files: readonly PeerFile[]): { readings: PeerReading[] } | { reason: string } {
  const readings: PeerReading[] = [];
  for (const file of files) {
    const peer = peers.find((p) => p.name === file.peer);
    if (peer === undefined) return { reason: `it reads ${file.path} from peer ${file.peer}, which the config's peers do not name` };
    if (!existsSync(peer.root) || !statSync(peer.root).isDirectory()) {
      return { reason: `it reads ${file.path} from ${peer.repository}, and no checkout is at ${peer.checkout}: clone it there (git clone https://github.com/${peer.repository} ${peer.checkout}), as CI does` };
    }
    const at = join(peer.root, file.path);
    if (!existsSync(at) || !statSync(at).isFile()) return { reason: `it reads ${file.path} from ${peer.repository}, and the checkout at ${peer.checkout} holds no such file` };
    const commit = git(peer.root, ["rev-parse", "HEAD"]);
    const status = git(peer.root, ["status", "--porcelain", "--", file.path]);
    readings.push({ peer: peer.name, path: file.path, repository: peer.repository, commit, dirty: status !== undefined && status !== "", blob: blobOf(readFileSync(at)) });
  }
  return { readings };
}

/** How a run says what it read of a peer: `PostHog/hoglake server/x.json at 3a6d9eb` (and `, changed in the checkout` when dirty). */
export function peerReadingText(reading: PeerReading): string {
  const at = reading.commit === undefined ? "in a checkout git does not read" : `at ${reading.commit.slice(0, 7)}`;
  return `${reading.repository} ${reading.path} ${at}${reading.dirty ? ", changed in the checkout" : ""}`;
}
