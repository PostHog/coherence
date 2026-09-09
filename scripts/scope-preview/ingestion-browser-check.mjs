// Diagnostic acceptance, not a claim that the current map is visually adequate.
import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { webkit } from 'playwright';
import { writeFile } from 'node:fs/promises';
const project = resolve(process.argv[2]), output = resolve(process.argv[3]);
const resolved = process.argv.includes('--resolved');
const browser = await webkit.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(pathToFileURL(join(project, 'public/_scope-library.html')).href);
  await page.waitForSelector('.component-card');
  const snapshot = await page.locator('#scope-data').evaluate(e => JSON.parse(e.textContent));
  assert.equal(snapshot.model.nodes.filter(n => n.role === 'assembly').length, 8);
  assert.equal(await page.locator('.component-card').count(), 8);
  assert.equal(snapshot.model.guarantees.length, 13);
  assert.equal(snapshot.model.catalogBindings.items.filter(b => b.observation.verdict === 'pass').length, 6);
  assert.equal(await page.locator('.map-promise-label').count(), resolved ? 7 : 1, 'authored reliance pairs have canonical labels (two guarantees share a pair)');
  const labels = await page.locator('.map-promise-label').evaluateAll(labels => labels.map(label => {
    const r = label.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { text: label.textContent, title: label.title, pointerAccessible: hit === label || label.contains(hit) };
  }));
  if (!resolved) assert.equal(labels[0].pointerAccessible, false, 'retain the observed label-occlusion counterexample; this is not a visual success gate');
  if (resolved) {
    assert.equal(snapshot.model.relations.length, 17);
    assert.equal(snapshot.model.guaranteeLinks.links.filter(l => l.status === 'current').length, 8);
  }
  await page.screenshot({ path: join(output, 'overview-webkit.png') });
  // Keyboard inspection is a distinct functioning path, not a forced mouse pass.
  await page.locator('.map-promise-label').filter({ hasText: 'G' }).first().focus();
  await page.keyboard.press('Enter');
  const inspection = await page.locator('.inspector').textContent();
  if (!resolved) {
    assert.match(inspection, /an accepted sub-batch remains in flight/);
    assert.match(inspection, /records an accepted sub-batch/);
  } else assert.ok(snapshot.model.guarantees.some(g => inspection.includes(g.invariant)), 'keyboard inspector names a canonical guarantee');
  await page.screenshot({ path: join(output, 'guarantee-webkit.png') });
  assert.deepEqual(errors, []);
  const report = { assemblies: 8, guarantees: 13, supportedBindings: 6, labels, errors, visualAcceptance: 'not established; inspect screenshot and pointer accessibility separately' };
  await writeFile(join(output, 'browser-diagnostic.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
