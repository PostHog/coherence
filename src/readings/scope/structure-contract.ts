import type { Asset, SourceReading } from "./catalog.ts";

/** Shared projection contract for current-state Structure.
 * Meanings and IDs come from canonical declarations; layout never supplies them. */
export interface StructureOptions {
  rankingWeights: { peers: number; guarantees: number; security: number; consumers: number };
  downtownCount: number;
  downtownThreshold: number;
  spacing: { x: number; y: number };
  shortTerminalNames: Record<string, string>;
  cardFields: Array<"intent" | "rationale" | "boundaries" | "resources" | "entrances">;
  promisePreviewCount: number;
  initialRelationshipLayer: "opening" | "all" | "guarantees";
  tileZoom: number;
  detailZoom: number;
  implementations: { rank: string; layout: string; route: string; card: string; view: string };
  extensionOptions: Record<string, unknown>;
}
export const DEFAULT_STRUCTURE_OPTIONS: StructureOptions = {
  rankingWeights: { peers: 3, guarantees: 2, security: 1, consumers: 2 },
  downtownCount: 3, downtownThreshold: 0.65, spacing: { x: 480, y: 420 },
  shortTerminalNames: {}, cardFields: ["intent"],
  promisePreviewCount: 3, initialRelationshipLayer: "opening", tileZoom: 0.46, detailZoom: 0.50,
  implementations: { rank: "default", layout: "default", route: "default", card: "default", view: "default" },
  extensionOptions: {},
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
