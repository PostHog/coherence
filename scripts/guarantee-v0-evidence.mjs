import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GUARANTEE_CATALOG as catalog } from "../src/verification/guarantee-catalog.ts";

const project = fileURLToPath(new URL("../", import.meta.url));
const source = process.argv[2];
if (!source || process.argv.slice(3).some(arg => arg !== "--check")) throw new Error("usage: node scripts/guarantee-v0-evidence.mjs PINNED_POSTHOG [--check]");
const root = resolve(source), check = process.argv.includes("--check");
const git = (...args) => execFileSync("git", ["-C", root, ...args], { maxBuffer: 32 * 1024 * 1024 });
if (git("rev-parse", "HEAD").toString().trim() !== catalog.source.commit) throw new Error("Wrong PostHog commit");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const files = git("ls-tree", "-r", "--name-only", "HEAD").toString().trim().split("\n");
const inventory = new Map();
for (const path of files) {
  const parts = path.split("/");
  if (!["products", "rust", "services", "posthog", "nodejs", "frontend", "common", "ee", "packages", "tools", "proto", ".github"].includes(parts[0])) continue;
  const n = ["nodejs", "frontend"].includes(parts[0]) ? 3 : 2;
  if (parts.length <= n) continue;
  const area = parts.slice(0, n).join("/");
  inventory.set(area, (inventory.get(area) ?? 0) + 1);
}
const definitions = catalog.definitions.map(item => {
  const refs = {};
  for (const kind of ["implementation", "oracle"]) {
    const ref = item.example[kind];
    if (!ref) { refs[kind] = null; continue; }
    if (!files.includes(ref.path)) throw new Error(`Untracked source ${ref.path}`);
    const bytes = readFileSync(resolve(root, ref.path));
    if (!bytes.equals(git("show", `HEAD:${ref.path}`))) throw new Error(`Dirty source ${ref.path}`);
    const lines = bytes.toString().split("\n"), line = lines.findIndex(text => text.includes(ref.anchor)) + 1;
    if (!line) throw new Error(`Missing anchor ${ref.path}: ${ref.anchor}`);
    refs[kind] = { ...ref, line, sha256: sha(bytes), url: `${catalog.source.repository}/blob/${catalog.source.commit}/${ref.path}#L${line}` };
  }
  return { id: item.id, area: item.example.area, grade: item.example.grade, ...refs,
    runEvidence: item.example.runEvidence.map(path => ({ path, sha256: sha(readFileSync(resolve(project, path))) })) };
});
const evidence = {
  version: 1, catalogVersion: catalog.version, catalogSha256: sha(JSON.stringify(catalog)), source: catalog.source,
  limit: "Structural address/hash audit, not semantic review or a test run. Inventory-only areas were not exhaustively read. Anchor lines locate inspected material; generic anchors are not runner-resolved test identities.",
  inventory: [...inventory].sort(([a], [b]) => a < b ? -1 : 1).map(([area, trackedFiles]) => ({ area, trackedFiles,
    definitions: definitions.filter(d => [d.implementation, d.oracle].some(ref => ref?.path.startsWith(area + "/"))).map(d => d.id) })),
  definitions,
  supplementalDiscovery: [
    ["ee/billing/quota_limiting.py", "def replace_limited_team_tokens", "Billing quotas have identity/time policies; not automatically the same as per-request egress budgets."],
    ["ee/billing/test/test_quota_limiting.py", "test_quota_cron_recounts_live_instead_of_writing_its_stale_snapshot", "Potential second supersession context: live usage must not be replaced by an earlier cron snapshot. Inspected, not bound or executed."],
    ["products/experiments/stats/frequentist/tests.py", "degrees_of_freedom = math.nan", "Undefined statistical quantities deliberately remain NaN. This file implements statistical tests, not unit tests; uncertainty-preserving output is a deferred candidate, not forced into v0."],
    ["products/error_tracking/backend/temporal/symbol_set_cleanup/test/test_symbol_set_cleanup.py", "test_deletes_old_used_and_unused_symbol_sets_with_model_semantics", "Retention eligibility and paced deletion merit another assay; not evidence for universal deletion completion."],
    ["products/access_control/backend/logic.py", "Business logic for access_control", "This entry point is only a scaffold docstring; its name is not evidence of enforcement."],
    ["tools/test_selection_verdict.py", "def parse_junit_failures", "Tooling derives verdicts from JUnit populations. No new guarantee inferred from the function name or handling of unreadable XML."],
    [".github/workflows/_rust-build-images.yml", "Read and filter matrix", "Build workflow derives its image matrix from a registry. No full deployment/provenance guarantee admitted from this bounded read."],
  ].map(([path, anchor, disposition]) => {
    const bytes = readFileSync(resolve(root, path));
    if (!bytes.equals(git("show", `HEAD:${path}`))) throw new Error(`Dirty supplemental source ${path}`);
    const line = bytes.toString().split("\n").findIndex(text => text.includes(anchor)) + 1;
    if (!line) throw new Error(`Missing supplemental anchor ${path}`);
    return { path, anchor, line, sha256: sha(bytes), disposition };
  }),
};
const lines = ["# Guarantee vocabulary v0 — Codex's take", "", "Generated from the shipped candidate catalog. Do not edit this projection by hand.", "",
  `${catalog.definitions.length} candidates · ${catalog.version} · single-project portability unproven.`, "", catalog.limit, "",
  "See [STUDY-CODEX-TAKE.md](STUDY-CODEX-TAKE.md) for breadth, curation choices and remaining work.", "",
  "| ID | Guarantee | Example grade |", "| --- | --- | --- |",
  ...catalog.definitions.map(d => `| ${d.id} | ${d.title} | ${d.example.grade} |`), ""];
