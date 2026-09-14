// Canonical readers adapt evidence into assets once. Renderers never interpret ledgers.
import { createHash } from "node:crypto";
import { readFile, readdir, lstat } from "node:fs/promises";
import { join, relative } from "node:path";
import type { Config, Graph } from "../../types.ts";
import { buildGraph } from "../../derivation/derive.ts";
import { findSpec, parseSpec, parseZones, refutedInvariants } from "../../derivation/walk.ts";
import { parseBoundary } from "../../verification/boundary.ts";
import { buildPromiseModel } from "../promise.ts";
import { buildScopeModel } from "../scope-model.ts";
import { readStatus } from "../../evidence/status.ts";
import { readTrustedJournal, resolve as resolveJournal } from "../../evidence/decisions.ts";
import { readDefects } from "../../evidence/defects.ts";
import { readExperiments } from "../../evidence/experiment.ts";
import { readWork } from "../../coordination/work.ts";
import { readConsequences, formatConsequenceRef } from "../../coordination/consequence.ts";
import { listReceipts, readReceipt, readReceiptStart } from "../../evidence/receipts.ts";
import { doctrineDocument } from "../../coordination/doctrine.ts";
import { taxonomyView } from "../../taxonomy/taxonomy-ledger.ts";
import { TAXONOMY } from "../../taxonomy/taxonomy-catalog.ts";
import { GUARANTEE_CATALOG } from "../../verification/guarantee-catalog.ts";
import { projectBindings } from "../../verification/guarantee-bindings.ts";
import { parseWord } from "../../verification/phrasebook.ts";
import { LIFECYCLE_HOOK_EVENTS, inspectLifecycleHook } from "../../lifecycle/control.ts";
import { agentInstructions, currentObservation } from "../../lifecycle/hooks.ts";
import { readHookText, composeHookText } from "../../lifecycle/hook-text.ts";
import { readActivity } from "../../lifecycle/activity.ts";
import { readTraceDetailed } from "../../lifecycle/read-trace.ts";
import { readCalibrationSamples } from "../../diagnostics/calibration.ts";
import { readBaseline } from "../../diagnostics/sidecar.ts";
import { catalogSchema, compare, type Asset, type Catalog, type Relation, type SourceReading, type Value } from "./catalog.ts";
import { resolveScopeConfiguration, type ScopeConfiguration } from "./configuration.ts";

export interface ScopeSnapshot { version: 1; catalog: Catalog; configuration: ScopeConfiguration; inputs?: string[] }
const json = (value: unknown): Record<string, Value> => JSON.parse(JSON.stringify(value));
const key = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const labelOf = (value: object): string => {
  const row = value as Record<string, unknown>;
  return String(row.label ?? row.title ?? row.chose ?? row.summary ?? row.hypothesis ?? row.objective ?? row.claim ?? row.id ?? row.event ?? "Record");
};

/** Source transactions prevent a failed reader from publishing a healthy-looking subset. */
export class AssetCatalog {
  assets: Asset[] = []; relations: Relation[] = []; sources: SourceReading[] = [];
  add(kind: string, id: string, label: string, attributes: unknown, source: string): string {
    const address = `${kind}:${id}`;
    this.assets.push({ id: address, kind, label, source, attributes: json(attributes) });
    return address;
  }
  link(kind: string, source: string, target: string, attributes: unknown = {}, identity?: string) {
    this.relations.push({ id: `relation:${identity ?? key([kind, source, target, attributes])}`, kind, source, target, attributes: json(attributes) });
  }
  async read(id: string, action: () => unknown | Promise<unknown>) {
    const start = this.assets.length, edges = this.relations.length;
    try {
      await action();
      this.sources.push({ id, status: "available", count: this.assets.length - start, message: "Canonical reader completed; no checks executed by Scope." });
    } catch (error) {
      this.assets.length = start; this.relations.length = edges;
      this.sources.push({ id, status: "unavailable", count: 0, message: String((error as Error).message ?? error) });
    }
  }
  finish(project: string): Catalog {
    const byId = new Map<string, Asset>();
    for (const asset of this.assets) {
      const old = byId.get(asset.id);
      if (old && JSON.stringify(old) !== JSON.stringify(asset)) throw new Error(`Scope asset identity conflict: ${asset.id}`);
      byId.set(asset.id, asset);
    }
    // Explicit but unresolved addresses remain references, never invented evidence.
    for (const relation of this.relations) for (const endpoint of [relation.source, relation.target]) if (!byId.has(endpoint)) {
      byId.set(endpoint, { id: endpoint, kind: "reference", label: endpoint, source: "references",
        attributes: { status: "unresolved", address: endpoint, detail: "Explicitly referenced; no captured asset establishes existence or validity." } });
    }
    const sources = [...this.sources].sort((a, b) => compare(a.id, b.id));
    for (const source of sources) byId.set(`source:${source.id}`, { id: `source:${source.id}`, kind: "source", label: source.id, source: source.id, attributes: json(source) });
    const assets = [...byId.values()].sort((a, b) => compare(a.id, b.id));
    const relations = [...new Map(this.relations.map(r => [r.id, r])).values()].sort((a, b) => compare(a.id, b.id));
    return { version: 1, project, assets, relations, sources, schema: catalogSchema(assets), limits: [
      "Scope reads evidence. It never runs verification, executes hooks, or grants work authority.",
      "Recorded verdicts, caller assessments, local executor receipts and transient host observations retain their different evidence grades.",
      "An unresolved reference is navigation, not proof of existence. No relationship is inferred from temporal or path proximity.",
      "Source availability is independent of view filters. Graph pagination names omitted connections; a projection is not the whole project.",
      "Configuration is presentation data, not an access-control boundary. Offline HTML contains the complete captured catalog.",
    ] };
  }
}

