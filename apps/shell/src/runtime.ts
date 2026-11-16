/**
 * The playground's runtime: registers the Service Worker, starts Python,
 * applies edits and answers preview requests. It keeps what the page shows in
 * one state object, which the React shell (App.tsx) renders.
 */

import { STARTER_DIR, counterFiles, counterSources, editableSources, starterBuildFiles } from '@play.usecross.dev/runner/counter-files';

export interface ShellState {
  /** One line on what the runtime is doing, such as "Ready". */
  status: string;
  /** Python serves the preview, and edits and actions are enabled. */
  ready: boolean;
  /** An apply's traceback or bundle error, or an error from the running preview. */
  error: { message: string; source: 'apply' | 'preview' } | null;
  /** Saved edits were made against an older starter. */
  starterChanged: boolean;
  /** pyproject.toml differs from what the running Python installed. */
  depsChanged: boolean;
  /** Python is restarting with new dependencies. */
  restarting: boolean;
  /** Files with saved edits, by path inside the project. */
  editedFiles: string[];
  /** The file the editor shows. */
  selectedFile: string;
  /** The preview's path inside the app, such as /counter. */
  previewPath: string;
  editorFailed: boolean;
}

let state: ShellState = {
  status: 'Initializing...',
  ready: false,
  error: null,
  starterChanged: false,
  depsChanged: false,
  restarting: false,
  editedFiles: [],
  selectedFile: editableSources[0],
  previewPath: '',
  editorFailed: false,
};
const listeners = new Set<() => void>();
export const getState = () => state;
export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function update(changes: Partial<ShellState>) {
  state = { ...state, ...changes };
  listeners.forEach(listener => listener());
}

let previewFrame!: HTMLIFrameElement;
let editor: Promise<Awaited<ReturnType<typeof import('./editor').mountEditor>> | null> = Promise.resolve(null);

let pythonWorker: Worker | null = null;
// The pyproject.toml the running worker installed.
let runningPyproject = counterSources['pyproject.toml'];
// Preview requests wait on this while a restarted worker takes over.
let takeover: Promise<void> = Promise.resolve();

function updateStatus(message: string) {
  console.log('[Shell]', message);
  update({ status: message });
}

/**
 * Start a Python worker that runs the starter with this pyproject.toml's
 * dependencies. Resolves once its app imports; on failure the worker is gone.
 */
async function startPython(pyproject: string): Promise<Worker> {
  const pythonWorker = new Worker(
    new URL('../../../packages/runner/python-worker.ts', import.meta.url),
    { type: 'module' }
  );
  
  // Initialize with counter files
  return new Promise<Worker>((resolve, reject) => {
    const channel = new MessageChannel();
    let settled = false;
    
    // Timeout after 90 seconds
    const timeoutId = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error('Python worker initialization timeout (90s)'));
      }
    }, 90000);
    
    // Handle worker errors
    const errorHandler = (error: ErrorEvent) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeoutId);
        reject(new Error(`Python worker error: ${error.message}`));
      }
    };
    
    const messageErrorHandler = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeoutId);
        reject(new Error('Python worker message error'));
      }
    };
    
    pythonWorker!.onerror = errorHandler;
    pythonWorker!.onmessageerror = messageErrorHandler;
    
    channel.port1.onmessage = (event) => {
      if (event.data.type === 'initialized') {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutId);
          // Clean up error handlers on success
          pythonWorker!.onerror = null;
          pythonWorker!.onmessageerror = null;
          
          if (event.data.success) {
            console.log('[Shell] Python worker initialized');
            resolve(pythonWorker);
          } else {
            reject(new Error(event.data.error || 'Python initialization failed'));
          }
        }
      } else if (event.data.type === 'error') {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutId);
          reject(new Error(event.data.error || 'Unknown initialization error'));
        }
      }
    };
    
    pythonWorker!.postMessage(
      {
        type: 'initialize',
        files: { ...counterFiles, [`${STARTER_DIR}/pyproject.toml`]: pyproject },
      },
      [channel.port2]
    );
  }).catch(error => {
    pythonWorker.terminate();
    throw error;
  });
}

// The Service Worker broadcasts every preview request to all shell tabs and
// takes the first answer, so exactly one tab may run Python and answer.
const RUNTIME_LOCK = 'play.usecross.dev:python-runtime';

