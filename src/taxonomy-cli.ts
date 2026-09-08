import type { Config } from "./types.ts";
import { buildGraph } from "./derive.ts";
import { requireDeclaredRoot } from "./floor.ts";
import { TAXONOMY } from "./taxonomy-catalog.ts";
import { classifyTaxonomy, captureTaxonomy, profileTaxonomy, TaxonomyError, TAXONOMY_LIMIT } from "./taxonomy.ts";
import type { TaxonomyAnswer } from "./taxonomy.ts";
import { recordTaxonomy, taxonomyView } from "./taxonomy-ledger.ts";
import type { TaxonomyRecord } from "./taxonomy-ledger.ts";
import type { TaxonomySelection, TaxonomySnapshot } from "./taxonomy.ts";

const HELP = `coherence taxonomy — caller-assessed classification, never verification

  catalog [role:ID|facet:ID|signal:ID|guarantee:ID] [--json]
  profile [--json]                         root manifest observations only
  inspect <file[#symbol]> [options]        resolved subject, candidates and questions
  record <file[#symbol]> [options] --expected <none|RECORD_ID>
         --session SESSION --because REASON --evidence <file[#symbol]>
  list [--session SESSION] [--check] [--json]
  show <RECORD_ID> [--check] [--json]

Options: --domain simulation; repeatable --answer signal:ID=yes|no|unknown,
--role role:ID, --facet facet:ID, --evidence file[#symbol], --dependency file[#symbol].
Record also accepts --agent NAME. Evidence is required for positive assessments.
Record revisions are complete replacements; supply all retained answers/roles/facets.
Only record writes. --expected protects against stale concurrent revisions.
Read --check requires a nonempty, current classified/composite population, not passing
guarantees. No attest, satisfied, verify, receipt or finalization operation exists.
Representation roles additionally require parses-syntax, validates-rules,
transforms-form or optimizes-form evidence. Unassessed, needs-evidence and no-fit
remain distinct. Inspect starts a fresh proposal and shows any saved assessment beside it.
All suggested guarantees remain UNVERIFIED. Use JSON for complete machine-readable data.`;

function renderTaxonomyResult(command: string, data: unknown): string {
  const banner = "TAXONOMY — caller-assessed classification; guarantees UNVERIFIED";
  if (command === "catalog" && data === TAXONOMY) return [banner,
    `${TAXONOMY.roles.length} terminal roles · ${TAXONOMY.facets.length} facets · ${TAXONOMY.questions.length} signals · ${TAXONOMY.guarantees.length} obligation suggestions`,
    ...TAXONOMY.roles.map(r => `  ${r.id}  [${r.pack}] ${r.label}`),
    "Inspect one namespaced ID with taxonomy catalog <ID>; --json includes the complete catalog."].join("\n");
  if (command === "profile") {
    const value = data as ReturnType<typeof profileTaxonomy>;
    return [banner, ...value.facts.map(f => `  ${f.source}: ${f.fact}`), value.limit].join("\n");
  }
  if (command === "list") {
    const value = data as ReturnType<typeof taxonomyView>;
    return [banner, `${value.items.length} current classifications`,
      ...value.items.slice(0, 30).map(i => `  ${i.status}  ${i.record.snapshot.subject.target}\n    ${i.record.id}\n    ${i.classification.roles.join(" + ") || "No selected role"}`),
      value.items.length > 30 ? `${value.items.length - 30} more withheld; --json includes all.` : "", value.limit].filter(Boolean).join("\n");
  }
  if (command === "catalog") return `${banner}\n${JSON.stringify(data, null, 2)}`;
  const value = data as { record?: TaxonomyRecord; snapshot?: TaxonomySnapshot; classification?: TaxonomySelection; status?: string; staleReasons?: string[]; next?: string; currentAssessment?: ReturnType<typeof taxonomyView>["items"][number] | null };
  const snapshot = value.record?.snapshot ?? value.snapshot, classification = value.classification;
  return [banner, snapshot?.subject.target, value.record ? `Record: ${value.record.id}\nBecause: ${value.record.because}` : "Read-only inspection; nothing recorded.",
    value.currentAssessment ? `Saved assessment: ${value.currentAssessment.status} · ${value.currentAssessment.record.id}\nSaved roles: ${value.currentAssessment.classification.roles.join(" + ") || "none"}. Proposal below does not overwrite it.` : "",
    `State: ${value.status ?? classification?.assessment}`, ...(value.staleReasons ?? []).map(s => `  STALE: ${s}`),
    classification ? `Selected: ${classification.roles.join(" + ") || "none"}\nFacets: ${classification.facets.join(", ") || "none assessed positive"}` : "",
    ...(classification?.candidates.slice(0, 6) ?? []).map(c => `  Candidate ${c.id}\n    ${c.responsibility}\n    support: ${c.support.join(", ")}${c.needsEvidence ? `; REQUIRED: ${c.needsEvidence}` : ""}${c.tensions.length ? `; competing signals: ${c.tensions.join(", ")}` : ""}`),
    classification && classification.candidates.length > 6 ? `${classification.candidates.length - 6} additional candidates retained in --json.` : "",
    ...(classification?.suggestions.slice(0, 10) ?? []).map(g => `  UNVERIFIED ${g.id}: ${g.text}`),
    classification && classification.suggestions.length > 10 ? `${classification.suggestions.length - 10} more suggestions in --json.` : "",
    ...(classification?.questions ?? []).map(q => `  ${q.id}: ${q.question}`),
    classification?.unanswered ? `${classification.unanswered} unknown/unanswered signals; showing at most six.` : "",
    value.next, TAXONOMY_LIMIT].filter(Boolean).join("\n");
}

