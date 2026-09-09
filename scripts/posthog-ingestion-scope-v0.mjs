// A source-preserving adoption, not a rewritten application or browser-only graph.
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
const node = resolve(process.argv[3] ?? '/Users/daniloc/.nvm/versions/node/v24.8.0/bin/node');
const commit = GUARANTEE_CATALOG.source.commit;
const prefix = 'nodejs/src/';
const tests = ['ingestion/api/grpc-server', 'ingestion/framework/batching-pipeline', 'ingestion/framework/result-handling-pipeline', 'ingestion/framework/side-effect-handling-pipeline', 'ingestion/common/common-ingestion-pipeline', 'common/utils/promise-scheduler'].map(p => `src/${p}.test.ts`);
const components = [
  { dir: 'servers', title: 'Ingestion transport integration', files: ['ingestion-api-server.ts', 'grpc-stream-ingest-driver.ts'], intent: 'Wires separate HTTP and gRPC pipelines; carries stream identity into processing and constructs the completion barrier from returned effects and scheduled promises.', gaps: ['The real driver must include every required side effect in its settlement promise. The gRPC server tests substitute a FakeDriver, so they do not establish this.'] },
  { dir: 'ingestion/api', title: 'Admission and acknowledgment', files: ['grpc-server.ts', 'grpc-server.test.ts', 'feed-order-sentinel.ts', 'batch-metrics.ts', 'types.ts', 'kafka-message-converter.ts'], intent: 'Accepts bounded client streams, grants feed capacity in arrival order, and acknowledges accepted batches after their driver-provided settlement barrier. Cancellation and shutdown retire waiting or accepted work.' },
  { dir: 'ingestion/framework', title: 'Batch execution and result routing', files: ['batching-pipeline.ts', 'batching-pipeline.test.ts', 'result-handling-pipeline.ts', 'result-handling-pipeline.test.ts', 'result-handling-helpers.ts', 'side-effect-handling-pipeline.ts', 'side-effect-handling-pipeline.test.ts', 'results.ts', 'chunk-pipeline.interface.ts', 'pipeline.interface.ts', 'base-chunk-pipeline.ts', 'steps.ts', 'helpers.ts'], intent: 'Tracks accepted batches and their capacity. Routes explicit OK, DROP, DLQ and REDIRECT results; preserves associated effects for scheduling or settlement.' },
  { dir: 'ingestion/common', title: 'Shared ingestion recipe', files: ['common-ingestion-pipeline.ts', 'common-ingestion-pipeline.test.ts'], intent: 'Composes parsing, team resolution, event processing, warnings, result routing and side effects. The same skeleton supplies multiple ingestion products; this adoption examines only the selected worker path.' },
  { dir: 'ingestion/common/steps/event-preprocessing', title: 'Parsing and team resolution', files: ['index.ts', 'parse-headers.ts', 'parse-kafka-message.ts', 'resolve-team.ts'], intent: 'Turns transport headers and payloads into events and resolves the team before team-aware processing. Unknown tokens can be dropped without halting the rest of a batch.', gaps: ['These selected pipeline fixtures do not prove tenant isolation across every caller, bypass or downstream store.'] },
  { dir: 'ingestion/pipelines/analytics', title: 'Analytics processing', files: ['joined-ingestion-pipeline.ts', 'event-subpipeline.ts', 'post-team-preprocessing-subpipeline.ts'], intent: 'Assembles event restrictions, per-identity processing and batched store flushes for analytics ingestion. Uses the shared recipe and declares typed output destinations.', gaps: ['Person merges, overflow policy, event transformation and real-store writes are outside this executable slice.'] },
  { dir: 'common/outputs', title: 'Output destinations', files: ['index.ts', 'ingestion-outputs.ts', 'single-ingestion-output.ts'], intent: 'Provides named destinations to the result router. Dead-letter and redirected records become producer effects; ordinary successful events continue on the processing path.', gaps: ['Fake-producer tests do not establish Kafka durability, delivery uniqueness or the completeness of configured destinations.'] },
  { dir: 'common/utils', title: 'Deferred effect scheduler', files: ['promise-scheduler.ts', 'promise-scheduler.test.ts'], intent: 'Tracks outstanding promises, removes them on settlement, and exposes explicit wait-for-all or wait-for-all-settled barriers. This slice includes only that utility.' },
];
const claims = [];
function claim(key, owner, file, at, invariant, oracle, extra = {}) { claims.push({ key, owner, file, at, invariant, oracle, ...extra }); }
claim('ack', 'ingestion/api', 'grpc-server.ts', 'WorkerIngestServer', 'an accepted sub-batch remains in flight until its driver settlement completes', 'records an accepted sub-batch in the shared in-flight metrics until it settles', {
  definition: 'acknowledgment-barrier', parameters: ['Stream ID and sub-batch sequence', 'CompletedSubBatch.settled supplied by the driver', 'Success ack placed on the originating stream queue', 'Rejected settlement poisons the pipeline and fails affected streams; the selected oracle directly tests only the unresolved barrier'],
  excludes: 'This named oracle observes in-flight accounting. Historical wait-removal mutation sensitivity does not prove all early-ack defects or downstream durability; the driver is fake.', falsifier: 'Hold the accepted batch settlement unresolved and observe its in-flight count retired.' });
