# CrossInertia Playground Architecture

**Phase 0** technical documentation — how the in-browser playground works.

## Overview

The CrossInertia Playground runs Python web applications entirely in the browser by combining:
1. **Service Workers** — Intercept HTTP requests
2. **Pyodide** — Python interpreter compiled to WebAssembly
3. **ASGI/WSGI bridges** — Adapt browser requests to Python frameworks
4. **Inertia.js client** — Real Inertia protocol implementation

No backend server is required. All HTTP requests, Python execution, and rendering happen client-side.

## Architecture Layers

```
┌─────────────────────────────────────────────────────────────┐
│  Browser (Main Thread)                                      │
│  ┌─────────────────┐          ┌──────────────────┐         │
│  │ Playground Shell│          │ Preview iframe   │         │
│  │ (apps/shell)    │─────────▶│ /preview/*       │         │
│  └─────────────────┘          └──────────────────┘         │
│                                        │                     │
│                                    fetch('/counter')        │
│                                        │                     │
└────────────────────────────────────────┼─────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────┐
│  Service Worker (sw.ts)                                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 1. Intercept /preview/* requests                    │   │
│  │ 2. Read/write virtual cookie jar                    │   │
│  │ 3. Forward to Python Worker via MessageChannel      │   │
│  │ 4. Return Response to browser                       │   │
│  └─────────────────────────────────────────────────────┘   │
└────────────────────────────────────────┬─────────────────────┘
                                         │ MessageChannel
                                         ▼
┌─────────────────────────────────────────────────────────────┐
│  Python Worker (python-worker.ts)                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 1. Load Pyodide (Python WebAssembly runtime)        │   │
│  │ 2. Install packages: FastAPI, CrossInertia, etc.    │   │
│  │ 3. Mount virtual filesystem (user's Python files)   │   │
│  │ 4. Load ASGI bridge (asgi-bridge.py)                │   │
│  │ 5. Execute Python app on each request               │   │
│  └─────────────────────────────────────────────────────┘   │
│                              │                               │
│                              ▼                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Pyodide Filesystem (in-memory)                      │   │
│  │                                                      │   │
│  │  /examples/counter/                                 │   │
│  │  ├── app.py              ← User's FastAPI app       │   │
│  │  ├── templates/                                     │   │
│  │  │   └── app.html        ← Inertia root template   │   │
│  │  └── static/build/.vite/                            │   │
│  │      └── manifest.json   ← Synthetic Vite manifest  │   │
│  │                                                      │   │
│  │  /asgi-bridge.py         ← HTTP → ASGI adapter      │   │
│  │  /wsgi-bridge.py         ← Django WSGI (Phase 2)    │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Request Flow (Counter Example)

### Initial Page Load

```
1. Browser navigates to /preview/counter
   ↓
2. Service Worker intercepts GET /preview/counter
   ↓
3. SW forwards to Python Worker:
   HttpRequest {
     method: 'GET',
     url: 'http://localhost/counter',
     headers: { accept: 'text/html', ... }
   }
   ↓
4. Python Worker calls asgi-bridge.py → handle_http_request()
   ↓
5. ASGI bridge builds ASGI scope:
   {
     'type': 'http',
     'method': 'GET',
     'path': '/counter',
     'headers': [(b'accept', b'text/html'), ...],
     ...
   }
   ↓
6. FastAPI app executes:
   @app.get("/counter")
   async def get_counter(request: Request):
       return inertia_response(request, "Counter", {"count": 0})
   ↓
7. inertia_response() checks X-Inertia header:
   - Not present → Return full HTML (app.html with page data)
   ↓
8. Response flows back:
   HttpResponse {
     status: 200,
     headers: { 'content-type': 'text/html' },
     body: <HTML with <div data-page="...">
   }
   ↓
9. Service Worker returns Response to browser
   ↓
10. Browser renders HTML, Inertia.js initializes from data-page
```

### Form Submission (Increment)

```
1. User clicks "+" button
   ↓
2. Inertia form calls POST /counter with action=increment
   ↓
3. Service Worker intercepts POST /preview/counter
   Headers: { 'X-Inertia': 'true', ... }
   Body: FormData { action: 'increment' }
   ↓
