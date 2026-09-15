import type { StructureOptions } from '../structure-contract.ts';
export interface RankedStructureComponent {
  id: string; label: string; parent: string | null; guarantees: any[]; boundaries: any[]; resources: any[]; entrances: any[]; density?: Record<string, unknown>;
  peers: string[];
  consumers: string[];
  counts: { peers: number; guarantees: number; security: number; consumers: number };
  terms: Record<string, number>;
  score: number;
}
export function defaultRank(context: { model: { components: Array<Record<string, any> & { id: string }>; relationships: Array<Record<string, any> & { source: string; target: string; kind: string }> }; options: Partial<StructureOptions>; defaults: unknown }): RankedStructureComponent[];
export const DEFAULT_RANKING_WEIGHTS: Readonly<{ peers: number; guarantees: number; security: number; consumers: number }>;
