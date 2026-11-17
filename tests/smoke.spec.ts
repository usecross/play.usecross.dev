import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import * as esbuild from 'esbuild-wasm';
import { bundleFrontend } from '../packages/bundler/index.ts';
import { frontendSources, readStarter } from '../packages/starters/index.ts';

const starter = readStarter(process.cwd());
const starterApp = starter['app.py'];
const starterDb = starter['db.py'];
const starterTemplate = starter['templates/app.html'];
const starterTsx = starter['frontend/app.tsx'];
const starterIndex = starter['frontend/pages/Tasks/Index.tsx'];
const starterCss = starter['frontend/app.css'];
const starterPyproject = starter['pyproject.toml'];
const crossInertiaVersion = starterPyproject.match(/"cross-inertia==([^"]+)"/)![1];
const INDEX = 'frontend/pages/Tasks/Index.tsx';
/** The task list page with its heading replaced. */
const withHeading = (heading: string) => starterIndex.replace('<h1>{HEADINGS[filter]}</h1>', heading);
/** The starter's pyproject.toml with one more dependency. */
const withDependency = (pin: string) => starterPyproject.replace('dependencies = [\n', `dependencies = [\n    "${pin}",\n`);
/** The preview app's /health status field. */
const healthStatus = (page: Page) => page.evaluate(() => fetch('/preview/health').then(r => r.json()).then(h => h.status));
/** The starter's frontend, bundled here in Node as the deploy does. */
const starterBuild = () => bundleFrontend(esbuild, frontendSources(starter));
/** The Inertia asset version of the page in the preview. */
const previewVersion = (page: Page) => page.evaluate(() => JSON.parse(
  (document.querySelector('#preview') as HTMLIFrameElement).contentDocument!.querySelector('script[data-page]')!.textContent!,
).version);
const editorCode = (page: Page) => page.locator('#editor .cm-content');
/** A starter file's entry in the sidebar, by its path. */
const fileButton = (page: Page, path: string) =>
  page.getByRole('navigation', { name: 'Files' }).getByRole('button', { name: path, exact: true });
/** Confirm a sidebar action, such as Clear data, in its dialog. */
async function confirmAction(page: Page, button: string, action: string) {
  await page.getByRole('button', { name: button }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: action }).click();
}

const preview = (page: Page) => page.frameLocator('#preview');
const heading = (page: Page) => preview(page).getByRole('heading', { level: 1 });
/** A task in the list, by its title. */
const task = (page: Page, title: string) => preview(page).getByRole('checkbox', { name: title, exact: true });
/** The layout's flash message. */
const flash = (page: Page) => preview(page).locator('.flash');
/** The open-task count in the layout's nav, a shared prop. */
const openCount = (page: Page) => preview(page).getByRole('navigation', { name: 'Main' }).locator('.badge');

async function addTask(page: Page, title: string) {
  await preview(page).getByRole('textbox', { name: 'New task' }).fill(title);
  await preview(page).getByRole('button', { name: 'Add' }).click();
  await expect(task(page, title)).toBeVisible();
}

/** Reload only the preview, and wait until its new page has loaded. */
async function reloadPreview(page: Page) {
  const loaded = page.locator('#preview').evaluate(frame => new Promise(resolve => frame.addEventListener('load', resolve, { once: true })));
  await page.getByRole('button', { name: 'Reload Preview' }).click();
  await loaded;
}

/** Replace a starter file's contents in the editor, as typing would. */
async function replaceFile(page: Page, tab: string, content: string) {
  await fileButton(page, tab).click();
  await editorCode(page).click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(content);
}

