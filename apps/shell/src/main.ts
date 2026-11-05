/**
 * CrossInertia Playground Shell
 * Phase 0: Service Worker registration and preview setup
 */

// Status display
const statusEl = document.getElementById('status') as HTMLElement;
const previewFrame = document.getElementById('preview') as HTMLIFrameElement;
const reloadBtn = document.getElementById('reload-btn') as HTMLButtonElement;

function updateStatus(message: string) {
  console.log('[Shell]', message);
  statusEl.textContent = message;
}

// Initialize the runner (Service Worker + Pyodide)
async function initialize() {
  try {
    updateStatus('Registering Service Worker...');
    
    // Register the Service Worker from /sw.js (proper scope)
    if (!('serviceWorker' in navigator)) {
      throw new Error('Service Workers are not supported in this browser');
    }

    const registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
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