claim('drain', 'ingestion/api', 'grpc-server.ts', 'WorkerIngestServer', 'shutdown waits for accepted sub-batch acknowledgments within its drain budget', 'stop() drains in-flight sub-batch acks before ending streams', {
  definition: 'graceful-drain', parameters: ['stop sets draining and aborts new admission', 'Sub-batches already fed to the driver', 'Settled batches acknowledged before ending streams', 'Configured drainTimeoutMs, default 15000ms', 'Fail remaining streams after the deadline; a poisoned pipeline skips draining'], falsifier: 'Start shutdown with a pending accepted batch and observe the stream close before its settlement and acknowledgment within the budget.' });
claim('cancel', 'ingestion/api', 'grpc-server.ts', 'WorkerIngestServer', 'a cancelled queued stream does not consume the next live feed slot', 'drops a cancelled stream from the admission queue so its slot skips to a live stream', {
  definition: 'cancellation-release', parameters: ['Queued stream acquisition', 'AbortSignal for the stream', 'FifoSlots waiting queue', 'A granted slot belongs to one live feed attempt', 'Remove queued waiter; release an already-granted slot when cancellation wins before use'], falsifier: 'Cancel the front waiter, release capacity, and observe it consumed by the cancelled stream instead of the next live waiter.' });
claim('fair', 'ingestion/api', 'grpc-server.ts', 'WorkerIngestServer', 'live streams acquire feed slots in arrival order', 'grants feed slots in arrival order across streams instead of racing', {
  definition: 'fair-admission', parameters: ['Live streams waiting to feed', 'Non-cancelled queued acquisitions', 'FIFO arrival order', 'Pipeline batch admission slots', 'Current holders eventually release capacity; no claim of scheduler fairness outside this queue'], falsifier: 'Queue multiple live streams and observe a later arrival acquire the next slot before the earlier waiter.' });
claim('streams', 'ingestion/api', 'grpc-server.ts', 'WorkerIngestServer', 'stream admission refuses work beyond the configured total concurrency ceiling', 'refuses a stream past the total concurrency ceiling with ResourceExhausted', {
  definition: 'bounded-admission', parameters: ['WorkerIngestServer stream entry', 'Open streams', 'Configured maxStreams', 'ResourceExhausted refusal', 'Stream retirement removes active ownership'], falsifier: 'Keep maxStreams live streams open and observe one additional stream accepted.' });
claim('batches', 'ingestion/framework', 'batching-pipeline.ts', 'BatchingPipeline', 'batch feed refuses excess concurrent batches until capacity is released', 'feed() accepts when under limit and rejects when at limit', {
  definition: 'bounded-admission', parameters: ['BatchingPipeline.feed', 'Accepted undrained batches', 'Configured concurrentBatches', 'FeedResult at_capacity instead of acceptance', 'Draining a completed batch releases its slot'], falsifier: 'Fill concurrentBatches slots and observe another nonempty batch accepted without a drain.' });
