/**
 * Service Worker for CrossInertia Playground
 * 
 * This is a minimal dev-mode loader that imports the actual Service Worker
 * from the runner package. In production, the real SW will be bundled here.
 * 
 * Dev mode: This file is served from /sw.js (allowed scope: /)
 * Production: Vite bundles packages/runner/sw.ts here during build
 */

// In dev mode, we can't use ES modules directly in Service Workers with type: 'module'
// due to scope restrictions, so this is a placeholder that will be replaced by the
// build process.

console.log('[SW Loader] Phase 0: Service Worker loading...');

// For Phase 0, we'll register a minimal SW that just logs
self.addEventListener('install', (event) => {
  console.log('[SW] Installing Service Worker (Phase 0 stub)');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[SW] Activating Service Worker (Phase 0 stub)');
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Only intercept /preview/ paths
  if (!url.pathname.startsWith('/preview/')) {
    return;
  }

  // Phase 0: Return a simple response
  event.respondWith(
    new Response(
      JSON.stringify({
        message: 'Phase 0: Service Worker stub active',
        note: 'Full ASGI bridge will be integrated in next iteration',
        path: url.pathname,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  );
});

console.log('[SW] Service Worker loaded and ready');