async function ready(page: Page) {
  await page.goto('/');
  await expect(page.locator('#status')).toHaveText(/^(Ready|Failed to initialize:.*)$/s, { timeout: 120_000 });
  await expect(page.locator('#status')).toHaveText('Ready');
  await expect(heading(page)).toHaveText('All tasks', { timeout: 30_000 });
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
    const response = await fetch('/preview/tasks');
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
  expect(result.htmlStatus).toBe(200);
  // SessionMiddleware adds Cookie.
  expect(result.vary).toBe('X-Inertia, Cookie');
  expect(result.initialPage).toMatchObject({
    component: 'Tasks/Index', props: { filter: 'all', errors: {} }, url: '/preview/tasks',
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
  expect(result.css.text).toContain('.layout');
  expect(errors).toEqual([]);
});

test('the editor shows the starter files that run in Python', async ({ page }) => {
  await page.goto('/');
  // Each folder lists its folders first, then its files, as editors do; each file is named by its path.
  const files = page.getByRole('navigation', { name: 'Files' }).getByRole('button');
  await expect.poll(() => files.evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')))).toEqual([
    'frontend/components/Layout.tsx', 'frontend/lib/url.ts', 'frontend/pages/Tasks/Edit.tsx',
    'frontend/pages/Tasks/Index.tsx', 'frontend/pages/Stats.tsx', 'frontend/app.css', 'frontend/app.tsx',
    'frontend/types.ts', 'templates/app.html', 'app.py', 'db.py', 'pyproject.toml',
  ]);
  await expect(fileButton(page, 'app.py')).toHaveAttribute('aria-current', 'true');
  const code = editorCode(page);
  await expect(code).toContainText('def shared_props(');

  // Picking a file shows it, and only it is current.
  await fileButton(page, 'pyproject.toml').click();
  await expect(code).toContainText(`"cross-inertia==${crossInertiaVersion}"`);
  await expect(fileButton(page, 'pyproject.toml')).toHaveAttribute('aria-current', 'true');
  await expect(fileButton(page, 'app.py')).toHaveAttribute('aria-current', 'false');
  await fileButton(page, 'templates/app.html').click();
  await expect(code).toContainText('{{ inertia_body() }}');
  await fileButton(page, INDEX).click();
  await expect(code).toContainText('useForm');
});

test('edits to app.py, db.py and the template apply without losing data', async ({ page }) => {
  await ready(page);
  const status = page.locator('#status');
  const firstTask = preview(page).getByRole('checkbox').first();
  await addTask(page, 'Keep me');

  // A Python edit applies after a pause; the tasks in SQLite survive it.
  await replaceFile(page, 'app.py', starterApp.replace('"Task added."', '"Task created."'));
  await expect(status).toHaveText('Changes applied');
  await expect(task(page, 'Keep me')).toBeVisible();
  await addTask(page, 'Second');
  await expect(flash(page)).toHaveText('Task created.');

  // A broken edit is rolled back: the traceback shows, the last version keeps serving.
  await replaceFile(page, 'app.py', starterApp.replace('def find_task(task_id: int)', 'def find_task(task_id: int'));
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.getByRole('alert')).toContainText('SyntaxError');
  await expect(status).toHaveText('Not applied: the previous version is still running');
  await reloadPreview(page);
  await addTask(page, 'Third');
  await expect(flash(page)).toHaveText('Task created.');

  // A failed edit's CrossInertia settings go with it: the last version keeps rendering.
  await replaceFile(page, 'app.py', starterApp
    .replace('import cross_inertia\n', 'import cross_inertia\nfrom cross_inertia import configure_inertia\n')
    .replace('\napp = FastAPI(\n', '\nconfigure_inertia(vite_port=5173, template_dir="missing")\napp = FastAPI(\n'));
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.getByRole('alert')).toContainText('TemplateNotFound');
  expect(await page.evaluate(() => fetch('/preview/tasks').then(response => response.status))).toBe(200);

  // Fixing it clears the error.
  await replaceFile(page, 'app.py', starterApp);
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.getByRole('alert')).toBeHidden();

  // Modules app.py imports are imported again too, and rolled back together.
  await expect(firstTask).toHaveAccessibleName('Third');
  await replaceFile(page, 'db.py', starterDb.replace('ORDER BY done, id DESC', 'ORDER BY done, title'));
  await expect(status).toHaveText('Changes applied');
  await expect(firstTask).toHaveAccessibleName('Add a task');
  await replaceFile(page, 'db.py', starterDb.replace('ORDER BY done, id DESC', 'ORDER BY done, title').replace('def counts()', 'def counts(:'));
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.getByRole('alert')).toContainText('SyntaxError');
  await expect(page.getByRole('alert')).toContainText('db.py');
  await reloadPreview(page);
  await expect(firstTask).toHaveAccessibleName('Add a task');
  await expect(openCount(page)).toHaveText('6');
  await replaceFile(page, 'db.py', starterDb);
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.getByRole('alert')).toBeHidden();
  await expect(firstTask).toHaveAccessibleName('Third');

  // A broken template is rolled back on disk too. The preview runs what the
  // editor shows, so a later app.py edit waits for the template to be fixed.
  await replaceFile(page, 'templates/app.html', starterTemplate.replace('{{ inertia_body() }}', '{{ inertia_body( }}'));
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.getByRole('alert')).toContainText('TemplateSyntaxError');
  await reloadPreview(page);
  await expect(task(page, 'Keep me')).toBeVisible();
  await replaceFile(page, 'app.py', starterApp.replace('"Task added."', '"Task stored."'));
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.getByRole('alert')).toContainText('TemplateSyntaxError');
  await expect(status).toHaveText('Not applied: the previous version is still running');
  await reloadPreview(page);
  await addTask(page, 'Fourth');
  await expect(flash(page)).toHaveText('Task added.');

  // Template edits apply the same way as Python ones; fixing it applies both.
  await replaceFile(page, 'templates/app.html', starterTemplate.replace('<title>Tasks - CrossInertia Playground</title>', '<title>Edited title</title>'));
  await page.keyboard.press('ControlOrMeta+s');
  await expect(status).toHaveText('Changes applied');
  await expect(page.getByRole('alert')).toBeHidden();
  await expect.poll(() => page.evaluate(() => (document.querySelector('#preview') as HTMLIFrameElement).contentDocument?.title))
    .toBe('Edited title');
  await addTask(page, 'Fifth');
  await expect(flash(page)).toHaveText('Task stored.');
});

