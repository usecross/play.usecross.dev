/**
 * CrossInertia Playground Shell
 * Registers the Service Worker, starts Python and sets up the preview.
 */

import { STARTER_DIR, counterFiles, counterSources, editableSources } from '@play.usecross.dev/runner/counter-files';

// Status display
const statusEl = document.getElementById('status') as HTMLElement;
const previewFrame = document.getElementById('preview') as HTMLIFrameElement;
const reloadBtn = document.getElementById('reload-btn') as HTMLButtonElement;

let pythonWorker: Worker | null = null;

function updateStatus(message: string) {
  console.log('[Shell]', message);
  statusEl.textContent = message;
}

// Initialize Python worker
async function initPythonWorker() {
  updateStatus('Loading Python runtime...');
  
  pythonWorker = new Worker(
    new URL('../../../packages/runner/python-worker.ts', import.meta.url),
    { type: 'module' }
  );
  
  // Initialize with counter files
  return new Promise<void>((resolve, reject) => {
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
            updateStatus('Ready');
            resolve();
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
        files: counterFiles,
      },
      [channel.port2]
    );
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
function answerPreviewRequests(worker: Worker) {
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
    
    worker.postMessage(
      {
        type: 'http-request',
        request,
      },
      [channel.port2]
    );
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

    await navigator.serviceWorker.ready;
    // Activation precedes clients.claim(). Do not navigate the preview until
    // this page is controlled, or its first request can hit the static host.
    if (!navigator.serviceWorker.controller) {
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
    
    // Initialize Python worker
    await initPythonWorker();
    answerPreviewRequests(pythonWorker!);
    
    // Keep the frame blank until BOTH the SW and Python app are ready.
    previewFrame.src = '/preview/';
    reloadBtn.disabled = false;
    editor.then(handle => handle?.setEditable(true));
  } catch (error) {
    pythonWorker?.terminate();
    pythonWorker = null;
    console.error('[Shell] Failed to initialize:', error);
    updateStatus('Failed to initialize: ' + (error as Error).message);
  }
}

// Reload button
reloadBtn.addEventListener('click', () => {
  previewFrame.src = '/preview/';
});

// Listen for preview messages
window.addEventListener('message', (event) => {
  // Only process messages from the preview iframe
  if (event.source !== previewFrame.contentWindow) {
    return;
  }
  
  if (event.data.type === 'preview:ready') {
    updateStatus('Preview ready');
  } else if (event.data.type === 'preview:error') {
    updateStatus('Error: ' + event.data.error);
    console.error('[Shell] Preview error:', event.data.error);
  }
});

// Start initialization
initialize();

// Edits waiting to be applied, by starter path.
const pendingEdits: Record<string, string> = {};
let applyTimer: ReturnType<typeof setTimeout> | undefined;
const applyErrorEl = document.getElementById('apply-error') as HTMLElement;

function editChanged(path: string, content: string) {
  pendingEdits[path] = content;
  clearTimeout(applyTimer);
  applyTimer = setTimeout(applyEdits, 800);
}

/** Send pending edits to Python; on success reload the preview, else show the traceback. */
function applyEdits() {
  clearTimeout(applyTimer);
  const worker = pythonWorker;
  const paths = Object.keys(pendingEdits);
  if (!worker || paths.length === 0) return;
  const files = Object.fromEntries(paths.map(path => [`${STARTER_DIR}/${path}`, pendingEdits[path]]));
  paths.forEach(path => delete pendingEdits[path]);

  updateStatus('Applying your changes...');
  const channel = new MessageChannel();
  channel.port1.onmessage = ({ data }) => {
    if (data.type !== 'applied') return;
    if (data.error) {
      applyErrorEl.textContent = data.error;
      applyErrorEl.hidden = false;
      applyErrorEl.scrollTop = applyErrorEl.scrollHeight; // The error message is last.
      updateStatus('Not applied: the previous version is still running');
    } else {
      applyErrorEl.hidden = true;
      previewFrame.contentWindow?.location.reload();
      updateStatus('Changes applied');
    }
  };
  worker.postMessage({ type: 'apply-files', files }, [channel.port2]);
}

// The editor loads in its own chunk, so it never delays Python.
const editorEl = document.getElementById('editor') as HTMLElement;
const editor = import('./editor')
  .then(({ mountEditor }) => mountEditor(editorEl, counterSources, {
    editable: editableSources,
    onChange: editChanged,
    onSave: applyEdits,
  }))
  .catch(error => {
    console.error('[Shell] Editor failed to load:', error);
    editorEl.textContent = 'The code view failed to load.';
    return null;
  });
