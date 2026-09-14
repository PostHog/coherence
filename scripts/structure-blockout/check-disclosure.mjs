import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const artifacts = fileURLToPath(new URL('../../docs/prototypes/structure-downtown/', import.meta.url));
const browser = await chromium.launch();
const results = [];
try {
  for (const width of [1440, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(new URL('../../public/_structure-blockout.html', import.meta.url).href);
    await page.locator('[data-stack]').first().waitFor();
    await page.waitForTimeout(500);
    const snapshot = async () => {
      await page.waitForFunction(() => BLOCKOUT.error || BLOCKOUT.routes.every(r =>
        [...document.querySelectorAll('[data-route]')].some(el => el.dataset.route === r.id)));
      return page.evaluate(() => ({
      selected: BLOCKOUT.selected, mode: BLOCKOUT.mode, focus: BLOCKOUT.connectionFocus,
      paths: Object.fromEntries([...document.querySelectorAll('[data-route]')]
        .filter(el => BLOCKOUT.routes.some(r => r.id === el.dataset.route && ['architecture', 'guarantee-reliance'].includes(r.kind)))
        .map(el => [el.dataset.route, el.getAttribute('d')])),
      cards: BLOCKOUT.cards.filter(c => c.nodeKind !== 'promise').map(c => [c.id, c.x, c.y, c.width, c.height]),
      camera: document.querySelector('.react-flow__viewport').style.transform,
      sidebar: document.querySelector('[data-sidebar] h2')?.textContent ?? null,
      error: BLOCKOUT.error,
    }));
    };
    const toggle = () => page.locator('[data-unfurl="component:src/derivation"]').click();
    const roundTrip = async name => {
      const before = await snapshot();
      assert.equal(before.error, null);
      await page.screenshot({ path: `${artifacts}/disclosure-${name}-before-${width}.png` });
      await toggle();
      await page.waitForTimeout(800);
      assert.equal(await page.locator('[data-promise-card]').count(), 3);
      assert.deepEqual(await snapshot(), before, `${name}: unfurl changed the reading`);
      await page.screenshot({ path: `${artifacts}/disclosure-${name}-open-${width}.png` });
      await toggle();
      await page.waitForTimeout(100);
      assert.equal(await page.locator('[data-promise-card]').count(), 0);
      assert.deepEqual(await snapshot(), before, `${name}: fold failed to restore the reading`);
      await page.screenshot({ path: `${artifacts}/disclosure-${name}-folded-${width}.png` });
      results.push({ width, name, ...before, roundTrip: 'unchanged' });
    };
    await roundTrip('opening');
    const opening = await snapshot();
    assert.equal(Object.keys(opening.paths).length, 4);
    assert.equal(opening.selected, null);
    await page.locator('[data-stack="component:src/derivation"] .card-body').click();
    const inspected = await snapshot();
    assert.deepEqual(inspected.paths, opening.paths, 'Inspection silently filtered connections');
    assert.equal(inspected.sidebar, 'Source derivation');
    await roundTrip('inspected');
    await page.getByRole('button', { name: 'Focus connections', exact: true }).click();
    const focused = await snapshot();
    assert.notDeepEqual(focused.paths, inspected.paths, 'Explicit focus did not change connections');
    assert.equal(focused.focus.id, 'component:src/derivation');
    await roundTrip('focused');
    await page.locator('[data-terminal]').filter({ hasText: 'Spec ancestry' }).click();
    const guarantee = await snapshot();
    assert.equal(guarantee.selected.kind, 'guarantee');
    assert.deepEqual(guarantee.paths, focused.paths, 'Guarantee inspection changed active focus');
    assert.match(await page.locator('[data-sidebar]').innerText(), /Reading surfaces → Source derivation/);
    await roundTrip('guarantee-inspected');
    await page.getByRole('button', { name: 'Focus connections', exact: true }).click();
    assert.equal(Object.keys((await snapshot()).paths).length, 1);
    await roundTrip('guarantee-focused');
    await page.getByRole('button', { name: 'Show all in this layer', exact: true }).click();
    assert.deepEqual((await snapshot()).paths, opening.paths);
    assert.deepEqual((await snapshot()).selected, guarantee.selected, 'Clearing focus erased inspection');
    assert.deepEqual(errors, []);
    await page.close();
  }
} finally {
  await browser.close();
  await writeFile(`${artifacts}/disclosure-results.json`, JSON.stringify(results, null, 2));
}
console.log(`Passed ${results.length} disclosure round trips`);
