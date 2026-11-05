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
import type { HttpRequest, HttpResponse, WorkerMessage, VirtualFileSystem } from './types';

declare const self: DedicatedWorkerGlobalScope;

let pyodide: PyodideInterface | null = null;
let initialized = false;

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
    indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.27.8/full/',
  });

  console.log('[Python Worker] Installing packages...');
  
  // Load micropip for package installation
  await pyodide.loadPackage('micropip');
  const micropip = pyodide.pyimport('micropip');
  
  // Install FastAPI stack
  // Note: In Phase 0, we're using published wheels from PyPI
  await micropip.install([
    'fastapi',
    'starlette',
    'pydantic',
    'python-multipart',  // Required for FastAPI form parsing
    'jinja2',  // Required for Jinja2Templates
  ]);
  
  // Install CrossInertia (when available on PyPI, or from GitHub)
  // For Phase 0, this may need adjustment based on published package availability
  try {
    await micropip.install('cross-inertia');
  } catch (error) {
    console.warn('[Python Worker] CrossInertia not available, using stub');
    // Install a minimal stub for Phase 0 testing
    pyodide.runPython(`
import sys
from types import ModuleType

# Minimal CrossInertia stub for Phase 0
cross_inertia = ModuleType('cross_inertia')
sys.modules['cross_inertia'] = cross_inertia

fastapi_module = ModuleType('fastapi')
cross_inertia.fastapi = fastapi_module

class InertiaResponse:
    def __init__(self, component, props):
        self.component = component
        self.props = props

def inertia_dependency():
    class Inertia:
        def render(self, component, props):
            return InertiaResponse(component, props)
    return Inertia()

fastapi_module.inertia_dependency = inertia_dependency
fastapi_module.InertiaResponse = InertiaResponse

# Register in sys.modules
sys.modules['cross_inertia.fastapi'] = fastapi_module
    `);
  }

  // Load the ASGI bridge module
  console.log('[Python Worker] Loading ASGI bridge...');
  const asgiBridgeCode = await fetch(new URL('./asgi-bridge.py', import.meta.url)).then(r => r.text());
  
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
        const response = await handleHttpRequest(data.request);
        port?.postMessage({ type: 'http-response', response });
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
      if (data.type === 'http-request') {
        port.postMessage({ type: 'http-response', error: errorMessage });
      } else {
        port.postMessage({ type: 'error', error: errorMessage });
      }
    }
  }
};

console.log('[Python Worker] Worker ready');
