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
import requirements from '../starters/requirements.txt?raw';
import runtime from '../starters/runtime.json';
import type { HttpRequest, HttpResponse, WorkerMessage, VirtualFileSystem } from './types';

declare const self: DedicatedWorkerGlobalScope;

let pyodide: PyodideInterface | null = null;
let initialized = false;

// Queue to serialize concurrent http-request handling
interface QueuedRequest {
  request: HttpRequest;
  port: MessagePort;
}
let requestQueue: QueuedRequest[] = [];
let processingRequest = false;

/**
 * Initialize Pyodide and load dependencies
 */
async function initialize(files?: VirtualFileSystem): Promise<void> {
  if (initialized) {
    console.warn('[Python Worker] Already initialized');
    return;
  }

  console.log('[Python Worker] Loading Pyodide...');
  pyodide = await loadPyodide({
    indexURL: `https://cdn.jsdelivr.net/pyodide/v${runtime.pyodideVersion}/full/`,
  });

  console.log('[Python Worker] Installing packages...');
  
  // Load micropip for package installation
  await pyodide.loadPackage('micropip');
  const micropip = pyodide.pyimport('micropip');
  
  const packages = requirements.split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
  try {
    // cross-web needs newer typing extensions than Pyodide's default. Install
    // that pin BEFORE loading Pydantic, which otherwise installs the old wheel.
    await micropip.install(packages.filter(pkg => pkg.startsWith('typing-extensions==')));
    await pyodide.loadPackage(['pydantic', 'MarkupSafe']);
    // Installation failures are fatal: never substitute a fake CrossInertia.
    const wheelUrl = new URL(runtime.crossInertia.wheelPath, self.location.origin).href;
    await micropip.install([wheelUrl, ...packages]);
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
sys.path.insert(0, '/')
import asgi_bridge
  `);

  // Load user files into virtual filesystem if provided
  if (files) {
    console.log('[Python Worker] Loading user files...');
    for (const [path, content] of Object.entries(files)) {
      const dirPath = path.split('/').slice(0, -1).join('/');
      if (dirPath) {
        pyodide.FS.mkdirTree(dirPath);
      }
      
      if (typeof content === 'string') {
        pyodide.FS.writeFile(path, content);
      } else {
        pyodide.FS.writeFile(path, content);
      }
    }
  }

  // Import the real package and starter before announcing readiness. Missing
  // imports/templates/configuration must fail initialization, not the first visit.
  pyodide.runPython(`
import cross_inertia
sys.path.insert(0, '/examples/counter')
from app import app, response as inertia_response
inertia_response.get_manifest()
inertia_response.templates.get_template('app.html')
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
 * Reset the worker (reload Python code)
 */
async function reset(): Promise<void> {
  // For Phase 0, we do a simple reload
  // In later phases, this would preserve the database
  if (pyodide) {
    await pyodide.runPythonAsync(`
import sys
# Clear cached modules
for key in list(sys.modules.keys()):
    if key.startswith('app') or key.startswith('examples'):
        del sys.modules[key]
    `);
  }
}

/**
 * Process queued http-requests serially to avoid shared request_json conflicts
 */
async function processRequestQueue() {
  if (processingRequest || requestQueue.length === 0) {
    return;
  }
  
  processingRequest = true;
  
  while (requestQueue.length > 0) {
    const { request, port } = requestQueue.shift()!;
    
    try {
      const response = await handleHttpRequest(request);
      port.postMessage({ type: 'http-response', response });
    } catch (error) {
      console.error('[Python Worker] Error:', error);
      const errorMessage = (error as Error).message;
      port.postMessage({ type: 'http-response', error: errorMessage });
    }
  }
  
  processingRequest = false;
}

// Message handler
self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const { data } = event;
  const port = (event.ports && event.ports[0]) as MessagePort | undefined;

  try {
    switch (data.type) {
      case 'initialize': {
        await initialize(data.files);
        port?.postMessage({ type: 'initialized', success: true });
        break;
      }

      case 'http-request': {
        if (!port) {
          console.error('[Python Worker] No port for http-request');
          return;
        }
        // Queue the request for serial processing
        requestQueue.push({ request: data.request, port });
        processRequestQueue();
        break;
      }

      case 'reset': {
        await reset();
        port?.postMessage({ type: 'reset-complete', success: true });
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
