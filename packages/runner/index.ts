/**
 * Runner package entry point
 * Registers the Service Worker and provides the runtime API
 */

import type { RunnerConfig } from './types';

/**
 * Register the Service Worker that intercepts HTTP requests
 * and routes them to the Pyodide worker
 */
export async function registerRunner(config?: RunnerConfig): Promise<ServiceWorkerRegistration> {
  if (!('serviceWorker' in navigator)) {
    throw new Error('Service Workers are not supported in this browser');
  }

  const registration = await navigator.serviceWorker.register(
    new URL('./sw.ts', import.meta.url),
    {
      type: 'module',
      scope: '/',
    }
  );

  // Wait for the service worker to be active
  if (registration.active) {
    return registration;
  }

  return new Promise((resolve) => {
    const worker = registration.installing || registration.waiting;
    if (worker) {
      worker.addEventListener('statechange', () => {
        if (worker.state === 'activated') {
          resolve(registration);
        }
      });
    }
  });
}

export * from './types';
