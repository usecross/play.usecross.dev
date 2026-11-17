/**
 * Python Worker - Loads Pyodide and executes Python/ASGI code
 * 
 * This worker runs in a separate thread and:
 * 1. Loads Pyodide (Python in WebAssembly)
 * 2. Installs required packages (FastAPI, CrossInertia, etc.)
 * 3. Loads the ASGI bridge
 * 4. Handles HTTP requests by invoking the ASGI application
 */

/// <reference lib="webworker" />

import { loadPyodide, type PyodideInterface } from 'pyodide';
import runtime from '../starters/runtime.json';
import type { HttpRequest, HttpResponse, WorkerMessage, VirtualFileSystem } from './types';

declare const self: DedicatedWorkerGlobalScope;

let pyodide: PyodideInterface | null = null;

// The starter's data directory, kept in IndexedDB across page reloads. Only
// this directory persists; the example's code comes from the current deploy.
const DATA_DIR = '/data';

/** Load (populate) or save the data directory's IndexedDB copy. */
function syncData(populate: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    pyodide!.FS.syncfs(populate, (error?: unknown) => (error ? reject(error) : resolve()));
  });
}
let initialized = false;

// Requests and edits run one at a time, in arrival order: they share
// request_json and the app module.
let queue: Promise<unknown> = Promise.resolve();
function serialize<T>(task: () => Promise<T>): Promise<T> {
  const result = queue.then(task);
  queue = result.catch(() => {});
  return result;
}

/**
 * Initialize Pyodide and load dependencies
 */
async function initialize(starterDir: string, files: VirtualFileSystem): Promise<void> {
  if (initialized) {
    console.warn('[Python Worker] Already initialized');
    return;
  }

  console.log('[Python Worker] Loading Pyodide...');
  pyodide = await loadPyodide({
    indexURL: `https://cdn.jsdelivr.net/pyodide/v${runtime.pyodideVersion}/full/`,
  });

  pyodide.FS.mkdirTree(DATA_DIR);
  // Pyodide documents FS.filesystems but its types leave it out.
  const { IDBFS } = (pyodide.FS as unknown as { filesystems: { IDBFS: Parameters<typeof pyodide.FS.mount>[0] } }).filesystems;
  pyodide.FS.mount(IDBFS, {}, DATA_DIR);
  await syncData(true);

  console.log('[Python Worker] Loading the starter\'s files...');
  for (const [path, content] of Object.entries(files)) {
    const dirPath = path.split('/').slice(0, -1).join('/');
    if (dirPath) pyodide.FS.mkdirTree(dirPath);
    pyodide.FS.writeFile(path, content);
  }
  pyodide.globals.set('starter_dir', starterDir);

  console.log('[Python Worker] Installing packages...');
  
  // Load micropip for package installation
  await pyodide.loadPackage('micropip');
  const micropip = pyodide.pyimport('micropip');

  // The starter's own pyproject.toml lists its dependencies.
  const dependencies = pyodide.runPython(`
import tomllib
with open(f'{starter_dir}/pyproject.toml', 'rb') as file:
    starter = tomllib.load(file)
starter['project']['dependencies']
  `);
  const packages: string[] = dependencies.toJs();
  dependencies.destroy();
  try {
    // cross-web needs newer typing extensions than Pyodide's default. Install
    // that pin BEFORE loading Pydantic, which otherwise installs the old wheel.
    await micropip.install(packages.filter(pkg => pkg.startsWith('typing-extensions==')));
    await pyodide.loadPackage(['pydantic', 'MarkupSafe', 'sqlite3']);
    // Installation failures are fatal: never substitute a fake CrossInertia.
    await micropip.install(packages).catch((error: Error) => {
      // Keep the exception, such as "ValueError: Can't fetch metadata for
      // 'some-package'", not micropip's own frames.
      const lines = error.message.trimEnd().split('\n');
      const frames = lines.map(line => line.startsWith(' ')).lastIndexOf(true);
      throw new Error(lines.slice(frames + 1).join('\n'));
    });
  } finally {
    micropip.destroy();
  }

  // Load the ASGI bridge module
  console.log('[Python Worker] Loading ASGI bridge...');
  const bridgeResponse = await fetch(new URL('./asgi-bridge.py', import.meta.url));
  if (!bridgeResponse.ok) {
    throw new Error(`ASGI bridge download failed: HTTP ${bridgeResponse.status}`);
  }
  const asgiBridgeCode = await bridgeResponse.text();
  
  // Write asgi_bridge.py to virtual filesystem
  pyodide.FS.writeFile('/asgi_bridge.py', asgiBridgeCode);
  
  // Import it
  pyodide.runPython(`
import sys
# Edits rewrite app.py, possibly within the same second and at the same size,
# which would let a stale .pyc win. Never write bytecode.
sys.dont_write_bytecode = True
sys.path.insert(0, '/')
import asgi_bridge
  `);

  // Import the real package and starter before announcing readiness. Missing
  // imports/templates/configuration must fail initialization, not the first visit.
  pyodide.runPython(`
import cross_inertia
import os
import browser_inertia
os.environ['PLAYGROUND_DATA_DIR'] = '${DATA_DIR}'
browser_inertia.install()
# Run the starter from its folder, as \`fastapi run\` would, so CrossInertia's
# default template and manifest paths find its files.
os.chdir(starter_dir)
sys.path.insert(0, starter_dir)
from app import app
browser_inertia.reload()
print(f'[Python Worker] CrossInertia {cross_inertia.__version__} loaded from {cross_inertia.__file__}')
  `);

  initialized = true;
  console.log('[Python Worker] Initialization complete');
}

