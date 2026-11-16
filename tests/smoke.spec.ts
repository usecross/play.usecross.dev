import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import * as esbuild from 'esbuild-wasm';
import { bundleFrontend } from '../packages/bundler/index.ts';

const crossInertiaVersion = readFileSync('examples/counter/pyproject.toml', 'utf8')
  .match(/"cross-inertia==([^"]+)"/)![1];

const starterApp = readFileSync('examples/counter/app.py', 'utf8');
const starterTemplate = readFileSync('examples/counter/templates/app.html', 'utf8');
const starterTsx = readFileSync('examples/counter/frontend/app.tsx', 'utf8');
const starterCss = readFileSync('examples/counter/frontend/app.css', 'utf8');
/** The starter's frontend, bundled here in Node as the deploy does. */
const starterBuild = () => bundleFrontend(esbuild, Object.fromEntries(readdirSync('examples/counter/frontend')
  .map(name => [`frontend/${name}`, readFileSync(`examples/counter/frontend/${name}`, 'utf8')])));
/** The Inertia asset version of the page in the preview. */
const previewVersion = (page: Page) => page.evaluate(() => JSON.parse(
  (document.querySelector('#preview') as HTMLIFrameElement).contentDocument!.querySelector('script[data-page]')!.textContent!,
).version);
const editorCode = (page: Page) => page.getByRole('tabpanel').locator('.cm-content');

/** Replace a starter file's contents in the editor, as typing would. */
async function replaceFile(page: Page, tab: string, content: string) {
  await page.getByRole('tab', { name: tab }).click();
  await editorCode(page).click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(content);
}

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

  expect(result.health.cross_inertia_version).toBe(crossInertiaVersion);
  expect(result.health.response_class).toBe('browser_inertia.BrowserInertiaResponse');
  expect(result.htmlStatus).toBe(200);
  expect(result.vary).toBe('X-Inertia');
  expect(result.initialPage).toMatchObject({
    component: 'Counter', props: { count: 0, errors: {} }, url: '/preview/counter',
  });
  // CrossInertia computes this from its real manifest, which esbuild generates at build time.
  const { manifest } = await starterBuild();
  const entry = manifest['frontend/app.tsx'];
  const pythonJson = (value: unknown): string => {
    if (Array.isArray(value)) return '[' + value.map(pythonJson).join(', ') + ']';
    if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => JSON.stringify(key) + ': ' + pythonJson(item)).join(', ') + '}';
    return JSON.stringify(value);
  };
  expect(result.initialPage.version).toBe(createHash('md5').update(pythonJson(manifest)).digest('hex'));
  expect(result.script).toBe(`/preview/static/build/${entry.file}`);
  expect(result.stylesheet).toBe(`/preview/static/build/${entry.css![0]}`);
  expect(result.script).toMatch(/\/assets\/app-\w+\.js$/);
  expect(result.js.status).toBe(200);
  expect(result.js.type).toMatch(/javascript/);
  expect(result.js.text).toContain('createInertiaApp');
  expect(result.css.status).toBe(200);
  expect(result.css.type).toContain('text/css');
  expect(result.css.text).toContain('.counter');
  expect(errors).toEqual([]);
});

test('the editor shows the starter files that run in Python', async ({ page }) => {
  await page.goto('/');
  const tabs = page.getByRole('tab');
  await expect(tabs).toHaveText(['app.py', 'templates/app.html', 'frontend/app.tsx', 'frontend/app.css', 'pyproject.toml']);
  await expect(page.getByRole('tab', { selected: true })).toHaveText('app.py');
  const code = page.getByRole('tabpanel').locator('.cm-content');
  await expect(code).toContainText('def read_count()');

  // Arrow keys move between tabs; the panel follows the selection.
  await page.getByRole('tab', { name: 'app.py' }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('tab', { selected: true })).toHaveText('pyproject.toml');
  await expect(page.getByRole('tab', { name: 'pyproject.toml' })).toBeFocused();
  await expect(code).toContainText(`"cross-inertia==${crossInertiaVersion}"`);
  await page.getByRole('tab', { name: 'templates/app.html' }).click();
  await expect(code).toContainText('{{ inertia_body() }}');
});

