/**
 * Service Worker for CrossInertia Playground
 * 
 * Intercepts HTTP requests to /preview/* and routes them through
 * the Pyodide worker to execute Python/ASGI application code.
 * 
 * Architecture:
 * 1. Browser makes request to /preview/...
 * 2. SW intercepts via fetch event
 * 3. SW forwards to Python worker via MessageChannel
 * 4. Python worker executes ASGI app
 * 5. Response flows back through SW to browser
 */

/// <reference lib="webworker" />

import type { HttpRequest, HttpResponse } from './types';
import { CookieJarImpl } from './cookie-jar';

declare const self: ServiceWorkerGlobalScope;

let pythonWorker: Worker | null = null;
const cookieJar = new CookieJarImpl();

// Initialize Python worker
function ensureWorker(): Worker {
  if (!pythonWorker) {
    pythonWorker = new Worker(new URL('./python-worker.ts', import.meta.url), {
      type: 'module',
    });
    
    console.log('[SW] Python worker created');
  }
  return pythonWorker;
}

self.addEventListener('install', (event) => {
  console.log('[SW] Installing Service Worker');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[SW] Activating Service Worker');
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Only intercept /preview/ paths
  if (!url.pathname.startsWith('/preview/')) {
    return;
  }

  event.respondWith(handlePreviewRequest(event.request));
});

/**
 * Handle requests to the preview iframe
 * Routes through Python worker for dynamic content
 */
async function handlePreviewRequest(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    
    // Strip /preview prefix for the Python app
    const appPath = url.pathname.replace(/^\/preview/, '') || '/';
    const appUrl = url.origin + appPath + url.search + url.hash;
    
    console.log('[SW] Handling request:', request.method, appPath);
    
    // Read request body if present
    let body: Uint8Array | undefined;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const arrayBuffer = await request.clone().arrayBuffer();
      body = new Uint8Array(arrayBuffer);
    }
    
    // Build headers object, adding virtual cookies
    const requestHeaders: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      requestHeaders[key] = value;
    });
    
    // Inject virtual cookies
    const cookieHeader = cookieJar.getCookieHeader(appUrl);
    if (cookieHeader) {
      requestHeaders['cookie'] = cookieHeader;
    }
    
    // Create HTTP request for Python
    const httpRequest: HttpRequest = {
      method: request.method,
      url: appUrl,
      headers: requestHeaders,
      body,
    };
    
    // Send to Python worker
    const worker = ensureWorker();
    const response = await sendHttpRequest(worker, httpRequest);
    
    // Extract Set-Cookie headers and update cookie jar
    const setCookieHeaders: string[] = [];
    Object.entries(response.headers).forEach(([key, value]) => {
      if (key.toLowerCase() === 'set-cookie') {
        setCookieHeaders.push(value);
      }
    });
    if (setCookieHeaders.length > 0) {
      cookieJar.setCookies(setCookieHeaders, appUrl);
    }
    
    // Build Response
    const responseHeaders = new Headers();
    Object.entries(response.headers).forEach(([key, value]) => {
      responseHeaders.append(key, value);
    });
    
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('[SW] Request failed:', error);
    return new Response(
      JSON.stringify({
        error: 'Internal playground error',
        message: (error as Error).message,
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

/**
 * Send HTTP request to Python worker and wait for response
 */
function sendHttpRequest(
  worker: Worker,
  request: HttpRequest
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    
    channel.port1.onmessage = (event) => {
      if (event.data.type === 'http-response') {
        if (event.data.error) {
          reject(new Error(event.data.error));
        } else {
          resolve(event.data.response);
        }
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

export {};
