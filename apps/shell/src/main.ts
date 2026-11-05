/**
 * CrossInertia Playground Shell
 * Phase 0: Service Worker registration and preview setup
 */

import { counterFiles } from '@play.usecross.dev/runner/counter-files';

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

// Handle messages from Service Worker via BroadcastChannel
const pythonChannel = new BroadcastChannel('python-bridge');

pythonChannel.addEventListener('message', async (event) => {
  if (event.data.type === 'python-request') {
    const { requestId, request } = event.data;
    
    if (!pythonWorker) {
      // Send error back
      pythonChannel.postMessage({
        type: 'python-response',
        requestId,
        error: 'Python worker not initialized',
      });
      return;
    }
    
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
    
    pythonWorker.postMessage(
      {
        type: 'http-request',
        request,
      },
      [channel.port2]
    );
  }
});

// Initialize the runner (Service Worker + Pyodide)
async function initialize() {
  try {
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
    
    // Keep the frame blank until BOTH the SW and Python app are ready.
    previewFrame.src = '/preview/';
    reloadBtn.disabled = false;
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