test('edits to app.py and the template apply without losing data', async ({ page }) => {
  await ready(page);
  const frame = page.frameLocator('#preview');
  const counter = frame.getByRole('status', { name: 'Counter value' });
  const code = page.getByRole('tabpanel').locator('.cm-content');
  const plus = frame.getByRole('button', { name: '+', exact: true });
  await plus.click();
  await expect(counter).toHaveText('1');

  // Dependencies are read-only until dependency edits land.
  await page.getByRole('tab', { name: 'pyproject.toml' }).click();
  await code.click();
  await page.keyboard.type('# edited');
  await expect(code).not.toContainText('# edited');

  // A Python edit applies after a pause; the count in SQLite survives it.
  const app = readFileSync('examples/counter/app.py', 'utf8');
  await replaceFile(page, 'app.py', app.replace('value = value + 1', 'value = value + 10'));
  await expect(page.locator('#status')).toHaveText('Changes applied');
  await expect(counter).toHaveText('1');
  await plus.click();
  await expect(counter).toHaveText('11');

  // A broken edit is rolled back: the traceback shows, the last version keeps serving.
  await replaceFile(page, 'app.py', app.replace('def read_count()', 'def read_count(:'));
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.getByRole('alert')).toContainText('SyntaxError');
  await expect(page.locator('#status')).toHaveText('Not applied: the previous version is still running');
  await page.getByRole('button', { name: 'Reload Preview' }).click();
  await plus.click();
  await expect(counter).toHaveText('21');

  // Fixing it clears the error.
  await replaceFile(page, 'app.py', app);
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.getByRole('alert')).toBeHidden();

  // A broken template is rolled back on disk too. The preview runs what the
  // editor shows, so a later app.py edit waits for the template to be fixed.
  const template = readFileSync('examples/counter/templates/app.html', 'utf8');
  await replaceFile(page, 'templates/app.html', template.replace('{{ inertia_body() }}', '{{ inertia_body( }}'));
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.getByRole('alert')).toContainText('TemplateSyntaxError');
  await page.getByRole('button', { name: 'Reload Preview' }).click();
  await expect(counter).toHaveText('21');
  await replaceFile(page, 'app.py', app.replace('value = value + 1', 'value = value + 2'));
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.getByRole('alert')).toContainText('TemplateSyntaxError');
  await expect(page.locator('#status')).toHaveText('Not applied: the previous version is still running');
  await page.getByRole('button', { name: 'Reload Preview' }).click();
  await plus.click();
  await expect(counter).toHaveText('22');

  // Template edits apply the same way as Python ones; fixing it applies both.
  await replaceFile(page, 'templates/app.html', template.replace('<title>Counter - CrossInertia Playground</title>', '<title>Edited title</title>'));
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.locator('#status')).toHaveText('Changes applied');
  await expect(page.getByRole('alert')).toBeHidden();
  await expect.poll(() => page.evaluate(() => (document.querySelector('#preview') as HTMLIFrameElement).contentDocument?.title))
    .toBe('Edited title');
  await plus.click();
  await expect(counter).toHaveText('24');
});

test('frontend edits are bundled in the browser and keep data', async ({ page }) => {
  page.on('dialog', dialog => dialog.accept());
  await ready(page);
  const frame = page.frameLocator('#preview');
  const counter = frame.getByRole('status', { name: 'Counter value' });
  const heading = frame.getByRole('heading', { level: 1 });
  await frame.getByRole('button', { name: '+', exact: true }).click();
  await expect(counter).toHaveText('1');
  const starterVersion = await previewVersion(page);

  // A TSX edit is bundled with esbuild-wasm and replaces the starter's build.
  await replaceFile(page, 'frontend/app.tsx', starterTsx.replace('<h1>Counter</h1>', '<h1>My counter</h1>'));
  await expect(page.locator('#status')).toHaveText('Changes applied', { timeout: 30_000 });
  await expect(heading).toHaveText('My counter');
  await expect(counter).toHaveText('1');
  // The new manifest changes the asset version, so an Inertia visit from the old page gets a 409.
  const editedVersion = await previewVersion(page);
  expect(editedVersion).not.toBe(starterVersion);
  expect(await page.evaluate(version => fetch('/preview/counter', {
    headers: { 'X-Inertia': 'true', 'X-Inertia-Version': version },
  }).then(response => response.status), starterVersion)).toBe(409);

  // CSS edits are bundled too.
  await replaceFile(page, 'frontend/app.css', starterCss + '\nh1 { color: rgb(200, 0, 0); }\n');
  await expect(page.locator('#status')).toHaveText('Changes applied');
  await expect(heading).toHaveCSS('color', 'rgb(200, 0, 0)');

  // A bundle error names the file and line; the last good bundle keeps serving.
  await replaceFile(page, 'frontend/app.tsx', starterTsx.replace('<h1>Counter</h1>', '<h1>Broken</h2>'));
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.getByRole('alert')).toContainText(/frontend\/app\.tsx:\d+:\d+/);
  await expect(page.getByRole('alert')).toContainText('Unexpected closing "h2" tag');
  await expect(page.locator('#status')).toHaveText('Not applied: the previous version is still running');
  await page.getByRole('button', { name: 'Reload Preview' }).click();
  await expect(heading).toHaveText('My counter');
  await replaceFile(page, 'frontend/app.tsx', starterTsx.replace('<h1>Counter</h1>', '<h1>My counter</h1>'));
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.getByRole('alert')).toBeHidden();

  // A reload bundles the saved edits again before the preview loads.
  await page.reload();
  await expect(page.locator('#status')).toHaveText('Ready', { timeout: 120_000 });
  await expect(heading).toHaveText('My counter');
  await expect(heading).toHaveCSS('color', 'rgb(200, 0, 0)');

  // Reset to starter goes back to the starter's own build.
  await page.getByRole('button', { name: 'Reset to starter' }).click();
  await expect(page.locator('#status')).toHaveText('Starter files restored');
  await expect(heading).toHaveText('Counter');
  expect(await previewVersion(page)).toBe(starterVersion);
  await expect(counter).toHaveText('1');
});

