import { GUARANTEE_CATALOG } from "./guarantee-catalog.ts";

export const GUARANTEE_CATALOG_USAGE = "coherence guarantees catalog [guarantee:ID] [--json]";

/** Reference lookup has no graph, configuration, ledger or test-runner dependency. */
export function runGuaranteeCatalog(args: string[]): { code: number; output: string } {
  const ids = args.filter(arg => !arg.startsWith("--"));
  if (ids.length > 1 || args.some(arg => arg.startsWith("--") && arg !== "--json") || new Set(args).size !== args.length)
    return { code: 2, output: GUARANTEE_CATALOG_USAGE };
  const definition = ids.length ? GUARANTEE_CATALOG.definitions.find(item => item.id === ids[0]) : undefined;
  if (ids.length && !definition) return { code: 2, output: `Unknown guarantee catalog ID.\n${GUARANTEE_CATALOG_USAGE}` };
  const { definitions, ...metadata } = GUARANTEE_CATALOG;
  if (args.includes("--json")) return { code: 0, output: JSON.stringify(definition ? { ...metadata, definition } : GUARANTEE_CATALOG, null, 2) };
  const lines = ["GUARANTEE CATALOG — candidate v0; applicability caller-assessed; portability unproven"];
  if (!definition) {
    lines.push(`${definitions.length} candidate definitions; no obligations activated`,
      ...definitions.map(item => `${item.id} · ${item.title} · ${item.example.grade}`),
      `Inspect one definition: ${GUARANTEE_CATALOG_USAGE}`);
  } else {
    const item = definition, example = item.example;
    const link = (path: string) => `${metadata.source.repository}/blob/${metadata.source.commit}/${path}`;
    lines.push(`${item.id} · ${item.title} · ${item.category}`, item.promise,
      `Applies when: ${item.appliesWhen}`, `Bind: ${item.parameters.join("; ")}`,
      `Excludes: ${item.excludes}`, `Falsifier: ${item.falsifier}`, `Demote or revise when: ${item.demoteWhen}`,
      `Distinct from ${item.distinctFrom.id}: ${item.distinctFrom.because}`,
      `PostHog example (${example.grade}): ${link(example.implementation.path)} · ${example.implementation.anchor}`,
      example.oracle ? `Oracle inspected: ${link(example.oracle.path)} · ${example.oracle.anchor}` : "Oracle: not located in the bounded search",
      `Evidence limit: ${example.limit}`, ...example.runEvidence.map(path => `Retained run: ${path}`));
  }
  lines.push(metadata.limit);
  return { code: 0, output: lines.join("\n") };
}
