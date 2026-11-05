import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import runtime from '../packages/starters/runtime.json';

async function ready(page: Page) {
  await page.goto('/');
  await expect(page.locator('#status')).toHaveText(/^(Ready|Failed to initialize:.*)$/s, { timeout: 120_000 });
  await expect(page.locator('#status')).toHaveText('Ready');
  await expect(page.frameLocator('#preview').getByRole('heading', { name: 'Counter', exact: true }))
    .toBeVisible({ timeout: 30_000 });
}

test('real CrossInertia initializes and serves manifest-backed assets', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await ready(page);

  await expect(page.getByRole('heading', { name: 'CrossInertia Playground' })).toBeVisible();
  const sw = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return { active: registration?.active?.scriptURL, controlled: !!navigator.serviceWorker.controller };
  });
  expect(sw.controlled).toBe(true);
  expect(sw.active).toMatch(/\/sw\.(js|ts)$/);

  const result = await page.evaluate(async () => {
    const health = await (await fetch('/preview/health')).json();
    const response = await fetch('/preview/counter');
    const html = await response.text();
    const document = new DOMParser().parseFromString(html, 'text/html');
    const initialPage = JSON.parse(document.querySelector('script[data-page="app"]')!.textContent!);
    const script = document.querySelector('script[src]')!.getAttribute('src')!;
    const stylesheet = document.querySelector('link[rel="stylesheet"]')!.getAttribute('href')!;
    const jsResponse = await fetch(script);
    const cssResponse = await fetch(stylesheet);
    return {
      health, htmlStatus: response.status, vary: response.headers.get('vary'), initialPage, script, stylesheet,
      js: { status: jsResponse.status, type: jsResponse.headers.get('content-type'), text: await jsResponse.text() },
      css: { status: cssResponse.status, type: cssResponse.headers.get('content-type'), text: await cssResponse.text() },
    };
  });

  expect(result.health.cross_inertia_version).toBe(runtime.crossInertia.version);
  expect(result.health.response_class).toBe('browser_inertia.BrowserInertiaResponse');
  expect(result.htmlStatus).toBe(200);
  expect(result.vary).toBe('X-Inertia');
  expect(result.initialPage).toMatchObject({
    component: 'Counter', props: { count: 0, errors: {} }, url: '/preview/counter',
  });
  // CrossInertia computes this from its real manifest, not the old hardcoded "1".
  const manifest = JSON.parse(readFileSync('examples/counter/static/build/.vite/manifest.json', 'utf8'));
  const pythonJson = (value: unknown): string => {
    if (Array.isArray(value)) return '[' + value.map(pythonJson).join(', ') + ']';
    if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => JSON.stringify(key) + ': ' + pythonJson(item)).join(', ') + '}';
    return JSON.stringify(value);
  };
  expect(result.initialPage.version).toBe(createHash('md5').update(pythonJson(manifest)).digest('hex'));
  expect(result.script).toBe('/preview/static/build/assets/app.js');
  expect(result.stylesheet).toBe('/preview/static/build/assets/app.css');
  expect(result.js.status).toBe(200);
  expect(result.js.type).toMatch(/javascript/);
  expect(result.js.text).toContain('createInertiaApp');
  expect(result.css.status).toBe(200);
  expect(result.css.type).toContain('text/css');
  expect(result.css.text).toContain('.counter');
  expect(errors).toEqual([]);
});

test('counter mutations and preview reload stay inside the ASGI mount', async ({ page }) => {
  await ready(page);
  const frame = page.frameLocator('#preview');
  const counter = frame.getByRole('status', { name: 'Counter value' });
  await expect(counter).toHaveText('0');
  for (const [button, value] of [['+', '1'], ['−', '0'], ['−', '-1'], ['Reset', '0'], ['+', '1']]) {
    await frame.getByRole('button', { name: button, exact: true }).click();
    await expect(counter).toHaveText(value);
  }

  await expect.poll(() => page.frames().find(frame => frame.parentFrame())?.url())
    .toMatch(/\/preview\/counter$/);
  await page.getByRole('button', { name: 'Reload Preview' }).click();
  await expect(counter).toHaveText('1'); // Same worker, same in-memory Python state.

  await page.reload();
  await expect(page.locator('#status')).toHaveText('Ready', { timeout: 120_000 });
  await expect(counter).toHaveText('0'); // Persistence is explicitly not implemented yet.
});

test('published protocol handles partial reloads, version conflicts and validation', async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const request = async (headers: Record<string, string>) => {
      const response = await fetch('/preview/counter', { headers: { 'X-Inertia': 'true', ...headers } });
      return { status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() };
    };
    const full = await request({});
    const partial = await request({
      'X-Inertia-Partial-Component': 'Counter',
      'X-Inertia-Partial-Data': 'missing',
    });
    const stale = await request({ 'X-Inertia-Version': 'stale-build' });
    const invalid = await fetch('/preview/counter', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'invalid' }),
    });
    const health = await (await fetch('/preview/health')).json();
    const privateFile = await fetch('/preview/static/build/.vite/manifest.json');
    const missingAsset = await fetch('/preview/static/build/assets/missing.js');
    return { full, partial, stale, invalidStatus: invalid.status, health, privateStatus: privateFile.status, missingStatus: missingAsset.status };
  });
  expect(result.full.status).toBe(200);
  expect(result.full.headers['x-inertia']).toBe('true');
  expect(JSON.parse(result.full.body)).toMatchObject({ component: 'Counter', props: { count: 0, errors: {} } });
  expect(JSON.parse(result.partial.body).props).toEqual({ errors: {} });
  expect(result.stale.status).toBe(409);
  expect(result.stale.headers['x-inertia-location']).toMatch(/\/preview\/counter$/);
  expect(result.invalidStatus).toBe(422);
  expect(result.health.counter).toBe(0);
  expect(result.privateStatus).toBe(404);
  expect(result.missingStatus).toBe(404);
});

test('a failed real wheel download fails visibly instead of substituting a stub', async ({ page, context }) => {
  await context.route('**/wheels/**/*.whl', route => route.fulfill({ status: 503, body: 'Wheel unavailable for failure-path test' }));
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('Failed to initialize:', { timeout: 120_000 });
  await expect(page.locator('#status')).toContainText(/503|fetch|download/i);
  await expect(page.locator('#preview')).toHaveAttribute('src', 'about:blank');
  await expect(page.getByRole('button', { name: 'Reload Preview' })).toBeDisabled();
});
