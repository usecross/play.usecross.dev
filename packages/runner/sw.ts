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

const cookieJar = new CookieJarImpl();

// Communication with the main thread's Python worker
// The main thread creates the worker and handles communication
interface PendingRequest {
  resolve: (response: HttpResponse) => void;
  reject: (error: Error) => void;
}

const pendingRequests = new Map<string, PendingRequest>();

// Use BroadcastChannel for SW ↔ page communication
const pythonChannel = new BroadcastChannel('python-bridge');

pythonChannel.addEventListener('message', (event) => {
  if (event.data.type === 'python-response') {
    const { requestId, response, error } = event.data;
    const pending = pendingRequests.get(requestId);
    
    if (pending) {
      pendingRequests.delete(requestId);
      if (error) {
        pending.reject(new Error(error));
      } else {
        pending.resolve(response);
      }
    }
  }
});

// Send request to Python worker via BroadcastChannel
async function sendToPython(request: HttpRequest): Promise<HttpResponse> {
  const requestId = Math.random().toString(36).substring(7);
  
  return new Promise((resolve, reject) => {
    pendingRequests.set(requestId, { resolve, reject });
    
    console.log('[SW] Sending to Python via BroadcastChannel:', request.method, request.url);
    
    // Send via BroadcastChannel (more reliable than client.postMessage)
    pythonChannel.postMessage({
      type: 'python-request',
      requestId,
      request,
    });
    
    // Timeout after 30 seconds
    setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId);
        reject(new Error('Request timeout'));
      }
    }, 30000);
  });
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
    
    // Send to Python worker via main thread
    console.log('[SW] Sending to Python:', httpRequest.method, httpRequest.url);
    const response = await sendToPython(httpRequest);
    
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

export {};