/** Strict command-local parsing keeps new flags out of unrelated CLI commands. */
export async function runTaxonomyCommand(cfg: Config, args: string[]): Promise<{ code: number; output: string }> {
  try {
    if (!args.length || args[0] === "help" || args[0] === "--help") return { code: 0, output: HELP };
    const command = args[0], positional: string[] = [], flags = new Map<string, string[]>();
    const modes: Record<string, string[]> = {
      catalog: ["--json"], profile: ["--json"],
      inspect: ["--json", "--domain", "--answer", "--role", "--facet", "--evidence", "--dependency"],
      record: ["--json", "--domain", "--answer", "--role", "--facet", "--evidence", "--dependency", "--expected", "--session", "--agent", "--because"],
      list: ["--json", "--session", "--check"], show: ["--json", "--check"],
    };
    if (!Object.hasOwn(modes, command)) throw new TaxonomyError(`Unknown taxonomy operation: ${command}`);
    const repeatable = new Set(["--domain", "--answer", "--role", "--facet", "--evidence", "--dependency"]);
    for (let i = 1; i < args.length; i++) {
      const arg = args[i];
      if (!arg.startsWith("--")) { positional.push(arg); continue; }
      if (!modes[command].includes(arg)) throw new TaxonomyError(`Unsupported flag for ${command}: ${arg}`);
      if (flags.has(arg) && !repeatable.has(arg)) throw new TaxonomyError(`Repeated singleton flag: ${arg}`);
      const value = arg === "--json" || arg === "--check" ? "true" : args[++i];
      if (value === undefined || value.startsWith("--")) throw new TaxonomyError(`Missing value for ${arg}`);
      flags.set(arg, [...(flags.get(arg) ?? []), value]);
    }
    const values = (flag: string) => flags.get(flag) ?? [], one = (flag: string) => values(flag)[0];
    if (command === "record") for (const flag of ["--expected", "--session", "--because"])
      if (!one(flag)) throw new TaxonomyError(`Required: ${flag}`);
    const target = positional[0];
    if (positional.length > (command === "catalog" ? 1 : ["inspect", "record", "show"].includes(command) ? 1 : 0)
      || (["inspect", "record", "show"].includes(command) && !target)) throw new TaxonomyError("Wrong number of taxonomy arguments");
    let data: unknown, code = 0;
    if (command === "catalog") {
      data = target ? [...TAXONOMY.roles, ...TAXONOMY.facets, ...TAXONOMY.questions, ...TAXONOMY.guarantees].find(item => item.id === target) : TAXONOMY;
      if (!data) throw new TaxonomyError(`Unknown namespaced taxonomy ID: ${target}`);
    } else {
      requireDeclaredRoot(cfg);
      if (command === "profile") data = profileTaxonomy(cfg);
      else if (command === "list" || command === "show") {
        const view = taxonomyView(cfg);
        if (command === "show") {
          const record = view.records.find(r => r.id === target);
          if (!record) throw new TaxonomyError(`Unknown taxonomy record: ${target}`);
          const item = view.items.find(i => i.record.id === target);
          data = { ...(item ?? { record, status: "superseded" }), limit: view.limit };
          if (flags.has("--check") && (!item || !["classified", "composite"].includes(item.status))) code = 1;
        } else {
          const items = view.items.filter(i => !one("--session") || i.record.session === one("--session"));
          data = { version: view.version, catalogVersion: view.catalogVersion, items, limit: view.limit };
          if (flags.has("--check") && (!items.length || items.some(i => !["classified", "composite"].includes(i.status)))) code = 1;
        }
      } else {
        const answers: Record<string, TaxonomyAnswer> = {};
        for (const pair of values("--answer")) {
          const match = /^(signal:[a-z0-9-]+)=(yes|no|unknown)$/.exec(pair);
          if (!match || Object.hasOwn(answers, match[1])) throw new TaxonomyError(`Invalid or repeated signal answer: ${pair}`);
          answers[match[1]] = match[2] as TaxonomyAnswer;
        }
        const input = { domains: values("--domain"), answers, roles: values("--role"), facets: values("--facet") };
        const graph = await buildGraph(cfg);
        if (command === "record") {
          const expected = one("--expected");
          const record = recordTaxonomy(cfg, graph, { ...input, target, expected: expected === "none" ? null : expected,
            session: one("--session"), agent: one("--agent"), because: one("--because"), evidence: values("--evidence"), dependencies: values("--dependency") });
          data = { record, classification: classifyTaxonomy(input), limit: TAXONOMY_LIMIT };
        } else data = { snapshot: captureTaxonomy(cfg, graph, target, values("--evidence"), values("--dependency")),
          currentAssessment: taxonomyView(cfg).items.find(i => i.record.snapshot.subject.target === target.replace(/^\.\//, "")) ?? null,
          classification: classifyTaxonomy(input), limit: TAXONOMY_LIMIT, next: "Select supported roles (repeat --role for a composite), then taxonomy record with --expected none or the current record ID. No verification is implied." };
      }
    }
    return { code, output: flags.has("--json") ? JSON.stringify(data, null, 2) : renderTaxonomyResult(command, data) };
  } catch (error) {
    const message = (error as Error).message;
    return { code: 2, output: args.includes("--json") ? JSON.stringify({ status: "unavailable", error: message }) : `Taxonomy unavailable: ${message}\nRun coherence taxonomy help for usage.` };
  }
}
