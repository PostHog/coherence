// Taxonomy is obligation discovery, not verification. Semantic answers are caller
// assessments; the graph supplies addresses and the filesystem supplies freshness.
import { createHash } from "node:crypto";
import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import type { Config, Graph, GraphNode } from "../types.ts";
import { TAXONOMY, LAB_TAXONOMY, type TaxonomyCatalog } from "./taxonomy-catalog.ts";

export const TAXONOMY_LIMIT = "Caller-assessed roles, not semantic proof. Whole subject files, direct local imports, explicit evidence/dependencies and root manifests are hashed; transitive dependencies, external services and runtime behavior are not verified. Moves require a new subject assessment.";
export class TaxonomyError extends Error {}
export const taxonomyHash = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const taxonomyCatalogDigest = (): string => taxonomyHash(TAXONOMY);
/** Historical assessment semantics follow their catalog, never today's replacement. */
export function taxonomyCatalogFor(digest: string): TaxonomyCatalog {
  const catalog = [LAB_TAXONOMY, TAXONOMY].find(c => taxonomyHash(c) === digest);
  if (!catalog) throw new TaxonomyError("Unknown taxonomy catalog digest; historical knowledge is unavailable");
  return catalog;
}
export type TaxonomyAnswer = "yes" | "no" | "unknown";
export const TAXONOMY_ASSESSMENTS = ["classified", "composite", "ambiguous", "unassessed", "needs-evidence", "no-fit", "out-of-evidence"] as const;
export interface TaxonomyInput {
  domains: string[];
  answers: Record<string, TaxonomyAnswer>;
  roles: string[];
  facets: string[];
}
export interface TaxonomySubject { target: string; node: string; kind: string; label: string; owner: string | null; files: string[] }
export interface TaxonomySnapshot { subject: TaxonomySubject; files: Record<string, string | null>; catalog: string }
export interface TaxonomySelection {
  assessment: typeof TAXONOMY_ASSESSMENTS[number];
  roles: string[]; facets: string[];
  candidates: Array<{ id: string; label: string; responsibility: string; support: string[]; tensions: string[]; needsEvidence?: string }>;
  suggestions: Array<{ id: string; text: string; level: string; activatedBy: string; status: "unverified" }>;
  questions: Array<{ id: string; question: string }>;
  unanswered: number;
}