/** Resolve once this tab owns the runtime; hold the lock until the tab closes. */
function acquireRuntime(): Promise<void> {
  return new Promise((resolve, reject) => {
    const hold = () => {
      resolve();
      return new Promise<never>(() => {});
    };
    navigator.locks.request(RUNTIME_LOCK, { ifAvailable: true }, lock => {
      if (lock) return hold();
      updateStatus('The playground is open in another tab. Close it to run here.');
      navigator.locks.request(RUNTIME_LOCK, hold).catch(reject);
    }).catch(reject);
  });
}

// Answer Service Worker requests only after this tab's Python app is ready.
function answerPreviewRequests() {
  const pythonChannel = new BroadcastChannel('python-bridge');
  pythonChannel.addEventListener('message', (event) => {
    if (event.data.type !== 'python-request') return;
    const { requestId, request } = event.data;

    // Forward to Python worker
    const channel = new MessageChannel();
    
    channel.port1.onmessage = (workerEvent) => {
      if (workerEvent.data.type === 'http-response') {
        // Send response back to SW via BroadcastChannel
        pythonChannel.postMessage({
          type: 'python-response',
          requestId,
          response: workerEvent.data.response,
          error: workerEvent.data.error,
        });
      }
    };
    
    takeover.then(() => pythonWorker!.postMessage({ type: 'http-request', request }, [channel.port2]));
  });
}

// Initialize the runner (Service Worker + Pyodide)
async function initialize() {
  try {
    await acquireRuntime();
    updateStatus('Registering Service Worker...');
    
    // Register the Service Worker from /sw.js (proper scope)
    if (!('serviceWorker' in navigator)) {
      throw new Error('Service Workers are not supported in this browser');
    }

    // In dev mode, use the TypeScript source; in production, use the built sw.js
    const swUrl = import.meta.env.DEV ? '/sw.ts' : '/sw.js';
    const registration = await navigator.serviceWorker.register(swUrl, {
      scope: '/',
      type: 'module',
    });

    const active = (await navigator.serviceWorker.ready).active!;
    // Activation precedes clients.claim(). Do not navigate the preview until
    // this page is controlled, or its first request can hit the static host.
    if (!navigator.serviceWorker.controller) {
      // A hard reload skips the Service Worker, which then never claims the
      // page by itself because it is already active. Ask it to.
      active.postMessage({ type: 'claim' });
      await new Promise<void>((resolve, reject) => {
        const onControllerChange = () => {
          clearTimeout(timeout);
          resolve();
        };
        const timeout = setTimeout(() => {
          navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
          reject(new Error('Service Worker did not take control'));
        }, 10000);
        navigator.serviceWorker.addEventListener('controllerchange', onControllerChange, { once: true });
      });
    }
    updateStatus('Service Worker registered');
    console.log('[Shell] Service Worker ready:', registration);
    
    // Start Python with the saved dependencies, or the starter's if they fail
    // to install. Read saved edits only now, so a tab that waited for another
    // one gets that tab's latest edits.
    updateStatus('Loading Python runtime...');
    const pyproject = currentFiles()['pyproject.toml'];
    let installError: string | null = null;
    try {
      pythonWorker = await startPython(pyproject);
      runningPyproject = pyproject;
    } catch (error) {
      if (pyproject === counterSources['pyproject.toml']) throw error;
      installError = `Your pyproject.toml failed to install, so Python runs the starter's dependencies.\n\n${(error as Error).message}`;
      updateStatus('Loading Python runtime with the starter\'s dependencies...');
      pythonWorker = await startPython(counterSources['pyproject.toml']);
    }
    updateStatus('Ready');
    answerPreviewRequests();

    // Run saved edits before the preview first loads.
    await restoreSavedEdits();
    if (installError && !state.error) showError(installError);
    updateDepsNotice();

    // Keep the frame blank until BOTH the SW and Python app are ready.
    previewFrame.src = '/preview/';
    update({ ready: true });
    (await editor)?.setEditable(true);
  } catch (error) {
    pythonWorker?.terminate();
    pythonWorker = null;
    console.error('[Shell] Failed to initialize:', error);
    updateStatus('Failed to initialize: ' + (error as Error).message);
  }
}

export function reloadPreview() {
  previewFrame.src = '/preview/';
}

// Messages from the Service Worker's reporter in the preview page.
function onPreviewMessage(event: MessageEvent) {
  // Only process messages from the preview iframe
  if (event.source !== previewFrame.contentWindow) {
    return;
  }

  // A new page starts, or it threw.
  if (event.data.type === 'preview:start') {
    // Only the preview's own error clears; an apply error stays until the next apply.
    if (state.error?.source === 'preview') {
      update({ error: null });
      updateStatus('Ready');
    }
  } else if (event.data.type === 'preview:error' && !state.error) {
    // The first error is usually the cause; later ones follow from it.
    showError(`Error in the preview:\n${event.data.error}`, 'preview');
    updateStatus('The preview has an error');
  }
}

