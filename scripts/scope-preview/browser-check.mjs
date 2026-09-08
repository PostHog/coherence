import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, webkit } from 'playwright';

const url = new URL('../../public/_scope-library.html', import.meta.url).href;
const screenshots = await mkdtemp(join(tmpdir(), 'scope-library-'));
const engine = process.env.SCOPE_BROWSER_ENGINE === 'webkit' ? webkit : chromium;
const browser = await engine.launch({ ...(engine === chromium && process.env.SCOPE_BROWSER_CHANNEL ? { channel: process.env.SCOPE_BROWSER_CHANNEL } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.setDefaultTimeout(5000);
  const errors = [], requests = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => requests.push(r.url()));
  if (process.env.SCOPE_WITHHOLD_NODE_MEASUREMENTS === '1') await page.addInitScript(() => {
    const NativeObserver = window.ResizeObserver;
    const deferred = [];
    window.scopeResumeMeasurements = () => deferred.splice(0).forEach(resume => resume());
    window.ResizeObserver = class extends NativeObserver {
      observe(target, options) {
        // Preserve viewport measurement while withholding asynchronous card size
        // observations. The old output stayed hidden forever in this condition.
        if (target.classList.contains('react-flow__node')) deferred.push(() => super.observe(target, options));
        else super.observe(target, options);
      }
    };
  });
  await page.goto(url);
  await page.waitForSelector('.react-flow__node');
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.canvas').getBoundingClientRect();
    const center = document.querySelector('.gravity-center').getBoundingClientRect();
    return Math.abs((center.left + center.right - canvas.left - canvas.right) / 2) < 1 &&
      Math.abs((center.top + center.bottom - canvas.top - canvas.bottom) / 2) < 1;
  });
  const snapshot = await page.locator('#scope-data').evaluate(e => JSON.parse(e.textContent));
  assert.equal(await page.locator('.component-card').count(), snapshot.model.nodes.length);
  assert.equal(await page.locator('.react-flow__edge').count(), snapshot.initial.connections.length);
  assert.ok(await page.locator('.react-flow__node').evaluateAll(es => es.every(e => {
    const style = getComputedStyle(e), bounds = e.getBoundingClientRect();
    return style.visibility === 'visible' && style.display !== 'none' && Number(style.opacity) > 0 && bounds.width > 0 && bounds.height > 0;
  })), 'cards must be painted, not merely present in the DOM');
  assert.equal(await page.locator('.inspector details summary').count(), snapshot.model.guarantees.filter(g => g.component === snapshot.model.center).length + 1);
  const boxes = await page.locator('.component-card').evaluateAll(elements => elements.map(e => {
    const b = e.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom };
  }));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    assert.ok(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top, 'browser cards overlap');
  }
  assert.ok(await page.locator('.component-card header strong').evaluateAll(es => es.every(e =>
    e.scrollHeight <= e.clientHeight + 1 && getComputedStyle(e).color === 'rgb(37, 50, 71)')), 'title clipping or contrast');
  if (process.env.SCOPE_WITHHOLD_NODE_MEASUREMENTS === '1') {
    await page.evaluate(async () => {
      window.scopeResumeMeasurements();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    assert.equal(await page.locator('.react-flow__edge').count(), snapshot.initial.connections.length,
      'late browser measurements must not erase declared connection endpoints');
  }
  await page.screenshot({ path: join(screenshots, 'desktop.png') });

  await page.locator('.component-index button').filter({ hasText: 'Coherence' }).click();
  assert.match(await page.locator('.inspector').innerText(), /UNCONNECTED COMPONENT/);
  assert.match(await page.locator('.inspector').innerText(), /Unmeasured — no guarantees/);
  await page.locator('.react-flow__edge').filter({ hasText: 'mutual reliance' }).click();
  assert.equal(await page.locator('.inspector .reliance-record').count(), 2, 'both canonical directions stay inspectable');

  const before = await page.locator('.react-flow__node').first().getAttribute('style');
  await page.getByRole('slider', { name: 'Rotation', exact: true }).fill('45');
  await page.waitForFunction(previous => document.querySelector('.react-flow__node').getAttribute('style') !== previous, before);
  await page.getByRole('combobox', { name: 'Connection style' }).selectOption('smoothstep');
  await page.locator('.react-flow__edge-smoothstep').first().waitFor();
  assert.equal(await page.locator('.react-flow__edge-smoothstep').count(), snapshot.initial.connections.length);
  await page.getByRole('combobox', { name: 'Connection style' }).selectOption('straight');
  await page.locator('.react-flow__edge-straight').first().waitFor();
  assert.equal(await page.locator('.react-flow__edge-straight').count(), snapshot.initial.connections.length);
  await page.getByRole('button', { name: 'Reset view parameters' }).click();
  assert.equal(await page.getByRole('slider', { name: 'Rotation', exact: true }).inputValue(), '-35');
  const viewport = await page.locator('.react-flow__viewport').getAttribute('style');
  await page.getByRole('button', { name: /zoom in/i }).click();
  await page.waitForFunction(previous => document.querySelector('.react-flow__viewport').getAttribute('style') !== previous, viewport);
  await page.getByRole('button', { name: 'Center gravity' }).click();
  // Library pan behavior, on clear canvas away from cards and controls.
  const beforePan = await page.locator('.react-flow__viewport').getAttribute('style');
  await page.mouse.move(300, 800); await page.mouse.down(); await page.mouse.move(390, 850, { steps: 5 }); await page.mouse.up();
  await page.waitForFunction(previous => document.querySelector('.react-flow__viewport').getAttribute('style') !== previous, beforePan);
  await page.getByRole('button', { name: 'Center gravity' }).click();
  await page.locator('.component-index button').filter({ hasText: 'Source adapters' }).focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('.inspector h2').innerText(), 'Source adapters');
  assert.deepEqual(await page.locator('#scope-data').evaluate(e => JSON.parse(e.textContent)), snapshot, 'parameters must not mutate evidence');
  await page.screenshot({ path: join(screenshots, 'selection.png') });

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
  assert.equal(await page.locator('.inspector h2').innerText(), 'Source adapters');
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
  await page.getByRole('button', { name: 'Center gravity' }).click();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile page overflows horizontally');
  await page.screenshot({ path: join(screenshots, 'mobile.png'), fullPage: true });
  for (const name of ['Hooks', 'Journal', 'Taxonomy']) {
    await page.getByRole('tab', { name, exact: true }).click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} overflows on mobile`);
    await page.screenshot({ path: join(screenshots, `mobile-${name.toLowerCase()}.png`) });
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, [url], 'self-contained means no second request');
  console.log(`Browser checks passed: structure, Hooks/Journal tabs, shared session, filters, pagination, keyboard navigation, preserved viewport, mobile and no external requests. Screenshots: ${screenshots}`);
} finally { await browser.close(); }
