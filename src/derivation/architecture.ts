import type { GraphNode } from "../types.ts";

export type ArchitectureDeclaration =
  | { kind: "purpose"; id: string; text: string }
  | { kind: "entrance"; id: string; label: string; component: string; description: string; anchor?: string }
  | { kind: "relationship"; id: string; from: string; to: string; label: string; because: string };
export type LocatedArchitectureDeclaration = ArchitectureDeclaration & { line: number };
export interface ArchitectureSection { declarations: LocatedArchitectureDeclaration[]; problems: string[] }
export interface ArchitectureModel extends ArchitectureSection {
  declarations: Array<LocatedArchitectureDeclaration & { owner: string; spec: string; problems: string[] }>;
}

/** Validate authored data once; a renderer never supplies missing architectural meaning. */
export function architectureDeclaration(raw: unknown): ArchitectureDeclaration {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("expected an object");
  const row = raw as Record<string, unknown>;
  const fields = { purpose: ["kind", "id", "text"], entrance: ["kind", "id", "label", "component", "description", "anchor"],
    relationship: ["kind", "id", "from", "to", "label", "because"] };
  if (typeof row.kind !== "string" || !Object.hasOwn(fields, row.kind)) throw new Error("unknown architecture kind");
  const allowed = fields[row.kind as keyof typeof fields];
  for (const key of Object.keys(row)) if (!allowed.includes(key)) throw new Error(`unknown field ${key}`);
  for (const key of allowed.filter(k => k !== "anchor" || row[k] !== undefined)) {
    if (typeof row[key] !== "string" || !row[key].trim() || /[\u0000-\u001f\u007f-\u009f]/.test(row[key] as string)) throw new Error(`${key} must be nonempty single-line text`);
  }
  if (!/^[a-z][a-z0-9-]*$/.test(row.id as string)) throw new Error("id must be a stable lowercase slug");
  return raw as ArchitectureDeclaration;
}

/** Canonical graph resolution preserves unavailable declarations as explicit problems. */
export function resolveArchitecture(nodes: GraphNode[]): ArchitectureModel | undefined {
  const declared = nodes.filter(n => n.architecture);
  if (!declared.length) return undefined;
  const model: ArchitectureModel = { declarations: [], problems: [] };
  const components = new Map(nodes.filter(n => n.kind === "component").map(n => [n.id.slice(2), n]));
  for (const node of declared) {
    const owner = node.id.slice(2), spec = node.specPath!;
    model.problems.push(...node.architecture!.problems.map(p => `${spec}: ${p}`));
    for (const row of node.architecture!.declarations) {
      const refs = row.kind === "entrance" ? [row.component] : row.kind === "relationship" ? [row.from, row.to] : [];
      const problems: string[] = [];
      for (const ref of refs) if (!components.has(ref)) problems.push(`component ${ref} is unresolved`);
      if (row.kind === "entrance" && row.anchor) {
        const anchor = row.anchor;
        const target = nodes.find(n => n.id === `${anchor.includes("#") ? "s" : "f"}:${anchor}`);
        const file = target?.kind === "symbol" ? nodes.find(n => n.id === target.parent) : target;
        if (!target || file?.parent !== `c:${row.component}`) problems.push(`anchor does not resolve inside its declared component`);
      }
      model.problems.push(...problems.map(problem => `${spec} ${row.id}: ${problem}`));
      model.declarations.push({ ...row, owner, spec, problems });
    }
  }
  return model;
}
