import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureSource = join(packageRoot, 'test/fixtures/scope-extensions');
const scratch = await mkdtemp(join(tmpdir(), 'coherence-scope-transplant-'));
const skipPack = process.argv.includes('--skip-pack');
const browserOptions = process.env.SCOPE_BROWSER_CHANNEL ? { channel: process.env.SCOPE_BROWSER_CHANNEL } : {};
let browser;

function run(command, args, cwd, expected = 0) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
  assert.equal(result.status, expected, `${command} ${args.join(' ')} exited ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  return result;
}

async function fixtureAt(name) {
  const root = join(scratch, name);
  await cp(fixtureSource, root, { recursive: true });
  for (const relative of await readdir(root, { recursive: true, encoding: 'utf8' })) {
    if (!relative.endsWith('.spec.txt')) continue;
    const source = join(root, relative);
    await writeFile(source.slice(0, -4) + '.md', await readFile(source));
    await rm(source);
  }
  return root;
}

async function generate(cli, root) {
  run(process.execPath, [cli, 'scope'], root);
  const html = join(root, 'public/_scope.html');
  assert.match(await readFile(html, 'utf8'), /id="scope-data"/, 'normal scope command did not emit its ordinary embedded snapshot');
  return html;
}

async function world(page) {
  return page.locator('[data-structure-stack]').evaluateAll(nodes => Object.fromEntries(nodes.map(node => {
    const shell = node.closest('.react-flow__node') ?? node;
    const style = getComputedStyle(shell), match = style.transform.match(/matrix\([^,]+,[^,]+,[^,]+,[^,]+,\s*([^,]+),\s*([^\)]+)\)/);
    return [node.getAttribute('data-structure-stack'), {
      x: match ? Number(match[1]) : Number.parseFloat(shell.style.left || '0'),
      y: match ? Number(match[2]) : Number.parseFloat(shell.style.top || '0'),
      width: shell.offsetWidth, height: shell.offsetHeight,
    }];
  })));
}

async function externalRoutes(page) {
  return page.locator('[data-structure-route]').evaluateAll(nodes => nodes.map(node => ({
    id: node.getAttribute('data-structure-route'), d: node.querySelector('path')?.getAttribute('d') ?? node.getAttribute('d'),
  })).filter(edge => !edge.id.startsWith('detail:') && !edge.id.startsWith('ownership:')).sort((a, b) => String(a.id).localeCompare(String(b.id))));
}

async function openGenerated(html, label) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.setDefaultTimeout(12_000);
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => requests.push(request.url()));
  await page.goto(pathToFileURL(html).href);
  await page.locator('[data-structure-view]').waitFor();
  assert.ok((await page.locator('[data-structure-stack]').count()) >= 2, `${label}: missing canonical component population beyond the project frame`);
  assert.ok((await page.locator('[data-structure-entrance]').count()) >= 1, `${label}: missing source-backed entrance`);
  assert.ok((await page.locator('[data-structure-route]').count()) >= 1, `${label}: missing meaningful external routes`);
  assert.equal(await page.locator('.graph-card').count(), 0, `${label}: Structure regressed to generic graph cards`);
  assert.ok(requests.every(url => url.startsWith('file:')), `${label}: generated page made a network request`);
  return { page, errors, requests };
}

async function assertStructure(html, { extended, label }) {
  const { page, errors } = await openGenerated(html, label);
  let observedWorld;
  try {
    const initialWorld = await world(page);
    observedWorld = initialWorld;
    const identities = Object.keys(initialWorld).sort();
    assert.equal(new Set(identities).size, identities.length, `${label}: component subject identity is not unique`);
    const initialRoutes = await externalRoutes(page);

    if (extended) {
      assert.equal(await page.locator('[data-fixture-card]').count(), identities.length, 'card override did not wrap every shipped card body');
      const hook = page.locator('[data-fixture-hook]').first();
      await hook.click();
      await hook.getByText('Hook count 1', { exact: true }).waitFor();
    }

    const card = page.locator('[data-structure-stack]').first();
    const subject = await card.getAttribute('data-structure-stack');
    const readableTitle = await card.locator('.structure-card-body h2').evaluate((title, shell) => {
      const node = shell.closest('.react-flow__node');
      return parseFloat(getComputedStyle(title).fontSize) * node.getBoundingClientRect().width / node.offsetWidth;
    }, await card.elementHandle());
    assert.ok(readableTitle >= 14, `${label}: opening card title is only ${readableTitle}px`);
    const contained = await card.evaluate(shell => {
      const body = shell.querySelector('[data-structure-card-body]'), outer = shell.getBoundingClientRect(), inner = body.getBoundingClientRect();
      return inner.left >= outer.left - 1 && inner.top >= outer.top - 1 && inner.right <= outer.right + 1 && inner.bottom <= outer.bottom + 1;
    });
    assert.equal(contained, true, `${label}: customized card body overflows its stable world shell`);
    const unfurl = card.locator('[data-structure-unfurl]').first();
    await unfurl.click();
    assert.equal(await unfurl.getAttribute('aria-expanded'), 'true', `${label}: unfurl did not expose disclosure state`);
    const promises = page.locator(`[data-structure-promise-card][data-owner=${JSON.stringify(subject)}]`);
    await promises.first().waitFor();
    await page.locator('[data-structure-route^="detail:"], [data-structure-route^="ownership:"]').first().waitFor({ state: 'attached' });
    await page.waitForFunction(() => Object.values(globalThis.__SCOPE_STRUCTURE__ ?? {}).every(snapshot => Object.values(snapshot).every(view => !view.error)));
    assert.deepEqual(await world(page), initialWorld, `${label}: unfurl moved or resized stable world rectangles`);
    assert.deepEqual(await externalRoutes(page), initialRoutes, `${label}: unfurl changed external route geometry`);
    assert.ok((await promises.count()) >= 1, `${label}: local promises were not independent cards`);

    const promise = promises.first();
    const promiseLabel = await promise.locator('span').innerText();
    await promise.locator('button').click();
    const sidebar = page.locator('[data-structure-sidebar]');
    await sidebar.waitFor();
    assert.ok((await sidebar.innerText()).includes(promiseLabel), `${label}: promise inspection lost its identity`);
    assert.match(await sidebar.innerText(), /oracle|verdict|evidence/i, `${label}: promise inspection hid evidence detail`);
    const evidenceButton = sidebar.locator('button').filter({ hasText: /present|absent|invalid|unknown/i }).first();
    if (await evidenceButton.count()) await evidenceButton.click();

    const close = page.getByRole('button', { name: 'Close architecture detail', exact: true });
    if (await close.count()) await close.click();
    await card.locator('[data-structure-card-body]').click();
    await sidebar.waitFor();
    assert.ok((await sidebar.innerText()).length > 20, `${label}: card-body inspection is empty`);

    const cameraBefore = await page.locator('.react-flow__viewport').getAttribute('style');
    for (let i = 0; i < 5; i++) {
      const control = page.locator('.react-flow__controls-zoomout');
      if (await control.isDisabled()) break;
      await control.click();
    }
    const zoomedWorld = await world(page);
    assert.deepEqual(zoomedWorld, initialWorld, `${label}: zoom replaced world geometry instead of card content`);
    const zoomCamera = await page.locator('.react-flow__viewport').getAttribute('style');
    assert.notEqual(zoomCamera, cameraBefore, `${label}: zoom did not change camera geometry`);

    await page.getByRole('tab', { name: 'All assets', exact: true }).click();
    await page.getByRole('tab', { name: 'Structure', exact: true }).click();
    await page.locator(`[data-structure-stack=${JSON.stringify(subject)}]`).waitFor();
    assert.equal(await page.locator(`[data-structure-stack=${JSON.stringify(subject)}] [data-structure-unfurl]`).getAttribute('aria-expanded'), 'true', `${label}: tab switch lost disclosure state`);
    // React Flow remounts on tab switch and applies the persisted camera from onInit, after the
    // nodes are already in the DOM; sample the transform only once it settles (observed identity
    // transform on an early sample, d-c1447605).
    await page.waitForFunction(expected => document.querySelector('.react-flow__viewport')?.getAttribute('style') === expected, zoomCamera, { timeout: 5000 }).catch(() => {});
    assert.equal(await page.locator('.react-flow__viewport').getAttribute('style'), zoomCamera, `${label}: tab switch lost camera state`);

    await page.locator('[data-structure-relationships] summary').click();
    const relationship = page.locator('[data-structure-relationships] button').first();
    const relationshipText = await relationship.innerText();
    await relationship.click();
    await sidebar.waitFor();
    const relationshipDetail = await sidebar.innerText();
    assert.ok(relationshipDetail.includes(relationshipText.split(' · ')[0]), `${label}: relationship inspector lost declared identity`);
    assert.match(relationshipDetail, /The exchange assigns accepted parcels to the dispatcher|Dispatch records its outcome in the receipt store/, `${label}: relationship inspector lost exact authored rationale`);

    if (extended) {
      await page.getByRole('tab', { name: 'Extension audit', exact: true }).click();
      const replacement = page.locator('[data-fixture-view]');
      await replacement.waitFor();
      const viewHook = replacement.getByRole('button', { name: 'View hook 0', exact: true });
      await viewHook.click();
      await replacement.getByRole('button', { name: 'View hook 1', exact: true }).waitFor();
      assert.match(await replacement.locator('h2').innerText(), /3 components/, 'whole-view override did not receive the canonical catalog');
    }
    assert.deepEqual(errors, [], `${label}: browser errors`);
  } finally { await page.close(); }
  return observedWorld;
}

async function assertFailures(cli) {
  const missing = await fixtureAt('missing-extension');
  const config = JSON.parse(await readFile(join(missing, 'coherence.scope.json'), 'utf8'));
  config.extensions = ['./does-not-exist.jsx'];
  await writeFile(join(missing, 'coherence.scope.json'), JSON.stringify(config));
  const result = run(process.execPath, [cli, 'scope'], missing, 1);
  assert.match(`${result.stdout}\n${result.stderr}`, /does-not-exist|extension/i, 'missing module error was not actionable');

  const unknown = await fixtureAt('unknown-registration');
  const unknownConfig = JSON.parse(await readFile(join(unknown, 'coherence.scope.json'), 'utf8'));
  unknownConfig.views[0].structure.implementations.rank = 'fixture.absent';
  await writeFile(join(unknown, 'coherence.scope.json'), JSON.stringify(unknownConfig));
  const unknownHtml = await generate(cli, unknown);
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(pathToFileURL(unknownHtml).href);
  await page.waitForTimeout(500);
  assert.match(`${await page.locator('body').innerText()}\n${pageErrors.join('\n')}`, /fixture\.absent|unknown registration/i);
  await page.close();
}

try {
  browser = await chromium.launch(browserOptions);
  const sourceFixture = await fixtureAt('source-extended');
  const extendedWorld = await assertStructure(await generate(join(packageRoot, 'src/cli.ts'), sourceFixture), { extended: true, label: 'source extended' });
  const sourceDefault = await fixtureAt('source-default');
  await rm(join(sourceDefault, 'extension.jsx'));
  await writeFile(join(sourceDefault, 'coherence.scope.json'), JSON.stringify({ version: 1, extends: 'default' }));
  const defaultWorld = await assertStructure(await generate(join(packageRoot, 'src/cli.ts'), sourceDefault), { extended: false, label: 'source default' });
  assert.deepEqual(Object.keys(extendedWorld).sort(), Object.keys(defaultWorld).sort(), 'override changed canonical component identities');
  assert.ok(Object.keys(defaultWorld).some(id => extendedWorld[id].x !== defaultWorld[id].x || extendedWorld[id].y !== defaultWorld[id].y), 'custom rank/layout did not change visible world positions');
  await assertFailures(join(packageRoot, 'src/cli.ts'));

  if (!skipPack) {
    const packed = join(scratch, 'packed'); await mkdir(packed);
    run('npm', ['pack', '--ignore-scripts', '--pack-destination', packed], packageRoot);
    const tarballs = (await readdir(packed)).filter(name => name.endsWith('.tgz'));
    assert.equal(tarballs.length, 1, 'npm pack did not produce exactly one archive');
    const consumer = await fixtureAt('packed-extended');
    await writeFile(join(consumer, 'package.json'), JSON.stringify({ name: 'scope-extension-consumer', private: true, type: 'module' }));
    run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', join(packed, tarballs[0])], consumer);
    const installed = join(consumer, 'node_modules/@danilocampos/coherence');
    assert.equal((await readdir(installed)).includes('src'), false, 'packed acceptance retained a source-checkout dependency');
    await assertStructure(await generate(join(consumer, 'node_modules/.bin/coherence'), consumer), { extended: true, label: 'packed extended' });

    const defaultConsumer = await fixtureAt('packed-default');
    await rm(join(defaultConsumer, 'extension.jsx'));
    await writeFile(join(defaultConsumer, 'coherence.scope.json'), JSON.stringify({ version: 1, extends: 'default' }));
    await mkdir(join(defaultConsumer, 'node_modules'), { recursive: true });
    await cp(join(consumer, 'node_modules'), join(defaultConsumer, 'node_modules'), { recursive: true, force: true });
    await assertStructure(await generate(join(defaultConsumer, 'node_modules/.bin/coherence'), defaultConsumer), { extended: false, label: 'packed default' });
  }
  console.log(`Scope transplant acceptance passed (${skipPack ? 'source only' : 'source and packed consumers'}): normal generation, registry inheritance, shared hooks, world geometry, inspection, state and offline output.`);
} finally {
  await browser?.close();
  if (!process.env.SCOPE_REVIEW_DIR) await rm(scratch, { recursive: true, force: true });
  else console.log(`Scope transplant artifacts retained at ${scratch}`);
}