let started = false;

/** Start the playground in this page, with the elements the shell rendered. */
export function start(elements: { preview: HTMLIFrameElement; editor: HTMLElement }) {
  if (started) return;
  started = true;
  previewFrame = elements.preview;
  window.addEventListener('message', onPreviewMessage);
  // The address bar follows the preview, including Inertia's client-side visits.
  previewFrame.addEventListener('load', () => {
    const win = previewFrame.contentWindow;
    const path = () => update({ previewPath: (win?.location.pathname ?? '').replace(/^\/preview/, '') || '/' });
    if (!win || win.location.href === 'about:blank') return;
    path();
    win.addEventListener('popstate', path);
    // Inertia visits use history.pushState, which fires no event.
    for (const method of ['pushState', 'replaceState'] as const) {
      const original = win.history[method].bind(win.history);
      win.history[method] = (...args: Parameters<History['pushState']>) => { original(...args); path(); };
    }
  });
  // The editor loads in its own chunk, so it never delays Python.
  editor = import('./editor')
    .then(({ mountEditor }) => mountEditor(elements.editor, counterSources, {
      editable: editableSources,
      onChange: editChanged,
      onSave: applyEdits,
    }))
    .catch(error => {
      console.error('[Shell] Editor failed to load:', error);
      update({ editorFailed: true });
      return null;
    });
  refreshEditedFiles();
  initialize();
}

export async function selectFile(path: string) {
  update({ selectedFile: path });
  (await editor)?.show(path);
}

// Edits are saved in localStorage with a fingerprint of the starter they
// were made against, so a deploy that changes the starter can be noticed.
const SAVED_EDITS = 'play.usecross.dev:counter-edits';
interface SavedEdits { starter: string; files: Record<string, string> }

function fingerprint(text: string): string {
  let hash = 0x811c9dc5; // FNV-1a
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return (hash >>> 0).toString(16);
}
const starterFingerprint = fingerprint(JSON.stringify(counterSources));

function loadEdits(): SavedEdits | null {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVED_EDITS) ?? 'null');
    return saved && typeof saved.files === 'object' ? saved : null;
  } catch {
    return null;
  }
}

function saveEdit(path: string, content: string) {
  const saved = loadEdits() ?? { starter: starterFingerprint, files: {} };
  if (content === counterSources[path]) delete saved.files[path];
  else saved.files[path] = content;
  if (Object.keys(saved.files).length) localStorage.setItem(SAVED_EDITS, JSON.stringify(saved));
  else localStorage.removeItem(SAVED_EDITS);
  refreshEditedFiles();
}

function refreshEditedFiles() {
  const edited = Object.keys(loadEdits()?.files ?? {}).filter(path => editableSources.includes(path));
  if (edited.join() !== state.editedFiles.join()) update({ editedFiles: edited });
}

const vfsPaths = (files: Record<string, string>) =>
  Object.fromEntries(Object.entries(files).map(([path, content]) => [`${STARTER_DIR}/${path}`, content]));

/** Send a message to a Python worker and wait for its answer: the error, or null. */
function sendToPython(message: object, worker = pythonWorker): Promise<string | null> {
  return new Promise((resolve, reject) => {
    if (!worker) return reject(new Error('Python worker not initialized'));
    const channel = new MessageChannel();
    channel.port1.onmessage = ({ data }) => {
      if (data.type === 'applied' || data.type === 'error') resolve(data.error);
    };
    worker.postMessage(message, [channel.port2]);
  });
}

function showError(message: string, source: 'apply' | 'preview' = 'apply') {
  update({ error: { message, source } });
}

/** Show a failed apply's traceback, or reload the preview after a successful one. */
function showResult(error: string | null, success: string | null) {
  if (error) {
    showError(error);
    updateStatus('Not applied: the previous version is still running');
  } else {
    update({ error: null });
    // Report success once the new preview has loaded, so it is the version the status describes.
    if (success) previewFrame.addEventListener('load', () => state.error || updateStatus(success), { once: true });
    previewFrame.contentWindow?.location.reload();
  }
}

/** The editable files as the editor has them: the starter, with saved edits over it. */
function currentFiles(): Record<string, string> {
  const saved = loadEdits()?.files ?? {};
  return Object.fromEntries(editableSources.map(path => [path, saved[path] ?? counterSources[path]]));
}

