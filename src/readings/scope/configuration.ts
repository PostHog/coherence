import { ASSET_KINDS, compare, textOf, valueAt, type Asset, type Catalog, type Relation, type Value } from "./catalog.ts";

export interface Filter { field: string; op: "eq" | "ne" | "in" | "contains" | "exists" | "gt" | "gte" | "lt" | "lte"; value?: Value }
export interface Field { field: string; label?: string; format?: "text" | "json" | "count" }
export interface View {
  id: string; title: string; description?: string; renderer: "graph" | "table" | "cards";
  kinds: string[]; where?: Filter[]; sort?: { field: string; direction?: "asc" | "desc" }[];
  fields: Field[]; groupBy?: string; pageSize?: number;
  graph?: { relations: string[]; layout: "concentric" | "grid" | "breadthfirst" | "circle";
    weight?: string; width?: number; height?: number; gap?: number; edgeLabel?: string };
}
export interface ScopeConfiguration {
  version: 1; title: string; initialView: string; views: View[];
}
const field = (path: string, label?: string): Field => ({ field: path, ...(label ? { label } : {}) });
const view = (id: string, title: string, kinds: string[], fields: Field[], extra: Partial<View> = {}): View =>
  ({ id, title, kinds, renderer: "table", fields, pageSize: 50, ...extra });

// Defaults use exactly the same language and renderers as a project-authored view.
export const DEFAULT_SCOPE: ScopeConfiguration = {
  version: 1, title: "Scope", initialView: "structure", views: [
    view("structure", "Structure", ["component"], [field("attributes.intent", "Purpose"), field("attributes.mass.ownedFiles", "Files"), { ...field("attributes.guarantees", "Guarantees"), format: "count" }], {
      renderer: "graph", description: "Declared ownership and dependencies. Guarantee evidence belongs to each guarantee; it is not component health.",
      graph: { relations: ["contains", "reliance", "evidence-import", "relies"], layout: "grid", width: 330, height: 220, gap: 48 }, pageSize: 100,
    }),
    view("guarantees", "Guarantees", ["guarantee", "binding", "guarantee-link", "obligation"], [field("kind"), field("attributes.verdict"), field("attributes.status"), field("attributes.component"), field("attributes.oracle")]),
    view("specs", "Specs", ["spec", "spec-section", "invariant", "refutation", "description", "rationale", "zone"], [field("kind"), field("attributes.owner"), field("attributes.category"), field("attributes.text")]),
    view("work", "Work", ["work"], [field("attributes.state"), field("attributes.readiness"), field("attributes.owner"), field("attributes.opened.criteria", "Success")], { renderer: "cards", groupBy: "attributes.state" }),
    view("journal", "Journal", ["decision", "defect", "experiment"], [field("kind"), field("attributes.at"), field("attributes.session"), field("attributes.state"), field("attributes.because")], { sort: [{ field: "attributes.at", direction: "desc" }] }),
    view("taxonomy", "Taxonomy", ["assessment", "obligation"], [field("attributes.status"), field("attributes.classification"), field("attributes.mapping"), field("attributes.satisfaction")]),
    view("evidence", "Evidence", ["verification", "verification-start", "claim-result", "consequence", "instrument", "calibration", "baseline"], [field("kind"), field("attributes.at"), field("attributes.kind", "Recorded result"), field("attributes.detail")]),
    view("hooks", "Hooks", ["control", "hook", "observation"], [field("kind"), field("attributes.host"), field("attributes.status"), field("attributes.template")], { renderer: "cards" }),
    view("assets", "All assets", ["*"], [field("kind"), field("source"), field("id")]),
  ],
};

const bad = (path: string, reason: string): never => { throw new Error(`Scope configuration ${path}: ${reason}`); };
function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) bad(path, "expected an object");
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[], path: string) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) bad(`${path}.${key}`, "unknown property");
}
function string(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) bad(path, "expected a nonempty string");
}
function attr(value: unknown, path: string) {
  string(value, path);
  if (!/^(id|kind|label|source|target|attributes(?:\.[A-Za-z0-9_$-]+)+)$/.test(value) || value.split(".").some(k => ["__proto__", "prototype", "constructor"].includes(k))) bad(path, "expected an asset field or attributes.path");
}
function strings(value: unknown, path: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some(v => typeof v !== "string" || !v.trim()) || new Set(value).size !== value.length) bad(path, "expected distinct strings");
}