test('frontend edits are bundled in the browser and keep data', async ({ page }) => {
  await ready(page);
  await addTask(page, 'Keep me');
  const starterVersion = await previewVersion(page);

  // A TSX edit in a nested page is bundled with esbuild-wasm and replaces the starter's build.
  await replaceFile(page, INDEX, withHeading('<h1>My tasks</h1>'));
  await expect(page.locator('#status')).toHaveText('Changes applied', { timeout: 30_000 });
  await expect(heading(page)).toHaveText('My tasks');
  await expect(task(page, 'Keep me')).toBeVisible();
  // The new manifest changes the asset version, so an Inertia visit from the old page gets a 409.
  const editedVersion = await previewVersion(page);
  expect(editedVersion).not.toBe(starterVersion);
  expect(await page.evaluate(version => fetch('/preview/tasks', {
    headers: { 'X-Inertia': 'true', 'X-Inertia-Version': version },
  }).then(response => response.status), starterVersion)).toBe(409);

  // CSS edits are bundled too.
  await replaceFile(page, 'frontend/app.css', starterCss + '\nh1 { color: rgb(200, 0, 0); }\n');
  await expect(page.locator('#status')).toHaveText('Changes applied');
  await expect(heading(page)).toHaveCSS('color', 'rgb(200, 0, 0)');

  // A bundle error names the file and line; the last good bundle keeps serving.
  await replaceFile(page, INDEX, withHeading('<h1>Broken</h2>'));
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.getByRole('alert')).toContainText(/frontend\/pages\/Tasks\/Index\.tsx:\d+:\d+/);
  await expect(page.getByRole('alert')).toContainText('Unexpected closing "h2" tag');
  await expect(page.locator('#status')).toHaveText('Not applied: the previous version is still running');
  await reloadPreview(page);
  await expect(heading(page)).toHaveText('My tasks');
  await replaceFile(page, INDEX, withHeading('<h1>My tasks</h1>'));
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.getByRole('alert')).toBeHidden();

  // A reload bundles the saved edits again before the preview loads.
  await page.reload();
  await expect(page.locator('#status')).toHaveText('Ready', { timeout: 120_000 });
  await expect(heading(page)).toHaveText('My tasks');
  await expect(heading(page)).toHaveCSS('color', 'rgb(200, 0, 0)');

  // Reset to starter goes back to the starter's own build.
  await confirmAction(page, 'Reset to starter', 'Discard edits');
  await expect(page.locator('#status')).toHaveText('Starter files restored');
  await expect(heading(page)).toHaveText('All tasks');
  expect(await previewVersion(page)).toBe(starterVersion);
  await expect(task(page, 'Keep me')).toBeVisible();
});

