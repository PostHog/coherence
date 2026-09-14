// Scope's transport is data. Readers own evidence; views own selection and presentation.
export type Value = null | boolean | number | string | Value[] | { [key: string]: Value };
export interface Asset {
  id: string; kind: string; label: string; source: string;
  attributes: Record<string, Value>;
}
export interface Relation {
  id: string; kind: string; source: string; target: string;
  attributes: Record<string, Value>;
}
export interface SourceReading {
  id: string; status: "available" | "unavailable"; count: number; message: string;
}
export interface Catalog {
  version: 1; project: string; assets: Asset[]; relations: Relation[];
  sources: SourceReading[];
  // An inspectable attribute inventory, including nested paths and observed types.
  schema: Record<string, Record<string, string[]>>;
  limits: string[];
}

/** This inventory declares adapter ownership, including families with zero instances. */
export const ASSET_KINDS = {
  entrance: "Declared entrances", "architectural-link": "Authored architectural relationships", "architecture-issue": "Architecture declaration issues",
  project: "Project", component: "Components", file: "Files", symbol: "Symbols", resource: "Platform resources",
  spec: "Specifications", "spec-section": "Authored spec sections", description: "Intent and prose", rationale: "Why",
  invariant: "Named invariants", refutation: "Recorded refutations", chart: "Atlas charts",
  claim: "Spec claims", guarantee: "Guarantees", reliance: "Component dependencies", transition: "Atlas transitions", zone: "Trust zones",
  "guarantee-link": "Authored guarantee links", obligation: "Taxonomy obligations", binding: "Catalog bindings",
  "guarantee-definition": "Guarantee vocabulary", "taxonomy-role": "Taxonomy roles", "taxonomy-facet": "Taxonomy facets",
  "taxonomy-question": "Taxonomy questions", "taxonomy-suggestion": "Taxonomy suggestions", assessment: "Taxonomy assessments",
  decision: "Journal records", defect: "Defect records", experiment: "Experiments", "experiment-event": "Experiment history",
  work: "Work orders", "work-event": "Work history", consequence: "Assessed consequence edges", reference: "Referenced addresses",
  verification: "Verification receipts", "verification-start": "Incomplete verification runs", "claim-result": "Recorded claim results",
  session: "Sessions", hook: "Hook templates", control: "Host controls", observation: "Session observations", activity: "Tool activity", read: "Observed file reads",
  instrument: "Recorded instrument readings", baseline: "Diagnostic baselines", calibration: "Calibration samples", word: "Dictionary words",
  doctrine: "Coordination doctrine", configuration: "Project configuration", source: "Source availability",
} as const;

export function valueAt(value: unknown, path: string): Value | undefined {
  let cursor: unknown = value;
  for (const key of path.split(".")) {
    if (!cursor || typeof cursor !== "object" || !Object.hasOwn(cursor, key)) return undefined;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor as Value | undefined;
}
export const textOf = (value: unknown): string => value == null ? "—" : typeof value === "string" ? value : JSON.stringify(value);
export const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

export function catalogSchema(assets: Asset[]): Catalog["schema"] {
  const schema: Catalog["schema"] = Object.fromEntries(Object.keys(ASSET_KINDS).map(kind => [kind, {}]));
  for (const asset of assets) {
    const fields = schema[asset.kind] ??= {};
    const walk = (value: unknown, path: string) => {
      const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
      fields[path] = [...new Set([...(fields[path] ?? []), type])].sort(compare);
      if (type === "object") for (const [key, child] of Object.entries(value as object)) walk(child, path ? `${path}.${key}` : key);
    };
    for (const [key, value] of Object.entries(asset)) walk(value, key);
  }
  return schema;
}
