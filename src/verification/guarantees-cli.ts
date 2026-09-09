import type { Config, Graph } from "../types.ts";
import { buildGraph } from "../derivation/derive.ts";
import { buildPromiseModel } from "../readings/promise.ts";
import { buildScopeModel } from "../readings/scope-model.ts";
import { readStatus } from "../evidence/status.ts";
import { taxonomyView } from "../taxonomy/taxonomy-ledger.ts";
import type { GuaranteeTaxonomy } from "./guarantees.ts";
import { GUARANTEE_CATALOG_USAGE, runGuaranteeCatalog } from "./guarantee-catalog-cli.ts";
import { projectBindings } from "./guarantee-bindings.ts";

/** Damage is a visible unavailable reading, not an empty healthy taxonomy. */
export function readGuaranteeTaxonomy(cfg: Config): GuaranteeTaxonomy {
  try { return { view: taxonomyView(cfg), error: null }; }
  catch (error) { return { view: null, error: String((error as Error).message) }; }
}
/** Load canonical evidence once and project the same inventory consumed by Scope. */
export async function projectGuarantees(cfg: Config, graph?: Graph) {
  graph ??= await buildGraph(cfg);
  const status = await readStatus(cfg);
  const model = buildScopeModel(graph, await buildPromiseModel(cfg, graph, status), cfg, readGuaranteeTaxonomy(cfg));
  const bindings = projectBindings(cfg, graph, status);
  if (bindings.items.length) model.catalogBindings = bindings;
  return model;
}
const HELP = `coherence guarantees [--check] [--json]
${GUARANTEE_CATALOG_USAGE}
catalog reads candidate vocabulary only; it does not activate, bind or verify it.
Read-only inventory of spec guarantees, taxonomy obligations and explicit links.
--check checks declared-link integrity, not obligation satisfaction or test outcomes.
Unlinked obligations and dependencies remain visible; this is not a coverage claim.
Specs own JSON bullets in ## addresses, ## relies on and ## guarantee bindings.
Bindings explicitly adopt candidate definitions with parameters, falsifiers and pinned inputs.
Optional flow: {from:{subject,title},to:{subject,title}} names owned, pinned file#symbol
endpoints for Scope. Direction and role titles are caller-assessed; not an inferred call graph.
verify records named-oracle support only across unchanged binding inputs; --from-report
does not establish that execution interval. No immutable receipt or browser write command.
Use --json for complete references, obligations, evidence and link diagnostics.`;
/** Strict read-only CLI: checks referential integrity without running any oracle. */
export async function runGuaranteesCommand(cfg: Config, args: string[]): Promise<{ code: number; output: string }> {
  if (args[0] === "catalog") return runGuaranteeCatalog(args.slice(1));
  if (args.length === 1 && ["help", "--help"].includes(args[0])) return { code: 0, output: HELP };
  if (args.some(a => !["--check", "--json"].includes(a)) || new Set(args).size !== args.length) return { code: 2, output: HELP };
  const model = await projectGuarantees(cfg), reading = model.guaranteeLinks!;
  const code = args.includes("--check") && (reading.issues.length || reading.taxonomy === "unavailable" || model.catalogBindings?.issues.length) ? 1 : 0;
  const data = { ...reading, guarantees: model.guarantees, dependencies: model.relations, ...(model.catalogBindings ? { catalogBindings: model.catalogBindings } : {}) };
  if (args.includes("--json")) return { code, output: JSON.stringify(data, null, 2) };
  const output = ["GUARANTEES — declarations and recorded evidence; mappings are caller-assessed",
    `${model.guarantees.length} guarantees · ${reading.links.length} declared links · ${reading.obligations.filter(o => o.mapping === "unlinked").length} unlinked obligations`,
    ...model.guarantees.map(g => `${g.id}\n  ${g.component}: ${g.invariant}\n  ${g.verdict} · ${g.chokepoint} · oracle: ${g.oracle || "none"}`),
    ...reading.links.map(l => `${l.owner} ${l.kind} ${l.claim}: ${l.status}${l.provider ? ` · provider ${l.provider}` : ""}`),
    ...(model.catalogBindings?.items ?? []).map(b => `${b.id}\n  ${b.definition?.title ?? "Invalid binding"} · ${b.binding?.subject ?? "?"}\n  applicability ${b.status} · named oracle ${b.observation.verdict}`),
    ...[...reading.issues, ...(model.catalogBindings?.issues ?? [])].map(issue => `ISSUE ${issue}`), reading.limit,
    ...(model.catalogBindings ? [model.catalogBindings.limit] : [])].join("\n");
  return { code, output: output.replace(/[\x00-\x08\x0b-\x1f\x7f]/gu, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`) };
}