test('errors in the running preview show in the shell', async ({ page }) => {
  await ready(page);
  const alert = page.getByRole('alert');

  // A render error bundles fine, then throws in the browser.
  await replaceFile(page, INDEX, withHeading('<h1>{missingName}</h1>'));
  await expect(page.locator('#status')).toHaveText('The preview has an error', { timeout: 30_000 });
  await expect(alert).toContainText('Error in the preview:');
  await expect(alert).toContainText('ReferenceError');
  await expect(alert).toContainText('missingName');
  // Frames point at the bundle without the origin or the /preview mount.
  await expect(alert).toContainText(/assets\/app-\w+\.js:\d+/);
  await expect(alert).not.toContainText('/preview/');

  // Fixing it clears the error.
  await replaceFile(page, INDEX, withHeading('<h1>Fixed</h1>'));
  await expect(page.locator('#status')).toHaveText('Changes applied');
  await expect(heading(page)).toHaveText('Fixed');
  await expect(alert).toBeHidden();

  // A package the template's import map doesn't provide fails when the page loads it.
  await replaceFile(page, 'frontend/app.tsx', "import confetti from 'canvas-confetti';\nconfetti();\n" + starterTsx);
  await expect(alert).toContainText('canvas-confetti', { timeout: 30_000 });
  await expect(page.locator('#status')).toHaveText('The preview has an error');

  // A reload of a working page clears it too.
  await replaceFile(page, 'frontend/app.tsx', starterTsx);
  await expect(page.locator('#status')).toHaveText('Changes applied');
  await expect(alert).toBeHidden();

  // An error in a click handler shows; reloading only the preview clears it and the status.
  await replaceFile(page, INDEX, starterIndex.replace(
    '<button disabled={form.processing}>Add</button>',
    "<button type=\"button\" onClick={() => { throw new Error('Add broke'); }}>Break</button>"));
  await preview(page).getByRole('button', { name: 'Break' }).click();
  await expect(alert).toContainText('Error: Add broke');
  await expect(page.locator('#status')).toHaveText('The preview has an error');
  await reloadPreview(page);
  await expect(alert).toBeHidden();
  await expect(page.locator('#status')).toHaveText('Ready');

  // The reporter runs after a doctype and before the page's scripts, and skips a
  // <head> inside a comment.
  await replaceFile(page, 'templates/app.html', starterTemplate.replace('<head>', '<!-- <head> in a comment --><head>'));
  await expect(page.locator('#status')).toHaveText('Changes applied');
  const html = await page.evaluate(() => fetch('/preview/tasks').then(r => r.text()));
  expect(html).toMatch(/^<!DOCTYPE html>\s*<html lang="en">\s*<!-- <head> in a comment --><head><script>\(/); // The function's name is minified in production.
  expect(await page.evaluate(() => (document.querySelector('#preview') as HTMLIFrameElement).contentDocument!.compatMode)).toBe('CSS1Compat');
});

test('frontend applies retry a failed esbuild load and land in order', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', "Playwright's WebKit can't intercept a Web Worker's requests");
  // The first esbuild download fails; the next one is slow.
  let downloads = 0;
  await page.route(/esbuild[^/]*\.wasm/, async route => {
    if (route.request().resourceType() !== 'fetch') return route.continue(); // Vite's dev module for the URL
    if (++downloads === 1) return route.abort();
    await new Promise(resolve => setTimeout(resolve, 2_000));
    await route.continue();
  });
  await ready(page);

  await replaceFile(page, INDEX, withHeading('<h1>My tasks</h1>'));
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.locator('#status')).toHaveText('Not applied: the previous version is still running');
  await expect(page.getByRole('alert')).toBeVisible();

  // The next edit downloads esbuild again. Resetting while it does must not
  // let the slower edited bundle land after the starter.
  await replaceFile(page, INDEX, withHeading('<h1>Second edit</h1>'));
  await page.keyboard.press('ControlOrMeta+s');
  await confirmAction(page, 'Reset to starter', 'Discard edits');
  await expect(page.locator('#status')).toHaveText('Starter files restored', { timeout: 30_000 });
  expect(downloads).toBe(2);
  await page.waitForTimeout(3_000); // Longer than the slow download, so a stale bundle would have landed.
  await expect(page.locator('#status')).toHaveText('Starter files restored');
  await expect(heading(page)).toHaveText('All tasks');
  await expect(page.getByRole('alert')).toBeHidden();
});

