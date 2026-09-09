import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { webkit } from 'playwright';
import { loadConfig } from '../../src/config.ts';
import { projectGuarantees } from '../../src/verification/guarantees-cli.ts';
import { startScopeServer } from './server.mjs';

const project = resolve(process.argv[2]);
const session = process.argv[3];
if (!session) throw new Error('Supply the attributable session for the synthetic journal probe');
const config = await loadConfig(project);
const model = await projectGuarantees(config);
assert.equal(model.catalogBindings.items.length, 2);
assert.ok(model.catalogBindings.items.every(b => b.observation.verdict === 'pass'));
const live = await startScopeServer({ cfg: config, htmlPath: join(project, 'public/_scope-library.html'), intervalMs: 100 });
const browser = await webkit.launch();
const screenshots = await mkdtemp(join(tmpdir(), 'posthog-scope-browser-'));
const source = join(project, 'posthog/query_cache/size_tracker.py');
const original = await readFile(source, 'utf8');
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(live.url);
  await page.waitForSelector('.component-card');
  await page.waitForFunction(() => document.querySelector('.feed-status')?.textContent === 'Scope live');
  assert.equal(await page.locator('.component-card').count(), 3);
  assert.equal(await page.locator('.structure-switch').count(), 0);
  assert.equal(await page.locator('.map-inspector').count(), 0);
  await page.screenshot({ path: join(screenshots, 'posthog-map.png') });
  const positions = () => page.locator('.react-flow__node').evaluateAll(es => es.map(e => [e.dataset.id, e.style.transform]));
  const initial = await positions();
  // Exercise ordinary pan to put the chosen assembly at the camera center before
  // zooming. Merely present-but-offscreen subjects are not visual acceptance.
  const centerBox = await page.locator('.gravity-center').boundingBox();
  await page.mouse.move(100, 400); await page.mouse.down();
  await page.mouse.move(100 + 800 - centerBox.x - centerBox.width / 2, 400 + 600 - centerBox.y - centerBox.height / 2, { steps: 10 });
  await page.mouse.up();
  for (let i = 0; i < 5 && await page.locator('[data-detail=detail]').count() === 0; i++) {
    await page.locator('.react-flow__controls-zoomin').click(); await page.waitForTimeout(250);
  }
  await page.waitForSelector('[data-detail=detail]');
  assert.equal(await page.locator('.card-binding').count(), 2);
  const center = page.locator('.gravity-center');
  await center.locator('.expand-subjects').click();
  assert.equal(await center.locator('.local-subject').count(), 2);
  const localBox = await center.locator('.subject-map svg').boundingBox();
  assert.ok(localBox.y >= 200 && localBox.y + localBox.height <= 1000, 'expanded subjects are actually onscreen');
  assert.match(await center.locator('.subject-map').textContent(), /2 tied centers/);
  assert.deepEqual(await positions(), initial);
  await page.screenshot({ path: join(screenshots, 'posthog-expanded.png') });
  const transform = () => page.locator('.react-flow__viewport').getAttribute('style');
  const before = await transform();
  await writeFile(source, original + '\n# Synthetic live-staleness probe; restored after inspection.\n');
  await page.waitForFunction(() => [...document.querySelectorAll('.subject-map details')].every(e => e.textContent.includes('stale binding')));
  assert.equal(await transform(), before);
  assert.deepEqual(await positions(), initial);
  await writeFile(source, original);
  await page.waitForFunction(() => [...document.querySelectorAll('.subject-map details')].every(e => e.textContent.includes('scoped evidence')));
  await center.locator('.expand-subjects').click();
  await center.locator('header strong').click();
  assert.equal(await page.locator('.binding-inspector > details').count(), 2);
  await page.locator('.binding-challenge summary').first().click();
  await page.getByLabel('Counterexample observation').first().fill('SYNTHETIC ACCEPTANCE PROBE, not a PostHog defect: demonstrate targeted counterexample handoff.');
  await page.getByLabel('Challenge session').first().fill(session);
  const command = await page.locator('[data-challenge-command]').first().textContent();
  assert.ok(command.includes(model.catalogBindings.items[0].id));
  assert.match(await page.locator('.binding-challenge').first().textContent(), /not recorded.*not delivered/);
  const cli = new URL('../../src/cli.ts', import.meta.url).pathname;
  // Resolve npx to this checkout's CLI, without network/package installation.
  const shell = `npx() { shift; node '${cli}' "$@"; }; ` + command.replace("--agent 'scope-reader'", "--agent 'main'");
  const output = execFileSync('/bin/sh', ['-c', shell], { cwd: project, encoding: 'utf8' });
  assert.match(output, /conjecture/);
  await page.getByRole('tab', { name: 'Journal', exact: true }).click();
  await page.waitForFunction(() => document.body.textContent.includes('SYNTHETIC ACCEPTANCE PROBE'));
  await page.screenshot({ path: join(screenshots, 'posthog-journal.png') });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ bindings: 2, browser: 'WebKit', liveStaleness: true, viewportPreserved: true,
    journalProbe: output.trim(), screenshots, limit: 'Synthetic UI/CLI handoff; no agent delivery or PostHog defect asserted.' }, null, 2));
} finally {
  await writeFile(source, original);
  await browser.close(); await live.close();
}
