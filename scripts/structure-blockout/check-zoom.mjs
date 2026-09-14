import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const artifacts = fileURLToPath(new URL('../../docs/prototypes/structure-downtown/', import.meta.url));
const browser = await chromium.launch(), results = [];
try {
  for (const width of [1440, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(new URL('../../public/_structure-blockout.html', import.meta.url).href);
    await page.locator('[data-stack]').first().waitFor();
    await page.waitForTimeout(500);
    const read = () => page.evaluate(() => {
      const zoom = Number(document.querySelector('.react-flow__viewport').style.transform.match(/scale\(([^)]+)\)/)[1]);
      return {
        error: BLOCKOUT.error, sparse: BLOCKOUT.sparse, zoom,
        cards: BLOCKOUT.cards.map(c => [c.id, c.x, c.y, c.width, c.height]),
        paths: Object.fromEntries([...document.querySelectorAll('[data-route]')].map(el => [el.dataset.route, el.getAttribute('d')])),
        expanded: BLOCKOUT.expanded,
        titles: [...document.querySelectorAll('[data-stack], [data-terminal], [data-promise-card]')].map(el => {
          const title = el.querySelector('h2, span'), box = el.getBoundingClientRect(), r = title.getBoundingClientRect();
          return { id: el.dataset.stack ?? el.dataset.terminal ?? el.dataset.promiseCard,
            geometry: [box.width / zoom, box.height / zoom, (r.x - box.x) / zoom, (r.y - box.y) / zoom, r.width / zoom, r.height / zoom],
            text: title.textContent, font: getComputedStyle(title).fontSize };
        }),
        supportingOpacity: getComputedStyle(document.querySelector('.stack .intent')).opacity,
      };
    });
    const invariant = (a, b) => {
      assert.equal(b.error, null);
      for (const key of ['cards', 'paths', 'expanded']) assert.deepEqual(b[key], a[key], `Zoom changed ${key}`);
      assert.equal(b.titles.length, a.titles.length);
      a.titles.forEach((title, i) => {
        const next = b.titles[i];
        assert.equal(next.id, title.id); assert.equal(next.text, title.text); assert.equal(next.font, title.font);
        title.geometry.forEach((v, j) => assert.ok(Math.abs(next.geometry[j] - v) < 0.02, `Zoom moved/resized ${title.id}: ${j}`));
      });
    };
    const zoomUntil = async sparse => {
      for (let i = 0; i < 8 && (await read()).sparse !== sparse; i++) {
        await page.locator(`.react-flow__controls-zoom${sparse ? 'out' : 'in'}`).click();
        await page.waitForTimeout(250);
      }
      await page.waitForTimeout(250);
      assert.equal((await read()).sparse, sparse);
    };
    for (const expanded of [false, true]) {
      if (expanded) {
        await page.locator('[data-unfurl="component:src/derivation"]').click();
        await page.waitForTimeout(800);
      }
      const near = await read();
      assert.equal(near.supportingOpacity, '1');
      await page.screenshot({ path: `${artifacts}/zoom-${expanded ? 'expanded' : 'collapsed'}-near-${width}.png` });
      await zoomUntil(true);
      const far = await read(); invariant(near, far);
      assert.equal(far.supportingOpacity, '0');
      await page.screenshot({ path: `${artifacts}/zoom-${expanded ? 'expanded' : 'collapsed'}-far-${width}.png` });
      await zoomUntil(false);
      const returned = await read(); invariant(near, returned);
      assert.equal(returned.supportingOpacity, '1');
      results.push({ width, expanded, near, far, returned });
    }
    assert.deepEqual(errors, []); await page.close();
  }
} finally {
  await browser.close();
  await writeFile(`${artifacts}/zoom-results.json`, JSON.stringify(results, null, 2));
}
console.log(`Passed ${results.length} fixed-geometry zoom round trips`);