4. Python Worker → ASGI bridge → FastAPI:
   @app.post("/counter")
   async def post_counter(request: Request, action: str = Form(...)):
       counter_value += 1
       return RedirectResponse("/counter", status_code=303)
   ↓
5. Response:
   HttpResponse {
     status: 303,
     headers: { 'location': '/counter' },
     body: null
   }
   ↓
6. Inertia client follows redirect:
   GET /counter with X-Inertia: true
   ↓
7. FastAPI processes second request:
   @app.get("/counter")
   - Detects X-Inertia header
   - Returns JSON response:
     {
       "component": "Counter",
       "props": { "count": 1 },
       "url": "/counter",
       "version": "1"
     }
   ↓
8. Inertia client updates Counter component props
   Counter re-renders with count=1
```

This is the **complete Inertia protocol cycle** running entirely in-browser.

## Key Components

### Service Worker (sw.ts)

**Purpose**: HTTP interception layer

**Responsibilities:**
- Intercept `fetch` events for `/preview/*` URLs
- Strip `/preview` prefix before forwarding to Python
- Manage virtual cookie jar:
  - Extract `Set-Cookie` from Python responses
  - Inject `Cookie` header into subsequent requests
- Communicate with Python Worker via MessageChannel
- Return synthetic `Response` objects to the browser

**Why Service Workers?**
- Only browser API that can intercept HTTP requests
- Runs in a separate thread (won't block UI)
- Can respond with synthetic data (no network required)

### Python Worker (python-worker.ts)

**Purpose**: Python runtime host

**Responsibilities:**
- Load Pyodide WebAssembly module
- Install Python packages via micropip (FastAPI, CrossInertia, etc.)
- Mount virtual filesystem with user's code
- Load ASGI/WSGI bridge modules
- Execute Python on each HTTP request
- Handle worker lifecycle (init, reset, reload)

**Initialization Steps:**
1. `loadPyodide()` — Download and initialize WASM runtime
2. `loadPackage('micropip')` — Package installer
3. `micropip.install(['fastapi', 'starlette', ...])` — Install deps
4. Load `asgi-bridge.py` via `runPython()`
5. Mount user files to Pyodide.FS

### ASGI Bridge (asgi-bridge.py)

**Purpose**: Translate HTTP requests to ASGI protocol

**Key Functions:**

```python
async def handle_http_request(request_data: dict) -> dict:
    # 1. Parse request (method, url, headers, body)
    # 2. Build ASGI scope
    # 3. Define receive() and send() callables
    # 4. Import and invoke user's ASGI app
    # 5. Collect response and return
```

**ASGI Scope** (simplified):
```python
{
    'type': 'http',
    'method': 'GET',
    'path': '/counter',
    'query_string': b'',
    'headers': [(b'host', b'localhost'), ...],
    'server': ('localhost', 80),
}
```

**ASGI Messages:**
```python
# receive() returns:
{'type': 'http.request', 'body': b'...', 'more_body': False}

# send() expects:
{'type': 'http.response.start', 'status': 200, 'headers': [...]}
{'type': 'http.response.body', 'body': b'...', 'more_body': False}
```

**Adaptation Pattern:**
This follows Simon Willison's [pyodide-asgi-browser](https://github.com/simonw/research/tree/main/pyodide-asgi-browser) pattern rather than inventing from scratch.

### Cookie Jar (cookie-jar.ts)

**Purpose**: Virtual cookie management

**Problem:**
Service Workers intercept `fetch()` requests but don't have access to the browser's automatic `Cookie` header for those requests. We need manual cookie storage.

**Solution:**

```typescript
interface CookieJar {
  setCookies(setCookieHeaders: string[], url: string): void;
  getCookieHeader(url: string): string | null;
  clear(): void;
}
```

**On Response:**
```typescript
// Parse Set-Cookie headers from Python response
cookieJar.setCookies([
  'sessionid=abc123; Path=/; HttpOnly',
  'csrftoken=xyz789; Path=/',
], 'http://localhost/counter');
```

**On Request:**
```typescript
// Inject Cookie header before forwarding to Python
const cookieHeader = cookieJar.getCookieHeader('http://localhost/counter');
// cookieHeader = "sessionid=abc123; csrftoken=xyz789"
```

**Cookie Matching:**
- Domain matching (exact + subdomain)
- Path prefix matching
- Expiration checking
- Secure flag (HTTPS only)
- SameSite (future)

## CrossInertia Integration

### The Vite Manifest Problem

**Production CrossInertia** expects:
```python
# In production, CrossInertia reads:
# static/build/.vite/manifest.json

{
  "app.tsx": {
    "file": "assets/app-[hash].js",
    "css": ["assets/app-[hash].css"]
  }
}
```

**The Problem:**
- Vite can't run inside Pyodide (no Node.js, no Vite dev server)
- CrossInertia's asset resolver tries to connect to `http://localhost:5173`
- We need CrossInertia to work without modifying the library

**Phase 0 Solution: Synthetic Manifest**

1. Place a fake `manifest.json` in Pyodide VFS at:
   ```
   /examples/counter/static/build/.vite/manifest.json
   ```

2. CrossInertia reads it and resolves asset URLs:
   ```python
   # CrossInertia sees this and generates asset URLs
   # But we serve components inline in app.html (Phase 0)
   ```

3. Phase 0 compromise: **Inline components in app.html**
   - React/Inertia loaded from CDN
   - Counter component written inline with `createElement()`
   - Synthetic manifest exists but isn't actually used yet

**Phase 1+ Solution: esbuild-wasm**

Future phases will:
1. Bundle `frontend/app.tsx` → `static/build/assets/app-[hash].js`
2. Store bundled files in Pyodide VFS
3. Service Worker intercepts `/static/build/*` and serves from VFS
4. Synthetic manifest points to real compiled assets

This avoids needing Vite while preserving CrossInertia's production path.

### Bypassing Development Server Probes

**Current CrossInertia behavior** (may need adjustment):
```python
# Tries to detect Vite dev server
def _detect_vite():
    try:
        response = httpx.get("http://localhost:5173")
        return response.status_code == 200
    except:
        return False
```

**Phase 0 workaround:**
- Counter example uses manual Inertia responses
- Doesn't rely on CrossInertia's asset injection yet

**Upstream change recommendation:**
```python
# Proposed: Configurable asset resolver
class BrowserAssetResolver:
    def get_entry_url(self) -> str:
        return "/static/build/app.js"  # From manifest
    
    def should_probe_vite(self) -> bool:
        return False  # Disable in browser mode
```

This would let the playground use real CrossInertia without a fork.

## PythonFrameworkRuntime Interface

**Abstraction for framework support:**

```typescript
interface PythonFrameworkRuntime {
  initialize(files: VirtualFileSystem): Promise<void>;
  handleHttp(request: HttpRequest): Promise<HttpResponse>;
  connectWebSocket?(request: WebSocketRequest): Promise<SocketSession>;
  reset(): Promise<void>;
}
```

**Future implementations:**

| Framework | Bridge | Priority | Notes |
|-----------|--------|----------|-------|
| FastAPI | ASGI | Phase 0 ✅ | Working in counter example |
| Starlette | ASGI | Phase 0 ✅ | Same bridge as FastAPI |
| Django | WSGI | Phase 2 | Needs ORM, migrations, middleware |
| Litestar | ASGI | Phase 3 | Similar to FastAPI |
| Flask | WSGI | Later | Simple WSGI adapter |

**Django will need separate WSGI path:**
- Django's ASGI support assumes async threading (not available in Pyodide)
- WSGI is simpler for synchronous Django code
- wsgi-bridge.py will implement `django.core.handlers.wsgi.WSGIHandler`

## State Persistence

### Phase 0: In-Memory

```python
# examples/counter/app.py
counter_value = 0  # Global variable

@app.post("/counter")
async def post_counter(action: str = Form(...)):
    global counter_value
    counter_value += 1
    return RedirectResponse("/counter", status_code=303)
```

**Limitation:** Counter resets on page reload.

### Phase 1: SQLite + IDBFS

**Pyodide IDBFS** (IndexedDB filesystem):
```python
# Enable persistent filesystem
pyodide.FS.mkdir('/data')
pyodide.FS.mount(pyodide.FS.filesystems.IDBFS, {}, '/data')

# After changes, persist to IndexedDB
pyodide.FS.syncfs(False, callback)

# On reload, restore from IndexedDB
pyodide.FS.syncfs(True, callback)
```

**SQLite persistence:**
```python
import sqlite3

conn = sqlite3.connect('/data/db.sqlite3')
# Changes persist across reloads via IDBFS
```

**Worker reload strategy:**
```typescript
async function reset() {
  // 1. Close SQLite connections
  await pyodide.runPython('conn.close()');
  
  // 2. Sync filesystem to IndexedDB
  await pyodide.FS.syncfs(false);
  
  // 3. Clear Python module cache
  pyodide.runPython('sys.modules.clear()');
  
  // 4. Re-import app
  pyodide.runPython('from app import app');
}
```

This preserves database state while hot-reloading Python code.

### Phase 2: Django Migrations

```python
# Run migrations through Django's API (not subprocess)
from django.core.management import call_command

call_command('makemigrations', verbosity=0)
call_command('migrate', verbosity=0)
```

Django's ORM will use SQLite, persisted via IDBFS.

## Future: WebSockets and Broadcasting

### Phase 3: Virtual WebSocket Transport

**Problem:**
- Service Workers can't intercept WebSocket connections
- `new WebSocket()` always tries real network connection

**Solution: Shim WebSocket API**

```typescript
// In preview iframe only
const NativeWebSocket = window.WebSocket;

window.WebSocket = class VirtualWebSocket extends EventTarget {
  constructor(url: string, protocols?: string | string[]) {
    super();
    if (url.startsWith('/')) {
      // Local URL → route through Python Worker
      this.#connectVirtual(url, protocols);
    } else {
      // External URL → could allow or block
      throw new Error('External WebSocket blocked');
    }
  }
  
  #connectVirtual(url: string, protocols?: string | string[]) {
    // Use MessageChannel to Python Worker
    // Implement WebSocket API surface
  }
};
```

**Python side (ASGI WebSocket):**

```python
# FastAPI WebSocket route works normally
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    while True:
        data = await websocket.receive_text()
        await websocket.send_text(f"Echo: {data}")
```

**ASGI WebSocket events:**
```
websocket.connect → accept
websocket.receive → data from client
websocket.send → data to client
websocket.disconnect → close
```

### Broadcasting to Multiple Clients

**Architecture:**
```
Preview 1 iframe                Preview 2 iframe
      │                                │
      └────────────┬───────────────────┘
                   │
           Service Worker (shared)
                   │
           Python Worker (shared)
                   │
         In-process event bus
```

**Implementation:**
```python
# In Python Worker
from typing import Dict, Set

class EventBus:
    subscribers: Dict[str, Set[callable]] = {}
    
    def subscribe(self, channel: str, callback: callable):
        if channel not in self.subscribers:
            self.subscribers[channel] = set()
        self.subscribers[channel].add(callback)
    
    async def publish(self, channel: str, message: dict):
        for callback in self.subscribers.get(channel, []):
            await callback(message)

# Each preview iframe gets its own connection ID
# Broadcasting sends to all connections except sender
```

**Cross-tab sync (future):**
```typescript
const broadcast = new BroadcastChannel('playground-events');
broadcast.postMessage({ type: 'event', channel: 'orders', data: {...} });
```

## Security and Isolation

### Phase 0: Minimal Isolation

- Preview runs on same origin as shell (localhost:3000)
- Python code can access all browser APIs
- No network restrictions

### Phase 1+: Proper Isolation

**Sandbox Preview:**
```html
<!-- Isolated preview frame -->
<iframe
  sandbox="allow-scripts allow-same-origin"
  src="https://runner.play.usecross.dev/"
></iframe>
```

**Separate origin for runner:**
- Main app: `play.usecross.dev`
- Preview: `runner.play.usecross.dev`
- No cookies, no localStorage from main app

**CSP headers:**
```
Content-Security-Policy:
  default-src 'none';
  script-src 'self' https://cdn.jsdelivr.net;
  connect-src 'self';
  style-src 'self' 'unsafe-inline';
```

**Resource limits:**
```typescript
// In Python Worker
const MEMORY_LIMIT = 512 * 1024 * 1024; // 512 MB
const TIMEOUT = 30000; // 30s per request

setTimeout(() => {
  worker.terminate();
  throw new Error('Request timeout');
}, TIMEOUT);
```

## Known Limitations (Phase 0)

### What Works
✅ HTTP GET/POST/PUT/DELETE  
✅ ASGI protocol (FastAPI, Starlette)  
✅ Form data, JSON bodies  
✅ Headers, cookies (virtual)  
✅ Redirects (301, 302, 303, 307, 308)  
✅ Inertia protocol (visits, forms, partial reloads)  
✅ React + Inertia.js client  

### What Doesn't Work Yet
❌ SQLite persistence (in-memory only)  
❌ Real asset bundling (CDN/inline only)  
❌ Monaco editor (fixed example)  
❌ WSGI/Django  
❌ WebSocket/SSE  
❌ File uploads  
❌ Streaming responses  

### Fundamental Limits (Browser Environment)
🚫 No real TCP sockets  
🚫 No subprocess spawning  
🚫 No native threading  
🚫 No real filesystem (VFS only)  
🚫 Limited Python packages (pure-Python or pre-compiled WASM)  

## Performance Considerations

### Pyodide Load Time
- Initial: ~5-10s (download WASM + stdlib)
- Cached: ~1-2s (Service Worker cache)
- Optimization: Pre-cache in shell, lazy-load in worker

### Package Installation
- micropip downloads wheels from PyPI
- Pure-Python packages: fast
- Compiled packages: need WASM builds
- Optimization: Bundle common packages, cache in IndexedDB

### Request Latency
- Service Worker intercept: <10ms
- MessageChannel IPC: <5ms
- Python execution: 10-100ms (depends on logic)
- Total overhead: ~50-200ms vs native

Acceptable for playground/demo; not production-grade latency.

## Debugging Tips

### Enable Verbose Logging

```typescript
// In sw.ts or python-worker.ts
const DEBUG = true;

if (DEBUG) {
  console.log('[SW] Request:', request.method, request.url);
}
```

### Inspect Service Worker

Chrome DevTools → Application → Service Workers:
- See registration status
- Unregister to force reload
- View console logs

### Check Pyodide Errors

Python exceptions are caught and returned:
```json
{
  "status": 500,
  "headers": {"content-type": "application/json"},
  "body": {
    "error": "NameError: name 'counter' is not defined",
    "traceback": "..."
  }
}
```

### Monitor MessageChannel

```typescript
channel.port1.onmessage = (event) => {
  console.log('[Channel] Response:', event.data);
};
```

### Pyodide Filesystem Inspection

```python
import os
print(os.listdir('/examples/counter'))
# ['app.py', 'templates', 'frontend', 'static']
```

## Deployment (Phase 1+)

### Cloudflare Pages

```bash
bun run build
npx wrangler pages deploy dist
```

### Build Output
```
dist/
├── index.html           # Shell
├── assets/
│   ├── main-[hash].js   # Shell JS
│   ├── sw-[hash].js     # Service Worker
│   └── worker-[hash].js # Python Worker
└── _headers             # CSP/CORS headers
```

### Cloudflare Workers Configuration

```toml
# wrangler.toml
[build]
command = "bun run build"
directory = "dist"

[[routes]]
pattern = "play.usecross.dev/*"
zone_name = "usecross.dev"
```

## Next Steps

### Phase 1: Editor + Persistence
- [ ] Monaco editor for file editing
- [ ] IDBFS for SQLite persistence
- [ ] esbuild-wasm for React bundling
- [ ] Hot reload for Python code changes

### Phase 2: Django
- [ ] WSGI bridge implementation
- [ ] Django ORM + migrations
- [ ] Sessions + CSRF middleware
- [ ] Django starter template

### Phase 3: Real-Time
- [ ] SSE streaming (http.response.body chunks)
- [ ] Virtual WebSocket transport
- [ ] In-process event bus
- [ ] Multi-client preview

### Phase 4: Polish
- [ ] Litestar support
- [ ] Export/import projects
- [ ] URL-based project sharing
- [ ] Performance profiling
- [ ] Cross-browser testing (Firefox, Safari)

## References

- [Pyodide ASGI Browser](https://github.com/simonw/research/tree/main/pyodide-asgi-browser) - Simon Willison's Service Worker + FastAPI experiment
- [Django Playground](https://github.com/django-playground) - Django in Pyodide
- [Inertia.js Protocol](https://inertiajs.com/the-protocol) - Full protocol spec
- [ASGI Specification](https://asgi.readthedocs.io/) - Async Server Gateway Interface
- [Pyodide Documentation](https://pyodide.org/en/stable/) - Python in WebAssembly
- [Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API) - MDN docs
