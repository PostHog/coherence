// Links are caller-assessed declarations, not proof of semantic entailment.
// This pure join never executes an oracle, changes its verdict, or infers a link.
import type { Graph } from "../types.ts";
import type { ScopeGuarantee, ScopeRelation } from "../readings/scope-model.ts";
import type { taxonomyView } from "../taxonomy/taxonomy-ledger.ts";

/** Caller-supplied canonical taxonomy or a visible unavailable reading. */
export interface GuaranteeTaxonomy { view: ReturnType<typeof taxonomyView> | null; error: string | null }
/** Authored reference with independently graded structural health, never satisfaction. */
export interface GuaranteeLink {
  owner: string; kind: "addresses" | "relies"; claim: string | null;
  provider: string | null; subject: string | null; obligation: string | null; assessment: string | null;
  because: string; basis: "caller-assessed"; status: "current" | "stale" | "invalid"; problems: string[];
}
/** Every activated suggestion survives projection, including stale and unlinked ones. */
export interface ObligationReading {
  owner: string | null; subject: string; assessment: string; obligation: string; text: string;
  applicability: "caller-assessed" | "stale"; assessmentState: string;
  mapping: "linked" | "unlinked"; claims: string[];
  satisfaction: "unverified";
}
/** Deterministic read-only join of declarations, applicability and link diagnostics. */
export interface GuaranteeLinks {
  version: 1; links: GuaranteeLink[]; obligations: ObligationReading[]; issues: string[];
  taxonomy: "available" | "unavailable";
  limit: string;
}
const LIMIT = "Link integrity is not satisfaction. Applicability and mapping are caller-assessed; oracle verdicts are separate recorded evidence, not immutable receipts. Import adjacency is not proof a guarantee is consumed.";
const REF = /^g-[a-f0-9]{64}$/;
const ASSESSMENT = /^t-[a-f0-9]{64}$/;
const safeText = (x: unknown): x is string => typeof x === "string" && !!x.trim() && x.length <= 4000 && !/[\x00-\x1f\x7f]/u.test(x);

/** Resolve every declaration and every active obligation; absent links never disappear. */
export function resolveGuaranteeLinks(graph: Graph, guarantees: ScopeGuarantee[], relations: ScopeRelation[],
  taxonomy: GuaranteeTaxonomy = { view: null, error: null }): GuaranteeLinks {
  const components = graph.nodes.filter(n => n.kind === "component").sort((a, b) => a.id < b.id ? -1 : 1);
  const ids = new Set(components.map(n => n.id.slice(2)));
  const links: GuaranteeLink[] = [], issues: string[] = [];
  const subjects = new Map((taxonomy.view?.items ?? []).map(item => [item.record.snapshot.subject.target, item]));
  if (taxonomy.error) issues.push(`Taxonomy unavailable: ${taxonomy.error}`);
  for (const component of components) {
    const owner = component.id.slice(2), declarations = component.guaranteeLinks;
    if (!declarations) continue;
    issues.push(...declarations.problems.map(p => `${owner}: ${p}`));
    const duplicates = new Set<string>();
    for (const kind of ["addresses", "relies"] as const) for (const raw of declarations[kind]) {
      const value = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
      const keys = kind === "addresses" ? ["claim", "subject", "obligation", "assessment", "because"] : ["claim", "provider", "because"];
      const row: GuaranteeLink = { owner, kind, claim: safeText(value.claim) ? value.claim : null,
        provider: kind === "addresses" ? owner : safeText(value.provider) ? value.provider : null,
        subject: safeText(value.subject) ? value.subject : null, obligation: safeText(value.obligation) ? value.obligation : null,
        assessment: safeText(value.assessment) ? value.assessment : null, because: safeText(value.because) ? value.because : "",
        basis: "caller-assessed", status: "current", problems: [] };
      const invalid = (message: string) => { row.status = "invalid"; row.problems.push(message); };
      const stale = (message: string) => { if (row.status !== "invalid") row.status = "stale"; row.problems.push(message); };
      if (Object.keys(value).some(k => !keys.includes(k)) || keys.some(k => !safeText(value[k]))) invalid(`Expected only ${keys.join(", ")} as nonempty single-line strings`);
      if (!row.claim || !REF.test(row.claim)) invalid("Malformed guarantee reference");
      const matches = guarantees.filter(g => g.id === row.claim);
      if (matches.length !== 1) invalid(matches.length ? "Ambiguous guarantee reference" : "Guarantee is missing or its contract changed");
      const guarantee = matches.length === 1 ? matches[0] : null;
      if (!row.provider || !ids.has(row.provider)) invalid("Provider component is missing");
      if (guarantee && guarantee.component !== row.provider) invalid("Claim does not belong to the declared provider");
      const identity = JSON.stringify([kind, row.claim, row.provider, row.subject, row.obligation]);
      if (duplicates.has(identity)) invalid("Duplicate link declaration");
      duplicates.add(identity);
      if (kind === "relies") {
        if (row.provider === owner) invalid("A reliance must name another component");
        if (!relations.some(r => r.source === owner && r.target === row.provider)) invalid("No canonical dependency connects consumer to provider (v0 direct-import grade)");
      } else {
        if (!row.assessment || !ASSESSMENT.test(row.assessment)) invalid("Malformed assessment reference");
        const item = row.subject ? subjects.get(row.subject) : undefined;
        if (!taxonomy.view) invalid("Taxonomy is unavailable; applicability cannot be checked");
        else if (!item) invalid("Classified subject is missing");
        if (item) {
          if (item.record.id !== row.assessment) stale("Assessment revision changed");
          if (item.status === "stale") stale(`Assessment expired: ${item.staleReasons.join("; ")}`);
          if (!["classified", "composite"].includes(item.classification.assessment)) invalid("Subject has no accepted role classification");
          if (item.record.snapshot.subject.owner !== component.id) invalid("Classified subject does not belong to this provider");
          const live = graph.nodes.filter(n => n.id === item.record.snapshot.subject.node);
          const file = live[0]?.kind === "symbol" ? graph.nodes.find(n => n.id === live[0].parent) : live[0];
          if (live.length !== 1 || file?.parent !== component.id) invalid("Current subject ownership does not match the declaration");
          if (!item.classification.suggestions.some(s => s.id === row.obligation)) invalid("Obligation is not activated by the current assessment");
        }
      }
      issues.push(...row.problems.map(p => `${owner} ${kind} ${row.claim ?? "?"}: ${p}`));
      links.push(row);
    }
  }
  links.sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0);
  const obligations = (taxonomy.view?.items ?? []).flatMap(item => item.classification.suggestions.map(suggestion => {
    const claims = [...new Set(links.filter(link => link.kind === "addresses" && link.status === "current"
      && link.subject === item.record.snapshot.subject.target && link.obligation === suggestion.id).map(link => link.claim!))].sort();
    return { owner: item.record.snapshot.subject.owner?.slice(2) ?? null, subject: item.record.snapshot.subject.target,
      assessment: item.record.id, obligation: suggestion.id, text: suggestion.text,
      applicability: item.status === "stale" ? "stale" as const : "caller-assessed" as const,
      assessmentState: item.classification.assessment, mapping: claims.length ? "linked" as const : "unlinked" as const,
      claims, satisfaction: "unverified" as const };
  })).sort((a, b) => `${a.subject}:${a.obligation}` < `${b.subject}:${b.obligation}` ? -1 : 1);
  return { version: 1, links, obligations, issues: issues.sort(), taxonomy: taxonomy.view ? "available" : "unavailable", limit: LIMIT };
}