test('dependency edits install by restarting Python, without losing data', async ({ page, context, browserName }) => {
  test.skip(browserName === 'webkit', "Playwright's WebKit can't intercept a Web Worker's requests");
  // Slow down the new package, so the new worker has loaded /data well before it is ready.
  let wheelRequested!: () => void;
  const installing = new Promise<void>(resolve => (wheelRequested = resolve));
  await context.route('**/humanize-*.whl', async route => {
    wheelRequested();
    await new Promise(resolve => setTimeout(resolve, 2_000));
    await route.continue();
  });
  await ready(page);
  const restart = page.getByRole('button', { name: 'Restart Python' });
  // The sidebar's notice that pyproject.toml differs from what Python installed.
  const depsNotice = page.locator('#deps-changed');
  await addTask(page, 'Before the restart');

  // A pyproject.toml edit waits for a restart instead of applying on a pause.
  await replaceFile(page, 'pyproject.toml', withDependency('humanize==4.17.0'));
  await expect(depsNotice).toBeVisible();
  await page.waitForTimeout(1_000); // Past the edit debounce.
  await expect(page.locator('#status')).toHaveText('Ready');

  // The old worker serves while the new one installs; its writes carry over.
  await restart.click();
  await expect(page.locator('#status')).toHaveText('Installing dependencies...');
  await expect(page.getByRole('button', { name: 'Reset to starter' })).toBeDisabled();
  await installing;
  await addTask(page, 'While installing');
  await expect(page.locator('#status')).toHaveText('Python restarted', { timeout: 120_000 });
  await expect(depsNotice).toBeHidden();
  await expect(task(page, 'While installing')).toBeVisible();
  await expect(task(page, 'Before the restart')).toBeVisible();

  // The new package imports in app.py, also after a full reload.
  await replaceFile(page, 'app.py', starterApp
    .replace('import cross_inertia\n', 'import cross_inertia\nimport humanize\n')
    .replace('"status": "ok",', '"status": humanize.intcomma(1234567),'));
  await expect(page.locator('#status')).toHaveText('Changes applied');
  expect(await healthStatus(page)).toBe('1,234,567');
  await page.reload();
  await expect(page.locator('#status')).toHaveText('Ready', { timeout: 120_000 });
  await expect(depsNotice).toBeHidden();
  expect(await healthStatus(page)).toBe('1,234,567');

  // A dependency that fails to install leaves the running version serving.
  await replaceFile(page, 'pyproject.toml', withDependency('humanize==4.17.0').replace('"humanize', '"no-such-package-for-play==1.0",\n    "humanize'));
  await restart.click();
  await expect(page.getByRole('alert')).toContainText('no-such-package-for-play', { timeout: 120_000 });
  await expect(page.locator('#status')).toHaveText('Not applied: the previous version is still running');
  await expect(depsNotice).toBeVisible();
  await addTask(page, 'After a failed install');
  expect(await healthStatus(page)).toBe('1,234,567');

  // Reset to starter restarts with the starter's dependencies and keeps the data.
  await confirmAction(page, 'Reset to starter', 'Discard edits');
  await expect(page.locator('#status')).toHaveText('Starter files restored', { timeout: 120_000 });
  await expect(depsNotice).toBeHidden();
  await expect(page.getByRole('alert')).toBeHidden();
  await expect(task(page, 'After a failed install')).toBeVisible();
  expect(await healthStatus(page)).toBe('ok');
});

test('saved dependencies that fail to install fall back to the starter\'s', async ({ page }) => {
  await page.addInitScript(([pyproject]) => localStorage.setItem('play.usecross.dev:tasks-edits', JSON.stringify({
    starter: 'any', files: { 'pyproject.toml': pyproject },
  })), [withDependency('no-such-package-for-play==1.0')]);
  await ready(page);
  await expect(page.getByRole('alert')).toContainText('Your pyproject.toml failed to install');
  await expect(page.getByRole('alert')).toContainText('no-such-package-for-play');
  await expect(page.locator('#deps-changed')).toBeVisible();
  await fileButton(page, 'pyproject.toml').click();
  await expect(editorCode(page)).toContainText('no-such-package-for-play');
});