export async function readScopeConfiguration(cfg: Config): Promise<ScopeConfiguration> {
  let raw: unknown;
  try { raw = JSON.parse(await readFile(join(cfg.root, "coherence.scope.json"), "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error(`Scope configuration coherence.scope.json: ${(error as Error).message}`); }
  return resolveScopeConfiguration(raw);
}

/** Enumerate session identities only; canonical readers below still validate every row. */
async function traceSessions(cfg: Config, directory: string): Promise<string[]> {
  const dir = join(cfg.root, ".coherence", directory);
  let files;
  try { if (!(await lstat(dir)).isDirectory() || (await lstat(dir)).isSymbolicLink()) throw new Error("Expected a real trace directory"); files = await readdir(dir); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return []; throw e; }
  const sessions = new Set<string>();
  for (const name of files.sort()) {
    const path = join(dir, name), stat = await lstat(path);
    if (!name.endsWith(".jsonl") || !stat.isFile() || stat.isSymbolicLink()) throw new Error(`Unexpected trace entry ${directory}/${name}`);
    for (const line of (await readFile(path, "utf8")).split("\n").filter(v => v.trim())) {
      const row = JSON.parse(line);
      if (typeof row?.session !== "string" || !row.session) throw new Error(`Trace lacks session identity: ${directory}/${name}`);
      sessions.add(row.session);
    }
  }
  return [...sessions].sort(compare);
}

export async function captureScope(cfg: Config, options: { graph?: Graph; configuration?: ScopeConfiguration } = {}): Promise<ScopeSnapshot> {
  const configuration = options.configuration ?? await readScopeConfiguration(cfg);
  const c = new AssetCatalog();
  const sessions = new Set<string>();
  let graph: Graph | undefined, status: Awaited<ReturnType<typeof readStatus>> | undefined;
  let taxonomy: ReturnType<typeof taxonomyView> | undefined;
  await c.read("status", async () => {
    const reading = await readStatus(cfg);
    for (const [id, value] of Object.entries(reading)) if (id !== "version") c.add("instrument", id, id, value, "status");
    for (const row of reading.verify?.claims ?? []) c.add("claim-result", key([row.node, row.claim]), row.claim, row, "status");
    status = reading;
  });
  await c.read("taxonomy", () => {
    const reading = taxonomyView(cfg);
    const current = new Map(reading.items.map(item => [item.record.id, item]));
    for (const row of reading.records) {
      sessions.add(row.session);
      const asset = c.add("assessment", row.id, row.snapshot.subject.target, { ...row, ...current.get(row.id), status: current.get(row.id)?.status ?? "superseded" }, "taxonomy");
      c.link("assesses", asset, `${row.snapshot.subject.kind}:${row.snapshot.subject.target}`);
    }
    taxonomy = reading;
  });
  await c.read("structure", async () => {
    const reading = options.graph ?? await buildGraph(cfg);
    // Without status the structural graph is still visible, but no promise reading is promoted.
    const scope = status ? buildScopeModel(reading, await buildPromiseModel(cfg, reading, status), cfg,
      { view: taxonomy ?? null, error: taxonomy ? null : "Taxonomy unavailable" }) : null;
    c.add("project", ".", reading.root, { name: reading.root, bindings: reading.bindings }, "structure");
    const components = new Map(scope?.nodes.map(n => [n.graphNodeId, n]));
    const nodeAddress = (id: string) => {
      const node = reading.nodes.find(n => n.id === id);
      const kind = node && ["component", "file", "symbol"].includes(node.kind) ? node.kind : "resource";
      return `${kind}:${id.replace(/^[cfs]:/, "")}`;
    };
    for (const node of reading.nodes) {
      const kind = ["component", "file", "symbol"].includes(node.kind) ? node.kind : "resource";
      const semantic = components.get(node.id);
      const attributes = { ...node, ...(semantic ? { intent: semantic.intent, mass: semantic.mass, role: semantic.role,
        guarantees: scope!.guarantees.filter(g => g.component === semantic.id).map(g => ({ id: g.id, invariant: g.invariant, verdict: g.verdict })) } : {}) };
      const address = c.add(kind, node.id.replace(/^[cfs]:/, ""), node.label, attributes, "structure");
      if (node.parent) c.link("contains", nodeAddress(node.parent), address);
      for (const claim of node.claims ?? []) {
        const id = c.add("claim", key([node.id, claim]), claim, { text: claim, owner: node.id, claimKind: node.claimKinds?.[claim] ?? null }, "structure");
        c.link("declares", address, id);
      }
    }
    for (const edge of reading.edges) c.link(edge.kind, nodeAddress(edge.source), nodeAddress(edge.target), edge, `graph:${edge.id}`);
    if (scope) {
      for (const row of scope.guarantees) {
        const id = c.add("guarantee", row.id, row.invariant, row, "structure");
        c.link("declares", `component:${row.component}`, id);
      }
      for (const row of scope.relations) {
        c.add("reliance", row.id, `${row.source} → ${row.target}`, row, "structure");
        c.link(row.kind, `component:${row.source}`, `component:${row.target}`, row, row.id);
      }
      for (const row of scope.transitions) {
        c.add("transition", key(row), row.translates || row.symbol, row, "structure");
        c.link("translates", `chart:${row.from}`, `chart:${row.to}`, row);
      }
      for (const [id, intent] of Object.entries(scope.charts ?? {})) c.add("chart", id, id, { intent }, "structure");
      for (const row of scope.guaranteeLinks?.links ?? []) {
        const id = c.add("guarantee-link", key(row), `${row.owner} ${row.kind} ${row.claim ?? "?"}`, row, "structure");
        if (row.claim) c.link("references", id, `guarantee:${row.claim}`);
        if (row.kind === "relies" && row.provider) c.link("relies", `component:${row.owner}`, `component:${row.provider}`, { ...row, declaration: id });
      }
      for (const row of scope.guaranteeLinks?.obligations ?? []) {
        const id = c.add("obligation", key([row.subject, row.obligation]), row.text, row, "structure");
        for (const claim of row.claims) c.link("addresses", `guarantee:${claim}`, id);
      }
      for (const row of projectBindings(cfg, reading, status!).items) {
        const id = c.add("binding", row.id, row.definition?.title ?? "Invalid binding", row, "structure");
        if (row.binding?.claim) c.link("binds", id, `guarantee:${row.binding.claim}`);
        const subjectAddress = (subject: string) => `${subject.includes("#") ? "symbol" : "file"}:${subject}`;
        if (row.binding?.subject) c.link("binding-subject", id, subjectAddress(row.binding.subject));
        if (row.binding?.flow) c.link("binding-flow", subjectAddress(row.binding.flow.from.subject), subjectAddress(row.binding.flow.to.subject), row);
      }
    }
    graph = reading;
  });
  await c.read("architecture", () => {
    if (!graph) throw new Error("Structural population unavailable");
    const architecture = graph.architecture;
    if (!architecture) return;
    for (const [index, message] of architecture.problems.entries())
      c.add("architecture-issue", key([message, index]), "Architecture issue", { message }, "architecture");
    for (const row of architecture.declarations) {
      if (row.kind === "purpose") {
        c.add("description", `architecture:${row.owner}:${row.id}`, "Project purpose", { ...row, category: "project-purpose", declaration: `${row.spec}:${row.line}` }, "architecture");
      } else if (row.kind === "entrance") {
        const id = c.add("entrance", `${row.owner}:${row.id}`, row.label, { ...row, declaration: `${row.spec}:${row.line}` }, "architecture");
        c.link("enters", id, `component:${row.component}`, { description: row.description });
      } else {
        const id = c.add("architectural-link", `${row.owner}:${row.id}`, row.label, { ...row, declaration: `${row.spec}:${row.line}` }, "architecture");
        c.link("architecture", `component:${row.from}`, `component:${row.to}`, { ...row, declaration: id }, `architecture:${row.owner}:${row.id}`);
      }
    }
  });
  await c.read("specs", async () => {
    if (!graph) throw new Error("Structural population unavailable; specs cannot be selected independently of their canonical owners.");
    for (const node of graph.nodes.filter(n => n.kind === "component")) {
      const owner = node.id.replace(/^c:/, ""), path = await findSpec(join(cfg.root, owner));
      if (!path) throw new Error(`Missing spec for ${node.id}`);
      const text = await readFile(path, "utf8"), parsed = parseSpec(text), file = relative(cfg.root, path);
      const id = c.add("spec", file, parsed.name, { ...parsed, path: file, owner, text }, "specs");
      c.link("defines", id, `component:${owner}`);
      for (const category of ["intent", "prose", "why"] as const) if (parsed[category]) {
        const child = c.add(category === "why" ? "rationale" : "description", key([file, category]), `${parsed.name} · ${category}`, { text: parsed[category], category, owner, spec: id }, "specs");
        c.link("contains", id, child);
      }
      const witnessed = refutedInvariants(parsed.refutations);
      for (const invariant of parsed.invariants) {
        const anchors = parsed.claims.filter(claim => parseBoundary(claim)?.inv === invariant);
        const child = c.add("invariant", key([file, invariant]), invariant, { text: invariant, owner, spec: id, anchors, anchored: anchors.length > 0, refuted: witnessed.has(invariant) }, "specs");
        c.link("declares", id, child);
        for (const claim of anchors) c.link("anchors", `claim:${key([node.id, claim])}`, child);
      }
      for (const refutation of parsed.refutations) {
        const names = [...refutedInvariants([refutation])];
        const child = c.add("refutation", key([file, refutation]), refutation, { text: refutation, owner, spec: id, invariants: names, basis: "authored-negative-control" }, "specs");
        c.link("contains", id, child);
        for (const name of names) if (parsed.invariants.includes(name)) c.link("refutes", child, `invariant:${key([file, name])}`);
      }
      const zones = parseZones(text);
      for (const [index, zone] of zones.entries()) {
        const child = c.add("zone", key([file, index]), zone.name, { ...zone, owner, spec: id, order: index, authoritative: owner === cfg.entryDir }, "specs");
        c.link("declares", id, child);
        const parents = zones.flatMap((z, i) => z.name === zone.inside ? [i] : []);
        if (parents.length === 1) c.link("zone-inside", child, `zone:${key([file, parents[0]])}`);
      }
      // Raw sections include unknown headings, repeated headings, and malformed bullets.
      // This indexes authored text only; parseSpec/parseZones still own its semantics.
      const lines = text.split("\n");
      let section: { heading: string; level: number; line: number; lines: string[] } | null = null;
      let fence: string | null = null;
      const finish = () => {
        if (!section) return;
        const child = c.add("spec-section", key([file, section.line]), section.heading, { heading: section.heading, category: section.heading.toLowerCase(),
          level: section.level, line: section.line, text: section.lines.join("\n"), owner, spec: id }, "specs");
        c.link("contains", id, child);
      };
      for (const [index, line] of lines.entries()) {
        const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
        const heading = !fence ? /^(#{1,6})\s+(.+?)\s*$/.exec(line) : null;
        if (heading) { finish(); section = { heading: heading[2], level: heading[1].length, line: index + 1, lines: [line] }; }
        else section?.lines.push(line);
        if (marker) { if (!fence) fence = marker; else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null; }
      }
      finish();
    }
  });
  await c.read("journal", () => {
    const ledger = readTrustedJournal(cfg);
    if (!ledger.ok) throw new Error(ledger.damage.map(d => d.detail).join("; "));
    const states = new Map<string, string>();
    for (const [state, entries] of Object.entries(resolveJournal(ledger.records))) for (const entry of entries) states.set(("rec" in entry ? entry.rec : entry).id, state);
    const groups = new Map<string, typeof ledger.records>();
    for (const row of ledger.records) {
      sessions.add(row.session);
      const address = row.kind === "session" ? key(row) : row.id;
      groups.set(address, [...(groups.get(address) ?? []), row]);
    }
    for (const [address, occurrences] of groups) {
      const row = occurrences[occurrences.length - 1];
      const id = c.add("decision", address, labelOf(row), { ...row, state: states.get(row.id) ?? row.kind, occurrences }, "journal");
      if (row.supersedes) c.link(row.kind, id, `decision:${row.supersedes}`);
    }
  });
  await c.read("defects", () => { for (const row of readDefects(cfg).records) { sessions.add(row.session); c.add("defect", row.id, row.summary, row, "defects"); } });
  await c.read("experiments", () => {
    const ledger = readExperiments(cfg);
    for (const row of ledger.records) {
      const id = c.add("experiment-event", row.id, labelOf(row), row, "experiments");
      c.link("experiment-history", id, `experiment:${"experiment" in row ? row.experiment : row.id}`);
    }
    for (const item of ledger.experiments) {
      sessions.add(item.opened.session);
      c.add("experiment", item.opened.id, item.opened.hypothesis, { ...item.opened, closed: item.closed, state: item.closed ? "closed" : "open" }, "experiments");
    }
  });
  await c.read("work", () => {
    const ledger = readWork(cfg);
    for (const row of ledger.records) {
      const id = c.add("work-event", row.id, labelOf(row), row, "work");
      c.link("work-history", id, `work:${row.work}`);
    }
    for (const item of ledger.works) {
      sessions.add(item.owner.session);
      const id = c.add("work", item.work, item.opened.objective, item, "work");
      if (item.opened.parent) c.link("parent-work", `work:${item.opened.parent}`, id);
      for (const dep of item.opened.dependsOn) c.link("depends-on", id, `work:${dep}`);
    }
  });
  await c.read("consequences", () => {
    for (const row of readConsequences(cfg).records) {
      c.add("consequence", row.id, `${row.from.kind} ${row.relation} ${row.to.kind}`, row, "consequences");
      c.link(row.relation, formatConsequenceRef(row.from), formatConsequenceRef(row.to), row, row.id);
    }
  });
  await c.read("receipts", () => {
    const ledger = listReceipts(cfg);
    for (const ref of ledger.completed) {
      const receipt = readReceipt(cfg, ref);
      c.add("verification", ref.slice("verification:".length), ref, receipt, "receipts");
      if (receipt.start.session) sessions.add(receipt.start.session);
      if (receipt.start.work) c.link("bound-to", ref, `work:${receipt.start.work.work}`);
    }
    for (const run of ledger.incomplete) {
      const start = readReceiptStart(cfg, run);
      c.add("verification-start", run, run, { ...start, status: "incomplete" }, "receipts");
      if (start.session) sessions.add(start.session);
    }
  });
  await c.read("catalogs", () => {
    for (const row of GUARANTEE_CATALOG.definitions) c.add("guarantee-definition", row.id, row.title, { ...row, catalog: GUARANTEE_CATALOG.version, limit: GUARANTEE_CATALOG.limit }, "catalogs");
    for (const [kind, rows] of [["taxonomy-role", TAXONOMY.roles], ["taxonomy-facet", TAXONOMY.facets], ["taxonomy-question", TAXONOMY.questions], ["taxonomy-suggestion", TAXONOMY.guarantees]] as const)
      for (const row of rows) c.add(kind, row.id, labelOf(row), { ...row, catalog: TAXONOMY.version }, "catalogs");
    c.add("doctrine", "current", "Coordination doctrine", doctrineDocument(), "catalogs");
  });
  await c.read("configuration", () => {
    const { root: _root, ...settings } = cfg;
    c.add("configuration", "project", "Coherence configuration", settings, "configuration");
    c.add("configuration", "scope", "Scope configuration", configuration, "configuration");
  });
  await c.read("dictionary", async () => {
    const dir = join(cfg.root, cfg.dictionary ?? "dictionary");
    let files;
    try { files = await readdir(dir); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return; throw e; }
    for (const file of files.filter(f => f.endsWith(".md")).sort()) {
      const text = await readFile(join(dir, file), "utf8"), word = parseWord(text);
      if (!word) throw new Error(`Malformed dictionary word ${file}`);
      c.add("word", file, word.name, { ...word, text, path: relative(cfg.root, join(dir, file)) }, "dictionary");
    }
  });
  for (const name of ["mass-baseline.json", "sinks-baseline.json", "conventions-baseline.json"]) await c.read(`baseline:${name}`, async () => {
    const data = await readBaseline(cfg, name);
    if (data !== null) c.add("baseline", name, name, { data, path: join(cfg.outputDir, name), grade: "recorded-baseline" }, `baseline:${name}`);
  });
  await c.read("calibration", () => { for (const row of readCalibrationSamples(cfg)) c.add("calibration", key(row), row.session, row, "calibration"); });
  for (const [directory, kind, reader] of [["activity", "activity", readActivity], ["read-traces", "read", readTraceDetailed]] as const) await c.read(directory, async () => {
    const discovered = await traceSessions(cfg, directory);
    for (const session of [...new Set([...sessions, ...discovered])].sort(compare)) {
      const reading = reader(cfg, session);
      if (reading.unreadable) throw new Error(`${reading.unreadable} unreadable ${directory} rows for ${session}`);
      for (const [i, row] of reading.rows.entries()) c.add(kind, key([row, i]), `${row.at} · ${row.session}`, row, directory);
    }
    for (const session of discovered) sessions.add(session);
  });
  await c.read("sessions", () => {
    for (const session of [...sessions].sort(compare)) c.add("session", session, session, { session }, "sessions");
    for (const asset of c.assets) {
      const session = asset.attributes.session;
      if (asset.kind !== "session" && typeof session === "string" && sessions.has(session)) c.link("recorded-by", asset.id, `session:${session}`);
    }
  });
  await c.read("hooks", () => {
    for (const event of LIFECYCLE_HOOK_EVENTS) {
      const customization = readHookText(cfg, event);
      const startup = event === "SessionStart" || event === "SubagentStart";
      const canonical = startup ? agentInstructions("{{session}}", "coherence", "{{agent}}") : "";
      const slot = (v: typeof customization.override) => v ? { path: relative(cfg.root, v.path), text: v.text } : null;
      c.add("hook", event, event, { event, canonical, override: slot(customization.override), append: slot(customization.append),
        problems: customization.problems, template: composeHookText(canonical, customization, {}), grade: "static-template",
        detail: "Runtime work, advisories and journal context are composed at invocation. This is not captured delivery." }, "hooks");
    }
  });
  for (const host of ["claude", "codex"] as const) await c.read(`control:${host}`, () => {
    const control = inspectLifecycleHook(cfg, host);
    c.add("control", host, host, control, `control:${host}`);
    for (const session of [...sessions].sort(compare)) {
      const id = c.add("observation", `${host}:${session}`, `${host} · ${session}`, { ...currentObservation(cfg, control, session), host }, `control:${host}`);
      c.link("observes", `control:${host}`, id);
      c.link("observed-session", id, `session:${session}`);
    }
  });
  const catalog = c.finish(graph?.root ?? cfg.name ?? "Project");
  const inputs = new Set<string>();
  for (const asset of catalog.assets) {
    const a = asset.attributes;
    if (asset.kind === "spec" && typeof a.path === "string") inputs.add(a.path);
    if (asset.kind === "assessment") for (const path of Object.keys((a.snapshot as { files?: object })?.files ?? {})) inputs.add(path);
    if (asset.kind === "binding") for (const path of Object.keys((a.binding as { evidence?: object })?.evidence ?? {})) inputs.add(path);
    if (asset.kind === "control") {
      for (const file of (a.files ?? []) as Array<{ path?: string }>) if (file.path) inputs.add(file.path);
      const launcher = a.launcher as { path?: string; mappingPath?: string; targetPath?: string } | null;
      for (const path of [launcher?.path, launcher?.mappingPath, launcher?.targetPath, (a.codexConfig as { path?: string } | null)?.path]) if (path) inputs.add(path);
    }
  }
  return { version: 1, configuration, catalog, inputs: [...inputs].sort(compare) };
}
