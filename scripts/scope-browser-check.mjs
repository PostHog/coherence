import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, webkit } from 'playwright';
import { loadConfig } from '../src/config.ts';
import { captureScope } from '../src/readings/scope/capture.ts';
import { renderScope } from '../src/readings/render-scope.ts';
import { startScopeServer } from '../src/readings/scope/server.ts';
import { layoutProjection } from '../src/readings/scope/layout.mjs';
import { projectView } from '../src/readings/scope/configuration.ts';
import { valueAt } from '../src/readings/scope/catalog.ts';
import { buildGraph } from '../src/derivation/derive.ts';
import { recordTaxonomy } from '../src/taxonomy/taxonomy-ledger.ts';

const root = await mkdtemp(join(tmpdir(), 'coherence-scope-browser-'));
let browser, live;
try {
  await mkdir(join(root, 'core'));
  await writeFile(join(root, 'coherence.config.json'), JSON.stringify({ name: 'Browser fixture', ignore: ['node_modules', 'public', '.git', 'ignored-evidence'], test: [], typecheck: [] }));
  await writeFile(join(root, 'project.spec.md'), '# Project\n\nComposes the core.\n');
  await writeFile(join(root, 'main.ts'), 'import { commit } from "./core/core.ts"; export const start = commit;\n');
  await writeFile(join(root, 'core/component.spec.md'), '# Core\n\nOwns state.\n\n## invariants\n\n- state stays owned\n');
  await writeFile(join(root, 'core/core.ts'), 'export function commit() { return 1; }\n');
  for (let i = 0; i < 10; i++) {
    await mkdir(join(root, `part-${i}`));
    await writeFile(join(root, `part-${i}/component.spec.md`), `# Component ${i}\n\nOwns a bounded responsibility.\n`);
  }
  const cfg = await loadConfig(root);
  await mkdir(join(root, 'ignored-evidence')); await writeFile(join(root, 'ignored-evidence/pin.txt'), 'original evidence');
  recordTaxonomy(cfg, await buildGraph(cfg), { target: 'core/core.ts#commit', expected: null, session: 'browser', because: 'Fixture assessment',
    answers: { 'signal:continuity': 'yes' }, roles: ['role:session-subscription-owner'], facets: ['facet:lifecycle'],
    evidence: ['core/core.ts'], dependencies: ['ignored-evidence/pin.txt'] });
  const snapshot = await captureScope(cfg), html = await renderScope(snapshot);
  const projection = projectView(snapshot.catalog, snapshot.configuration.views[0]);
  for (const layout of ['concentric', 'grid', 'breadthfirst', 'circle']) {
    const result = layoutProjection(projection.assets, projection.relations, { ...snapshot.configuration.views[0].graph, layout }, valueAt);
    const positions = Object.values(result.positions);
    for (let i = 0; i < positions.length; i++) for (let j = i + 1; j < positions.length; j++) assert.ok(Math.abs(positions[i].x - positions[j].x) >= result.width || Math.abs(positions[i].y - positions[j].y) >= result.height, `${layout} rectangles overlap`);
  }
  const path = join(root, 'scope.html'); await writeFile(path, html);
  browser = await (process.env.SCOPE_BROWSER_ENGINE === 'webkit' ? webkit : chromium).launch(process.env.SCOPE_BROWSER_CHANNEL ? { channel: process.env.SCOPE_BROWSER_CHANNEL } : {});
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [], requests = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('request', r => requests.push(r.url()));
  await page.goto(pathToFileURL(path).href);
  await page.locator('.react-flow__node').first().waitFor();
  assert.equal(await page.locator('.react-flow__node').count(), 12);
  assert.ok(await page.locator('.react-flow__edge').count() > 0);
  for (const node of await page.locator('.react-flow__node').all()) assert.equal(await node.isVisible(), true);
  const titlePixels = await page.locator('.graph-card header strong').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize) * el.closest('.react-flow__node').getBoundingClientRect().width / el.closest('.react-flow__node').offsetWidth);
  assert.ok(titlePixels >= 14, `twelve-component opening titles are too small: ${titlePixels}px`);
  for (const view of snapshot.configuration.views) { await page.getByRole('tab', { name: view.title, exact: true }).click(); await page.getByRole('heading', { name: view.title, exact: true }).waitFor(); }
  await page.getByRole('tab', { name: 'All assets', exact: true }).click();
  await page.getByRole('searchbox').fill('state stays owned');
  await page.locator('.asset-link').first().click(); await page.getByRole('complementary', { name: 'Asset inspector' }).waitFor();
  assert.ok((await page.locator('.inspector').innerText()).includes('state stays owned'));
  await page.getByRole('button', { name: 'Close inspector' }).click();
  await page.getByRole('button', { name: 'Configure', exact: true }).click();
  const custom = { version: 1, extends: false, views: [{ id: 'custom', title: 'My invariants', renderer: 'cards', kinds: ['invariant'], fields: [{ field: 'attributes.anchored', label: 'Anchored' }] }] };
  await page.getByRole('textbox', { name: 'Scope JSON configuration' }).fill(JSON.stringify(custom));
  await page.getByRole('button', { name: 'Apply preview' }).click();
  await page.getByRole('tab', { name: 'My invariants' }).waitFor();
  assert.equal(await page.getByRole('tab').count(), 1);
  assert.ok((await page.locator('.card-grid').innerText()).includes('state stays owned'));
  await page.getByRole('textbox', { name: 'Scope JSON configuration' }).fill('{"version":900}');
  await page.getByRole('button', { name: 'Apply preview' }).click();
  assert.ok((await page.getByRole('alert').innerText()).includes('supported version'));
  assert.ok(requests.every(url => url.startsWith('file:')), 'offline artifact made a network request');
  await page.screenshot({ path: join(root, 'offline.png'), fullPage: true });

  live = await startScopeServer({ cfg, intervalMs: 100 });
  const response = await fetch(live.url); assert.equal(response.status, 200);
  assert.equal((await fetch(live.url, { method: 'POST' })).status, 405);
  assert.equal((await fetch(live.url, { headers: { Origin: 'https://foreign.example' } })).status, 403);
  await page.goto(live.url); await page.getByText('Live · read only', { exact: true }).waitFor();
  await page.getByRole('tab', { name: 'Taxonomy', exact: true }).click();
  await page.locator('td').getByText('classified', { exact: true }).waitFor();
  await writeFile(join(root, 'ignored-evidence/pin.txt'), 'changed outside the source walker');
  await page.locator('td').getByText('stale', { exact: true }).first().waitFor({ timeout: 15000 });
  await writeFile(join(root, 'coherence.scope.json'), JSON.stringify(custom));
  await page.getByRole('tab', { name: 'My invariants' }).waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await writeFile(join(root, 'core/component.spec.md'), '# Core\n\nOwns state.\n\n## invariants\n\n- updated invariant\n');
  await page.waitForTimeout(800);
  assert.ok((await page.locator('.card-grid').innerText()).includes('state stays owned'));
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.getByRole('button', { name: 'updated invariant', exact: true }).waitFor({ timeout: 15000 });
  await writeFile(join(root, 'coherence.scope.json'), '{');
  await page.getByRole('alert').waitFor();
  assert.ok((await page.getByRole('alert').innerText()).includes('Scope configuration'));
  await writeFile(join(root, 'coherence.scope.json'), JSON.stringify(custom));
  await page.waitForFunction(() => !document.querySelector('.source-alert'), { timeout: 15000 });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'mobile page overflows');
  assert.deepEqual(errors, []);
  console.log('Scope browser checks passed: all views, custom configuration, offline requests, geometry, inspector, live configuration/source updates, pause, damage recovery, HTTP boundary and mobile.');
} finally {
  await browser?.close(); await live?.close(); await rm(root, { recursive: true, force: true });
}
