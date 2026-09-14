import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const artifacts = fileURLToPath(new URL('../../docs/prototypes/structure-downtown/', import.meta.url));
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 3 });
  await page.goto(new URL('../../public/_structure-blockout.html', import.meta.url).href);
  await page.locator('[data-route]').first().waitFor();
  await page.waitForTimeout(400);
  const observation = await page.evaluate(() => {
    const edge = BLOCKOUT.routes.find(e => e.id === 'relation:architecture:.:command-model');
    const actual = [...document.querySelectorAll('[data-route]')].find(el => el.dataset.route === edge.id);
    const prefix = edge.labelBox.sourcePath;
    const wire = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    wire.setAttribute('d', prefix);
    const length = wire.getTotalLength(), start = wire.getPointAtLength(0), end = wire.getPointAtLength(length);
    let previous = start, minForwardStep = Infinity, maxLateralOffset = 0;
    for (let d = 0.25; d <= length; d += 0.25) {
      const p = wire.getPointAtLength(d);
      minForwardStep = Math.min(minForwardStep, p.y - previous.y);
      maxLateralOffset = Math.max(maxLateralOffset, Math.abs(p.x - start.x));
      previous = p;
    }
    const card = document.querySelector('[data-stack="component:src"]').getBoundingClientRect();
    const label = document.querySelector('[data-route-label="relation:architecture:.:command-model"]').getBoundingClientRect();
    return { prefix, matchesRenderedPath: actual.getAttribute('d').startsWith(prefix), minForwardStep, maxLateralOffset,
      start: [start.x, start.y], end: [end.x, end.y],
      sourceBottom: BLOCKOUT.cards.find(c => c.id === edge.source).y + BLOCKOUT.cards.find(c => c.id === edge.source).height,
      labelTop: edge.labelBox.y,
      clip: { x: Math.min(card.x, label.x) - 10, y: card.bottom - 35,
        width: Math.max(card.right, label.right) - Math.min(card.x, label.x) + 20, height: label.bottom - card.bottom + 50 } };
  });
  await writeFile(`${artifacts}/short-wire-results.json`, JSON.stringify(observation, null, 2));
  await page.screenshot({ path: `${artifacts}/short-wire.png`, clip: observation.clip });
  assert.ok(observation.matchesRenderedPath, 'Measured prefix differs from rendered wire');
  assert.equal(observation.start[1], observation.sourceBottom);
  assert.equal(observation.end[1], observation.labelTop);
  assert.ok(observation.maxLateralOffset < 0.001, 'Nearby free ports should align');
  assert.ok(observation.minForwardStep >= -0.001, `Wire doubles back: ${observation.minForwardStep}`);
  console.log('Short wire advances continuously from card to label');
} finally { await browser.close(); }
