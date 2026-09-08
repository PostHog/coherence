import assert from 'node:assert/strict';
import { writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, webkit } from 'playwright';
import { tmpProject, cleanup, cfg } from '../../test/_helpers.ts';
import { buildGraph } from '../../src/derive.ts';
import { recordTaxonomy } from '../../src/taxonomy-ledger.ts';
import { TAXONOMY } from '../../src/taxonomy-catalog.ts';
import { startScopeServer } from './server.mjs';

const root = await tmpProject({ 'coherence.spec.md': '# Fixture\n', 'subject.ts': 'export function session() { return 1; }\n' });
const config = cfg(root), graph = await buildGraph(config);
const live = await startScopeServer({ cfg: config, htmlPath: new URL('../../public/_scope-library.html', import.meta.url), intervalMs: 40 });
const engine = process.env.SCOPE_BROWSER_ENGINE === 'webkit' ? webkit : chromium;
const browser = await engine.launch(engine === chromium && process.env.SCOPE_BROWSER_CHANNEL ? { channel: process.env.SCOPE_BROWSER_CHANNEL } : {});
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(live.url);
  await page.waitForFunction(() => document.querySelector('.feed-status')?.textContent === 'Journal live');
  await page.getByRole('tab', { name: 'Taxonomy', exact: true }).click();
  assert.match(await page.locator('.taxonomy-panel').innerText(), /No classifications recorded/);
  const options = { target: 'subject.ts#session', expected: null, session: 'taxonomy-fixture', agent: 'fixture', because: 'Owns session and resource lifecycle',
    answers: { 'signal:continuity': 'yes', 'signal:resource': 'yes' }, roles: ['role:session-subscription-owner', 'role:resource-driver'], facets: ['facet:lifecycle'], evidence: ['subject.ts'] };
  const a = recordTaxonomy(config, graph, options);
  await page.locator('.taxonomy-list .journal-row').waitFor();
  assert.match(await page.locator('.taxonomy-detail').innerText(), /composite/);
  assert.match(await page.locator('.taxonomy-detail').innerText(), /UNVERIFIED/);
  await page.getByRole('combobox', { name: 'Scope session' }).selectOption('taxonomy-fixture');
  await page.getByRole('textbox', { name: 'Search taxonomy' }).fill('subject.ts');
  await page.locator('.taxonomy-list .journal-row').click();
  await writeFile(join(root, 'subject.ts'), 'export function session() { return 2; }\n');
  await page.waitForFunction(() => document.querySelector('.taxonomy-detail')?.textContent.includes('Stale evidence'));
  assert.equal(await page.getByRole('textbox', { name: 'Search taxonomy' }).inputValue(), 'subject.ts');
  assert.equal(await page.locator('.taxonomy-list .journal-row').count(), 1);
  const b = recordTaxonomy(config, await buildGraph(config), { ...options, expected: a.id, because: 'Reassessed changed source' });
  await page.waitForFunction(() => document.querySelector('.taxonomy-detail')?.textContent.includes('Reassessed changed source'));
  assert.doesNotMatch(await page.locator('.taxonomy-detail').innerText(), /Stale evidence/);
  const c = recordTaxonomy(config, await buildGraph(config), { ...options, expected: b.id, roles: [],
    answers: { 'signal:representation': 'yes' }, because: 'Representation needs operational evidence' });
  await page.waitForFunction(() => document.querySelector('.taxonomy-detail')?.textContent.includes('Representation needs operational evidence'));
  await page.locator('.taxonomy-detail summary').filter({ hasText: 'Candidate responsibilities' }).click();
  assert.match(await page.locator('.taxonomy-detail').innerText(), /Required before selection: signal:parses-syntax/);
  await page.locator('.taxonomy-questions summary').click();
  assert.match(await page.locator('.taxonomy-questions').innerText(), /recognize an input syntax/);
  const d = recordTaxonomy(config, await buildGraph(config), { ...options, expected: c.id,
    answers: { 'signal:parses-syntax': 'yes' }, roles: ['role:parser'], because: 'Explicit parser evidence' });
  await page.waitForFunction(() => document.querySelector('.taxonomy-detail')?.textContent.includes('Explicit parser evidence'));
  recordTaxonomy(config, await buildGraph(config), { ...options, expected: d.id, roles: [], facets: [],
    answers: Object.fromEntries(TAXONOMY.questions.filter(q => q.pack === 'core').map(q => [q.id, 'no'])), because: 'Exhausted catalog without a fit' });
  await page.waitForFunction(() => document.querySelector('.taxonomy-detail')?.textContent.includes('Exhausted catalog without a fit'));
  await page.getByRole('combobox', { name: 'Taxonomy status' }).selectOption('no-fit');
  assert.equal(await page.locator('.taxonomy-list .journal-row').count(), 1);
  await page.getByRole('combobox', { name: 'Taxonomy status' }).selectOption('ambiguous');
  assert.match(await page.locator('.taxonomy-panel').innerText(), /No matching classifications/);
  await page.getByRole('combobox', { name: 'Taxonomy status' }).selectOption('');
  await page.getByRole('tab', { name: 'Structure', exact: true }).click();
  await page.getByRole('tab', { name: 'Taxonomy', exact: true }).click();
  assert.equal(await page.getByRole('textbox', { name: 'Search taxonomy' }).inputValue(), 'subject.ts');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'taxonomy mobile overflow');
  const [name] = await readdir(join(root, '.coherence/taxonomy'));
  await writeFile(join(root, '.coherence/taxonomy', name), 'damaged\n');
  await page.waitForFunction(() => document.querySelector('.taxonomy-panel [role=alert]')?.textContent.includes('Taxonomy unavailable'));
  assert.equal(await page.locator('.taxonomy-list .journal-row').count(), 0);
  assert.deepEqual(errors, []);
  console.log('Taxonomy browser checks passed: focused operational questions, explicit selection, no-fit, empty, composite, unverified suggestions, live staleness/revision, retained filters, mobile and damaged evidence.');
} finally { await browser.close(); await live.close(); await cleanup(root); }
