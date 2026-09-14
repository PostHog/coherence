import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';

// Preserve the observed seven-stack failure as well as checking today's richer
// topology: adding the browser alone happens to hide the old router's overshoot.
const artifacts = new URL('../../docs/prototypes/mnemion-structure/', import.meta.url);
const fixture = JSON.parse(await readFile(new URL('hub-routing-fixture.json', artifacts), 'utf8'));
const bundled = await build({ entryPoints: [new URL('./routing.mjs', import.meta.url).pathname],
  bundle: true, write: false, format: 'iife', globalName: 'HUB_ROUTING' });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
  await page.goto(new URL('../../public/_mnemion-structure.html', import.meta.url).href);
  await page.locator('[data-route]').first().waitFor();
  await page.addScriptTag({ content: bundled.outputFiles[0].text });
  const result = await page.evaluate(fixture => {
    const measure = (routes, cards, coreId, rendered = false) => routes.filter(r =>
      r.target === coreId && r.priority === 1).map(r => {
      const target = cards.find(c => c.id === r.target);
      const path = rendered ? [...document.querySelectorAll('[data-route]')].find(el => el.dataset.route === r.id)
        : document.createElementNS('http://www.w3.org/2000/svg', 'path');
      if (!rendered) path.setAttribute('d', r.path);
      const length = path.getTotalLength(), end = path.getPointAtLength(length);
      let maxY = -Infinity;
      for (let d = 0; d <= length; d += 0.5) maxY = Math.max(maxY, path.getPointAtLength(d).y);
      return { id: r.id, targetBottom: target.y + target.height, endY: end.y,
        overshoot: Math.max(0, maxY - end.y), maxY,
        sideArrival: Math.min(Math.abs(end.x - target.x), Math.abs(end.x - target.x - target.width)) < 0.01,
        matchesRenderedPath: !rendered || path.getAttribute('d') === r.path };
    });
    const fixed = HUB_ROUTING.route(fixture.cards, fixture.relationships, fixture.annotations);
    const negative = fixture.negative.map(r => ({ ...fixture.relationships.find(e => e.id === r.id), ...r }));
    return {
      negative: measure(negative, fixture.cards, fixture.coreId),
      fixed: measure(fixed, fixture.cards, fixture.coreId),
      current: measure(BLOCKOUT.routes, BLOCKOUT.cards, fixture.coreId, true),
      routingError: BLOCKOUT.error,
    };
  }, fixture);
  await writeFile(new URL('hub-routing-results.json', artifacts), JSON.stringify(result, null, 2));
  assert.equal(result.routingError, null);
  assert.ok(result.negative.some(r => r.maxY > r.targetBottom + 100), 'Fixture must retain the measured below-hub detour');
  for (const scene of ['fixed', 'current']) {
    assert.equal(result[scene].length, 2, scene);
    for (const wire of result[scene]) {
      assert.ok(wire.matchesRenderedPath, wire.id);
      assert.ok(wire.sideArrival, `${scene}: entrance should reach a clear side of the hub`);
      assert.ok(wire.overshoot < 0.01, `${scene}: wire passes arrival and doubles back: ${wire.overshoot}`);
    }
  }
  console.log('Hub approaches pass in captured and enriched layouts; old routing fails the same check');
} finally { await browser.close(); }
