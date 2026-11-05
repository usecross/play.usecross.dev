/**
 * CrossInertia Playground Shell
 * Phase 0: Service Worker registration and preview setup
 */

import { counterFiles } from '@play.usecross.dev/runner/counter-files';
import type { HttpRequest, HttpResponse } from '@play.usecross.dev/runner/types';

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
    
    channel.port1.onmessage = (event) => {
      if (event.data.type === 'initialized') {
        if (event.data.success) {
          console.log('[Shell] Python worker initialized');
          updateStatus('Ready');
          resolve();
        } else {
          reject(new Error('Python initialization failed'));
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
  console.log('[Shell] Received message from BroadcastChannel:', event.data.type);
  
  if (event.data.type === 'python-request') {
    const { requestId, request } = event.data;
    
    console.log('[Shell] Python request:', request.method, request.url);
    
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
    console.log('[Shell] Forwarding to Python worker...');
    const channel = new MessageChannel();
    
    channel.port1.onmessage = (workerEvent) => {
      console.log('[Shell] Got response from Python worker');
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

    // Wait for the service worker to be active
    if (registration.active) {
      updateStatus('Service Worker registered');
      console.log('[Shell] Service Worker ready:', registration);
    } else {
      await new Promise<void>((resolve) => {
        const worker = registration.installing || registration.waiting;
        if (worker) {
          worker.addEventListener('statechange', () => {
            if (worker.state === 'activated') {
              updateStatus('Service Worker registered');
              console.log('[Shell] Service Worker ready:', registration);
              resolve();
            }
          });
        }
      });
    }
    
    // Initialize Python worker
    await initPythonWorker();
    
    // Service Worker is now active and will intercept requests to /preview/
    // Reload the preview iframe so the first load is intercepted by the active SW
    previewFrame.contentWindow?.location.reload();
  } catch (error) {
    console.error('[Shell] Failed to initialize:', error);
    updateStatus('Failed to initialize: ' + (error as Error).message);
  }
}

// Reload button
reloadBtn.addEventListener('click', () => {
  previewFrame.contentWindow?.location.reload();
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
