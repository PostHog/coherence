// Original Jest suites, executed afresh against the pinned checkout. No report replay.
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';

const project = dirname(fileURLToPath(import.meta.url));
const runtime = JSON.parse(readFileSync(join(project, 'assay-runtime.json'), 'utf8'));
const pins = JSON.parse(readFileSync(join(project, 'source-pins.json'), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function check() {
  if (execFileSync('git', ['rev-parse', 'HEAD'], { cwd: runtime.upstream, encoding: 'utf8' }).trim() !== pins.commit) throw new Error('Runtime revision changed');
  execFileSync('git', ['diff', '--quiet', 'HEAD'], { cwd: runtime.upstream });
  for (const [path, digest] of Object.entries(pins.files)) {
    if (hash(readFileSync(join(project, path))) !== digest || hash(readFileSync(join(runtime.upstream, path))) !== digest) throw new Error(`Changed source input: ${path}`);
  }
}
check();
mkdirSync(join(project, 'runs'), { recursive: true });
const run = mkdtempSync(join(project, 'runs', 'jest-'));
const report = join(run, 'report.json');
const result = spawnSync(runtime.node, ['node_modules/jest/bin/jest.js', '--config', 'jest.config.js', '--runInBand', '--no-cache', '--json', `--outputFile=${report}`, '--runTestsByPath', ...runtime.tests], {
  cwd: join(runtime.upstream, 'nodejs'), encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024,
  // No ambient credentials. These suites use their own fake producers/managers.
  env: { PATH: `${dirname(runtime.node)}:/usr/bin:/bin`, NODE_ENV: 'test', HOME: process.env.HOME, CI: '1', AWS_EC2_METADATA_DISABLED: 'true' },
});
writeFileSync(join(run, 'output.log'), (result.stdout ?? '') + (result.stderr ?? ''));
if (result.error || result.signal || ![0, 1].includes(result.status)) throw new Error(`Oracle did not finish: ${result.error ?? result.signal ?? result.status}`);
check();
const parsed = JSON.parse(readFileSync(report, 'utf8'));
writeFileSync(join(run, 'execution.json'), JSON.stringify({ node: runtime.node, version: execFileSync(runtime.node, ['--version'], { encoding: 'utf8' }).trim(), exit: result.status, suites: parsed.numTotalTestSuites, tests: parsed.numTotalTests, failedSuites: parsed.numFailedTestSuites, commit: pins.commit }, null, 2));
process.stdout.write(JSON.stringify(parsed));
process.exitCode = result.status;