test('edits are saved across reloads; reset and clear data are separate', async ({ page }) => {
  await ready(page);
  const code = editorCode(page);

  const edited = starterApp.replace('A small task list', 'My task list').replace('"Task added."', '"Saved for later."');
  await replaceFile(page, 'app.py', edited);
  await expect(page.locator('#status')).toHaveText('Changes applied');
  await addTask(page, 'One');
  await expect(flash(page)).toHaveText('Saved for later.');

  // A full reload starts a new worker; the saved edit runs before the preview loads.
  await page.reload();
  await ready(page);
  await expect(code).toContainText('My task list');
  await addTask(page, 'Two');
  await expect(flash(page)).toHaveText('Saved for later.');

  // Clear data brings back the starter's tasks and keeps the code.
  await confirmAction(page, 'Clear data', 'Delete data');
  await expect(page.locator('#status')).toHaveText('Data cleared');
  await expect(task(page, 'One')).toBeHidden();
  await expect(preview(page).getByRole('checkbox')).toHaveCount(4);
  await expect(code).toContainText('My task list');
  await addTask(page, 'Three');

  // Reset to starter restores the code and keeps the tasks, also after a reload.
  await confirmAction(page, 'Reset to starter', 'Discard edits');
  await expect(page.locator('#status')).toHaveText('Starter files restored');
  await expect(code).not.toContainText('My task list');
  await addTask(page, 'Four');
  await expect(flash(page)).toHaveText('Task added.');
  await page.reload();
  await ready(page);
  await expect(code).not.toContainText('My task list');
  await expect(task(page, 'Three')).toBeVisible();
  await expect(page.locator('#starter-changed')).toBeHidden();
});

test('broken or outdated saved edits keep the playground running', async ({ page }) => {
  // Saved against an older starter, and with a syntax error.
  await page.addInitScript(([app]) => localStorage.setItem('play.usecross.dev:tasks-edits', JSON.stringify({
    starter: 'an-older-starter', files: { 'app.py': app },
  })), [starterApp.replace('import time\n', 'import time(\n')]);
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('SyntaxError', { timeout: 120_000 });
  await expect(page.locator('#status')).toHaveText('Not applied: the previous version is still running');
  await expect(page.locator('#starter-changed')).toBeVisible();
  await expect(editorCode(page)).toContainText('import time(');
  // The starter still serves, and editing works.
  await expect(heading(page)).toHaveText('All tasks');
  await replaceFile(page, 'app.py', starterApp);
  await expect(page.locator('#status')).toHaveText('Changes applied');
  await expect(page.getByRole('alert')).toBeHidden();
});

test('task changes stay inside the ASGI mount and persist in IndexedDB', async ({ page, context, browser }) => {
  await ready(page);
  const frame = preview(page);
  await expect(openCount(page)).toHaveText('3');
  await addTask(page, 'Persist me');
  await expect(openCount(page)).toHaveText('4');
  await task(page, 'Persist me').click();
  await expect(task(page, 'Persist me')).toBeChecked();
  await expect(openCount(page)).toHaveText('3');

  // The edit page saves with PUT and deletes with DELETE.
  await frame.getByRole('link', { name: 'Edit Add a task' }).click();
  await frame.getByRole('textbox', { name: 'Title' }).fill('Renamed task');
  await frame.getByRole('button', { name: 'Save' }).click();
  await expect(flash(page)).toHaveText('Task saved.');
  await expect(task(page, 'Renamed task')).toBeVisible();
  await frame.getByRole('link', { name: 'Edit Open the Stats page' }).click();
  await frame.getByRole('button', { name: 'Delete' }).click();
  await expect(flash(page)).toHaveText('Task deleted.');
  await expect(task(page, 'Open the Stats page')).toBeHidden();

  await expect.poll(() => page.frames().find(frame => frame.parentFrame())?.url())
    .toMatch(/\/preview\/tasks$/);
  await reloadPreview(page);
  await expect(task(page, 'Renamed task')).toBeVisible();
  await expect(task(page, 'Persist me')).toBeChecked();

  // A full reload starts a new Python worker, which reads SQLite back from IndexedDB.
  await page.reload();
  await expect(page.locator('#status')).toHaveText('Ready', { timeout: 120_000 });
  await expect(task(page, 'Persist me')).toBeChecked();

  // So does a new tab after every tab has closed.
  await page.close();
  const reopened = await context.newPage();
  await ready(reopened);
  await expect(task(reopened, 'Renamed task')).toBeVisible();

  // Control: another browser profile has its own IndexedDB, so it has only the starter's tasks.
  const otherProfile = await browser.newContext();
  const other = await otherProfile.newPage();
  await ready(other);
  await expect(preview(other).getByRole('checkbox')).toHaveCount(4);
  await expect(task(other, 'Add a task')).toBeVisible();
  await otherProfile.close();
});

