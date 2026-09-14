import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { loadConfig } from '../src/config.ts';
import { captureScope } from '../src/readings/scope/capture.ts';
import { buildStructureModel } from '../src/readings/scope/structure-model.ts';
import { renderScope } from '../src/readings/render-scope.ts';

// Assess the current renderer, not an earlier dist bundle left by another run.
await import('./build-scope.mjs');

// The fixture checks reuse; the actual checkout supplies the architectural review.
// Screenshots are retained for human review, which this script cannot replace.
const artifacts = process.env.SCOPE_REVIEW_DIR ?? await mkdtemp(join(tmpdir(), 'coherence-structure-review-'));
await mkdir(artifacts, { recursive: true });
const fixture = await mkdtemp(join(tmpdir(), 'structure-project-'));
let browser;
try {
  await mkdir(join(fixture, 'store'));
  await writeFile(join(fixture, 'coherence.config.json'), JSON.stringify({ name: 'Orchard dispatch', test: [], typecheck: [] }));
  await writeFile(join(fixture, 'orchard.spec.md'), `# Orchard dispatch

Coordinates harvest requests.

## architecture

- {"kind":"purpose","id":"purpose","text":"Orchard dispatch turns harvest requests into retained picking orders."}
- {"kind":"entrance","id":"request","label":"Request a harvest","component":".","description":"A grower submits a harvest request.","anchor":"main.ts#request"}
- {"kind":"relationship","id":"retain","from":".","to":"store","label":"Retains picking orders","because":"Dispatch hands accepted requests to the order store."}
`);
  await writeFile(join(fixture, 'main.ts'), 'export function request() { return "accepted"; }\n');
  await writeFile(join(fixture, 'store/store.spec.md'), '# Order store\n\nRetains accepted picking orders.\n\n## invariants\n\n- an accepted order keeps its identity\n');
  await writeFile(join(fixture, 'store/store.ts'), 'export const orders = [];\n');
  browser = await chromium.launch(process.env.SCOPE_BROWSER_CHANNEL ? { channel: process.env.SCOPE_BROWSER_CHANNEL } : {});
  const results = [];
  for (const [name, root] of [['fixture', fixture], ['coherence', resolve(process.argv[2] ?? '.')]]) {
    const snapshot = await captureScope(await loadConfig(root));
    const model = buildStructureModel(snapshot.catalog);
    assert.ok(model.project.purposes.length, `${name}: missing authored project purpose`);
    assert.ok(model.project.entrances.length, `${name}: missing authored entrances`);
    assert.ok(model.relationships.length, `${name}: missing meaningful relationships`);
    const html = join(artifacts, `${name}.html`);
    await writeFile(html, await renderScope(snapshot));
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [], requests = [];
    page.setDefaultTimeout(10000);
    page.on('console', message => { if (/Couldn.t create edge/.test(message.text())) errors.push(message.text()); });
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => requests.push(request.url()));
    await page.goto(pathToFileURL(html).href);
    await page.locator('[data-structure-stack]').first().waitFor();
    assert.equal(await page.locator('[data-structure-stack]').count(), model.components.length);
    await page.waitForFunction(count => document.querySelectorAll('.react-flow__edge').length === count, model.relationships.length);
    assert.equal(await page.locator('.react-flow__edge').count(), model.relationships.length);
    assert.equal(await page.locator('.graph-card').count(), 0, 'Structure unexpectedly uses generic file/import cards');
    assert.ok((await page.locator('.structure-introduction').innerText()).includes(String(model.project.purposes[0].attributes.text)));
    const titlePixels = await page.locator('.structure-select').first().evaluate(element => {
      const node = element.closest('.react-flow__node');
      return parseFloat(getComputedStyle(element).fontSize) * node.getBoundingClientRect().width / node.offsetWidth;
    });
    assert.ok(titlePixels >= 14, `${name}: opening titles are only ${titlePixels}px`);
    await page.screenshot({ path: join(artifacts, `${name}-overview.png`), fullPage: true });
    const entrance = model.project.entrances[0];
    await page.locator('.structure-entrances').getByRole('button', { name: entrance.label, exact: true }).click();
    await page.locator('[data-structure-sidebar]').waitFor();
    assert.ok((await page.locator('[data-structure-sidebar]').innerText()).includes(entrance.label));
    await page.getByRole('button', { name: 'Close architecture detail', exact: true }).click();
    const component = model.components.find(item => item.guarantees.length > 0);
    assert.ok(component, 'fixture must exercise an owned promise');
    const target = page.locator(`[data-structure-expand=${JSON.stringify(component.id)}]`);
    await target.click();
    assert.equal(await target.getAttribute('aria-expanded'), 'true');
    const opened = page.locator(`[data-structure-stack=${JSON.stringify(component.id)}]`);
    await opened.getByRole('button', { name: component.guarantees[0].label, exact: true }).first().click();
    assert.equal(await page.locator('[data-structure-sidebar] h2').innerText(), component.guarantees[0].label);
    const selectedText = await page.locator('[data-structure-sidebar] h2').innerText();
    for (let i = 0; i < 8; i++) {
      const control = page.locator('.react-flow__controls-zoomin');
      if (await control.isDisabled()) break;
      await control.click();
    }
    await page.getByText('Detailed cards', { exact: true }).waitFor();
    assert.equal(await page.locator('[data-structure-sidebar] h2').innerText(), selectedText);
    await page.screenshot({ path: join(artifacts, `${name}-detail.png`), fullPage: true });
    for (let i = 0; i < 14; i++) {
      const control = page.locator('.react-flow__controls-zoomout');
      if (await control.isDisabled()) break;
      await control.click();
    }
    await page.getByText('Tile detail', { exact: true }).waitFor();
    assert.equal(await target.getAttribute('aria-expanded'), 'true', 'zoom changed explicit expansion');
    await page.getByRole('tab', { name: 'All assets', exact: true }).click();
    await page.getByRole('tab', { name: 'Structure', exact: true }).click();
    await target.waitFor();
    assert.equal(await target.getAttribute('aria-expanded'), 'true', 'tab switch lost explicit expansion');
    await page.getByText('Tile detail', { exact: true }).waitFor();
    const evidence = component.guarantees[0].evidence[0];
    if (evidence) {
      await page.locator('[data-structure-sidebar]').getByRole('button', { name: String(evidence.attributes.verdict), exact: true }).first().click();
      assert.equal(await page.locator('[data-structure-sidebar] h2').count(), 1, 'evidence selection produced conflicting inspectors');
      assert.ok((await page.locator('[data-structure-sidebar]').innerText()).includes(String(evidence.attributes.oracle)));
    }
    await page.getByRole('button', { name: 'Close architecture detail', exact: true }).click();
    await page.getByRole('button', { name: 'Fit architecture', exact: true }).click();
    await page.locator('[data-structure-relationships] summary').click();
    await page.locator('[data-structure-relationships] button').first().focus();
    await page.keyboard.press('Enter');
    await page.locator('[data-structure-sidebar]').waitFor();
    assert.ok((await page.locator('[data-structure-sidebar]').innerText()).includes('Declared meaning'));
    await page.locator('.structure-edge-focused').waitFor({ state: 'attached' });
    assert.equal(await page.locator('.structure-edge-focused').count(), 1);
    assert.equal(await page.locator('.relationship-focused').count(), 2);
    await page.locator('[data-structure-relationships] summary').click();
    await page.screenshot({ path: join(artifacts, `${name}-relationship.png`), fullPage: true });
    const reliance = model.relationships.find(item => item.kind === 'guarantee-reliance' && item.guaranteeIds.length);
    if (reliance) {
      await page.getByRole('button', { name: 'Close architecture detail', exact: true }).click();
      for (const id of [reliance.source, reliance.target]) {
        const control = page.locator(`[data-structure-expand=${JSON.stringify(id)}]`);
        if (await control.getAttribute('aria-expanded') !== 'true') await control.click();
      }
      const provider = model.components.find(item => item.id === reliance.target);
      const promise = provider.guarantees.find(item => item.id === reliance.guaranteeIds[0]);
      assert.ok(promise, 'explicit reliance has no provider promise');
      await page.locator(`[data-structure-stack=${JSON.stringify(provider.id)}]`).getByRole('button', { name: promise.label, exact: true }).first().waitFor();
      assert.equal(await page.locator('.react-flow__edge').count(), model.relationships.length, 'opening a promise lost its external relationship');
      await page.getByRole('button', { name: 'Fit architecture', exact: true }).click();
      await page.screenshot({ path: join(artifacts, `${name}-connected-stacks.png`), fullPage: true });
    }
    assert.deepEqual(errors, [], `${name}: browser errors`);
    assert.ok(requests.every(url => url.startsWith('file:')), `${name}: offline artifact made a network request`);
    results.push({ name, titlePixels, components: model.components.length, relationships: model.relationships.length,
      entrances: model.project.entrances.length, unavailable: model.sources.filter(source => source.status === 'unavailable') });
    await page.close();
  }
  await writeFile(join(artifacts, 'review.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ artifacts, results }, null, 2));
} finally {
  await browser?.close();
  await rm(fixture, { recursive: true, force: true });
}
