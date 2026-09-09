// Historical assay utility, not a Coherence command. Reads only; emits JSON to stdout.
// Capture before removing the exploratory spec additions; check the saved evidence later.
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const hash = value => createHash('sha256').update(value).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 20_000_000 });
const read = path => readFileSync(resolve(root, path), 'utf8');
const key = row => JSON.stringify([row.owner, row.kind, row.value]);
function declarations(path, content) {
  let section = '';
  return content.split('\n').flatMap((line, index) => {
    if (line.startsWith('## ')) section = line.slice(3).trim();
    if (!['relies on', 'addresses'].includes(section) || !line.startsWith('- {')) return [];
    return [{ owner: dirname(path) === '.' ? '.' : dirname(path), path, line: index + 1,
      kind: section === 'relies on' ? 'relies' : 'addresses', value: JSON.parse(line.slice(2)), raw: line }];
  });
}
function summarize(data) {
  const relies = data.declarations.filter(row => row.kind === 'relies');
  const claims = data.claims.map(claim => ({ id: claim.id, component: claim.component,
    invariant: claim.invariant, chokepoint: claim.chokepoint,
    links: relies.filter(row => row.value.claim === claim.id).length,
    addedLinks: relies.filter(row => row.added && row.value.claim === claim.id).length }));
  const components = data.components.map(component => ({ ...component,
    claims: claims.filter(claim => claim.component === component.id).length,
    consumerLinks: relies.filter(row => row.owner === component.id).length,
    providerLinks: relies.filter(row => row.value.provider === component.id).length,
    addedConsumerLinks: relies.filter(row => row.added && row.owner === component.id).length,
    addedProviderLinks: relies.filter(row => row.added && row.value.provider === component.id).length }));
  const pairs = data.dependencies.map(edge => ({ source: edge.source, target: edge.target,
    links: relies.filter(row => row.owner === edge.source && row.value.provider === edge.target).length,
    ...data.edgeDispositions.find(row => row.source === edge.source && row.target === edge.target) }));
  assert.equal(new Set(pairs.map(row => `${row.source}->${row.target}`)).size, pairs.length);
  assert(pairs.every(row => row.disposition));
  assert.equal(data.edgeDispositions.length, pairs.length);
  const histogram = {};
  for (const claim of claims) histogram[claim.links] = (histogram[claim.links] ?? 0) + 1;
  return { counts: { additions: relies.filter(row => row.added).length, relies: relies.length,
    addresses: data.declarations.filter(row => row.kind === 'addresses').length,
    claims: claims.length, components: components.length, pairs: pairs.length,
    linkedPairs: pairs.filter(row => row.links).length }, histogram, claims, components, pairs };
}