test('a second tab waits instead of sharing or answering for the active runtime', async ({ page, context }) => {
  await ready(page);
  await addTask(page, 'First');

  const second = await context.newPage();
  await second.goto('/');
  await expect(second.locator('#status')).toContainText('open in another tab');
  await expect(second.locator('#preview')).toHaveAttribute('src', 'about:blank');
  await expect(second.getByRole('button', { name: 'Reload Preview' })).toBeDisabled();

  // Every preview request is still answered by the first tab's Python state.
  const totals = await page.evaluate(async () => {
    const totals = [];
    for (let i = 0; i < 8; i++) totals.push((await (await fetch('/preview/health')).json()).tasks.total);
    return totals;
  });
  expect(totals).toEqual([5, 5, 5, 5, 5, 5, 5, 5]);
  await addTask(page, 'Second');

  // Edits made after the second tab opened reach it when it takes over.
  await replaceFile(page, 'templates/app.html', starterTemplate.replace('<title>Tasks - CrossInertia Playground</title>', '<title>Handed over</title>'));
  await expect(page.locator('#status')).toHaveText('Changes applied');

  // Closing the active tab hands the runtime to the waiting one, which loads the saved tasks and edits.
  await page.close();
  await expect(second.locator('#status')).toHaveText('Ready', { timeout: 120_000 });
  await expect(task(second, 'Second')).toBeVisible();
  await expect.poll(() => second.evaluate(() => (document.querySelector('#preview') as HTMLIFrameElement).contentDocument?.title))
    .toBe('Handed over');
  await fileButton(second, 'templates/app.html').click();
  await expect(editorCode(second)).toContainText('<title>Handed over</title>');
});

test('forms show validation errors by their field and a flash message after the redirect', async ({ page }) => {
  await ready(page);
  const frame = preview(page);
  const input = frame.getByRole('textbox', { name: 'New task' });

  // The server rejects an empty title; the error comes back as the `errors` prop.
  await frame.getByRole('button', { name: 'Add' }).click();
  await expect(input).toHaveAccessibleDescription('Give the task a title.');
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(flash(page)).toBeHidden();

  // Typing clears the error; the server checks again on the next submit.
  await input.fill('Write the tests');
  await expect(input).toHaveAttribute('aria-invalid', 'false');
  await expect(frame.getByText('Give the task a title.')).toBeHidden();

  // A valid title redirects back; the session carries the flash message there.
  await frame.getByRole('button', { name: 'Add' }).click();
  await expect(flash(page)).toHaveText('Task added.');
  await expect(input).toHaveValue('');
  await expect(input).toHaveAttribute('aria-invalid', 'false');
  await expect(openCount(page)).toHaveText('4');

  // A flash message shows once.
  await reloadPreview(page);
  await expect(task(page, 'Write the tests')).toBeVisible();
  await expect(flash(page)).toBeHidden();
});

test('a filter reloads only the tasks; other props keep their values', async ({ page }) => {
  await ready(page);
  const frame = preview(page);
  await expect(openCount(page)).toHaveText('3');
  // Add a task without the page knowing, as another tab or user would.
  await page.evaluate(() => fetch('/preview/tasks', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Added elsewhere' }),
  }));

  // The filter asks only for `tasks` and `filter`: the list has the new task,
  // the layout's count does not change.
  await frame.getByRole('navigation', { name: 'Filter' }).getByRole('link', { name: 'Open' }).click();
  await expect(heading(page)).toHaveText('Open tasks');
  await expect(task(page, 'Added elsewhere')).toBeVisible();
  await expect(task(page, 'Run FastAPI in the browser')).toBeHidden();
  await expect(openCount(page)).toHaveText('3');
  // flash is always(), so partial reloads include it too.
  await expect(flash(page)).toHaveText('Task added.');

  // A full visit gets every prop.
  await frame.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /^Tasks/ }).click();
  await expect(heading(page)).toHaveText('All tasks');
  await expect(openCount(page)).toHaveText('4');
});

test('Stats loads its deferred prop after the page, and its optional prop on request', async ({ page }) => {
  await ready(page);
  const frame = preview(page);
  await frame.getByRole('link', { name: 'Stats', exact: true }).click();
  await expect(frame.getByRole('heading', { name: 'Stats' })).toBeVisible();
  // The page shows before the slow summary; Inertia then asks for it.
  await expect(frame.getByRole('status')).toHaveText('Loading stats…');
  await expect(frame.getByRole('definition')).toHaveText(['4', '3', '1', '25%']);
  await expect(frame.getByRole('status')).toBeHidden();

  // done_tasks comes only when the page asks for it.
  await expect(frame.getByRole('listitem')).toHaveCount(0);
  await frame.getByRole('button', { name: 'Load done tasks' }).click();
  await expect(frame.getByRole('listitem')).toHaveText(['Run FastAPI in the browser']);
  await expect(frame.getByRole('button', { name: 'Load done tasks' })).toBeHidden();
});

