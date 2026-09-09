import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../src/derivation/derive.ts';
import { compileImportAliases } from '../src/derivation/import-aliases.ts';
import { cfg, tmpProject, cleanup } from './_helpers.ts';

test('import aliases — only unique declared in-population targets become canonical edges', async () => {
  const root = await tmpProject({
    'root.spec.md': '# Aliases\n',
    'main.ts': 'import "~/one"; import "~/tests/two"; import "exact"; import "~/tests/absent"; import "~/ambiguous"; import "~/ignored/hidden"; import "~/../outside"; import "./relative"; import "unknown";',
    'src/one.ts': '', 'tests/two/index.ts': '', 'src/tests/absent.ts': '',
    'src/ambiguous.ts': '', 'src/ambiguous/index.ts': '', 'src/ignored/hidden.ts': '',
    'relative/index.ts': '', 'outside.ts': '',
  });
  try {
    const options = cfg(root, { ignore: ['ignored'], importAliases: { '~/*': ['src/*'], '~/tests/*': ['tests/*'], exact: ['src/one.ts'] } });
    const graph = await buildGraph(options);
    const targets = graph.edges.filter(e => e.source === 'f:main.ts').map(e => e.target).sort();
    assert.deepEqual(targets, ['f:src/one.ts', 'f:tests/two/index.ts', 'f:relative/index.ts', 'x:~/tests/absent', 'x:~/ambiguous', 'x:~/ignored/hidden', 'x:~/../outside', 'x:unknown'].sort());
    assert.ok(graph.nodes.some(n => n.id === 'x:~/ambiguous' && n.sub?.includes('ambiguous')));
    const without = await buildGraph({ ...options, importAliases: undefined });
    assert.ok(without.edges.some(e => e.target === 'x:~/one'), 'negative control: undeclared aliases stay external');
    const reordered = await buildGraph({ ...options, importAliases: Object.fromEntries(Object.entries(options.importAliases!).reverse()) });
    assert.deepEqual(reordered.edges, graph.edges);
  } finally { await cleanup(root); }
});

test('import aliases — malformed and escaping declarations refuse; alternatives never guess precedence', () => {
  for (const value of [null, [], 'bad', { '~/*': [] }, { '~/*': ['../src/*'] }, { '~/*': ['/src/*'] }, { '~/*': ['C:\\src\\*'] }, { '~/*': ['src/*/bad'] }, { '~/*': ['src'] }, { exact: ['src/*'] }, { '../*': ['src/*'] }, { '*': ['src/*'] }, { exact: [3] }]) {
    assert.throws(() => compileImportAliases(value), /importAliases/);
  }
  const resolve = compileImportAliases({ '~/*': ['a/*', 'b/*'], exact: ['./a/x.ts'] });
  const files = new Map([['a/x.ts', 'a'], ['b/x.ts', 'b']]);
  assert.equal(resolve('~/x', files, ['ts'])?.reason, 'ambiguous declared alias');
  assert.equal(resolve('exact', files, ['ts'])?.target, 'a/x.ts');
  for (const capture of ['../x', 'a/../../x', '/x', 'a\\x', '', 'a//x']) assert.equal(resolve(`~/${capture}`, files, ['ts'])?.target, undefined);
});