claim('dlq', 'ingestion/framework', 'result-handling-pipeline.ts', 'ResultHandlingPipeline', 'dead-letter results retain the producer effect in their result context', 'should handle dlq results and add side effects');
claim('redirect', 'ingestion/framework', 'result-handling-pipeline.ts', 'ResultHandlingPipeline', 'redirect results retain the destination producer effect in their result context', 'should handle redirected results and add side effects');
claim('effects', 'ingestion/framework', 'side-effect-handling-pipeline.ts', 'SideEffectHandlingPipeline', 'inline effect handling waits for settlement before clearing effect context', 'should await side effects and clear them from context');
claim('unknown-team', 'ingestion/common', 'common-ingestion-pipeline.ts', 'newCommonIngestionPipeline', 'unresolved event tokens are dropped while other events continue', 'drops events whose token cannot be resolved and keeps processing the rest');
claim('recipe-dlq', 'ingestion/common', 'common-ingestion-pipeline.ts', 'newCommonIngestionPipeline', 'the shared recipe routes dead-letter results to the configured output', 'produces DLQ results from steps to the DLQ output');
claim('recipe-redirect', 'ingestion/common', 'common-ingestion-pipeline.ts', 'newCommonIngestionPipeline', 'the shared recipe routes redirect results to the configured output', 'produces redirect results to the configured redirect output');
claim('scheduled', 'common/utils', 'promise-scheduler.ts', 'PromiseScheduler', 'waitForAll waits for the scheduled promise population it observes', 'should wait for all scheduled promises');

