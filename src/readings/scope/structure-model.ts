import type { Asset, Catalog, Relation } from "./catalog.ts";
import { compare, textOf } from "./catalog.ts";
import type { StructureComponent, StructureGuarantee, StructureModel, StructureRelationship } from "./structure-contract.ts";

const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
const ownerOf = (asset: Asset): string | null => {
  const owner = asset.attributes.owner;
  return typeof owner === "string" ? owner.replace(/^c:/, "") : null;
};
const relationsTo = (catalog: Catalog, kind: string, target: string): Relation[] =>
  catalog.relations.filter(relation => relation.kind === kind && relation.target === target);

/** Pure architectural projection. It selects canonical meanings without reading source,
 * evaluating evidence, or interpreting imports as architecture. */
export function buildStructureModel(catalog: Catalog): StructureModel {
  const assets = new Map(catalog.assets.map(asset => [asset.id, asset]));
  const componentAssets = catalog.assets.filter(asset => asset.kind === "component");
  const sourceUnavailable = new Set(catalog.sources.filter(source => source.status === "unavailable").map(source => source.id));
  const guaranteesByOwner = new Map<string, StructureGuarantee[]>();
  const guaranteeAssetToInvariant = new Map<string, string>();

  for (const invariant of catalog.assets.filter(asset => asset.kind === "invariant")) {
    const owner = ownerOf(invariant);
    if (!owner) continue;
    const ownerId = `component:${owner}`;
    const candidates = catalog.assets.filter(asset => asset.kind === "guarantee" &&
      asset.attributes.component === owner && asset.attributes.invariant === invariant.label);
    for (const candidate of candidates) guaranteeAssetToInvariant.set(candidate.id, invariant.id);
    const verdicts = [...new Set(candidates.map(candidate => textOf(candidate.attributes.verdict)))];
    const anchors = relationsTo(catalog, "anchors", invariant.id).map(relation => relation.source);
    const refutations = relationsTo(catalog, "refutes", invariant.id)
      .map(relation => assets.get(relation.source)?.label).filter((label): label is string => Boolean(label));
    const row: StructureGuarantee = {
      id: invariant.id, label: invariant.label, owner: ownerId, asset: invariant,
      anchors, oracles: candidates.map(candidate => textOf(candidate.attributes.oracle)).filter(value => value !== "—"),
      verdict: candidates.length ? (verdicts.length === 1 ? verdicts[0] : "mixed") : "unanchored",
      evidence: candidates,
      rationale: textOf(componentAssets.find(asset => asset.id === `component:${owner}`)?.attributes.why ?? ""),
      refutations,
    };
    guaranteesByOwner.set(ownerId, [...(guaranteesByOwner.get(ownerId) ?? []), row]);
  }

  const explicitReliance = catalog.relations.filter(relation => relation.kind === "relies" && relation.attributes.kind === "relies");
  const architecture = catalog.relations.filter(relation => relation.kind === "architecture");
  const entrances = catalog.assets.filter(asset => asset.kind === "entrance");
  const taxonomyUnavailable = sourceUnavailable.has("taxonomy");
  const components: StructureComponent[] = componentAssets.map(asset => {
    const id = asset.id;
    const assessments = catalog.assets.filter(candidate => candidate.kind === "assessment" && candidate.attributes.status !== "superseded" &&
      String((candidate.attributes.snapshot as { subject?: { owner?: string } } | undefined)?.subject?.owner ?? "").replace(/^c:/, "component:") === id);
    const labels = assessments.flatMap(assessment => {
      const classification = assessment.attributes.classification as { roles?: unknown; facets?: unknown } | undefined;
      return [...strings(classification?.roles), ...strings(classification?.facets)];
    });
    const states: Record<string, number> = {};
    for (const assessment of assessments) {
      const state = textOf(assessment.attributes.status);
      states[state] = (states[state] ?? 0) + 1;
    }
    const boundaries = catalog.assets.filter(candidate => candidate.kind === "transition" &&
      `component:${candidate.attributes.component}` === id);
    const resources = catalog.relations.filter(relation => relation.kind === "contains" && relation.source === asset.id)
      .map(relation => assets.get(relation.target)).filter((candidate): candidate is Asset => candidate?.kind === "resource");
    const ownedEntrances = entrances.filter(entrance => `component:${entrance.attributes.component}` === id);
    const guarantees = (guaranteesByOwner.get(id) ?? []).sort((a, b) => compare(a.id, b.id));
    const relationships = [...architecture, ...explicitReliance].filter(relation => relation.source === asset.id || relation.target === asset.id).length;
    return {
      id, label: asset.label, intent: textOf(asset.attributes.intent ?? asset.attributes.prose ?? ""),
      rationale: textOf(asset.attributes.why ?? ""),
      parent: typeof asset.attributes.parent === "string" ? asset.attributes.parent.replace(/^c:/, "component:") : null,
      role: textOf(asset.attributes.role ?? "component"), asset, guarantees, boundaries, resources, entrances: ownedEntrances,
      density: { invariants: guarantees.length, boundaries: boundaries.length, relationships,
        total: guarantees.length + boundaries.length + relationships },
      taxonomy: { labels: [...new Set(labels)].sort(compare), subjects: assessments.length,
        stale: assessments.filter(row => row.attributes.status === "stale").length, unavailable: taxonomyUnavailable, states },
    };
  }).sort((a, b) => compare(a.id, b.id));

  const relationships: StructureRelationship[] = [
    ...architecture.map(relation => ({
      id: relation.id, kind: "architecture" as const, source: relation.source,
      target: relation.target, label: textOf(relation.attributes.label),
      because: textOf(relation.attributes.because), declarationId: textOf(relation.attributes.declaration),
      guaranteeIds: [], problems: strings(relation.attributes.problems),
    })),
    ...explicitReliance.map(relation => {
      const guaranteeId = typeof relation.attributes.claim === "string" ?
        guaranteeAssetToInvariant.get(`guarantee:${relation.attributes.claim}`) : undefined;
      return ({
      id: relation.id, kind: "guarantee-reliance" as const, source: relation.source,
      target: relation.target, label: guaranteeId ? (assets.get(guaranteeId)?.label ?? "Relies on guarantee") : textOf(relation.attributes.claim ?? "Relies on guarantee"),
      because: textOf(relation.attributes.because ?? relation.attributes.reason ?? ""),
      declarationId: textOf(relation.attributes.declaration ?? relation.id),
      guaranteeIds: guaranteeId ? [guaranteeId] : [],
      problems: strings(relation.attributes.problems),
    }); }),
  ].sort((a, b) => compare(a.id, b.id));

  const purposes = catalog.assets.filter(asset => asset.kind === "description" && asset.attributes.category === "project-purpose");
  const issues = [
    ...catalog.assets.filter(asset => asset.kind === "architecture-issue").map(asset => ({ source: "architecture", message: textOf(asset.attributes.message) })),
    ...catalog.sources.filter(source => source.status === "unavailable").map(source => ({ source: source.id, message: source.message })),
  ];
  return { project: { label: catalog.project, purposes, entrances }, components, relationships, issues, sources: catalog.sources };
}
