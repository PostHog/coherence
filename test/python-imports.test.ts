import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph, pythonImportCandidates } from '../src/derivation/derive.ts';
import { cfg, tmpProject, cleanup } from './_helpers.ts';

test('python imports — unique dotted local modules become canonical edges; ambiguity and missing modules do not', async () => {
  const root = await tmpProject({ 'root.spec.md': '# Python\n',
    'posthog/query_cache/cache.py': 'from posthog.storage.object_storage import client\nfrom . import helper\nfrom ..caching import factory\nimport ambiguous\nimport absent\n',
    'posthog/query_cache/__init__.py': '', 'posthog/caching/__init__.py': '', 'posthog/storage/object_storage.py': '',
    'ambiguous.py': '', 'ambiguous/__init__.py': '' });
  try {
    const graph = await buildGraph(cfg(root, { language: 'python', codeExt: ['py'] }));
    const edges = graph.edges.filter(e => e.source === 'f:posthog/query_cache/cache.py');
    assert.deepEqual(edges.filter(e => e.target.startsWith('f:')).map(e => e.target).sort(),
      ['f:posthog/caching/__init__.py', 'f:posthog/query_cache/__init__.py', 'f:posthog/storage/object_storage.py']);
    assert.ok(edges.some(e => e.target === 'x:ambiguous'));
    assert.ok(edges.some(e => e.target === 'x:absent'));
    assert.deepEqual(pythonImportCandidates('a.py', '..outside'), []);
    assert.deepEqual(pythonImportCandidates('pkg/a.py', '../../outside'), []);
  } finally { await cleanup(root); }
});
