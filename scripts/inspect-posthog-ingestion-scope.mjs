// Read canonical adoption and quantify missing root-alias relationships.
// The alias counterfactual is diagnostic only: never feeds Scope or verification.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, copyFile, readdir } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.ts';
import { buildGraph } from '../src/derivation/derive.ts';
import { projectGuarantees } from '../src/verification/guarantees-cli.ts';

const project = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
const resolved = process.argv.includes('--resolved');
const cfg = await loadConfig(project), graph = await buildGraph(cfg), model = await projectGuarantees(cfg);
const adoption = JSON.parse(await readFile(join(project, 'ADOPTION.json'), 'utf8'));
const pins = JSON.parse(await readFile(join(project, 'source-pins.json'), 'utf8'));
const hash = b => createHash('sha256').update(b).digest('hex');
for (const [path, digest] of Object.entries(pins.files)) {
  assert.equal(hash(await readFile(join(project, path))), digest, path);
  assert.equal(hash(execFileSync('git', ['show', `${pins.commit}:${path}`], { cwd: adoption.upstream, maxBuffer: 16 * 1024 * 1024 })), digest, path);
}
const tsconfig = execFileSync('git', ['show', `${pins.commit}:nodejs/tsconfig.json`], { cwd: adoption.upstream, encoding: 'utf8' });
assert.deepEqual(JSON.parse(tsconfig).compilerOptions.paths['~/*'], ['./src/*']);
assert.deepEqual(JSON.parse(tsconfig).compilerOptions.paths['~/tests/*'], ['./tests/*']);
const files = new Map(graph.nodes.filter(n => n.kind === 'file').map(n => [n.path, n]));
const nodes = new Map(graph.nodes.map(n => [n.id, n]));
const aliases = graph.edges.filter(e => e.kind === 'imports' && e.target.startsWith('x:~/'));
const hits = [], outside = [];
for (const edge of aliases) {
  const specifier = edge.target.slice(2);
  const base = specifier.startsWith('~/tests/') ? `nodejs/tests/${specifier.slice(8)}` : `nodejs/src/${specifier.slice(2)}`;
  const candidates = [base, `${base}.ts`, `${base}/index.ts`].filter(p => files.has(p));
  if (candidates.length !== 1) { outside.push({ source: nodes.get(edge.source).path, specifier, candidates }); continue; }
  const target = files.get(candidates[0]);
  hits.push({ source: nodes.get(edge.source).path, target: target.path, consumer: nodes.get(edge.source).parent?.slice(2), provider: target.parent?.slice(2), specifier });
}
const pair = (a, b) => JSON.stringify([a, b]);
const additionalPairs = new Set(hits.filter(h => h.consumer && h.provider && h.consumer !== h.provider).map(h => pair(h.consumer, h.provider)));
const represented = new Set(model.relations.map(r => pair(r.source, r.target)));
const recoverableLinks = model.guaranteeLinks.links.filter(l => l.kind === 'relies' && l.status !== 'current' && additionalPairs.has(pair(l.owner, l.provider)));
assert.equal(adoption.components.length, 8);
assert.equal(model.guarantees.length, 13);
assert.equal(model.catalogBindings.items.length, 6);
assert.ok(model.catalogBindings.items.every(b => b.status === 'current' && b.observation.verdict === 'pass'));
assert.ok(model.guarantees.every(g => g.verdict === 'pass'));
assert.equal(model.guaranteeLinks.links.filter(l => l.status !== 'current').length, resolved ? 0 : 7);
assert.equal(recoverableLinks.length, resolved ? 0 : 7);
let recovery;
if (resolved) {
  const baselineDir = fileURLToPath(new URL('../docs/assays/posthog-ingestion-scope-v0/results/', import.meta.url));
  const baseline = JSON.parse(await readFile(join(baselineDir, 'inventory.json'), 'utf8'));
  const before = JSON.parse(await readFile(join(baselineDir, 'scope.json'), 'utf8'));
  const expected = new Set([...before.relations.map(r => pair(r.source, r.target)), ...baseline.aliasDiagnostic.additionalComponentPairs.map(([a, b]) => pair(a, b))]);
  assert.deepEqual([...represented].sort(), [...expected].sort(), 'exact component-pair parity with the pre-implementation prediction');
  assert.equal(model.guaranteeLinks.links.length, 8);
  assert.equal(hits.length, 0, 'no uniquely resolvable aliases remain external');
  assert.equal(aliases.length, 137, 'omitted imports remain unresolved');
  recovery = { beforeRelations: before.relations.length, afterRelations: model.relations.length,
    recoveredPairs: baseline.aliasDiagnostic.additionalComponentPairs.length, currentReliances: 8,
    remainingUnresolvedAliasOccurrences: aliases.length, prediction: 'exact population parity',
    freshness: 'configuration change first staled all six observations; fresh verification restored scoped passes' };
}
const report = {
  recovery,
  commit: pins.commit, pinnedFiles: Object.keys(pins.files).length,
  components: adoption.components.map(c => ({ id: c.dir, title: c.title })),
  canonical: { components: model.nodes.length, center: model.center, relations: model.relations.length, guarantees: model.guarantees.length,
    currentBindings: model.catalogBindings.items.length, currentReliances: model.guaranteeLinks.links.filter(l => l.status === 'current').length,
    invalidReliances: model.guaranteeLinks.links.filter(l => l.status !== 'current'),
    internalFileImports: graph.edges.filter(e => e.kind === 'imports' && e.target.startsWith('f:')).length },
  aliasDiagnostic: { source: 'nodejs/tsconfig.json', sourceDigest: hash(tsconfig), distinctUnresolvedSpecifiers: new Set(aliases.map(e => e.target)).size,
    importOccurrences: aliases.length, resolvesToCopiedFile: hits.length, missingOrAmbiguousInSlice: outside.length,
    additionalComponentPairs: [...additionalPairs].filter(p => !represented.has(p)).map(p => JSON.parse(p)),
    recoverableDeclaredReliances: recoverableLinks.length, resolvedImports: hits, omittedImports: outside },
  limits: ['Alias counterfactual is an assay diagnostic, not canonical graph data.', 'Direct module grade: no reexport, runtime call or dynamic dispatch inference.', 'Catalog binding flows currently require both endpoints to share their owner.', 'Source-only driver composition and real destination durability remain unverified.'],
};
await mkdir(output, { recursive: true });
await writeFile(join(output, 'inventory.json'), JSON.stringify(report, null, 2) + '\n');
for (const name of ['ADOPTION.json', 'source-pins.json', 'assay-runtime.json', 'coherence.config.json']) await copyFile(join(project, name), join(output, name));
await copyFile(join(project, '.coherence/status.json'), join(output, 'status.json'));
await copyFile(join(project, 'public/scope.json'), join(output, 'scope.json'));
await writeFile(join(output, 'upstream-tsconfig.json'), tsconfig);
const specs = ['project.spec.md', ...adoption.components.map(c => c.dir + '/component.spec.md')];
for (const path of specs) { const target = join(output, 'specs', path + '.txt'); await mkdir(dirname(target), { recursive: true }); await copyFile(join(project, path), target); }
for (const run of await readdir(join(project, 'runs'))) {
  const target = join(output, 'runs', run); await mkdir(target, { recursive: true });
  for (const file of ['report.json', 'execution.json', 'output.log']) await copyFile(join(project, 'runs', run, file), join(target, file));
}
console.log(JSON.stringify({ ...report, aliasDiagnostic: { ...report.aliasDiagnostic, resolvedImports: undefined, omittedImports: undefined } }, null, 2));