if (execFileSync('git', ['rev-parse', 'HEAD'], { cwd: upstream, encoding: 'utf8' }).trim() !== commit) throw new Error('Wrong upstream revision');
execFileSync('git', ['diff', '--quiet', 'HEAD'], { cwd: upstream });
const project = await mkdtemp(join(tmpdir(), 'coherence-posthog-ingestion-'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const pins = {};
const files = [...new Set([...components.flatMap(c => c.files.map(f => prefix + c.dir + '/' + f)), 'LICENSE', 'nodejs/jest.config.js', 'nodejs/jest.config.shared.js', 'nodejs/jest.setup.ts', 'nodejs/jest.setup-env.ts', 'nodejs/package.json'])];
for (const path of files) {
  const bytes = await readFile(join(upstream, path));
  if (!bytes.equals(execFileSync('git', ['show', `${commit}:${path}`], { cwd: upstream, maxBuffer: 16 * 1024 * 1024 }))) throw new Error(`Changed upstream file: ${path}`);
  await mkdir(dirname(join(project, path)), { recursive: true });
  await writeFile(join(project, path), bytes); pins[path] = sha(bytes);
}
await copyFile(join(coherence, 'docs/assays/posthog-ingestion-scope-v0/oracle.mjs'), join(project, 'oracle.mjs'));
await writeFile(join(project, 'source-pins.json'), JSON.stringify({ repository: GUARANTEE_CATALOG.source.repository, commit, files: pins }, null, 2) + '\n');
await writeFile(join(project, 'assay-runtime.json'), JSON.stringify({ upstream, node, tests }, null, 2) + '\n');
await writeFile(join(project, 'coherence.config.json'), JSON.stringify({ name: 'PostHog · bounded ingestion worker', language: 'typescript', codeExt: ['ts'], entryDir: '.', outputDir: 'public',
  importAliases: { '~/*': ['nodejs/src/*'], '~/tests/*': ['nodejs/tests/*'] },
  ignore: ['node_modules', '.git', '.coherence', 'public', 'runs', ...tests.map(p => p.split('/').at(-1)), 'jest.setup.ts', 'jest.setup-env.ts'],
  staticOracleExistence: false, test: [], testBatch: [process.execPath, 'oracle.mjs'], testBatchFormat: 'vitest-json' }, null, 2) + '\n');
const evidence = { ...pins };
for (const p of ['oracle.mjs', 'source-pins.json', 'assay-runtime.json']) evidence[p] = sha(await readFile(join(project, p)));
for (const c of claims) {
  c.boundary = `boundary "${c.invariant}" at ${c.at} via guard "${c.oracle}"`;
  c.id = guaranteeRef(prefix + c.owner, parseBoundary(c.boundary));
}
// These are source-inspected consumption declarations, not an invented call graph.
const relies = [
  ['servers', 'ack', 'The transport composition installs WorkerIngestServer to own the settlement-to-ack boundary.'],
  ['servers', 'batches', 'The real driver feeds and drains BatchingPipeline through the joined pipeline.'],
  ['servers', 'scheduled', 'GrpcStreamIngestDriver.next includes promiseScheduler.waitForAll in its settlement promise.'],
  ['ingestion/api', 'batches', 'The driver interface returns the framework FeedResult and admission is aligned with pipeline capacity.'],
  ['ingestion/common', 'dlq', 'The shared builder installs result handling after the event processing steps.'],
  ['ingestion/common', 'redirect', 'The shared builder delegates redirect effect construction to result handling.'],
  ['ingestion/common', 'scheduled', 'The common builder receives the scheduler used for detached step and hook effects.'],
  ['ingestion/pipelines/analytics', 'unknown-team', 'The joined analytics pipeline uses the shared recipe to resolve teams before team-aware steps.'],
];
await writeFile(join(project, 'project.spec.md'), '# PostHog ingestion worker slice\n\nA bounded source-preserving adoption of admission, processing, result routing and acknowledgment. Not the full ingestion fleet or an end-to-end delivery proof.\n\n## why\nUse existing source seams and original oracles to distinguish canonical graph omissions from canvas problems. Root aliases remain unchanged; missing connections must stay visible as an adoption finding.\n');
for (const component of components) {
  const owned = claims.filter(c => c.owner === component.dir);
  const bindings = owned.filter(c => c.definition).map(c => {
    const definition = GUARANTEE_CATALOG.definitions.find(d => d.id === `guarantee:${c.definition}`);
    return { claim: c.id, definition: definition.id, definitionDigest: bindingDigest(definition), subject: `${prefix}${c.owner}/${c.file}`,
      assessor: 'Codex · caller-assessed ingestion adoption', because: c.invariant,
      parameters: Object.fromEntries(definition.parameters.map((key, i) => [key, c.parameters[i]])),
      excludes: c.excludes ?? 'Selected original unit fixtures only: no real fleet load, downstream Kafka durability or complete failure/race coverage.',
      falsifier: c.falsifier, evidence };
  });
  const links = relies.filter(([owner]) => owner === component.dir).map(([, key, because]) => {
    const c = claims.find(c => c.key === key); return { claim: c.id, provider: prefix + c.owner, because };
  });
  const spec = `# ${component.title}\n\n${component.intent}\n\n## invariants\n${owned.map(c => '- ' + c.invariant).join('\n')}\n\n## works when\n${owned.map(c => '- ' + c.boundary).join('\n')}\n\n## guarantee bindings\n${bindings.map(b => '- ' + JSON.stringify(b)).join('\n')}\n\n## relies on\n${links.map(l => '- ' + JSON.stringify(l)).join('\n')}\n\n## why\nThis spec covers the copied files in this directory, not every upstream module under the same directory. Named test evidence is scoped to its selected fixtures. Imports and declared reliance do not establish end-to-end satisfaction.\n\n## known limits\n${(component.gaps ?? ['No claim of complete behavioral coverage.']).map(g => '- ' + g).join('\n')}\n`;
  await writeFile(join(project, prefix + component.dir, 'component.spec.md'), spec);
}
await mkdir(join(project, 'public'));
await writeFile(join(project, 'ADOPTION.json'), JSON.stringify({ project, upstream, commit, components: components.map(c => ({ ...c, dir: prefix + c.dir })), claims, relies, tests,
  limitations: ['Root-alias imports are currently unresolved by Coherence.', 'Binding flow endpoints cannot cross ownership seams.', 'Colocated tests are pinned as evidence but excluded from runtime graph mass.', 'Catalog definitions are candidate vocabulary; no new portability claim.'] }, null, 2) + '\n');
console.log(project);
