import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, webkit } from 'playwright';
import { mapConnections } from './semantic.mjs';

const screenshots = await mkdtemp(join(tmpdir(), 'scope-semantic-'));
const engine = process.env.SCOPE_BROWSER_ENGINE === 'chromium' ? chromium : webkit;
const browser = await engine.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [], requests = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => requests.push(r.url()));
  if (process.env.SCOPE_WITHHOLD_NODE_MEASUREMENTS === '1') await page.addInitScript(() => {
    const NativeObserver = window.ResizeObserver;
    window.ResizeObserver = class extends NativeObserver {
      observe(target, options) { if (!target.classList.contains('react-flow__node')) super.observe(target, options); }
    };
  });
  await page.goto(new URL('../../public/_scope-library.html', import.meta.url).href);
  await page.waitForSelector('[data-detail=overview]');
  const snapshot = await page.locator('#scope-data').evaluate(e => JSON.parse(e.textContent));
  const expected = snapshot.model.nodes.filter(n => n.role === 'assembly');
  assert.deepEqual((await page.locator('.react-flow__node').evaluateAll(es => es.map(e => e.dataset.id))).sort(), expected.map(n => n.id).sort());
  assert.equal(await page.locator('.structure-switch').count(), 0);
  assert.equal(await page.locator('.map-inspector').count(), 0);
  const positions = () => page.locator('.react-flow__node').evaluateAll(es => es.map(e => [e.dataset.id, e.style.transform]));
  const initial = await positions();
  const camera = () => page.locator('.react-flow__viewport').getAttribute('style');
  const opening = await camera();
  const boxes = await page.locator('.component-card').evaluateAll(es => es.map(e => {
    const b = e.getBoundingClientRect(), title = e.querySelector('header strong');
    return { x: b.x, y: b.y, right: b.right, bottom: b.bottom, title: parseFloat(getComputedStyle(title).fontSize) * b.width / e.offsetWidth,
      visible: getComputedStyle(e.parentElement).visibility, overflow: e.scrollHeight > e.clientHeight + 1 };
  }));
  for (const b of boxes) {
    assert.ok(b.x >= 0 && b.right <= 1601 && b.y >= 200 && b.bottom <= 1001, 'all assemblies fit the opening map');
    assert.ok(b.title >= 15.9 && b.visible === 'visible' && !b.overflow, 'readable painted cards, including withheld measurements');
  }
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    assert.ok(a.right <= b.x || b.right <= a.x || a.bottom <= b.y || b.bottom <= a.y, 'cards never overlap');
  }
  const connections = mapConnections(snapshot.model, snapshot.initial.connections);
  assert.equal(await page.locator('.react-flow__edge').count(), connections.length);
  assert.equal(await page.locator('.map-promise-label').count(), connections.filter(c => c.kind === 'promise').length);
  assert.ok(await page.locator('.map-promise-label').evaluateAll(labels => labels.every(label => {
    const b = label.getBoundingClientRect(), x = b.x + b.width / 2, y = b.y + b.height / 2;
    return [...document.querySelectorAll('.react-flow__node')].filter(n => n.dataset.id !== label.dataset.owner).every(n => {
      const r = n.getBoundingClientRect(); return x < r.left || x > r.right || y < r.top || y > r.bottom;
    });
  })), 'a guarantee label must not appear owned by an unrelated central card');
  for (const n of expected) {
    const card = page.locator('.react-flow__node').filter({ has: page.locator('header strong', { hasText: n.label }) });
    assert.equal(await card.locator('.spec-intent').textContent(), n.intent || 'No authored description.');
    assert.equal(await card.locator('.card-guarantees > div').count(), snapshot.model.guarantees.filter(g => g.component === n.id).length);
  }
  await page.screenshot({ path: join(screenshots, 'overview.png') });
  await page.locator('.map-promise-label').first().click();
  assert.match(await page.locator('.inspector').textContent(), /caller-assessed/);
  assert.equal(await camera(), opening, 'inspection does not move or resize the map');
  await page.getByRole('button', { name: 'Close inspector', exact: true }).click();
  for (let i = 0; i < 12 && await page.locator('[data-detail=summary]').count() === 0; i++) { await page.locator('.react-flow__controls-zoomin').click(); await page.waitForTimeout(250); }
  await page.waitForSelector('[data-detail=summary]');
  assert.deepEqual(await positions(), initial);
  await page.screenshot({ path: join(screenshots, 'summary.png') });
  for (let i = 0; i < 12 && await page.locator('[data-detail=detail]').count() === 0; i++) { await page.locator('.react-flow__controls-zoomin').click(); await page.waitForTimeout(250); }
  await page.waitForSelector('[data-detail=detail]');
  assert.deepEqual(await positions(), initial);
  const center = page.locator('.gravity-center');
  assert.ok(await center.locator('.card-guarantees').isVisible());
  await center.locator('.expand-subjects').click();
  assert.ok(await center.locator('.subject-map').isVisible());
  assert.match(await center.locator('.subject-map').textContent(), /guarantee incidence.*declared subjects/s);
  assert.deepEqual(await positions(), initial, 'local expansion preserves global geography');
  assert.equal(await page.locator('.component-card').count(), expected.length);
  await page.screenshot({ path: join(screenshots, 'expanded.png') });
  await page.getByRole('button', { name: 'Fit displayed assemblies', exact: true }).click();
  assert.equal(await camera(), opening);
  for (const [name, selector] of [['Hooks', '.hooks-panel'], ['Journal', '.journal-panel'], ['Taxonomy', '.taxonomy-panel']]) {
    await page.getByRole('tab', { name, exact: true }).click(); await page.waitForSelector(selector);
  }
  await page.getByRole('tab', { name: 'Structure', exact: true }).click();
  assert.equal(await camera(), opening, 'tab switches retain map context');
  const beforeTabs = await page.locator('.react-flow__viewport').getAttribute('style');
  await page.getByRole('tab', { name: 'Hooks', exact: true }).click();
  assert.equal(await page.locator('.event-list button').count(), snapshot.readings.hooks.events.length);
  assert.match(await page.locator('.hook-summary').innerText(), /Choose a session/);
  const journalSubject = snapshot.readings.journal.records.find(r => r.kind === 'conjecture') ?? snapshot.readings.journal.records[0];
  if (journalSubject) {
    await page.getByRole('combobox', { name: 'Scope session' }).selectOption(journalSubject.session);
    const observed = snapshot.readings.hooks.hosts.find(h => h.host === 'codex').sessions[journalSubject.session];
    assert.match(await page.locator('.hook-summary').innerText(), new RegExp(observed.unavailable ? 'Unavailable' : observed.state));
  }
  await page.getByRole('combobox', { name: 'Hook host', exact: true }).selectOption('claude');
  await page.getByRole('button', { name: /^Stop/ }).click();
  assert.match(await page.locator('.hook-detail').innerText(), /Main Stop records state/);
  await page.locator('.hook-detail summary').filter({ hasText: 'Composed static template' }).click();
  await page.screenshot({ path: join(screenshots, 'hooks.png') });
  await page.getByRole('tab', { name: 'Journal', exact: true }).click();
  if (journalSubject) {
    assert.equal(await page.getByRole('combobox', { name: 'Scope session' }).inputValue(), journalSubject.session);
    await page.getByRole('textbox', { name: 'Search journal' }).fill(journalSubject.id);
    await page.waitForFunction(id => document.querySelector('.journal-panel .journal-detail').innerText.includes(id), journalSubject.id);
  }
  await page.getByRole('textbox', { name: 'Search journal' }).fill('a-string-that-is-definitely-not-a-record-782391');
  await page.locator('.journal-panel .empty-reading').waitFor();
  await page.getByRole('textbox', { name: 'Search journal' }).fill('');
  await page.getByRole('combobox', { name: 'Scope session' }).selectOption('');
  const capturedCount = snapshot.readings.journal.records.length + snapshot.readings.defects.length + snapshot.readings.experiments.length;
  assert.equal(await page.locator('.journal-panel .journal-row').count(), Math.min(30, capturedCount));
  if (capturedCount > 30) {
    await page.getByRole('button', { name: /Show 30 more/ }).click();
    assert.equal(await page.locator('.journal-panel .journal-row').count(), Math.min(60, capturedCount));
  }
  await page.getByRole('combobox', { name: 'Journal view' }).selectOption('outstanding');
  await page.getByRole('combobox', { name: 'Journal source' }).selectOption('experiments');
  assert.equal(await page.locator('.journal-panel .journal-row').count(), Math.min(30, snapshot.readings.openExperiments.length));
  await page.getByRole('combobox', { name: 'Journal view' }).selectOption('timeline');
  await page.getByRole('combobox', { name: 'Journal source' }).selectOption('');
  await page.screenshot({ path: join(screenshots, 'journal.png') });
  await page.getByRole('tab', { name: 'Structure', exact: true }).click();
  assert.equal(await page.locator('.react-flow__viewport').getAttribute('style'), beforeTabs, 'tab switches must preserve the canvas viewport');
  await page.getByRole('tab', { name: 'Structure', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('tab', { name: 'Hooks', exact: true, selected: true }).waitFor();
  assert.equal(await page.getByRole('tab', { name: 'Hooks', exact: true }).getAttribute('aria-selected'), 'true');
  await page.keyboard.press('ArrowRight');
  await page.getByRole('tab', { name: 'Journal', exact: true, selected: true }).waitFor();
  assert.equal(await page.getByRole('tab', { name: 'Journal', exact: true }).getAttribute('aria-selected'), 'true');
  await page.keyboard.press('Home');
  await page.getByRole('tab', { name: 'Structure', exact: true, selected: true }).waitFor();
  assert.equal(await page.getByRole('tab', { name: 'Structure', exact: true }).getAttribute('aria-selected'), 'true');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Fit displayed assemblies' }).click();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile page overflows horizontally');
  await page.screenshot({ path: join(screenshots, 'mobile.png'), fullPage: true });
  for (const name of ['Hooks', 'Journal', 'Taxonomy']) {
    await page.getByRole('tab', { name, exact: true }).click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} overflows on mobile`);
    await page.screenshot({ path: join(screenshots, `mobile-${name.toLowerCase()}.png`) });
  }
  assert.deepEqual(errors, []);
  assert.equal(requests.filter(r => /^https?:/.test(r)).length, 0, 'standalone preview makes no network request');
  console.log(JSON.stringify({ assemblies: expected.length, titlePixels: boxes[0].title, parity: true, semanticZoom: true, localExpansion: true, screenshots }));
} finally { await browser.close(); }
