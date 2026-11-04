/**
 * CrossInertia Playground Shell
 * Phase 0: Service Worker registration and preview setup
 */

import { registerRunner } from '@play.usecross.dev/runner';

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
    
    const registration = await registerRunner();
    
    updateStatus('Service Worker registered');
    console.log('[Shell] Service Worker ready:', registration);
    
    // Service Worker is now active and will intercept requests to /preview/
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
  if (event.data.type === 'preview:ready') {
    updateStatus('Preview ready');
  } else if (event.data.type === 'preview:error') {
    updateStatus('Error: ' + event.data.error);
    console.error('[Shell] Preview error:', event.data.error);
  }
});

// Start initialization
initialize();