/** Unknown syntax refuses. There are no callbacks, expressions, imports or executable templates. */
export function resolveScopeConfiguration(raw?: unknown): ScopeConfiguration {
  if (raw === undefined) return structuredClone(DEFAULT_SCOPE);
  const input = object(raw, "root");
  keys(input, ["version", "extends", "title", "initialView", "views", "removeViews"], "root");
  if (input.version !== 1) bad("version", "supported version is 1");
  if (input.extends !== undefined && input.extends !== "default" && input.extends !== false) bad("extends", 'expected "default" or false');
  const config = input.extends === false ? { version: 1 as const, title: "Scope", initialView: "", views: [] as View[] } : structuredClone(DEFAULT_SCOPE);
  if (input.title !== undefined) { string(input.title, "title"); config.title = input.title; }
  if (input.removeViews !== undefined) {
    strings(input.removeViews, "removeViews");
    for (const id of input.removeViews) if (!config.views.some(v => v.id === id)) bad("removeViews", `unknown default view ${id}`);
    config.views = config.views.filter(v => !(input.removeViews as string[]).includes(v.id));
  }
  if (input.views !== undefined && !Array.isArray(input.views)) bad("views", "expected an array");
  const ids = new Set<string>();
  for (const [index, candidate] of ((input.views ?? []) as unknown[]).entries()) {
    const path = `views[${index}]`, v = object(candidate, path);
    keys(v, ["id", "title", "description", "renderer", "kinds", "where", "sort", "fields", "groupBy", "pageSize", "graph"], path);
    string(v.id, `${path}.id`); string(v.title, `${path}.title`);
    if (!/^[a-z][a-z0-9-]*$/.test(v.id) || ids.has(v.id)) bad(`${path}.id`, "expected a unique lowercase slug");
    ids.add(v.id);
    if (!["graph", "table", "cards"].includes(v.renderer as string)) bad(`${path}.renderer`, "expected graph, table or cards");
    strings(v.kinds, `${path}.kinds`);
    if (!v.kinds.length || v.kinds.some(k => k !== "*" && !Object.hasOwn(ASSET_KINDS, k))) bad(`${path}.kinds`, "unknown or empty asset population");
    if (v.description !== undefined) string(v.description, `${path}.description`);
    if (v.groupBy !== undefined) {
      attr(v.groupBy, `${path}.groupBy`);
      if (v.renderer !== "cards") bad(`${path}.groupBy`, "grouping is supported by cards views");
    }
    if (v.pageSize !== undefined && (!Number.isInteger(v.pageSize) || Number(v.pageSize) < 1 || Number(v.pageSize) > 500)) bad(`${path}.pageSize`, "expected 1–500");
    if (!Array.isArray(v.fields) || !v.fields.length) bad(`${path}.fields`, "expected at least one field");
    for (const [i, entry] of (v.fields as unknown[]).entries()) {
      const p = `${path}.fields[${i}]`, f = object(entry, p); keys(f, ["field", "label", "format"], p); attr(f.field, p);
      if (f.label !== undefined) string(f.label, `${p}.label`);
      if (f.format !== undefined && !["text", "json", "count"].includes(f.format as string)) bad(`${p}.format`, "unknown format");
    }
    for (const name of ["where", "sort"] as const) {
      if (v[name] === undefined) continue;
      if (!Array.isArray(v[name])) bad(`${path}.${name}`, "expected an array");
      for (const [i, entry] of (v[name] as unknown[]).entries()) {
        const p = `${path}.${name}[${i}]`, f = object(entry, p);
        keys(f, name === "where" ? ["field", "op", "value"] : ["field", "direction"], p); attr(f.field, p);
        if (name === "sort") { if (f.direction !== undefined && !["asc", "desc"].includes(f.direction as string)) bad(p, "unknown sort direction"); }
        else {
          if (!["eq", "ne", "in", "contains", "exists", "gt", "gte", "lt", "lte"].includes(f.op as string)) bad(p, "unknown filter operator");
          if (f.op !== "exists" && !Object.hasOwn(f, "value")) bad(p, "filter value required");
          if (f.op === "in" && !Array.isArray(f.value)) bad(p, "in requires an array");
          if (["gt", "gte", "lt", "lte"].includes(f.op as string) && (typeof f.value !== "number" || !Number.isFinite(f.value))) bad(p, "comparison requires a finite number");
          if (f.op === "exists" && f.value !== undefined && typeof f.value !== "boolean") bad(p, "exists takes a boolean");
          if (f.op === "contains" && typeof f.value !== "string") bad(p, "contains takes a string");
        }
      }
    }
    if (v.renderer === "graph") {
      const g = object(v.graph, `${path}.graph`); keys(g, ["relations", "layout", "weight", "width", "height", "gap", "edgeLabel"], `${path}.graph`);
      strings(g.relations, `${path}.graph.relations`);
      if (!["concentric", "grid", "breadthfirst", "circle"].includes(g.layout as string)) bad(`${path}.graph.layout`, "unsupported Cytoscape layout");
      if (g.weight !== undefined) attr(g.weight, `${path}.graph.weight`);
      if (g.edgeLabel !== undefined) attr(g.edgeLabel, `${path}.graph.edgeLabel`);
      for (const dim of ["width", "height", "gap"]) if (g[dim] !== undefined && (typeof g[dim] !== "number" || !Number.isFinite(g[dim]) || Number(g[dim]) < (dim === "gap" ? 0 : 100) || Number(g[dim]) > 2000)) bad(`${path}.graph.${dim}`, "invalid layout dimension");
    } else if (v.graph !== undefined) bad(`${path}.graph`, "only graph views accept graph configuration");
    const validated = structuredClone(v) as unknown as View;
    const existing = config.views.findIndex(item => item.id === v.id);
    if (existing < 0) config.views.push(validated); else config.views[existing] = validated;
  }
  if (!config.views.length) bad("views", "at least one view is required");
  if (input.initialView !== undefined) { string(input.initialView, "initialView"); config.initialView = input.initialView; }
  if (!config.initialView) config.initialView = config.views[0].id;
  if (!config.views.some(v => v.id === config.initialView)) bad("initialView", "view does not exist; choose a remaining view");
  return config;
}

