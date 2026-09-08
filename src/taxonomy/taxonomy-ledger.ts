// One immutable file per predecessor slot. Exclusive creation makes two accepted
// successors of the same subject revision unrepresentable at the write boundary.
// Surviving damage refuses; committed Git history remains the deletion/rewrite witness.
import { constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import type { Config, Graph } from "../types.ts";
import { TAXONOMY } from "./taxonomy-catalog.ts";
import { captureTaxonomy, classifyTaxonomy, TaxonomyError, taxonomyHash, taxonomyInput, taxonomyPath, taxonomyStaleness, taxonomyCatalogFor, TAXONOMY_LIMIT, TAXONOMY_ASSESSMENTS } from "./taxonomy.ts";
import type { TaxonomyInput, TaxonomySnapshot } from "./taxonomy.ts";

export interface TaxonomyRecord {
  version: 1; event: "classification-recorded"; basis: "caller-assessed";
  previous: string | null; at: string; session: string; agent: string;
  input: TaxonomyInput; snapshot: TaxonomySnapshot;
  evidence: string[]; dependencies: string[]; because: string; id: string;
}
const ID = /^t-[a-f0-9]{64}$/;
const HASH = /^[a-f0-9]{64}$/;
const text = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim() || value.length > 4000 || /[\x00-\x1f\x7f]/u.test(value)) throw new TaxonomyError("Expected nonempty single-line classification text (maximum 4000 characters)");
  return value;
};
function strings(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 256) throw new TaxonomyError("Expected a bounded string list");
  return [...new Set(value.map(text))].sort();
}
const slot = (record: Pick<TaxonomyRecord, "snapshot" | "previous">) => `slot-${taxonomyHash([record.snapshot.subject.target, record.previous])}.json`;
function directory(cfg: Config, create = false): string | null {
  let path = cfg.root;
  for (const part of [".coherence", "taxonomy"]) {
    path = join(path, part);
    try {
      const s = lstatSync(path);
      if (!s.isDirectory() || s.isSymbolicLink()) throw new TaxonomyError("Taxonomy ledger must use real contained directories");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (!create) return null;
      try { mkdirSync(path); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
      const s = lstatSync(path);
      if (!s.isDirectory() || s.isSymbolicLink()) throw new TaxonomyError("Taxonomy directory creation was redirected");
    }
  }
  return path;
}

function validateSnapshot(value: TaxonomySnapshot): TaxonomySnapshot {
  if (!value || !value.subject || !value.files || Array.isArray(value.files) || !HASH.test(value.catalog)) throw new TaxonomyError("Malformed taxonomy snapshot");
  const s = value.subject;
  const file = taxonomyPath(text(s.target).split("#")[0]);
  if (!["file", "symbol"].includes(s.kind) || s.node !== (s.kind === "file" ? `f:${s.target}` : `s:${s.target}`)
    || (s.kind === "symbol") !== s.target.includes("#") || s.target.split("#").length > 2
    || (s.owner !== null && !text(s.owner).startsWith("c:"))) throw new TaxonomyError("Malformed taxonomy subject identity");
  const files = strings(s.files);
  if (files.length !== 1 || files[0] !== file || !HASH.test(value.files[file] ?? "")) throw new TaxonomyError("Snapshot must retain its subject file digest");
  const entries = Object.entries(value.files).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  if (entries.length > 2048) throw new TaxonomyError("Too many snapshot dependencies");
  for (const [path, digest] of entries) if (taxonomyPath(path) !== path || (digest !== null && (typeof digest !== "string" || !HASH.test(digest)))) throw new TaxonomyError("Invalid snapshot dependency");
  return { subject: { target: s.target, node: s.node, kind: s.kind, label: text(s.label), owner: s.owner, files }, files: Object.fromEntries(entries), catalog: value.catalog };
}

/** Runtime validation owns the whole wire relation, not only its content hash. */
export function validateTaxonomyRecord(raw: TaxonomyRecord): TaxonomyRecord {
  if (!raw || raw.version !== 1 || raw.event !== "classification-recorded" || raw.basis !== "caller-assessed") throw new TaxonomyError("Unknown taxonomy record schema");
  if (raw.previous !== null && !ID.test(raw.previous)) throw new TaxonomyError("Invalid predecessor");
  if (typeof raw.at !== "string" || !Number.isFinite(Date.parse(raw.at)) || new Date(raw.at).toISOString() !== raw.at) throw new TaxonomyError("Invalid classification timestamp");
  if (!raw.input || !Array.isArray(raw.input.domains) || !Array.isArray(raw.input.roles) || !Array.isArray(raw.input.facets)
    || !raw.input.answers || typeof raw.input.answers !== "object" || Array.isArray(raw.input.answers)) throw new TaxonomyError("Invalid classification input");
  const catalog = taxonomyCatalogFor(raw.snapshot?.catalog);
  const input = taxonomyInput(raw.input, catalog);
  classifyTaxonomy(input, catalog);
  const evidence = strings(raw.evidence), dependencies = strings(raw.dependencies);
  const snapshot = validateSnapshot(raw.snapshot);
  for (const address of [...evidence, ...dependencies]) {
    const file = taxonomyPath(address.split("#")[0]);
    if (address.split("#").length > 2 || address.endsWith("#") || !HASH.test(snapshot.files[file] ?? "")) throw new TaxonomyError("Evidence must be represented in the snapshot");
  }
  if ((Object.values(input.answers).includes("yes") || input.facets.length) && !evidence.length) throw new TaxonomyError("Positive assessments require an evidence address");
  const body = { version: 1 as const, event: "classification-recorded" as const, basis: "caller-assessed" as const,
    previous: raw.previous, at: raw.at, session: text(raw.session), agent: text(raw.agent), input, snapshot, evidence, dependencies, because: text(raw.because) };
  const record = { ...body, id: `t-${taxonomyHash(body)}` };
  if (JSON.stringify(record) !== JSON.stringify(raw)) throw new TaxonomyError("Noncanonical or inconsistent taxonomy record");
  return record;
}

export function readTaxonomyRecords(cfg: Config): TaxonomyRecord[] {
  const dir = directory(cfg), records: TaxonomyRecord[] = [];
  if (dir) for (const name of readdirSync(dir).sort()) {
    if (!/^slot-[a-f0-9]{64}\.json$/.test(name)) throw new TaxonomyError(`Unexpected taxonomy ledger entry: ${name}`);
    const path = join(dir, name), stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) throw new TaxonomyError(`Unreadable taxonomy record: ${name}`);
    const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const opened = fstatSync(fd);
      if (!opened.isFile() || opened.ino !== stat.ino || opened.dev !== stat.dev) throw new TaxonomyError(`Taxonomy record changed during read: ${name}`);
      const bytes = readFileSync(fd, "utf8");
      let record;
      try { record = validateTaxonomyRecord(JSON.parse(bytes)); } catch (error) { throw new TaxonomyError(`${name}: ${(error as Error).message}`); }
      if (bytes !== JSON.stringify(record) + "\n" || slot(record) !== name) throw new TaxonomyError(`Displaced or torn taxonomy record: ${name}`);
      records.push(record);
    } finally { closeSync(fd); }
  }
  if (!records.length) {
    let tracked = "";
    try { tracked = execFileSync("git", ["ls-tree", "-r", "--name-only", "HEAD", "--", ".coherence/taxonomy"], { cwd: cfg.root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { /* Non-Git/unborn has no committed deletion witness. */ }
    if (tracked.trim()) throw new TaxonomyError("Committed taxonomy population disappeared; empty is not adoption");
  }
  const byId = new Map(records.map(r => [r.id, r]));
  if (byId.size !== records.length) throw new TaxonomyError("Duplicate taxonomy identities");
  for (const record of records) {
    const visited = new Set<string>(); let item: TaxonomyRecord | undefined = record;
    while (item) {
      if (visited.has(item.id)) throw new TaxonomyError("Cyclic taxonomy history");
      visited.add(item.id);
      if (item.previous === null) break;
      const parent: TaxonomyRecord | undefined = byId.get(item.previous);
      if (!parent || parent.snapshot.subject.target !== record.snapshot.subject.target) throw new TaxonomyError("Detached taxonomy history");
      item = parent;
    }
  }
  return records;
}

export function taxonomyView(cfg: Config) {
  const records = readTaxonomyRecords(cfg), superseded = new Set(records.flatMap(r => r.previous ? [r.previous] : []));
  const items = records.filter(r => !superseded.has(r.id)).map(record => {
    const catalog = taxonomyCatalogFor(record.snapshot.catalog);
    const classification = classifyTaxonomy(record.input, catalog), staleReasons = taxonomyStaleness(cfg, record.snapshot);
    return { record, classification, assessedCatalogVersion: catalog.version, status: staleReasons.length ? "stale" : classification.assessment, staleReasons };
  }).sort((a, b) => a.record.snapshot.subject.target < b.record.snapshot.subject.target ? -1 : 1);
  return { version: 1, catalogVersion: TAXONOMY.version, states: [...TAXONOMY_ASSESSMENTS, "stale"], limit: TAXONOMY_LIMIT, records, items };
}

export interface RecordTaxonomyInput extends Partial<TaxonomyInput> {
  target: string; expected: string | null; session: string; agent?: string; because: string;
  evidence?: string[]; dependencies?: string[]; now?: string;
}
/** Exclusive predecessor slots preserve history and reject stale concurrent writers. */
export function recordTaxonomy(cfg: Config, graph: Graph, opts: RecordTaxonomyInput): TaxonomyRecord {
  const records = readTaxonomyRecords(cfg), input = taxonomyInput(opts), snapshot = captureTaxonomy(cfg, graph, opts.target, opts.evidence, opts.dependencies);
  const body = { version: 1 as const, event: "classification-recorded" as const, basis: "caller-assessed" as const,
    previous: opts.expected, at: opts.now ?? new Date().toISOString(), session: text(opts.session), agent: text(opts.agent ?? "main"), input, snapshot,
    evidence: strings(opts.evidence ?? []), dependencies: strings(opts.dependencies ?? []), because: text(opts.because) };
  const record = validateTaxonomyRecord({ ...body, id: `t-${taxonomyHash(body)}` });
  const existing = records.find(r => slot(r) === slot(record));
  if (existing) {
    const retry = { ...record, at: existing.at, id: existing.id };
    if (JSON.stringify(retry) === JSON.stringify(existing)) return existing;
    throw new TaxonomyError("Revision already advanced; inspect the current record before retrying");
  }
  const superseded = new Set(records.map(r => r.previous));
  const current = records.find(r => r.snapshot.subject.target === snapshot.subject.target && !superseded.has(r.id));
  if ((current?.id ?? null) !== opts.expected) throw new TaxonomyError("Expected revision is not current (use --expected none only for a new subject)");
  const dir = directory(cfg, true)!;
  let fd;
  try { fd = openSync(join(dir, slot(record)), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600); }
  catch (error) { throw new TaxonomyError(`Revision could not be exclusively recorded: ${(error as NodeJS.ErrnoException).code}`); }
  try { writeFileSync(fd, JSON.stringify(record) + "\n"); } finally { closeSync(fd); }
  return record;
}