if (process.argv[2] === 'capture') {
  const { loadConfig } = await import('../../../src/config.ts');
  const { buildGraph } = await import('../../../src/derivation/derive.ts');
  const { projectGuarantees } = await import('../../../src/verification/guarantees-cli.ts');
  const { TAXONOMY } = await import('../../../src/taxonomy/taxonomy-catalog.ts');
  const base = git('rev-parse', '1979969').trim();
  assert.equal(git('rev-parse', 'HEAD').trim(), base, 'baseline moved: reassess before capture');
  const paths = git('ls-files').trim().split('\n').filter(path => path.endsWith('.spec.md'));
  const cfg = await loadConfig(root), graph = await buildGraph(cfg);
  const model = await projectGuarantees(cfg, graph);
  assert.deepEqual(model.guaranteeLinks.issues, []);
  const specs = paths.map(path => {
    const baseline = git('show', `${base}:${path}`), current = read(path);
    return { path, baselineDigest: hash(baseline), capturedDigest: hash(current),
      baselineDeclarations: declarations(path, baseline), declarations: declarations(path, current) };
  });
  const all = specs.flatMap(spec => spec.declarations.map(row => ({ ...row,
    added: !spec.baselineDeclarations.some(old => key(old) === key(row)) })));
  const changed = specs.filter(spec => spec.baselineDigest !== spec.capturedDigest).map(spec => spec.path);
  const patch = git('diff', '--binary', base, '--', ...changed);
  // Remove report prose from automated authority: these are attributed prior audit dispositions.
  const reportPath = 'SCOPE-GUARANTEE-ADOPTION-CODEX-TAKE.md', report = read(reportPath);
  const edgeDispositions = report.split('\n').filter(line => /^\| `[^`]+` → `[^`]+` \|/.test(line)).map(line => {
    const [, source, target, detail] = line.match(/^\| `([^`]+)` → `([^`]+)` \| (.*?) \|/);
    return { source, target, disposition: /^\d+$/.test(detail) ? 'linked' : detail.startsWith('TYPE-ONLY:') ? 'type-only'
      : detail.startsWith('EVIDENCE EDGE:') ? 'evidence' : 'contract-or-representation-gap', detail };
  });
  const data = { schema: 'coherence-adoption-assay/v1', baseline: base,
    attribution: { session: '01a06cfd-b3bc-7771-b2fb-a270ead577b7', agent: 'main' },
    limits: ['Historical consumer-link inventory, not guarantee satisfaction or adoption demand.',
      'Edge dispositions are the prior authored audit, not a fresh runtime graph proof.',
      'Captured oracle verdicts are dated observations, not rerun or immutable receipts.'],
    specs, specPopulationDigest: hash(JSON.stringify(specs.map(s => [s.path, s.capturedDigest]))),
    patchDigest: hash(patch), report: { path: reportPath, digest: hash(report) },
    catalog: { digest: hash(JSON.stringify(TAXONOMY)), value: TAXONOMY },
    components: model.nodes.map(({ id, label }) => ({ id, label })),
    dependencies: model.relations, claims: model.guarantees, declarations: all, edgeDispositions,
    effort: { status: 'unavailable', reason: 'No isolated authoring-time/rewrite denominator established; shared session elapsed time is not task effort.' } };
  const summary = summarize(data);
  assert.deepEqual(summary.counts, { additions: 112, relies: 115, addresses: 3, claims: 83, components: 12, pairs: 56, linkedPairs: 30 });
  console.log(JSON.stringify({ snapshot: data, summary, patch }, null, 2));
} else if (process.argv[2] === 'check') {
  const data = JSON.parse(readFileSync(resolve(here, 'snapshot.json'), 'utf8'));
  const patch = readFileSync(resolve(here, 'exploratory.patch'), 'utf8');
  assert.equal(hash(patch), data.patchDigest);
  assert.equal(hash(readFileSync(resolve(here, data.report.archive), 'utf8')), data.report.digest);
  assert.equal(hash(JSON.stringify(data.catalog.value)), data.catalog.digest);
  const scratch = mkdtempSync(resolve(tmpdir(), 'coherence-adoption-replay-'));
  try {
    for (const spec of data.specs) {
      assert(!spec.path.startsWith('/') && !spec.path.split('/').includes('..') && spec.path.endsWith('.spec.md'));
      const baseline = git('show', `${data.baseline}:${spec.path}`);
      assert.equal(hash(baseline), spec.baselineDigest);
      assert.deepEqual(declarations(spec.path, baseline), spec.baselineDeclarations);
      const target = resolve(scratch, spec.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, baseline, { flag: 'wx' });
    }
    execFileSync('git', ['apply', '--', resolve(here, 'exploratory.patch')], { cwd: scratch });
    for (const spec of data.specs) {
      const replayed = readFileSync(resolve(scratch, spec.path), 'utf8');
      assert.equal(hash(replayed), spec.capturedDigest);
      assert.deepEqual(declarations(spec.path, replayed), spec.declarations);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true }); // Only this invocation's fresh replay directory.
  }
  assert.equal(hash(JSON.stringify(data.specs.map(s => [s.path, s.capturedDigest]))), data.specPopulationDigest);
  assert.deepEqual(data.declarations, data.specs.flatMap(spec => spec.declarations.map(row => ({ ...row,
    added: !spec.baselineDeclarations.some(old => key(old) === key(row)) }))));
  const summary = summarize(data);
  assert.deepEqual(summary.counts, { additions: 112, relies: 115, addresses: 3, claims: 83, components: 12, pairs: 56, linkedPairs: 30 });
  assert.deepEqual(summary, JSON.parse(readFileSync(resolve(here, 'inventory.json'), 'utf8')));
  const mappings = JSON.parse(readFileSync(resolve(here, 'mappings.json'), 'utf8'));
  const added = data.declarations.filter(row => row.added);
  assert.equal(mappings.rows.length, added.length);
  const identities = new Set();
  for (const row of mappings.rows) {
    const identity = `${row.path}:${row.line}`;
    assert(!identities.has(identity)); identities.add(identity);
    assert(added.some(item => item.path === row.path && item.line === row.line && item.value.claim === row.claim));
    assert(['unchanged', 'partial', 'none'].includes(row.fit));
    assert(row.reason && row.residual);
    assert(row.candidates.every(id => data.catalog.value.guarantees.some(g => g.id === id)));
  }
  console.log(JSON.stringify({ archive: 'consistent', ...summary.counts, mappingRows: mappings.rows.length,
    note: 'Consistency checks do not independently validate semantic mappings or edge dispositions.' }, null, 2));
} else throw new Error(`Usage: node ${relative(root, fileURLToPath(import.meta.url))} capture|check`);
