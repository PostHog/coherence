// Read-only field measurements, not a semantic classifier or a new verification gate.
// Known gaps are reported, not asserted as behavior that future work must preserve.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.ts';
import { buildGraph } from '../src/derivation/derive.ts';

assert.ok(process.argv.slice(2).every(arg => arg === '--check-preview'), 'Only --check-preview is supported');
const root = fileURLToPath(new URL('..', import.meta.url));
function cli(...args) {
  const result = spawnSync(process.execPath, ['src/cli.ts', 'taxonomy', ...args, '--json'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.error, undefined);
  assert.ok([0, 1, 2].includes(result.status), `Unexpected CLI exit: ${result.status}`);
  return { exit: result.status, data: JSON.parse(result.stdout || result.stderr) };
}
function probe(target, args = []) {
  const result = cli('inspect', target, ...args), c = result.data.classification;
  return c ? { target, exit: result.exit, status: c.assessment, candidates: c.candidates.map(r => r.id),
    questions: c.questions.map(q => q.id), unanswered: c.unanswered, suggestions: c.suggestions.map(g => g.id) }
    : { target, exit: result.exit, error: result.data.error };
}
const catalogResult = cli('catalog'), listResult = cli('list');
assert.equal(catalogResult.exit, 0); assert.equal(listResult.exit, 0);
const catalog = catalogResult.data, items = listResult.data.items;
const graph = await buildGraph(await loadConfig(root));
const files = graph.nodes.filter(n => n.kind === 'file');
const count = values => Object.fromEntries([...new Set(values)].sort().map(v => [v, values.filter(x => x === v).length]));
const core = catalog.guarantees.filter(g => g.pack === 'core');
assert.equal(new Set(items.map(i => i.record.snapshot.subject.target)).size, items.length);
assert.ok(items.every(i => i.classification.suggestions.every(g => g.status === 'unverified')));
const representation = ['--answer', 'signal:representation=yes'];
const allNo = catalog.questions.filter(q => q.pack === 'core').flatMap(q => ['--answer', `${q.id}=no`]);
const summary = {
  grade: 'caller-assessed purposive sample; not project-wide coverage or verified obligations',
  population: { components: graph.nodes.filter(n => n.kind === 'component').length, files: files.length,
    sourceFiles: files.filter(n => n.path.startsWith('src/')).length, testFiles: files.filter(n => n.path.startsWith('test/')).length },
  adoption: { subjects: items.length, distinctFiles: new Set(items.map(i => i.record.snapshot.subject.files[0])).size,
    byStatus: count(items.map(i => i.status)), byKind: count(items.map(i => i.record.snapshot.subject.kind)),
    selectedRoles: new Set(items.flatMap(i => i.classification.roles)).size,
    suggestions: items.reduce((n, i) => n + i.classification.suggestions.length, 0),
    distinctSuggestions: new Set(items.flatMap(i => i.classification.suggestions.map(g => g.id))).size,
    zeroSuggestionSubjects: items.filter(i => !i.classification.suggestions.length).map(i => i.record.snapshot.subject.target),
    exhaustedNoFit: items.filter(i => !i.classification.unanswered && !i.classification.roles.length).map(i => i.record.snapshot.subject.target) },
  catalog: { coreRoles: catalog.roles.filter(r => r.pack === 'core').length,
    coreRolesWithoutDirectSuggestions: catalog.roles.filter(r => r.pack === 'core' && !core.some(g => g.when === r.id)).map(r => r.id),
    coreFacetsWithoutEnabledSuggestions: catalog.facets.filter(f => f.pack === 'core' && !core.some(g => g.when === f.id)).map(f => f.id) },
  probes: [probe('src'), probe('c:src'), probe('scripts/scope-preview/app.jsx'),
    probe('src/derivation/walk.ts#parseSpec', representation), probe('src/types.ts', representation),
    probe('src/readings/scope-model.ts', [...representation, '--answer', 'signal:transforms-form=yes', '--role', 'role:lowerer-domain-transformer', '--facet', 'facet:deterministic']),
    probe('test/taxonomy.test.ts', allNo), probe('src/cli.ts')],
};
if (process.argv.includes('--check-preview')) {
  const readings = JSON.parse(readFileSync(new URL('../public/scope-readings.json', import.meta.url), 'utf8'));
  const ids = rows => rows.map(i => i.record.id).sort();
  assert.deepEqual(ids(readings.taxonomy.items), ids(items), 'Recapture Scope: recorded population differs');
  assert.deepEqual(readings.taxonomy.items, items, 'Recapture Scope: classification or freshness differs');
  const html = readFileSync(new URL('../public/_scope-library.html', import.meta.url), 'utf8');
  const embedded = JSON.parse(html.match(/<script type="application\/json" id="scope-data">([\s\S]*?)<\/script>/)?.[1] ?? 'null');
  assert.deepEqual(embedded?.readings.taxonomy, readings.taxonomy, 'Rebuild Scope: embedded taxonomy differs');
  summary.preview = { matchedSubjects: items.length, projectionParity: true };
}
console.log(JSON.stringify(summary, null, 2));
