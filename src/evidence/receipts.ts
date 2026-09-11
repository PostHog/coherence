// Immutable local execution evidence. Hashes detect changed addressed bytes; they do
// not authenticate a local executor or prove the relevance/adequacy of its assertions.
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { closeSync, constants, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "../types.ts";
import { readWork } from "../coordination/work.ts";

const BASE = ".coherence/verification";
const HASH = /^[a-f0-9]{64}$/;
const RUN = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
// These are declared outputs/coordination, not arbitrary .coherence evidence. Tests
// consuming them, ignored files, environment, services or external dependencies need
// additional evidence; this grade does not capture those inputs.
export const RECEIPT_EXCLUSIONS = [BASE + "/", ".coherence/work/", ".coherence/consequences/", ".coherence/status.json", ".coherence/status-<uuid>.tmp", ".coherence/status.lock/", ".coherence/verify-jobs.json", ".coherence/narrative.json"];
export interface InputFile { path: string; sha256: string; executable: boolean }
export interface InputManifest { version: 1; grade: "git-visible-worktree-v1"; exclusions: string[]; files: InputFile[] }
export interface ReceiptStart {
  version: 1; run: string; at: string; session: string | null; agent: string | null;
  commit: string | null; index: string; inputs: string; configuration: string;
  executor: { node: string; implementation: string; trust: "local-unattested" };
  invocation: { fast: boolean; scope: string[] | null; imported: boolean; serial: boolean };
  work: { work: string; definition: string; criteria: string[] } | null;
}
export interface ReceiptObservation { node: string; claim: string; kind: "pass" | "fail" | "skip"; executed: boolean }
export interface VerificationReceipt {
  version: 1; run: string; start: string; ended: string; inputsAfter: string; indexAfter: string; executorAfter: string;
  outcome: "completed" | "error"; exitCode: number; failures: number; pending: number; onramp: boolean;
  observations: ReceiptObservation[];
}
interface Terminal { version: 1; run: string; receipt: string }
export interface ReceiptRead { id: string; receipt: VerificationReceipt; start: ReceiptStart; inputs: InputManifest; problems: string[]; files: string[] }
export class ReceiptError extends Error { constructor(message: string) { super(`verification receipt refused: ${message}`); this.name = "ReceiptError"; } }
function fail(message: string): never { throw new ReceiptError(message); }
export function receiptCanonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(receiptCanonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${receiptCanonical((value as Record<string, unknown>)[k])}`).join(",")}}`;
  return fail("non-JSON evidence");
}
export const receiptHash = (value: unknown): string => createHash("sha256").update(receiptCanonical(value) + "\n").digest("hex");
const bytesHash = (value: Buffer | string): string => createHash("sha256").update(value).digest("hex");
function safePath(root: string, path: string, create = false): string {
  if (!path || path.startsWith("/") || path.includes("\\") || path.split("/").some(p => !p || p === "." || p === "..")) fail("unsafe path");
  let current = resolve(root);
  for (const part of path.split("/").slice(0, -1)) {
    current = join(current, part);
    if (create) { try { mkdirSync(current); syncDir(dirname(current)); } catch (e: any) { if (e.code !== "EEXIST") throw e; } }
    const st = lstatSync(current);
    if (st.isSymbolicLink() || !st.isDirectory()) fail(`redirected/non-directory evidence: ${path}`);
  }
  return join(root, path);
}
function readBytes(root: string, path: string): Buffer {
  const target = safePath(root, path);
  const before = lstatSync(target);
  if (!before.isFile() || before.isSymbolicLink()) fail(`non-regular evidence: ${path}`);
  const fd = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const actual = fstatSync(fd);
    if (actual.ino !== before.ino || actual.dev !== before.dev) fail(`evidence changed while opening: ${path}`);
    return readFileSync(fd);
  } finally { closeSync(fd); }
}
function syncDir(path: string): void { const fd = openSync(path, constants.O_RDONLY); try { fsyncSync(fd); } finally { closeSync(fd); } }
function publish(root: string, path: string, value: unknown): void {
  const target = safePath(root, path, true), bytes = Buffer.from(receiptCanonical(value) + "\n");
  const temp = join(dirname(target), `.pending-${randomUUID()}`);
  const fd = openSync(temp, "wx", 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
  try {
    try { linkSync(temp, target); }
    catch (e: any) {
      if (e.code !== "EEXIST") throw e;
      if (!readBytes(root, path).equals(bytes)) fail(`conflicting publication: ${path}`);
    }
    syncDir(dirname(target));
  } finally { unlinkSync(temp); syncDir(dirname(target)); }
}
function readObject(root: string, path: string, hash?: string): any {
  const bytes = readBytes(root, path);
  let value: unknown;
  try { value = JSON.parse(bytes.toString("utf8")); } catch { return fail(`malformed JSON: ${path}`); }
  if (!bytes.equals(Buffer.from(receiptCanonical(value) + "\n"))) fail(`noncanonical/torn evidence: ${path}`);
  if (hash && bytesHash(bytes) !== hash) fail(`digest mismatch: ${path}`);
  return value;
}
function git(root: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0 || result.error) return fail(`Git could not capture inputs (${args[0]})`);
  return result.stdout;
}
function excluded(path: string): boolean {
  if (/^\.coherence\/status-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.tmp$/.test(path)) return true;
  return RECEIPT_EXCLUSIONS.some(p => p.endsWith("/") ? path.startsWith(p) : path === p); }