function matches(asset: Asset, filter: Filter): boolean {
  const v = valueAt(asset, filter.field), x = filter.value;
  switch (filter.op) {
    case "exists": return (v !== undefined && v !== null) === (x ?? true);
    case "eq": return JSON.stringify(v) === JSON.stringify(x);
    case "ne": return JSON.stringify(v) !== JSON.stringify(x);
    case "in": return (x as Value[]).some(item => JSON.stringify(item) === JSON.stringify(v));
    case "contains": return v !== undefined && (Array.isArray(v) ? v.some(item => textOf(item).includes(String(x))) : textOf(v).includes(String(x)));
    case "gt": return typeof v === "number" && v > (x as number);
    case "gte": return typeof v === "number" && v >= (x as number);
    case "lt": return typeof v === "number" && v < (x as number);
    case "lte": return typeof v === "number" && v <= (x as number);
  }
}
export interface Projection { assets: Asset[]; relations: Relation[]; total: number; matched: number; withheld: number; withheldRelations: number }
/** One selection mechanism for every renderer. No kind-specific view branches. */
export function projectView(catalog: Catalog, view: View, search = "", page = 0): Projection {
  const population = catalog.assets.filter(a => view.kinds.includes("*") || view.kinds.includes(a.kind));
  const query = search.toLocaleLowerCase();
  const selected = population.filter(a => (view.where ?? []).every(f => matches(a, f)) && (!query || JSON.stringify(a).toLocaleLowerCase().includes(query)));
  selected.sort((a, b) => {
    for (const sort of view.sort ?? []) {
      const x = valueAt(a, sort.field), y = valueAt(b, sort.field);
      const order = typeof x === "number" && typeof y === "number" ? x - y : compare(textOf(x), textOf(y));
      if (order) return order * (sort.direction === "desc" ? -1 : 1);
    }
    return compare(a.id, b.id);
  });
  const size = view.pageSize ?? 50, offset = Math.max(0, Math.min(Math.floor(page), Math.max(0, Math.ceil(selected.length / size) - 1))) * size;
  const assets = selected.slice(offset, offset + size), ids = new Set(assets.map(a => a.id));
  const candidates = catalog.relations.filter(r => view.graph?.relations.includes("*") || view.graph?.relations.includes(r.kind));
  const relations = candidates.filter(r => ids.has(r.source) && ids.has(r.target));
  return { assets, relations, total: population.length, matched: selected.length, withheld: selected.length - assets.length,
    withheldRelations: candidates.filter(r => ids.has(r.source) || ids.has(r.target)).length - relations.length };
}
