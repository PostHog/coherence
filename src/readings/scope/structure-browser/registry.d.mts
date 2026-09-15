import type { RankedStructureComponent } from './ranking.mjs';
import type { StructureLayout } from './layout.mjs';
export interface StructureRegistry { defaults: Record<string, (context: unknown) => unknown>; resolve(kind: string, name?: string): (...args: any[]) => any; names(kind: string): string[] }
export function createStructureRegistry(defaults: Record<string, (...args: any[]) => any>, extensions?: unknown[]): StructureRegistry;
export function validateRanked(value: unknown, model: { components: Array<Record<string, any> & { id: string }> }): RankedStructureComponent[];
export function validateLayout(value: unknown, ranked: RankedStructureComponent[]): StructureLayout;
export interface RoutedStructureEdge { id: string; source: string; target: string; path: string; points: Array<{ x: number; y: number }>; labelBox?: Record<string, unknown> }
export function validateRoutes(value: unknown, relationships: Array<{ id: string; source: string; target: string }>): RoutedStructureEdge[];