// Applies, restarts and data clears run one at a time, in order, so a slow
// bundle or install can't land after a later one, such as a Reset to starter.
let lastApply: Promise<unknown> = Promise.resolve();
function queued(task: () => Promise<string | null>): Promise<string | null> {
  const run = lastApply.then(task);
  lastApply = run.catch(() => {});
  return run;
}

/**
 * Apply every editable file except pyproject.toml, which applies by
 * restarting Python. Python gets the frontend's build, not its sources: the
 * starter's own build when the frontend is unchanged, otherwise a new bundle.
 * Returns the error, or null.
 */
const applyFiles = (files: Record<string, string>) => queued(() => bundleAndSend(files));

async function bundleAndSend(files: Record<string, string>, worker = pythonWorker): Promise<string | null> {
  const frontend = Object.fromEntries(Object.entries(files).filter(([path]) => path.startsWith('frontend/')));
  const python = Object.fromEntries(Object.entries(files)
    .filter(([path]) => !(path in frontend) && path !== 'pyproject.toml'));
  let build = starterBuildFiles;
  if (Object.entries(frontend).some(([path, content]) => content !== counterSources[path])) {
    try {
      // esbuild-wasm loads in its own chunk, on the first frontend edit.
      build = (await (await import('@play.usecross.dev/bundler/browser.ts')).bundle(frontend)).files;
    } catch (error) {
      return (error as Error).message;
    }
  }
  return sendToPython({ type: 'apply-files', files: vfsPaths({ ...python, ...build }) }, worker);
}

/**
 * Start a new worker with the editor's files, including pyproject.toml, and
 * switch to it. The running worker keeps serving until then, and keeps
 * serving if the new one fails. Returns the error, or null.
 */
const restartPython = () => queued(async () => {
  const files = currentFiles();
  let worker: Worker;
  try {
    worker = await startPython(files['pyproject.toml']);
  } catch (error) {
    return (error as Error).message;
  }
  const error = await bundleAndSend(files, worker);
  if (error) {
    worker.terminate();
    return error;
  }
  // The new worker loaded /data when it started. Hold preview requests, let
  // the old worker finish (each request saves /data), then load it again.
  let release!: () => void;
  takeover = new Promise(resolve => (release = resolve));
  try {
    await sendToPython({ type: 'reload-data' }, pythonWorker);
    pythonWorker!.terminate();
    pythonWorker = worker;
    runningPyproject = files['pyproject.toml'];
    await sendToPython({ type: 'reload-data' }, worker);
  } finally {
    release();
  }
  return null;
});

function updateDepsNotice() {
  update({ depsChanged: currentFiles()['pyproject.toml'] !== runningPyproject });
}

async function restoreSavedEdits() {
  const saved = loadEdits();
  if (!saved) return;
  (await editor)?.setFiles(currentFiles());
  update({ starterChanged: saved.starter !== starterFingerprint });
  showResult(await applyFiles(currentFiles()), null);
}

// Whether there are edits the preview doesn't run yet.
let editsPending = false;
let applyTimer: ReturnType<typeof setTimeout> | undefined;

function editChanged(path: string, content: string) {
  saveEdit(path, content);
  if (path === 'pyproject.toml') return updateDepsNotice();
  editsPending = true;
  clearTimeout(applyTimer);
  applyTimer = setTimeout(applyEdits, 800);
}

async function applyEdits() {
  clearTimeout(applyTimer);
  if (!pythonWorker || !editsPending) return;
  editsPending = false;
  updateStatus('Applying your changes...');
  showResult(await applyFiles(currentFiles()), 'Changes applied');
}

/** Discard saved edits and run the starter's files. The app's data is kept. */
export async function resetToStarter() {
  clearTimeout(applyTimer);
  editsPending = false;
  localStorage.removeItem(SAVED_EDITS);
  update({ starterChanged: false });
  refreshEditedFiles();
  (await editor)?.setFiles(counterSources);
  updateStatus('Restoring the starter...');
  const restart = runningPyproject !== counterSources['pyproject.toml'];
  showResult(await (restart ? restartPython() : applyFiles(currentFiles())), 'Starter files restored');
  updateDepsNotice();
}

/** Restart Python with the editor's pyproject.toml and other files. */
export async function restart() {
  clearTimeout(applyTimer);
  editsPending = false;
  update({ restarting: true });
  updateStatus('Installing dependencies...');
  showResult(await restartPython(), 'Python restarted');
  update({ restarting: false });
  updateDepsNotice();
}

/** Delete the app's data, such as the count. Code edits are kept. */
export async function clearData() {
  updateStatus('Clearing data...');
  showResult(await queued(() => sendToPython({ type: 'clear-data' })), 'Data cleared');
}
