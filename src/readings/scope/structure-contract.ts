import type { Asset, SourceReading } from "./catalog.ts";

/** Shared projection contract for the first current-state Structure prototype.
 * Meanings and IDs come from canonical declarations; layout never supplies them. */
export interface StructureOptions {
  summaryGuarantees: number;
  tileZoom: number;
  detailZoom: number;
  columns: number;
}
export const DEFAULT_STRUCTURE_OPTIONS: StructureOptions = {
  summaryGuarantees: 2, tileZoom: 0.5, detailZoom: 0.95, columns: 3,
};
export interface StructureGuarantee {
  id: string;
  label: string;
  owner: string;
  asset: Asset;
  anchors: string[];
  oracles: string[];
  verdict: string;
  evidence: Asset[];
  rationale: string;
  refutations: string[];
}
export interface StructureComponent {
  id: string;
  label: string;
  intent: string;
  rationale: string;
  parent: string | null;
  role: string;
  asset: Asset;
  guarantees: StructureGuarantee[];
  boundaries: Asset[];
  resources: Asset[];
  entrances: Asset[];
  density: { invariants: number; boundaries: number; relationships: number; total: number };
  taxonomy: { labels: string[]; subjects: number; stale: number; unavailable: boolean; states: Record<string, number> };
}
export interface StructureRelationship {
  id: string;
  kind: "architecture" | "guarantee-reliance";
  source: string;
  target: string;
  label: string;
  because: string;
  declarationId: string;
  guaranteeIds: string[];
  problems: string[];
}
export interface StructureModel {
  project: { label: string; purposes: Asset[]; entrances: Asset[] };
  components: StructureComponent[];
  relationships: StructureRelationship[];
  issues: Array<{ source: string; message: string }>;
  sources: SourceReading[];
}
