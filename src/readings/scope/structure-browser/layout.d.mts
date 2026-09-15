import type { StructureOptions } from '../structure-contract.ts';
import type { RankedStructureComponent } from './ranking.mjs';
export interface StructureCard extends RankedStructureComponent { x: number; y: number; width: number; height: number; downtown: boolean }
export interface StructureLayout { ranked: RankedStructureComponent[]; root: RankedStructureComponent | null; coreIds: string[]; cost: number; cards: StructureCard[]; exact?: boolean; bounds: { x: number; y: number; width: number; height: number } }
export function defaultLayout(context: { model: { components: Array<Record<string, any> & { id: string }>; relationships: Array<Record<string, any> & { source: string; target: string; kind: string }> }; ranked: RankedStructureComponent[]; options: Partial<StructureOptions> & Record<string, unknown>; defaults: unknown }): StructureLayout;
export const DEFAULT_LAYOUT_OPTIONS: Readonly<Record<string, unknown>>;