test('frontend applies retry a failed esbuild load and land in order', async ({ page }) => {
  page.on('dialog', dialog => dialog.accept());
  // The first esbuild download fails; the next one is slow.
  let downloads = 0;
  await page.route(/esbuild[^/]*\.wasm/, async route => {
    if (route.request().resourceType() !== 'fetch') return route.continue(); // Vite's dev module for the URL
    if (++downloads === 1) return route.abort();
    await new Promise(resolve => setTimeout(resolve, 2_000));
    await route.continue();
  });
  await ready(page);
  const heading = page.frameLocator('#preview').getByRole('heading', { level: 1 });

  await replaceFile(page, 'frontend/app.tsx', starterTsx.replace('<h1>Counter</h1>', '<h1>My counter</h1>'));
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.locator('#status')).toHaveText('Not applied: the previous version is still running');
  await expect(page.getByRole('alert')).toBeVisible();

  // The next edit downloads esbuild again. Resetting while it does must not
  // let the slower edited bundle land after the starter.
  await replaceFile(page, 'frontend/app.tsx', starterTsx.replace('<h1>Counter</h1>', '<h1>Second edit</h1>'));
  await page.keyboard.press('ControlOrMeta+s');
  await page.getByRole('button', { name: 'Reset to starter' }).click();
  await expect(page.locator('#status')).toHaveText('Starter files restored', { timeout: 30_000 });
  expect(downloads).toBe(2);
  await page.waitForTimeout(3_000); // Longer than the slow download, so a stale bundle would have landed.
  await expect(page.locator('#status')).toHaveText('Starter files restored');
  await expect(heading).toHaveText('Counter');
  await expect(page.getByRole('alert')).toBeHidden();
});

test('edits are saved across reloads; reset and clear data are separate', async ({ page }) => {
  page.on('dialog', dialog => dialog.accept());
  await ready(page);
  const frame = page.frameLocator('#preview');
  const counter = frame.getByRole('status', { name: 'Counter value' });
  const plus = frame.getByRole('button', { name: '+', exact: true });
  const code = editorCode(page);

  await replaceFile(page, 'app.py', starterApp.replace('value = value + 1', 'value = value + 10'));
  await expect(page.locator('#status')).toHaveText('Changes applied');
  await plus.click();
  await expect(counter).toHaveText('10');

  // A full reload starts a new worker; the saved edit runs before the preview loads.
  await page.reload();
  await ready(page);
  await expect(code).toContainText('value = value + 10');
  await plus.click();
  await expect(counter).toHaveText('20');

  // Clear data resets the count and keeps the code.
  await page.getByRole('button', { name: 'Clear data' }).click();
  await expect(page.locator('#status')).toHaveText('Data cleared');
  await expect(counter).toHaveText('0');
  await expect(code).toContainText('value = value + 10');
  await plus.click();
  await expect(counter).toHaveText('10');

  // Reset to starter restores the code and keeps the count, also after a reload.
  await page.getByRole('button', { name: 'Reset to starter' }).click();
  await expect(page.locator('#status')).toHaveText('Starter files restored');
  await expect(code).not.toContainText('value + 10');
  await plus.click();
  await expect(counter).toHaveText('11');
  await page.reload();
  await ready(page);
  await expect(code).not.toContainText('value + 10');
  await expect(counter).toHaveText('11');
  await expect(page.locator('#starter-changed')).toBeHidden();
});

