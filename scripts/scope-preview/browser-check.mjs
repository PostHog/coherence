import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, webkit } from 'playwright';
import { scopeScene } from './scene.mjs';

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
    return [...document.querySelectorAll('.component-card')].every(card => {
      const b = card.getBoundingClientRect();
      return b.left >= canvas.left && b.right <= canvas.right && b.top >= canvas.top && b.bottom <= canvas.bottom;
    });
  });
  const snapshot = await page.locator('#scope-data').evaluate(e => JSON.parse(e.textContent));
  assert.ok(await page.locator('.canvas-caption').evaluate(caption => {
    const a = caption.getBoundingClientRect();
    return [...document.querySelectorAll('.component-card')].every(card => {
      const b = card.getBoundingClientRect();
      return a.bottom <= b.top || a.top >= b.bottom || a.right <= b.left || a.left >= b.right;
    });
  }), 'the explanatory caption must not cover a card or its evidence footer');
  const initialScene = scopeScene(snapshot.model);
  const readingSize = await page.locator('.gravity-center').evaluate(card => {
    const scale = card.getBoundingClientRect().width / card.offsetWidth;
    return { purpose: parseFloat(getComputedStyle(card.querySelector('.spec-intent')).fontSize) * scale,
      architecture: parseFloat(getComputedStyle(card.querySelector('.spec-prose')).fontSize) * scale };
  });
  assert.ok(readingSize.purpose >= 15 && readingSize.architecture >= 14,
    `default view must be readable in screen pixels, not just CSS pixels: ${JSON.stringify(readingSize)}`);
  await page.screenshot({ path: join(screenshots, 'reading-default.png') });
  assert.ok(await page.locator('.canvas').evaluate(canvas => {
    const b = canvas.getBoundingClientRect();
    const cardArea = [...canvas.querySelectorAll('.component-card')].reduce((sum, card) => {
      const r = card.getBoundingClientRect(); return sum + r.width * r.height;
    }, 0);
    return cardArea / (b.width * b.height) >= 0.35;
  }), 'cards occupy the canvas rather than reserving most of it for orbital whitespace');
  const openingViewport = await page.locator('.react-flow__viewport').getAttribute('style');
  await page.getByRole('button', { name: 'Fit displayed assemblies' }).click();
  assert.equal(await page.locator('.react-flow__viewport').getAttribute('style'), openingViewport,
    'readability and containment must hold in the same default view, not separate zoom modes');
  assert.ok(await page.locator('.canvas').evaluate(canvas => {
    const view = canvas.getBoundingClientRect();
    return [...canvas.querySelectorAll('.component-card')].every(card => {
      const b = card.getBoundingClientRect();
      return b.left >= view.left && b.right <= view.right && b.top >= view.top && b.bottom <= view.bottom;
    });
  }), 'explicit overview keeps the complete project available');
  assert.equal(await page.locator('.component-card').count(), initialScene.model.nodes.length);
  assert.equal(await page.locator('.card-taxonomy').count(), initialScene.model.nodes.length);
  assert.ok(await page.locator('.component-card').evaluateAll(cards => cards.every(card => {
    const panel = card.querySelector('.card-taxonomy'), footer = card.querySelector('.card-body footer');
    return panel.scrollHeight <= panel.clientHeight + 1 && card.scrollHeight <= card.clientHeight + 1
      && footer.getBoundingClientRect().bottom <= card.getBoundingClientRect().bottom + 1;
  })), 'taxonomy and verification metadata fit inside the card');
  assert.ok(await page.locator('.card-taxonomy-roles strong').evaluateAll(labels => labels.every(label => label.scrollWidth <= label.clientWidth + 1)), 'recorded role labels remain readable');
  assert.ok(await page.locator('.card-taxonomy-roles strong, .card-taxonomy-facets>span').evaluateAll(entries => entries.every(entry => {
    const style = getComputedStyle(entry);
    return style.fontFamily.includes('monospace') && parseFloat(style.fontSize) < parseFloat(getComputedStyle(entry.closest('.component-card').querySelector('.spec-intent')).fontSize);
  })), 'taxonomy entries use smaller monospace type');
  assert.equal(await page.locator('.react-flow__edge').count(), snapshot.initial.connections.length);
  assert.ok(await page.locator('.react-flow__node').evaluateAll(es => es.every(e => {
    const style = getComputedStyle(e), bounds = e.getBoundingClientRect();
    return style.visibility === 'visible' && style.display !== 'none' && Number(style.opacity) > 0 && bounds.width > 0 && bounds.height > 0;
  })), 'cards must be painted, not merely present in the DOM');
  assert.equal(await page.locator('.invariant-evidence').count(), Math.min(8, new Set([
    ...(snapshot.model.nodes.find(n => n.id === snapshot.model.center).invariants ?? []),
    ...snapshot.model.guarantees.filter(g => g.component === snapshot.model.center).map(g => g.invariant),
  ]).size));
  for (const node of initialScene.model.nodes) {
    const card = page.locator('.react-flow__node').filter({ has: page.locator('header strong', { hasText: node.label }) });
    assert.equal(await card.locator('.spec-intent').textContent(), node.intent || 'No authored description.');
    if (node.prose) assert.equal(await card.locator('.spec-prose').textContent(), node.prose);
    assert.ok(await card.evaluate(e => {
      const description = e.querySelector('.card-description'), taxonomy = e.querySelector('.card-taxonomy');
      return description.getBoundingClientRect().top < taxonomy.getBoundingClientRect().top &&
        description.scrollHeight <= description.clientHeight + 1;
    }), 'current project descriptions fit completely ahead of taxonomy');
  }
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
  const seenAssemblies = new Set();
  for (let groupPage = 0; groupPage < initialScene.pages; groupPage++) {
    const expected = scopeScene(snapshot.model, { page: groupPage });
    const visible = await page.locator('.react-flow__node').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-id')));
    assert.deepEqual(visible.sort(), expected.model.nodes.map(n => n.id).sort());
    visible.forEach(id => seenAssemblies.add(id));
    assert.match(await page.locator('.assembly-pagination').innerText(), new RegExp(`${expected.withheld} elsewhere`));
    assert.ok(await page.locator('.component-card').evaluateAll(cards => cards.every(card => {
      const prose = card.querySelector('.card-description');
      return prose.scrollHeight <= prose.clientHeight + 1;
    })), 'each assembly page retains complete current spec prose');
    if (groupPage + 1 < initialScene.pages) await page.getByRole('button', { name: 'Next assemblies', exact: true }).click();
  }
  assert.deepEqual([...seenAssemblies].sort(), snapshot.model.nodes.filter(n => n.role === 'assembly').map(n => n.id).sort());
  for (let groupPage = 1; groupPage < initialScene.pages; groupPage++) await page.getByRole('button', { name: 'Previous assemblies', exact: true }).click();
  await page.getByRole('button', { name: 'Whole-project overview', exact: true }).click();
  assert.equal(await page.locator('.component-card').count(), initialScene.total);
  await page.getByRole('button', { name: 'Readable groups', exact: true }).click();
  assert.equal(await page.locator('.component-card').count(), initialScene.model.nodes.length);
  await page.locator('.evidence-surface').click();
  assert.match(await page.locator('.inspector').innerText(), /EVIDENCE SURFACE/);
  await page.locator('.component-index button').filter({ hasText: 'Coordination' }).click();
  const transition = snapshot.model.transitions.find(t => t.component === 'src/coordination');
  assert.ok(transition);
  await page.locator('.transition-reading').filter({ hasText: transition.symbol }).locator('summary').click();
  assert.ok((await page.locator('.transition-inspector').innerText()).includes(transition.translates));
  await page.locator('.component-index button').filter({ hasText: 'Harness core' }).click();
  const center = snapshot.model.nodes.find(n => n.id === snapshot.model.center);
  const linked = center.invariants.find(name => center.why.includes(name) && center.refutations.some(r => r.startsWith(`${name}:`)));
  assert.ok(linked, 'this project has linked spec evidence to exercise');
  await page.getByRole('searchbox', { name: 'Find an invariant or oracle' }).fill(linked);
  await page.locator('.invariant-evidence summary').first().click();
  assert.ok((await page.locator('.invariant-evidence').first().innerText()).includes(center.refutations.find(r => r.startsWith(`${linked}:`))));
  await page.getByRole('searchbox', { name: 'Find an invariant or oracle' }).fill('');

  const beforeSelection = await page.locator('.react-flow__viewport').getAttribute('style');
  await page.locator('.component-index button').filter({ hasText: 'Coherence' }).click();
  assert.equal(await page.locator('.react-flow__viewport').getAttribute('style'), beforeSelection, 'selecting a component must not sacrifice diagram context');
  assert.match(await page.locator('.inspector').innerText(), /PROJECT CONTAINER/);
  assert.match(await page.locator('.inspector').innerText(), /Contains/);
  assert.match(await page.locator('.inspector').innerText(), /Unmeasured — no guarantees/);
  await page.getByRole('button', { name: 'Fit displayed assemblies' }).click();
  await page.locator('.react-flow__edge').filter({ hasText: 'mutual reliance' }).first().click();
  assert.equal(await page.locator('.inspector .reliance-record').count(), 2, 'both canonical directions stay inspectable');

  const before = await page.locator('.react-flow__node').evaluateAll(nodes => nodes.map(n => n.getAttribute('style')).join('|'));
  await page.getByRole('slider', { name: 'Rotation', exact: true }).fill('45');
  await page.waitForFunction(previous => [...document.querySelectorAll('.react-flow__node')].map(n => n.getAttribute('style')).join('|') !== previous, before);
  await page.getByRole('combobox', { name: 'Connection style' }).selectOption('smoothstep');
  await page.locator('.react-flow__edge-smoothstep').first().waitFor();
  assert.equal(await page.locator('.react-flow__edge-smoothstep').count(), snapshot.initial.connections.length);
  await page.getByRole('combobox', { name: 'Connection style' }).selectOption('straight');
  await page.locator('.react-flow__edge-straight').first().waitFor();
  assert.equal(await page.locator('.react-flow__edge-straight').count(), snapshot.initial.connections.length);
  await page.getByRole('button', { name: 'Reset view parameters' }).click();
  assert.equal(await page.getByRole('slider', { name: 'Rotation', exact: true }).inputValue(), '-180');
  const viewport = await page.locator('.react-flow__viewport').getAttribute('style');
  await page.getByRole('button', { name: /zoom in/i }).click();
  await page.waitForFunction(previous => document.querySelector('.react-flow__viewport').getAttribute('style') !== previous, viewport);
  await page.getByRole('button', { name: 'Fit displayed assemblies' }).click();
  // Library pan behavior, on clear canvas away from cards and controls.
  const beforePan = await page.locator('.react-flow__viewport').getAttribute('style');
  await page.mouse.move(300, 800); await page.mouse.down(); await page.mouse.move(390, 850, { steps: 5 }); await page.mouse.up();
  await page.waitForFunction(previous => document.querySelector('.react-flow__viewport').getAttribute('style') !== previous, beforePan);
  await page.getByRole('button', { name: 'Fit displayed assemblies' }).click();
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
  await page.getByRole('button', { name: 'Fit displayed assemblies' }).click();
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