/** Capture the declared Git-visible working bytes, independently of the graph walker.
 * The index is separate run provenance; committing unchanged bytes does not stale them. */
export function captureReceiptInputs(cfg: Config): { manifest: InputManifest; index: string; commit: string | null } {
  if (realpathSync(git(cfg.root, ["rev-parse", "--show-toplevel"]).trim()) !== realpathSync(cfg.root)) fail("receipt mode requires the repository root");
  const paths = [...new Set(git(cfg.root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]).split("\0").filter(Boolean))].filter(p => !excluded(p)).sort();
  const files: InputFile[] = [];
  for (const path of paths) {
    try {
      const bytes = readBytes(cfg.root, path);
      files.push({ path, sha256: bytesHash(bytes), executable: !!(lstatSync(join(cfg.root, path)).mode & 0o111) });
    } catch (e: any) { if (e.code !== "ENOENT") throw e; /* tracked deletions are absent working bytes */ }
  }
  const index = bytesHash(git(cfg.root, ["ls-files", "--stage", "-z"]).split("\0").filter(row => {
    const tab = row.indexOf("\t"); return tab >= 0 && !excluded(row.slice(tab + 1));
  }).join("\0"));
  const commit = spawnSync("git", ["rev-parse", "--verify", "HEAD"], { cwd: cfg.root, encoding: "utf8" });
  return { manifest: { version: 1, grade: "git-visible-worktree-v1", exclusions: RECEIPT_EXCLUSIONS, files }, index, commit: commit.status === 0 ? commit.stdout.trim() : null };
}
function implementationHash(): string {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const files: Array<[string, string]> = [];
  function walk(dir: string): void {
    for (const item of readdirSync(dir, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
      const path = join(dir, item.name);
      if (item.isDirectory()) walk(path);
      else if (/\.(ts|js|json|wasm)$/.test(item.name)) files.push([relative(root, path), bytesHash(readFileSync(path))]);
    }
  }
  walk(root);
  walk(join(dirname(root), "grammars"));
  files.push(["../package.json", bytesHash(readFileSync(join(dirname(root), "package.json")))]);
  return receiptHash(files);
}
export function beginReceipt(cfg: Config, opts: { fast?: boolean; only?: Set<string>; fromReport?: string; serial?: boolean; session?: string; agent?: string; work?: string }): ReceiptStart {
  const sampled = captureReceiptInputs(cfg);
  const opened = opts.work ? readWork(cfg).works.find(w => w.work === opts.work)?.opened : null;
  if (opts.work && !opened) fail(`unknown work ${opts.work}`);
  const configuration = { ...cfg, root: "." };
  const start: ReceiptStart = {
    version: 1, run: randomUUID(), at: new Date().toISOString(), session: opts.session ?? null, agent: opts.agent ?? null,
    commit: sampled.commit, index: sampled.index, inputs: receiptHash(sampled.manifest), configuration: receiptHash(JSON.parse(JSON.stringify(configuration))),
    executor: { node: process.version, implementation: implementationHash(), trust: "local-unattested" },
    invocation: { fast: !!opts.fast, scope: opts.only ? [...opts.only].sort() : null, imported: !!opts.fromReport, serial: !!opts.serial },
    work: opened ? { work: opened.work, definition: opened.id, criteria: opened.criteria } : null,
  };
  publish(cfg.root, `${BASE}/artifacts/${start.inputs}`, sampled.manifest);
  publish(cfg.root, `${BASE}/starts/${start.run}.json`, start);
  return start;
}
export function finishReceipt(cfg: Config, start: ReceiptStart, result: Pick<VerificationReceipt, "outcome" | "exitCode" | "failures" | "pending" | "onramp" | "observations">): string {
  const stored = readObject(cfg.root, `${BASE}/starts/${start.run}.json`, receiptHash(start));
  validateStart(stored);
  const sampled = captureReceiptInputs(cfg);
  const receipt: VerificationReceipt = { version: 1, run: start.run, start: receiptHash(start), ended: new Date().toISOString(), inputsAfter: receiptHash(sampled.manifest), indexAfter: sampled.index, executorAfter: implementationHash(), ...result };
  validateReceipt(receipt);
  publish(cfg.root, `${BASE}/artifacts/${receipt.inputsAfter}`, sampled.manifest);
  const hash = receiptHash(receipt);
  // Refuse a second terminal before leaving an orphan object when possible. Atomic
  // publication of the seal arbitrates races before a terminal object is published.
  const sealPath = `${BASE}/starts/${start.run}.done.json`;
  try { const old = readObject(cfg.root, sealPath); if (old.receipt !== hash) fail("run already has a terminal receipt"); }
  catch (e: any) { if (e.code !== "ENOENT") throw e; }
  publish(cfg.root, sealPath, { version: 1, run: start.run, receipt: hash } satisfies Terminal);
  publish(cfg.root, `${BASE}/receipts/${hash}.json`, receipt);
  return `sha256-${hash}`;
}
const object = (v: any): boolean => !!v && typeof v === "object" && !Array.isArray(v);
const exact = (v: any, keys: string[]): boolean => object(v) && Object.keys(v).sort().join() === keys.sort().join();
const iso = (v: any): boolean => typeof v === "string" && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const strings = (v: any): boolean => Array.isArray(v) && v.every(x => typeof x === "string");
function validateStart(s: any): asserts s is ReceiptStart {
  if (!exact(s, ["version","run","at","session","agent","commit","index","inputs","configuration","executor","invocation","work"]) || s.version !== 1 || !RUN.test(s.run) || !iso(s.at)
    || ![s.index,s.inputs,s.configuration].every(x => typeof x === "string" && HASH.test(x))
    || ![s.session,s.agent].every(x => x === null || typeof x === "string") || !(s.commit === null || /^[a-f0-9]{40,64}$/.test(s.commit))
    || !exact(s.executor,["node","implementation","trust"]) || typeof s.executor.node !== "string" || !HASH.test(s.executor.implementation) || s.executor.trust !== "local-unattested"
    || !exact(s.invocation,["fast","scope","imported","serial"]) || ![s.invocation.fast,s.invocation.imported,s.invocation.serial].every(x => typeof x === "boolean") || !(s.invocation.scope === null || strings(s.invocation.scope))
    || !(s.work === null || exact(s.work,["work","definition","criteria"]) && typeof s.work.work === "string" && typeof s.work.definition === "string" && strings(s.work.criteria) && s.work.criteria.length)) fail("invalid start shape");
}
function validateReceipt(r: any): asserts r is VerificationReceipt {
  if (!exact(r,["version","run","start","ended","inputsAfter","indexAfter","executorAfter","outcome","exitCode","failures","pending","onramp","observations"]) || r.version !== 1 || !RUN.test(r.run) || !iso(r.ended)
    || ![r.start,r.inputsAfter,r.indexAfter,r.executorAfter].every(x => typeof x === "string" && HASH.test(x)) || !["completed","error"].includes(r.outcome)
    || ![r.exitCode,r.failures,r.pending].every(x => Number.isSafeInteger(x) && x >= 0) || typeof r.onramp !== "boolean" || !Array.isArray(r.observations)
    || !r.observations.every((o: any) => exact(o,["node","claim","kind","executed"]) && typeof o.node === "string" && typeof o.claim === "string" && ["pass","fail","skip"].includes(o.kind) && typeof o.executed === "boolean" && !(o.kind === "skip" && o.executed))) fail("invalid terminal shape");
  const keys = r.observations.map((o: ReceiptObservation) => receiptCanonical([o.node,o.claim]));
  if (new Set(keys).size !== keys.length) fail("duplicate observation identities");
}
function validateManifest(m: any): asserts m is InputManifest {
  if (!exact(m,["version","grade","exclusions","files"]) || m.version !== 1 || m.grade !== "git-visible-worktree-v1" || receiptCanonical(m.exclusions) !== receiptCanonical(RECEIPT_EXCLUSIONS) || !Array.isArray(m.files)) fail("invalid input manifest");
  let previous = "";
  for (const f of m.files) {
    if (!exact(f,["path","sha256","executable"]) || typeof f.path !== "string" || f.path <= previous || f.path.startsWith("/") || f.path.includes("\\") || f.path.split("/").some((p: string) => !p || p === "." || p === "..") || excluded(f.path) || !HASH.test(f.sha256) || typeof f.executable !== "boolean") fail("invalid input file");
    previous = f.path;
  }
}
function names(cfg: Config, dir: string): string[] {
  try { const path = safePath(cfg.root, `${BASE}/${dir}/x`); return readdirSync(dirname(path)).sort(); }
  catch (e: any) { if (e.code === "ENOENT") return []; throw e; }
}
function corpus(cfg: Config): { starts: Map<string, ReceiptStart>; receipts: Map<string, VerificationReceipt>; seals: Map<string, Terminal> } {
  const starts = new Map<string, ReceiptStart>(), receipts = new Map<string, VerificationReceipt>(), seals = new Map<string, Terminal>();
  for (const name of names(cfg,"starts")) {
    if (name.startsWith(".pending-")) fail("incomplete receipt publication survives; inspect before recovery");
    const v = readObject(cfg.root, `${BASE}/starts/${name}`);
    if (name.endsWith(".done.json")) {
      if (!exact(v,["version","run","receipt"]) || v.version !== 1 || !RUN.test(v.run) || !HASH.test(v.receipt) || name !== `${v.run}.done.json`) fail("invalid terminal seal");
      seals.set(v.run,v);
    } else { validateStart(v); if (name !== `${v.run}.json`) fail("displaced start"); starts.set(v.run,v); }
  }
  for (const name of names(cfg,"receipts")) {
    if (name.startsWith(".pending-")) fail("incomplete receipt publication survives; inspect before recovery");
    if (!/^[a-f0-9]{64}\.json$/.test(name)) fail("unexpected receipt filename");
    const hash = name.slice(0,-5), r = readObject(cfg.root,`${BASE}/receipts/${name}`,hash); validateReceipt(r);
    const s = starts.get(r.run);
    if (!s || receiptHash(s) !== r.start || r.ended < s.at) fail("missing/conflicting start");
    if (seals.has(r.run) && seals.get(r.run)!.receipt !== hash) fail("competing terminal receipts");
    receipts.set(hash,r);
  }
  for (const seal of seals.values()) if (!receipts.has(seal.receipt) || receipts.get(seal.receipt)!.run !== seal.run) fail("missing/displaced terminal receipt");
  return { starts, receipts, seals };
}
/** Resolve immutable bytes and their required dependencies. Current eligibility is a
 * separate reading; a valid historical receipt never silently becomes a current pass. */
export function readReceipt(cfg: Config, id: string, current = false): ReceiptRead {
  const hash = id.replace(/^verification:/, "").replace(/^sha256-/, "");
  if (!HASH.test(hash)) fail("expected verification:sha256-<64 hex digits>");
  const all = corpus(cfg), receipt = all.receipts.get(hash);
  if (!receipt || all.seals.get(receipt.run)?.receipt !== hash) fail("receipt missing or run incomplete");
  const start = all.starts.get(receipt.run)!;
  const inputs = readObject(cfg.root, `${BASE}/artifacts/${start.inputs}`, start.inputs); validateManifest(inputs);
  const after = readObject(cfg.root, `${BASE}/artifacts/${receipt.inputsAfter}`, receipt.inputsAfter); validateManifest(after);
  const problems: string[] = [];
  if (receipt.outcome !== "completed" || receipt.exitCode || receipt.failures || receipt.pending || receipt.onramp) problems.push("run did not complete all required verification");
  if (start.invocation.fast || start.invocation.imported) problems.push("fast or imported-report evidence is not witnessed full execution");
  if (!receipt.observations.length || receipt.observations.some(o => o.kind !== "pass") || !receipt.observations.some(o => o.executed)) problems.push("missing, failed or skipped execution evidence");
  if (start.inputs !== receipt.inputsAfter || start.index !== receipt.indexAfter || start.executor.implementation !== receipt.executorAfter) problems.push("inputs changed during execution");
  if (current && receiptHash(captureReceiptInputs(cfg).manifest) !== start.inputs) problems.push("tested inputs differ from the current repository");
  if (current && receiptHash(JSON.parse(JSON.stringify({ ...cfg, root: "." }))) !== start.configuration) problems.push("effective configuration differs from the run");
  if (current && start.work) {
    const opened = readWork(cfg).works.find(w => w.work === start.work!.work)?.opened;
    if (!opened || opened.id !== start.work.definition || receiptCanonical(opened.criteria) !== receiptCanonical(start.work.criteria)) problems.push("bound work definition is missing or changed");
  }
  return { id: `verification:sha256-${hash}`, receipt, start, inputs, problems, files: [...new Set([`${BASE}/starts/${start.run}.json`,`${BASE}/starts/${start.run}.done.json`,`${BASE}/receipts/${hash}.json`,`${BASE}/artifacts/${start.inputs}`,`${BASE}/artifacts/${receipt.inputsAfter}`])] };
}
export function receiptWorkProblem(cfg: Config, id: string, work: string): string | null {
  try {
    if (!/^sha256-[a-f0-9]{64}$/.test(id)) return "legacy verification address has no receipt";
    const r = readReceipt(cfg,id,true);
    const opened = readWork(cfg).works.find(w => w.work === work)?.opened;
    if (!opened || r.start.work?.work !== work || r.start.work.definition !== opened.id || receiptCanonical(r.start.work.criteria) !== receiptCanonical(opened.criteria)) return "receipt does not bind this work definition";
    return r.problems.join("; ") || null;
  } catch (e) { return e instanceof Error ? e.message : String(e); }
}
export function listReceipts(cfg: Config): { completed: string[]; incomplete: string[] } {
  const all = corpus(cfg);
  const completed = [...all.seals.values()].map(s => `verification:sha256-${s.receipt}`).sort();
  for (const id of completed) readReceipt(cfg,id);
  return { completed, incomplete: [...all.starts.keys()].filter(run => !all.seals.has(run)).sort() };
}

/** Read a start through the same strict corpus admission as terminal receipts. */
export function readReceiptStart(cfg: Config, run: string): ReceiptStart {
  if (!RUN.test(run)) fail("invalid run identity");
  const start = corpus(cfg).starts.get(run);
  if (!start) fail("missing verification start");
  return start;
}
