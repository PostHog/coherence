// Explicit catalog adoption. Reuses spec boundaries, contained evidence reads and
// verifier records; neither taxonomy nor a catalog example can confer support.
import { createHash } from "node:crypto";
import type { Config, Graph } from "../types.ts";
import type { StatusRecord } from "../evidence/status.ts";
import { indexClaimRecords } from "../evidence/status.ts";
import { taxonomyFile, resolveTaxonomySubject } from "../taxonomy/taxonomy.ts";
import { GUARANTEE_CATALOG, type GuaranteeDefinition } from "./guarantee-catalog.ts";
import { parseBoundary, guaranteeRef, claimKey } from "./boundary.ts";

export interface GuaranteeBinding {
  claim: string; definition: string; definitionDigest: string; subject: string;
  assessor: string; because: string; parameters: Record<string, string>;
  excludes: string; falsifier: string; evidence: Record<string, string>;
  flow?: { from: { subject: string; title: string }; to: { subject: string; title: string } };
}
export interface BindingReading {
  id: string; owner: string; declaration: unknown; binding: GuaranteeBinding | null;
  definition: GuaranteeDefinition | null; status: "current" | "stale" | "invalid";
  problems: string[]; inputDigest: string | null;
  observation: { verdict: "pass" | "fail" | "stale" | "unverified"; at: string | null; oracle: string; detail?: string };
}
export interface BindingProjection { items: BindingReading[]; issues: string[]; limit: string }
const LIMIT = "Candidate applicability and entailment are caller-assessed. Evidence supports only the named oracle at the explicit input set; dependency completeness, external services and whole-component safety are not established. Records are mutable local verification history, not immutable receipts. Catalog example results never activate support.";
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const normalized = (value: unknown): unknown => Array.isArray(value) ? value.map(normalized)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, normalized(v)])) : value;
export const bindingDigest = (value: unknown): string => hash(JSON.stringify(normalized(value)));
const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && !!v.trim() && v.length <= 4000 && !/[\x00-\x1f\x7f]/u.test(v);
const SHA = /^[a-f0-9]{64}$/;
const KEYS = ["claim", "definition", "definitionDigest", "subject", "assessor", "because", "parameters", "excludes", "falsifier", "evidence"];

