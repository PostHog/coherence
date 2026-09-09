import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpProject, cfg, cleanup, runCaptured } from "./_helpers.ts";
import { buildGraph } from "../src/derivation/derive.ts";
import { bindingDigest, projectBindings, bindRunEvidence } from "../src/verification/guarantee-bindings.ts";
import { GUARANTEE_CATALOG } from "../src/verification/guarantee-catalog.ts";
import { guaranteeRef, parseBoundary } from "../src/verification/boundary.ts";
import { runVerify } from "../src/verification/verify.ts";
import { readStatus } from "../src/evidence/status.ts";
import { projectGuarantees, runGuaranteesCommand } from "../src/verification/guarantees-cli.ts";

const source = 'export function publish() { return true; }\n';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const claim = 'boundary "late work cannot displace the winner" at publish via guard "publish test"';
export async function bindingFixture() {
  const definition = GUARANTEE_CATALOG.definitions.find(d => d.id === 'guarantee:supersession-safety')!;
  const root = await tmpProject({ 'root.spec.md': '# Cache\n', 'core.ts': source,
    'oracle.mjs': `import { publish } from './core.ts';\nimport { writeFileSync } from 'node:fs';\nconst result = publish();\nconst report = JSON.stringify({testResults:[{assertionResults:[{fullName:'publish test',status:result ? 'passed':'failed'}]}]});\nwriteFileSync('report.json', report);\nconsole.log(report);\n` });
  const config = cfg(root, { testBatch: ['node', 'oracle.mjs'], test: ['node', 'oracle.mjs'] });
  const binding = { claim: guaranteeRef('.', parseBoundary(claim)!), definition: definition.id,
    definitionDigest: bindingDigest(definition), subject: 'core.ts', assessor: 'test-author', because: 'Competing asynchronous writes share one publication key',
    parameters: Object.fromEntries(definition.parameters.map(p => [p, `Explicit ${p}`])),
    excludes: 'ABA and real external services', falsifier: 'Complete new work then old work; observe old work win',
    evidence: { 'core.ts': sha(source), 'oracle.mjs': sha(await readFile(join(root, 'oracle.mjs'), 'utf8')) } };
  const spec = () => `# Cache\n\nPublication boundary.\n\n## works when\n- ${claim}\n\n## why\nLate work must not overwrite newer work.\n\n## guarantee bindings\n- ${JSON.stringify(binding)}\n`;
  await writeFile(join(root, 'root.spec.md'), spec());
  return { root, config, binding, spec };
}

test('catalog bindings — exact scoped declarations retain failures and never borrow example support', async () => {
  const f = await bindingFixture();
  try {
    const graph = await buildGraph(f.config);
    const initial = projectBindings(f.config, graph);
    assert.equal(initial.items.length, 1);
    assert.equal(initial.items[0].status, 'current', initial.issues.join('\n'));
    assert.equal(initial.items[0].observation.verdict, 'unverified');
    assert.equal(initial.items[0].definition!.example.grade, 'mutation-tested');
    assert.equal(graph.nodes.find(n => n.kind === 'component')!.prose, undefined);
    const row = graph.nodes.find(n => n.kind === 'component')!.guaranteeLinks!.bindings!;
    for (const edit of [{ definition: 'guarantee:missing' }, { parameters: {} }, { subject: 'absent.ts' },
      { assessor: '' }, { evidence: {} }, { evidence: { '../elsewhere': sha('x') } }, { extra: true }]) {
      row[0] = { ...f.binding, ...edit };
      assert.equal(projectBindings(f.config, graph).items[0].status, 'invalid');
    }
    row[0] = { ...f.binding, definitionDigest: '0'.repeat(64) };
    assert.equal(projectBindings(f.config, graph).items[0].status, 'stale');
    row[0] = { ...f.binding, parameters: { ...f.binding.parameters, 'publication subject': { unsafe: 'not text' } } };
    assert.equal(projectBindings(f.config, graph).items[0].binding, null, 'malformed parameter objects never reach the renderer as typed strings');
    row[0] = f.binding; row.push(f.binding);
    assert.match(projectBindings(f.config, graph).issues.join(), /Duplicate/);
    row.pop();
    await symlink('core.ts', join(f.root, 'redirect.ts'));
    row[0] = { ...f.binding, evidence: { ...f.binding.evidence, 'redirect.ts': sha(source) } };
    assert.match(projectBindings(f.config, graph).issues.join(), /contained regular/);
  } finally { await cleanup(f.root); }
});