test('broken or outdated saved edits keep the playground running', async ({ page }) => {
  // Saved against an older starter, and with a syntax error.
  await page.addInitScript(([app]) => localStorage.setItem('play.usecross.dev:counter-edits', JSON.stringify({
    starter: 'an-older-starter', files: { 'app.py': app },
  })), [starterApp.replace('def read_count()', 'def read_count(:')]);
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('SyntaxError', { timeout: 120_000 });
  await expect(page.locator('#status')).toHaveText('Not applied: the previous version is still running');
  await expect(page.locator('#starter-changed')).toBeVisible();
  await expect(editorCode(page)).toContainText('def read_count(:');
  // The starter still serves, and editing works.
  await expect(page.frameLocator('#preview').getByRole('status', { name: 'Counter value' })).toHaveText('0');
  await replaceFile(page, 'app.py', starterApp);
  await expect(page.locator('#status')).toHaveText('Changes applied');
  await expect(page.getByRole('alert')).toBeHidden();
});

test('counter mutations stay inside the ASGI mount and persist in IndexedDB', async ({ page, context, browser }) => {
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
  await expect(counter).toHaveText('1');

  // A full reload starts a new Python worker, which reads SQLite back from IndexedDB.
  await page.reload();
  await expect(page.locator('#status')).toHaveText('Ready', { timeout: 120_000 });
  await expect(counter).toHaveText('1');

  // So does a new tab after every tab has closed.
  await page.close();
  const reopened = await context.newPage();
  await ready(reopened);
  await expect(reopened.frameLocator('#preview').getByRole('status', { name: 'Counter value' })).toHaveText('1');

  // Control: another browser profile has its own IndexedDB, so it starts at 0.
  const otherProfile = await browser.newContext();
  const other = await otherProfile.newPage();
  await ready(other);
  await expect(other.frameLocator('#preview').getByRole('status', { name: 'Counter value' })).toHaveText('0');
  await otherProfile.close();
});

test('a second tab waits instead of sharing or answering for the active runtime', async ({ page, context }) => {
  await ready(page);
  const frame = page.frameLocator('#preview');
  const counter = frame.getByRole('status', { name: 'Counter value' });
  await frame.getByRole('button', { name: '+', exact: true }).click();
  await expect(counter).toHaveText('1');

  const second = await context.newPage();
  await second.goto('/');
  await expect(second.locator('#status')).toContainText('open in another tab');
  await expect(second.locator('#preview')).toHaveAttribute('src', 'about:blank');
  await expect(second.getByRole('button', { name: 'Reload Preview' })).toBeDisabled();

  // Every preview request is still answered by the first tab's Python state.
  const counts = await page.evaluate(async () => {
    const counts = [];
    for (let i = 0; i < 8; i++) counts.push((await (await fetch('/preview/health')).json()).counter);
    return counts;
  });
  expect(counts).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
  await frame.getByRole('button', { name: '+', exact: true }).click();
  await expect(counter).toHaveText('2');

  // Edits made after the second tab opened reach it when it takes over.
  await replaceFile(page, 'templates/app.html', starterTemplate.replace('<title>Counter - CrossInertia Playground</title>', '<title>Handed over</title>'));
  await expect(page.locator('#status')).toHaveText('Changes applied');

  // Closing the active tab hands the runtime to the waiting one, which loads the saved count and edits.
  await page.close();
  await expect(second.locator('#status')).toHaveText('Ready', { timeout: 120_000 });
  await expect(second.frameLocator('#preview').getByRole('status', { name: 'Counter value' })).toHaveText('2');
  await expect.poll(() => second.evaluate(() => (document.querySelector('#preview') as HTMLIFrameElement).contentDocument?.title))
    .toBe('Handed over');
  await second.getByRole('tab', { name: 'templates/app.html' }).click();
  await expect(editorCode(second)).toContainText('<title>Handed over</title>');
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
  // A network failure: micropip ignores HTTP status, so an error page would
  // fail PyPI's checksum check instead, with a less specific message.
  await context.route('**/cross_inertia-*.whl', route => route.abort('failed'));
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('Failed to initialize:', { timeout: 120_000 });
  await expect(page.locator('#status')).toContainText(/failed to fetch/i);
  await expect(page.locator('#preview')).toHaveAttribute('src', 'about:blank');
  await expect(page.getByRole('button', { name: 'Reload Preview' })).toBeDisabled();
});