/** Preserve every declaration, including malformed ones. No verdict is synthesized. */
export function projectBindings(cfg: Config, graph: Graph, status: StatusRecord = { version: 1 }): BindingProjection {
  const items: BindingReading[] = [], issues: string[] = [];
  const records = indexClaimRecords(status.verify?.claims ?? []);
  for (const component of graph.nodes.filter(n => n.kind === "component").sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    const owner = component.id.slice(2), seen = new Set<string>();
    for (const raw of component.guaranteeLinks?.bindings ?? []) {
      const row: BindingReading = { id: `b-${bindingDigest([owner, raw])}`, owner, declaration: raw,
        binding: null, definition: null, status: "current", problems: [], inputDigest: null,
        observation: { verdict: "unverified", at: null, oracle: "" } };
      const invalid = (message: string) => { row.status = "invalid"; row.problems.push(message); };
      const stale = (message: string) => { if (row.status !== "invalid") row.status = "stale"; row.problems.push(message); };
      try {
        if (!plain(raw) || KEYS.some(k => !Object.hasOwn(raw, k)) || Object.keys(raw).some(k => !KEYS.includes(k) && k !== "flow")
          || KEYS.filter(k => !["parameters", "evidence"].includes(k)).some(k => !text(raw[k]))
          || !plain(raw.parameters) || !plain(raw.evidence)
          || Object.values(raw.parameters).some(v => !text(v))
          || Object.values(raw.evidence).some(v => typeof v !== "string" || !SHA.test(v))) throw new Error("Expected a complete guarantee binding with only declared fields");
        if (Object.hasOwn(raw, "flow")) {
          const flow = raw.flow;
          if (!plain(flow) || Object.keys(flow).length !== 2 || !["from", "to"].every(k => {
            const end = flow[k];
            return plain(end) && Object.keys(end).length === 2 && text(end.subject) && text(end.title) && end.title.length <= 100;
          })) throw new Error("Flow requires exactly from/to endpoints with subject and title");
        }
        const b = raw as unknown as GuaranteeBinding;
        row.binding = b;
        const definition = GUARANTEE_CATALOG.definitions.find(d => d.id === b.definition);
        if (!definition) throw new Error("Unknown candidate definition");
        row.definition = definition;
        if (!SHA.test(b.definitionDigest)) throw new Error("Malformed definition digest");
        if (b.definitionDigest !== bindingDigest(definition)) stale("Definition changed; reassess applicability");
        if (Object.keys(b.parameters).length !== definition.parameters.length
          || definition.parameters.some(k => !text(b.parameters[k]))
          || Object.keys(b.parameters).some(k => !definition.parameters.includes(k))) throw new Error("Parameters must exactly match the candidate definition");
        const identity = bindingDigest([b.claim, b.definition, b.subject]);
        if (seen.has(identity)) invalid("Duplicate binding for this claim, definition and subject");
        seen.add(identity);
        const subject = resolveTaxonomySubject(graph, b.subject);
        if (subject.owner !== component.id) invalid("Subject belongs to another component");
        for (const endpoint of b.flow ? [b.flow.from, b.flow.to] : []) {
          const resolved = resolveTaxonomySubject(graph, endpoint.subject);
          if (resolved.kind !== "symbol" || resolved.owner !== component.id) invalid("Flow endpoint must be an owned canonical symbol");
          if (!resolved.files.every(p => Object.hasOwn(b.evidence, p))) invalid("Evidence must include every flow endpoint file");
        }
        const matches = (component.claims ?? []).filter(c => { const boundary = parseBoundary(c); return boundary && guaranteeRef(owner, boundary) === b.claim; });
        if (matches.length !== 1) throw new Error("Binding requires exactly one current local boundary claim");
        const boundary = parseBoundary(matches[0])!;
        row.observation.oracle = boundary.oracle;
        if (!boundary.oracle) invalid("Binding requires a named oracle");
        const paths = Object.keys(b.evidence).sort();
        if (!paths.length || paths.length > 128 || !subject.files.every(p => Object.hasOwn(b.evidence, p))) throw new Error("Evidence must include the whole subject file (maximum 128 paths)");
        const live: Record<string, string> = {};
        for (const path of paths) {
          if (!SHA.test(b.evidence[path])) throw new Error(`Invalid evidence digest: ${path}`);
          live[path] = hash(taxonomyFile(cfg, path)!);
          if (live[path] !== b.evidence[path]) stale(`Evidence changed: ${path}`);
        }
        // The authored spec and runner configuration are mandatory observation inputs.
        // Changing the oracle, runner or applicability declaration cannot reuse old green.
        const spec = component.specPath;
        if (!spec) throw new Error("Provider spec path is missing");
        const configBytes = taxonomyFile(cfg, "coherence.config.json", true);
        const inputs = [row.id, live, hash(taxonomyFile(cfg, spec)!), configBytes ? hash(configBytes) : null, cfg.test, cfg.testMatch,
          cfg.testBatch, cfg.testBatchFormat, cfg.language, cfg.oracleExecution];
        row.inputDigest = bindingDigest(inputs);
        const record = records.get(claimKey(component.label, matches[0]));
        if (record && (record.kind === "pass" || record.kind === "fail") && typeof record.at === "string" && record.bindingInputs?.[row.id]) {
          row.observation = { verdict: row.status === "current" && record.bindingInputs[row.id] === row.inputDigest ? record.kind : "stale",
            at: record.at, oracle: boundary.oracle, detail: typeof record.detail === "string" ? record.detail : "" };
        }
      } catch (error) { invalid(String((error as Error).message)); }
      if (row.status !== "current" && row.observation.verdict !== "unverified") row.observation.verdict = "stale";
      issues.push(...row.problems.map(p => `${owner} ${row.id}: ${p}`));
      items.push(row);
    }
  }
  return { items, issues, limit: LIMIT };
}

/** Join THIS run's named signals to unchanged pre/post inputs, never carried verdicts. */
export function bindRunEvidence<T extends { node: string; claim: string; kind: string; oracleChecked?: boolean }>(
  signals: T[], before: BindingProjection, after: BindingProjection, graph: Graph,
): Array<T & { bindingInputs?: Record<string, string> }> {
  return signals.map(signal => {
    if (signal.kind === "skip" || !signal.oracleChecked) return signal;
    const bindingInputs: Record<string, string> = {};
    for (const row of after.items) {
      const component = graph.nodes.find(n => n.id === `c:${row.owner}`), boundary = parseBoundary(signal.claim);
      if (!boundary || component?.label !== signal.node || !row.binding || row.binding.claim !== guaranteeRef(row.owner, boundary)) continue;
      const original = before.items.find(b => b.id === row.id);
      if (row.status === "current" && original?.status === "current" && row.inputDigest && original.inputDigest === row.inputDigest) bindingInputs[row.id] = row.inputDigest;
    }
    return { ...signal, ...(Object.keys(bindingInputs).length ? { bindingInputs } : {}) };
  });
}