/** The same contained path grammar governs subjects, evidence and freshness reads. */
export function taxonomyPath(raw: string): string {
  const value = raw.replace(/^\.\//, "");
  if (!value || /[\x00-\x1f\x7f\\:#]/u.test(value) || value.startsWith("/") || value.split("/").includes("..")
    || value !== posix.normalize(value) || value === ".") throw new TaxonomyError(`Expected a repository-relative file path: ${JSON.stringify(raw)}`);
  return value;
}

/** Refuse stable symlink redirection, non-files and oversized evidence; no project code runs. */
export function taxonomyFile(cfg: Config, raw: string, missing = false): Buffer | null {
  const file = taxonomyPath(raw), parts = file.split("/");
  let path = cfg.root;
  for (let i = 0; i < parts.length; i++) {
    path = join(path, parts[i]);
    let stat;
    try { stat = lstatSync(path); } catch (error) {
      if (missing && (error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new TaxonomyError(`Evidence unavailable: ${file}`);
    }
    if (stat.isSymbolicLink() || (i < parts.length - 1 ? !stat.isDirectory() : !stat.isFile())) throw new TaxonomyError(`Evidence must be contained regular files: ${file}`);
    if (i === parts.length - 1 && stat.size > 16 * 1024 * 1024) throw new TaxonomyError(`Evidence exceeds 16 MiB: ${file}`);
  }
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fstatSync(fd), standing = lstatSync(path);
    if (!opened.isFile() || standing.isSymbolicLink() || opened.ino !== standing.ino || opened.dev !== standing.dev) throw new TaxonomyError(`Evidence moved while opening: ${file}`);
    return readFileSync(fd);
  } finally { closeSync(fd); }
}

/** Resolve one file or one exported graph symbol. Arbitrary labels never become addresses. */
export function resolveTaxonomySubject(graph: Graph, target: string): TaxonomySubject {
  const [raw, symbol, extra] = target.split("#");
  const file = taxonomyPath(raw);
  if (extra !== undefined || symbol === "" || (symbol && /[\x00-\x20\x7f]/u.test(symbol))) throw new TaxonomyError("Use one file#symbol address, not compound chokepoints");
  const matches = graph.nodes.filter(n => symbol ? n.kind === "symbol" && n.path === file && n.label === symbol : n.kind === "file" && n.path === file);
  if (matches.length !== 1) throw new TaxonomyError(`Subject must resolve to exactly one graph file or symbol: ${target} (${matches.length} matches)`);
  const node = matches[0], byId = new Map(graph.nodes.map(n => [n.id, n]));
  let owner: GraphNode | undefined = node;
  const seen = new Set<string>();
  while (owner && owner.kind !== "component" && !seen.has(owner.id)) { seen.add(owner.id); owner = owner.parent ? byId.get(owner.parent) : undefined; }
  return { target: file + (symbol ? `#${symbol}` : ""), node: node.id, kind: node.kind, label: node.label, owner: owner?.id ?? null, files: [file] };
}

export function taxonomyInput(input: Partial<TaxonomyInput>, catalog: TaxonomyCatalog = TAXONOMY): TaxonomyInput {
  const unique = (values: string[] = []) => [...new Set(values)].sort();
  const domains = unique(input.domains);
  if (domains.some(d => d !== "simulation")) throw new TaxonomyError("Only the explicit simulation domain pack is supported; core is always included");
  const eligible = (pack: string) => pack === "core" || domains.includes(pack);
  const answers = Object.fromEntries(Object.entries(input.answers ?? {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  for (const [id, answer] of Object.entries(answers)) {
    if (!catalog.questions.some(q => q.id === id && eligible(q.pack)) || !["yes", "no", "unknown"].includes(answer)) throw new TaxonomyError(`Unknown, disabled or invalid signal answer: ${id}=${answer}`);
  }
  const roles = unique(input.roles), facets = unique(input.facets);
  for (const id of roles) if (!catalog.roles.some(r => r.id === id && eligible(r.pack))) throw new TaxonomyError(`Unknown or disabled terminal role: ${id}`);
  for (const id of facets) if (!catalog.facets.some(f => f.id === id && eligible(f.pack))) throw new TaxonomyError(`Unknown or disabled facet: ${id}`);
  if (answers["signal:declarations-only"] === "yes" && catalog.roles.some(r => r.requires && answers[r.requires] === "yes"))
    throw new TaxonomyError("Declarations-only conflicts with a positive runtime representation operation");
  return { domains, answers, roles, facets };
}

/** Positive signals propose candidates; explicit operational exclusions narrow them, never name cues. */
export function classifyTaxonomy(raw: Partial<TaxonomyInput> = {}, catalog: TaxonomyCatalog = TAXONOMY): TaxonomySelection {
  const input = taxonomyInput(raw, catalog), eligible = (pack: string) => pack === "core" || input.domains.includes(pack);
  const candidates = catalog.roles.filter(r => eligible(r.pack) && (!r.requires ||
    (input.answers[r.requires] !== "no" && input.answers["signal:declarations-only"] !== "yes")))
    .map(r => ({ id: r.id, label: r.label, responsibility: r.responsibility,
    support: [...r.signals, ...(r.requires ? [r.requires] : [])].filter(s => input.answers[s] === "yes"),
    tensions: r.tensions.filter(s => input.answers[s] === "yes"),
    ...(r.requires && input.answers[r.requires] !== "yes" ? { needsEvidence: r.requires } : {}) }))
    .filter(r => r.support.length > 0).sort((a, b) => b.support.length - a.support.length || (a.id < b.id ? -1 : 1));
  if (input.roles.some(id => !candidates.some(c => c.id === id && !c.needsEvidence))) throw new TaxonomyError("Selected roles require a positive supporting signal and operational evidence; inspect the candidate questions first");
  const active = new Set([...input.roles, ...input.facets]);
  const needed = new Set(candidates.flatMap(c => c.needsEvidence ? [c.needsEvidence] : []));
  const relevant = catalog.questions.filter(q => eligible(q.pack) && (!q.when || needed.has(q.id) || input.answers[q.when] === "yes"
    || catalog.questions.some(other => other.when === q.when && input.answers[other.id] === "yes")));
  const questions = relevant.filter(q => !input.answers[q.id] || input.answers[q.id] === "unknown")
    .sort((a, b) => Number(needed.has(b.id)) - Number(needed.has(a.id)) || Number(!!b.when) - Number(!!a.when));
  const untouched = !Object.values(input.answers).some(v => v !== "unknown") && !input.facets.length;
  return { assessment: input.roles.length > 1 ? "composite" : input.roles.length ? "classified" : candidates.length ? "ambiguous"
    : catalog.version === LAB_TAXONOMY.version ? "out-of-evidence" : untouched ? "unassessed" : questions.length ? "needs-evidence" : "no-fit",
    roles: input.roles, facets: input.facets, candidates,
    suggestions: catalog.guarantees.filter(g => eligible(g.pack) && active.has(g.when)).map(g => ({ id: g.id, text: g.text, level: g.level, activatedBy: g.when, status: "unverified" })),
    questions: questions.slice(0, 6).map(q => ({ id: q.id, question: q.question })), unanswered: questions.length };
}

const MANIFESTS = ["coherence.config.json", "package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "tsconfig.json", "pyproject.toml", "uv.lock", "requirements.txt", "Cargo.toml", "Cargo.lock", "go.mod", "go.sum"];
export function captureTaxonomy(cfg: Config, graph: Graph, target: string, evidence: string[] = [], dependencies: string[] = []): TaxonomySnapshot {
  const subject = resolveTaxonomySubject(graph, target), files = new Set([...subject.files, ...MANIFESTS]);
  for (const edge of graph.edges) if (edge.kind === "imports" && edge.source === `f:${subject.files[0]}`) {
    const destination = graph.nodes.find(n => n.id === edge.target);
    if (destination?.kind === "file" && destination.path) files.add(destination.path);
  }
  for (const address of [...evidence, ...dependencies]) {
    const file = taxonomyPath(address.split("#")[0]);
    if (address.includes("#")) resolveTaxonomySubject(graph, address);
    taxonomyFile(cfg, file); files.add(file);
  }
  return { subject, files: Object.fromEntries([...files].sort().map(file => {
    const bytes = taxonomyFile(cfg, file, MANIFESTS.includes(file));
    return [file, bytes === null ? null : createHash("sha256").update(bytes).digest("hex")];
  })), catalog: taxonomyCatalogDigest() };
}

export function taxonomyStaleness(cfg: Config, snapshot: TaxonomySnapshot): string[] {
  const reasons: string[] = [];
  if (snapshot.catalog !== taxonomyCatalogDigest()) reasons.push("catalog changed");
  for (const [file, digest] of Object.entries(snapshot.files)) {
    try {
      const bytes = taxonomyFile(cfg, file, true), current = bytes === null ? null : createHash("sha256").update(bytes).digest("hex");
      if (current !== digest) reasons.push(`changed or missing: ${file}`);
    } catch { reasons.push(`unavailable: ${file}`); }
  }
  return reasons;
}

/** Mechanical manifest observations, not a claim about the project's dominant semantic role. */
export function profileTaxonomy(cfg: Config) {
  const facts: Array<{ source: string; fact: string }> = [];
  for (const file of MANIFESTS) {
    const bytes = taxonomyFile(cfg, file, true);
    if (!bytes) continue;
    facts.push({ source: file, fact: "present" });
    if (file === "package.json") {
      let pkg;
      try { pkg = JSON.parse(bytes.toString("utf8")); } catch { throw new TaxonomyError("package.json is not readable JSON"); }
      if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) throw new TaxonomyError("package.json must be an object");
      for (const field of ["bin", "exports", "main", "workspaces"]) if (Object.hasOwn(pkg, field)) facts.push({ source: file, fact: `declares ${field}` });
    }
  }
  return { version: TAXONOMY.version, grade: "root-manifest-observations", facts, enabledPacks: ["core"], optionalPacks: ["simulation"],
    limit: "Manifest presence and declared entry points are facts, not semantic project classification. No scripts, LSP server or adapters are executed by profiling. Nested workspace manifests are not inventoried." };
}