/**
 * Handle HTTP request through ASGI
 */
async function handleHttpRequest(request: HttpRequest): Promise<HttpResponse> {
  if (!pyodide || !initialized) {
    throw new Error('Python worker not initialized');
  }

  // Convert request to Python-friendly format
  // Pass as JSON string to avoid JsProxy conversion issues
  const requestData = {
    method: request.method,
    url: request.url,
    rootPath: request.rootPath || '',
    headers: request.headers,
    body: request.body ? Array.from(request.body) : [],
  };

  // Call the ASGI bridge using JSON for reliable conversion
  pyodide.globals.set('request_json', JSON.stringify(requestData));
  const responseData = await pyodide.runPythonAsync(`
import json
from asgi_bridge import handle_http_request

# Parse JSON to Python dict
request_data = json.loads(request_json)
response = await handle_http_request(request_data)
json.dumps(response)
  `);

  const response = JSON.parse(responseData as string);

  // Convert body back to Uint8Array if present
  let body: Uint8Array | undefined;
  if (response.body) {
    if (typeof response.body === 'string') {
      body = new TextEncoder().encode(response.body);
    } else {
      body = new Uint8Array(response.body);
    }
  }

  return {
    status: response.status,
    statusText: response.statusText || '',
    headers: response.headers,
    body,
  };
}

/**
 * Write edited starter files and re-import the app. Returns the traceback if
 * the new code fails; the previous version then keeps serving.
 */
async function applyFiles(files: Record<string, string>): Promise<string | null> {
  if (!pyodide || !initialized) {
    throw new Error('Python worker not initialized');
  }
  pyodide.globals.set('files_json', JSON.stringify(files));
  return await pyodide.runPythonAsync(`
import json
from asgi_bridge import apply_files
apply_files(json.loads(files_json))
  `) ?? null;
}

/** Delete everything in the data directory, re-import the app, and save. */
async function clearData(): Promise<string | null> {
  if (!pyodide || !initialized) {
    throw new Error('Python worker not initialized');
  }
  const error = await pyodide.runPythonAsync(`
from asgi_bridge import clear_data
clear_data('${DATA_DIR}')
  `) ?? null;
  await syncData(false);
  return error;
}

async function answerHttpRequest(request: HttpRequest, port: MessagePort) {
  try {
    const response = await handleHttpRequest(request);
    // Save before answering, so a reload right after a response keeps it.
    await syncData(false);
    port.postMessage({ type: 'http-response', response });
  } catch (error) {
    console.error('[Python Worker] Error:', error);
    const errorMessage = (error as Error).message;
    port.postMessage({ type: 'http-response', error: errorMessage });
  }
}

// Message handler
self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const { data } = event;
  const port = (event.ports && event.ports[0]) as MessagePort | undefined;

  try {
    switch (data.type) {
      case 'initialize': {
        await initialize(data.starterDir, data.files);
        port?.postMessage({ type: 'initialized', success: true });
        break;
      }

      case 'http-request': {
        if (!port) {
          console.error('[Python Worker] No port for http-request');
          return;
        }
        serialize(() => answerHttpRequest(data.request, port));
        break;
      }

      case 'apply-files': {
        const error = await serialize(() => applyFiles(data.files));
        port?.postMessage({ type: 'applied', error });
        break;
      }

      case 'clear-data': {
        const error = await serialize(clearData);
        port?.postMessage({ type: 'applied', error });
        break;
      }

      case 'reload-data': {
        // After the requests before it, so a replaced worker's last writes are in IndexedDB.
        await serialize(() => syncData(true));
        port?.postMessage({ type: 'applied', error: null });
        break;
      }
    }
  } catch (error) {
    console.error('[Python Worker] Error:', error);
    const errorMessage = (error as Error).message;
    
    if (port) {
      if (data.type === 'initialize') {
        port.postMessage({ type: 'initialized', success: false, error: errorMessage });
      } else {
        port.postMessage({ type: 'error', error: errorMessage });
      }
    }
  }
};

console.log('[Python Worker] Worker ready');