for (const [index, item] of catalog.definitions.entries()) {
  const refs = definitions[index];
  lines.push(`## ${index + 1}. ${item.title}`, "", `\`${item.id}\` · ${item.category}`, "", item.promise, "",
    `Applies when: ${item.appliesWhen}`, "", `Binding parameters: ${item.parameters.join("; ")}.`, "",
    `Excludes: ${item.excludes}`, "", `Falsifier: ${item.falsifier}`, "", `Demote or revise when: ${item.demoteWhen}`, "",
    `Distinct from \`${item.distinctFrom.id}\`: ${item.distinctFrom.because}`, "",
    `Example: [${refs.implementation.path}](${refs.implementation.url}).`, "",
    refs.oracle ? `Oracle inspected: [${refs.oracle.path}](${refs.oracle.url}) — \`${refs.oracle.anchor}\`.` : "Oracle: not located in the bounded search.", "",
    `Evidence grade: **${item.example.grade}**. ${item.example.limit}`, "",
    ...item.example.runEvidence.map(path => `Retained run: [${path}](../../../${path}).`), "");
}
const destination = resolve(project, "docs/assays/posthog-guarantees-v0");
if (!check) mkdirSync(destination, { recursive: true });
for (const [name, content] of [["evidence.json", JSON.stringify(evidence, null, 2) + "\n"], ["CATALOG-CODEX-TAKE.md", lines.join("\n") + "\n"]]) {
  const path = resolve(destination, name);
  if (check) { if (readFileSync(path, "utf8") !== content) throw new Error(`${name} is stale`); }
  else writeFileSync(path, content);
}
console.log(JSON.stringify({ definitions: definitions.length, inventoryAreas: inventory.size,
  sourceFiles: new Set(definitions.flatMap(d => [d.implementation?.path, d.oracle?.path].filter(Boolean))).size,
  selectedAreas: new Set(definitions.map(d => d.area)).size,
  grades: Object.fromEntries(["mutation-tested", "test-inspected", "source-inspected"].map(grade => [grade, definitions.filter(d => d.grade === grade).length])), check }));