test('published protocol handles partial reloads, deferred props, version conflicts and validation', async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const request = async (path: string, headers: Record<string, string> = {}) => {
      const response = await fetch(path, { headers: { 'X-Inertia': 'true', ...headers } });
      return { status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() };
    };
    const full = await request('/preview/tasks');
    const partial = await request('/preview/tasks', {
      'X-Inertia-Partial-Component': 'Tasks/Index',
      'X-Inertia-Partial-Data': 'missing',
    });
    const onlyTasks = await request('/preview/tasks?filter=done', {
      'X-Inertia-Partial-Component': 'Tasks/Index',
      'X-Inertia-Partial-Data': 'tasks',
    });
    const stats = await request('/preview/stats');
    const summary = await request('/preview/stats', {
      'X-Inertia-Partial-Component': 'Stats',
      'X-Inertia-Partial-Data': 'summary',
    });
    const stale = await request('/preview/tasks', { 'X-Inertia-Version': 'stale-build' });
    const invalid = await fetch('/preview/tasks', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    });
    const health = await (await fetch('/preview/health')).json();
    const missingAsset = await fetch('/preview/static/build/assets/missing.js');
    return {
      full, partial, onlyTasks, stats, summary, stale,
      invalidStatus: invalid.status, health, missingStatus: missingAsset.status,
    };
  });
  expect(result.full.status).toBe(200);
  expect(result.full.headers['x-inertia']).toBe('true');
  expect(JSON.parse(result.full.body)).toMatchObject({
    component: 'Tasks/Index',
    props: { filter: 'all', counts: { total: 4, open: 3, done: 1 }, flash: null, root_path: '/preview', errors: {} },
  });
  // Only requested props, plus always() ones and errors.
  expect(JSON.parse(result.partial.body).props).toEqual({ flash: null, errors: {} });
  const onlyTasks = JSON.parse(result.onlyTasks.body).props;
  expect(Object.keys(onlyTasks).sort()).toEqual(['errors', 'flash', 'tasks']);
  expect(onlyTasks.tasks).toEqual([{ id: 4, title: 'Run FastAPI in the browser', done: true }]);
  // Deferred and optional props are left out of the first response.
  const stats = JSON.parse(result.stats.body);
  expect(stats.props).not.toHaveProperty('summary');
  expect(stats.props).not.toHaveProperty('done_tasks');
  expect(stats.deferredProps).toEqual({ default: ['summary'] });
  expect(JSON.parse(result.summary.body).props.summary).toEqual({ total: 4, open: 3, done: 1, percent_done: 25 });
  expect(result.stale.status).toBe(409);
  expect(result.stale.headers['x-inertia-location']).toMatch(/\/preview\/tasks$/);
  expect(result.invalidStatus).toBe(422);
  expect(result.health.tasks).toEqual({ total: 4, open: 3, done: 1 });
  expect(result.missingStatus).toBe(404);
});

test('a hard reload, which skips the Service Worker, still starts the playground', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'A cache-bypassing reload needs the Chrome DevTools Protocol');
  await ready(page);
  const cdp = await page.context().newCDPSession(page);
  // Page.reload returns before the old page unloads, and its status is Ready too.
  const reloaded = page.waitForEvent('framenavigated', frame => frame === page.mainFrame());
  await cdp.send('Page.reload', { ignoreCache: true });
  await reloaded;
  await expect(page.locator('#status')).toHaveText(/^(Ready|Failed to initialize:.*)$/s, { timeout: 120_000 });
  await expect(page.locator('#status')).toHaveText('Ready');
  await expect(heading(page)).toHaveText('All tasks');
});

test('a failed real wheel download fails visibly instead of substituting a stub', async ({ page, context, browserName }) => {
  test.skip(browserName === 'webkit', "Playwright's WebKit can't intercept a Web Worker's requests");
  // A network failure: micropip ignores HTTP status, so an error page would
  // fail PyPI's checksum check instead, with a less specific message.
  await context.route('**/cross_inertia-*.whl', route => route.abort('failed'));
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('Failed to initialize:', { timeout: 120_000 });
  await expect(page.locator('#status')).toContainText(/failed to fetch/i);
  await expect(page.locator('#preview')).toHaveAttribute('src', 'about:blank');
  await expect(page.getByRole('button', { name: 'Reload Preview' })).toBeDisabled();
});