test('catalog bindings — only unchanged executed inputs earn support; edits and historical reports cannot renew it', async () => {
  const f = await bindingFixture();
  try {
    const graph = await buildGraph(f.config);
    const run = await runCaptured(() => runVerify(f.config, graph, { fast: false }));
    assert.equal(run.code, 0, run.out);
    const passed = await projectGuarantees(f.config);
    assert.equal(passed.catalogBindings!.items[0].observation.verdict, 'pass');
    const cli = JSON.parse((await runGuaranteesCommand(f.config, ['--json'])).output);
    assert.deepEqual(cli.catalogBindings, passed.catalogBindings);
    await runCaptured(() => runVerify(f.config, graph, { fast: true }));
    assert.equal((await projectGuarantees(f.config)).catalogBindings!.items[0].observation.verdict, 'pass');
    await writeFile(join(f.root, 'core.ts'), source.replace('true', 'false'));
    const stale = (await projectGuarantees(f.config)).catalogBindings!.items[0];
    assert.equal(stale.status, 'stale');
    assert.equal(stale.observation.verdict, 'stale');
    assert.equal((await runGuaranteesCommand(f.config, ['--check'])).code, 1);
    f.binding.evidence['core.ts'] = sha(source.replace('true', 'false'));
    await writeFile(join(f.root, 'root.spec.md'), f.spec());
    const reassessed = await buildGraph(f.config);
    assert.equal((await projectGuarantees(f.config)).catalogBindings!.items[0].observation.verdict, 'unverified');
    await runCaptured(() => runVerify(f.config, reassessed, { fast: false, fromReport: 'report.json' }));
    assert.equal((await projectGuarantees(f.config)).catalogBindings!.items[0].observation.verdict, 'unverified');
    const failed = await runCaptured(() => runVerify(f.config, reassessed, { fast: false }));
    assert.equal(failed.code, 1);
    assert.equal((await projectGuarantees(f.config)).catalogBindings!.items[0].observation.verdict, 'fail');
    const before = projectBindings(f.config, reassessed);
    await writeFile(join(f.root, 'root.spec.md'), f.spec() + '\nChanged while running.\n');
    const signals = [{ node: 'Cache', claim, kind: 'pass', oracleChecked: true }];
    assert.ok(bindRunEvidence(signals, before, before, reassessed)[0].bindingInputs);
    assert.equal(bindRunEvidence(signals, before, projectBindings(f.config, reassessed), reassessed)[0].bindingInputs, undefined);
    assert.ok((await readStatus(f.config)).verify!.claims[0].bindingInputs);
    await writeFile(join(f.root, 'root.spec.md'), f.spec());
    const missingSymbol = await buildGraph(f.config);
    missingSymbol.nodes = missingSymbol.nodes.filter(n => n.label !== 'publish');
    await runCaptured(() => runVerify(f.config, missingSymbol, { fast: false }));
    assert.equal((await projectGuarantees(f.config)).catalogBindings!.items[0].observation.verdict, 'unverified', 'structural failure is not a named oracle check');
  } finally { await cleanup(f.root); }
});

test('catalog bindings — flow endpoints require owned pinned symbols and changed paths cannot borrow support', async () => {
  const f = await bindingFixture();
  try {
    const endpoint = { subject: 'core.ts#publish', title: 'Publication' };
    const binding = { ...f.binding, flow: { from: endpoint, to: endpoint } };
    const graph = await buildGraph(f.config);
    const rows = graph.nodes.find(n => n.kind === 'component')!.guaranteeLinks!.bindings!;
    rows[0] = binding;
    const before = projectBindings(f.config, graph);
    assert.equal(before.items[0].status, 'current', before.issues.join());
    for (const flow of [null, {}, { from: endpoint, to: { subject: 4, title: 'bad' } }, { from: endpoint, to: endpoint, extra: true }]) {
      rows[0] = { ...binding, flow };
      const row = projectBindings(f.config, graph).items[0];
      assert.equal(row.status, 'invalid');
      assert.equal(row.binding, null, 'malformed endpoint never reaches the browser as typed data');
    }
    for (const subject of ['core.ts', 'core.ts#absent']) {
      rows[0] = { ...binding, flow: { from: endpoint, to: { ...endpoint, subject } } };
      assert.equal(projectBindings(f.config, graph).items[0].status, 'invalid');
    }
    await writeFile(join(f.root, 'other.ts'), 'export function consume() {}');
    const expanded = await buildGraph(f.config);
    const declarations = expanded.nodes.find(n => n.kind === 'component')!.guaranteeLinks!.bindings!;
    declarations[0] = { ...binding, flow: { from: endpoint, to: { subject: 'other.ts#consume', title: 'Consumer' } } };
    assert.match(projectBindings(f.config, expanded).issues.join(), /every flow endpoint file/);
    binding.flow.to = { ...endpoint, title: 'Changed mapping' };
    rows[0] = binding;
    const after = projectBindings(f.config, graph);
    assert.notEqual(before.items[0].id, after.items[0].id);
    assert.equal(bindRunEvidence([{ node: 'Cache', claim, kind: 'pass', oracleChecked: true }], before, after, graph)[0].bindingInputs, undefined);
    const symbol = expanded.nodes.find(n => n.kind === 'symbol' && n.path === 'other.ts')!;
    (declarations[0] as any).evidence = { ...binding.evidence, 'other.ts': sha('export function consume() {}') };
    assert.equal(projectBindings(f.config, expanded).items[0].status, 'current');
    symbol.parent = 'c:foreign';
    assert.match(projectBindings(f.config, expanded).issues.join(), /owned canonical symbol/);
  } finally { await cleanup(f.root); }
});
