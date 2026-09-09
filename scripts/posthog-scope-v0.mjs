// Prepare a new isolated, reproducible adoption. Never modifies either source tree.
// Generated files are exact upstream copies plus specs derived from this declaration.
import { mkdtemp, mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { GUARANTEE_CATALOG } from '../src/verification/guarantee-catalog.ts';
import { bindingDigest } from '../src/verification/guarantee-bindings.ts';
import { guaranteeRef, parseBoundary } from '../src/verification/boundary.ts';

const coherence = fileURLToPath(new URL('..', import.meta.url));
const upstream = resolve(process.argv[2] ?? '/tmp/coherence-posthog-probes.jYxKId/posthog');
const python = resolve(process.argv[3] ?? '/tmp/coherence-posthog-probes.jYxKId/pinned-env/bin/python');
const commit = GUARANTEE_CATALOG.source.commit;
if (execFileSync('git', ['rev-parse', 'HEAD'], { cwd: upstream, encoding: 'utf8' }).trim() !== commit) throw new Error('Wrong PostHog revision');
execFileSync('git', ['diff', '--quiet', 'HEAD'], { cwd: upstream });
const files = execFileSync('git', ['ls-files', 'posthog/query_cache', 'posthog/caching/redis_cluster_connection_factory.py', 'posthog/storage/object_storage.py', 'LICENSE'], { cwd: upstream, encoding: 'utf8' }).trim().split('\n').filter(p => p.endsWith('.py') || p === 'LICENSE');
const project = await mkdtemp(join(tmpdir(), 'coherence-posthog-scope-'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const pins = {};
for (const path of files) {
  const bytes = await readFile(join(upstream, path));
  if (!bytes.equals(execFileSync('git', ['show', `${commit}:${path}`], { cwd: upstream, maxBuffer: 16 * 1024 * 1024 }))) throw new Error(`Dirty source: ${path}`);
  await mkdir(dirname(join(project, path)), { recursive: true });
  await writeFile(join(project, path), bytes); pins[path] = sha(bytes);
}
await mkdir(join(project, 'network'));
await copyFile(join(coherence, 'docs/assays/posthog-guarantees-r3/network/sitecustomize.py'), join(project, 'network/sitecustomize.py'));
await copyFile(join(coherence, 'docs/assays/posthog-scope-v0/run-query-cache.py'), join(project, 'oracle.py'));
await writeFile(join(project, 'source-pins.json'), JSON.stringify({ repository: GUARANTEE_CATALOG.source.repository, commit, files: pins }, null, 2) + '\n');
await writeFile(join(project, 'assay-runtime.json'), JSON.stringify({ upstream, python }, null, 2) + '\n');
const cfg = { name: 'PostHog · query-cache adoption slice', language: 'python', codeExt: ['py'], entryDir: '.', outputDir: 'public',
  ignore: ['.git', '.coherence', '__pycache__', 'public', 'runs', 'network', 'oracle.py'], testDir: 'posthog/query_cache/test',
  test: [], testBatch: [python, 'oracle.py'], testBatchFormat: 'vitest-json' };
await writeFile(join(project, 'coherence.config.json'), JSON.stringify(cfg, null, 2) + '\n');
const definitions = [
  { id: 'guarantee:supersession-safety', invariant: 'a late upload cannot replace the newer cache entry or retain its losing blob',
    because: 'Two asynchronous uploads can complete out of order for one cache key. The Redis compare-and-swap and upload cleanup form the bounded publication contract.',
    parameters: { 'publication subject': 'The Redis entry at entry_redis_key(cache_key)', 'operation identity': 'The per-upload UUID embedded in the S3 pointer',
      'supersession relation': 'Current Redis bytes differ from the inline bytes captured by this upload', 'acceptance precondition': 'Current bytes equal expected inline bytes, or already equal this operation\'s pointer',
      'cleanup ownership': 'A losing upload deletes its own blob, never the winner\'s blob' },
    excludes: 'ABA with equal inline bytes, Redis failover, real S3 behavior and crash cleanup. R3 mutation failed first on orphan count; the later newer-response assertion was not reached.',
    falsifier: 'Store older then newer results; finish newer upload before older; observe two remaining blobs instead of one or read back the older response.' },
  { id: 'guarantee:retry-recognition', invariant: 'repeating an already-installed pointer swap returns success',
    because: 'A swap whose reply was lost must not be mistaken for a superseded upload: that result would select cleanup of the live pointer\'s blob.',
    parameters: { 'operation identity': 'The unique pointer bytes for one upload', 'already-applied witness': 'Current Redis bytes equal the proposed pointer',
      'retry horizon': 'While those pointer bytes remain the current entry', 'success result': 'TeamCacheSizeTracker.replace_value returns True even when expected inline bytes no longer match',
      'cleanup consequence': 'Success avoids the losing-upload cleanup branch; the oracle directly checks return value and retained pointer' },
    excludes: 'An actual lost network reply, real S3 retry cleanup, arbitrary duplicate execution or reuse of an operation identity.',
    falsifier: 'Publish a pointer, repeat replace_value with stale expected bytes, and observe False instead of True.' },
];
const owner = 'posthog/query_cache';
const boundaries = definitions.map(d => `boundary "${d.invariant}" at replace_value() via guard "test_stale_upload_cannot_replace_a_newer_entry"`);
const evidence = { ...pins };
for (const p of ['oracle.py', 'source-pins.json', 'assay-runtime.json', 'network/sitecustomize.py']) evidence[p] = sha(await readFile(join(project, p)));
const bindings = definitions.map((d, i) => {
  const definition = GUARANTEE_CATALOG.definitions.find(g => g.id === d.id);
  const upload = 'posthog/query_cache/storage.py#schedule_upload_for_pointer';
  const publication = 'posthog/query_cache/size_tracker.py#replace_value()';
  return { claim: guaranteeRef(owner, parseBoundary(boundaries[i])), definition: d.id, definitionDigest: bindingDigest(definition),
    subject: 'posthog/query_cache/size_tracker.py', assessor: 'Codex · caller-assessed adoption, 2026-09-09', because: d.because,
    parameters: d.parameters, excludes: d.excludes, falsifier: d.falsifier, evidence,
    flow: i === 0 ? { from: { subject: upload, title: 'Upload completion' }, to: { subject: publication, title: 'Pointer publication' } }
      : { from: { subject: publication, title: 'Pointer publication result' }, to: { subject: upload, title: 'Cleanup decision' } } };
});
await writeFile(join(project, 'project.spec.md'), '# PostHog query-cache slice\n\nAn isolated source slice, not the complete PostHog application. Two explicitly adopted promises share one original production oracle.\n\n## why\nUse unchanged source to test catalog adoption without altering the working application. The separate pinned runtime runs the original oracle against real Redis and fake S3.\n');
await writeFile(join(project, owner, 'query-cache.spec.md'), `# Query cache\n\nStores query results inline in Redis, moves large compressed results to object storage, and conditionally publishes their pointers.\n\nThe cache remains readable while uploads complete asynchronously. Redis byte comparisons arbitrate which upload may publish; the losing upload cleans up its own blob.\n\n## invariants\n${definitions.map(d => '- ' + d.invariant).join('\n')}\n\n## works when\n${boundaries.map(c => '- ' + c).join('\n')}\n\n## guarantee bindings\n${bindings.map(b => '- ' + JSON.stringify(b)).join('\n')}\n\n## refutations\n- ${definitions[0].invariant}: R3 removed the Lua expected-value refusal; the original oracle failed at two retained fake-storage objects instead of one. Restoring it passed.\n- ${definitions[1].invariant}: R3 removed already-applied recognition; the same oracle failed at False versus True. Restoring it passed.\n\n## why\nA delayed upload must not damage the state that won while it was in flight. Retry recognition is separate from supersession: one distinguishes this operation from a competitor, the other recognizes this operation's own completed effect.\n`);
for (const [dir, title, intent] of [
  ['posthog/caching', 'Redis connection factory', 'Selects and constructs the query-cache Redis client. No catalog promise is adopted here in this slice.'],
  ['posthog/storage', 'Object storage client', 'Provides storage reads, writes and deletion. The selected oracle substitutes FakeObjectStorage; it does not verify this client.'],
  ['posthog/query_cache/test', 'Query-cache oracles', 'Exercises query-cache behavior. The adopted promises share the original stale-upload test, with controlled upload order, real Redis and fake S3.'],
]) await writeFile(join(project, dir, 'component.spec.md'), `# ${title}\n\n${intent}\n\n## why\nRetain this real ownership seam without inventing a guarantee from an import or a passing neighboring test.\n`);
await mkdir(join(project, 'public'));
await writeFile(join(project, 'ADOPTION.json'), JSON.stringify({ project, upstream, commit, bindings: bindings.map(b => b.definition), sourceFiles: files.length,
  limitation: 'Selected source slice; incomplete imports remain outside the view. Test execution is in the original pinned runtime, not these copies.' }, null, 2) + '\n');
console.log(project);
