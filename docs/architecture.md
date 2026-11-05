# CrossInertia Playground Architecture

**Phase 0 / real-library milestone** technical documentation. See [milestone evidence and the unreleased upstream dependency](./real-cross-inertia.md) before building or deploying this branch. Future-phase sections below are plans, not implemented features.

## Overview

The CrossInertia Playground runs Python web applications entirely in the browser by combining:
1. **Service Workers** — Intercept HTTP requests
2. **Pyodide** — Python interpreter compiled to WebAssembly
3. **ASGI/WSGI bridges** — Adapt browser requests to Python frameworks
4. **Inertia.js client** — Real Inertia protocol implementation

No backend server is required. All HTTP requests, Python execution, and rendering happen client-side.

## Architecture Layers

```text
Shell (main thread)
  ├── owns Python Web Worker (Pyodide + FastAPI + CrossInertia)
  └── hosts preview iframe (/preview/*)
           │ browser fetch
           ▼
Browser Service Worker
  ├── virtual cookie jar
  └── BroadcastChannel → shell → MessageChannel → Python worker
                                                  │
                                    ASGI scope with root_path=/preview
                                                  │
                                    FastAPI /counter route
                                                  │
                                    CrossInertia renderer
                                      ├── VFS manifest + Jinja template
                                      └── real Inertia JSON / HTML
```

The Python VFS includes `/asgi_bridge.py`, `/browser_inertia.py`, and the
counter app/template/manifest/ESM/CSS files under `/examples/counter/`.
Those contents come from the actual repository files through raw imports.

## Request Flow (Counter Example)

### Initial page load

1. The shell registers the Service Worker and waits for page control.
2. It initializes Pyodide, installs the real upstream candidate wheel and direct dependency pins, writes the example VFS, and imports/validates the starter.
3. Only after success does it navigate the iframe to `/preview/`.
4. The Service Worker forwards the full request URL with `rootPath: "/preview"`.
5. The ASGI scope retains `path=/preview/counter` and `root_path=/preview`. FastAPI matches the unprefixed `/counter` route.
6. The route calls `get_inertia(request, response).render("Counter", {"count": counter_value})`.
7. CrossInertia reads the VFS manifest and renders the real Jinja `inertia_head()` / `inertia_body()` helpers.
8. Its template-generated `/preview/static/build/assets/app.js` and `app.css` requests travel through the same bridge and are served from the VFS.

### Form submission

1. The real Inertia React client POSTs JSON to `/preview/counter`.
2. FastAPI validates the action and updates the in-memory Python count.
3. A 303 redirect targets `request.url_for("get_counter")`, preserving `/preview/counter`.
4. Inertia follows the redirect with `X-Inertia: true`.
5. CrossInertia returns the actual page JSON, including its manifest-derived asset version and validation error props.
6. The browser client renders the new count without reloading the Python worker.

Version conflicts, partial reload filtering, and initial HTML rendering are
library behavior, not locally reimplemented protocol code.

## Key Components

### Service Worker (sw.ts)

**Purpose**: HTTP interception layer

**Responsibilities:**
- Intercept `fetch` events for `/preview/*` URLs
- Preserve the full URL and send `/preview` as the ASGI mount prefix
- Manage virtual cookie jar:
  - Extract `Set-Cookie` from Python responses
  - Inject `Cookie` header into subsequent requests
- Communicate through BroadcastChannel to the shell, then MessageChannel to its Python Worker
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

The counter uses the real `cross_inertia.fastapi` renderer. Its Vite-shaped
manifest maps `frontend/app.js` to `assets/app.js` and `assets/app.css`.
The fixed ESM/CSS sources are mapped into the VFS; React/Inertia use pinned CDN
imports. Dynamic esbuild-wasm compilation is not implemented yet.

`BrowserInertiaResponse` inherits rendering unchanged and only forces
production-mode detection, provides an explicit Vite URL to avoid port scans,
and disables SSR. An explicit upstream runtime-mode option should eventually
replace that subclass.

Published 0.22.1 cannot render these plain props inside Pyodide's running event
loop without attempting to start a thread. This branch therefore builds the
exact upstream PR #146 candidate recorded in `packages/starters/runtime.json`.
No CrossInertia source patch or fake-library fallback is applied here.

See [real CrossInertia milestone](./real-cross-inertia.md) for the regression
evidence, remaining async-prop limitations, and release prerequisite.

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

## Deployment

**Candidate dependency warning:** this branch uses an unreleased upstream wheel. Normal `bun run deploy` is blocked; first release upstream PR #146 and switch to the published pin. See [milestone details](./real-cross-inertia.md). Local builds and Wrangler dry-runs remain available.

### Cloudflare Workers Static Assets

From the repository root:

```bash
bun install --frozen-lockfile
bunx wrangler whoami # Or bunx wrangler login if not authenticated
bun run deploy
```

`bun run deploy` builds the shell, then publishes its static assets using
`wrangler.jsonc`. There is no Cloudflare Pages project or server-side Worker
script. The browser Service Worker handles `/preview/` after registration;
opening that path without an active Service Worker returns a 404, not the shell.

### Build Output

```
apps/shell/dist/
├── index.html                    # Shell
├── sw.js                         # Bundled runner Service Worker, scope /
└── assets/
    ├── main-[hash].js            # Shell JS and counter files
    ├── python-worker-[hash].js   # Python Worker
    └── asgi-bridge-[hash].py      # Python ASGI adapter
```

Pyodide's WASM runtime and Python packages are downloaded from external CDNs
and PyPI at runtime; they are not part of the static asset upload.

### Cloudflare Configuration

`wrangler.jsonc` targets account `8a22aaadda6af656a4fe3835b90450dd` and Worker
`play-usecross-dev`, with assets from `apps/shell/dist`. It keeps the
`workers.dev` endpoint and binds only the custom domain `play.usecross.dev`.
Deploying can create that hostname's DNS record in the `usecross.dev` zone.
Do not change DNS for `auth`, `docs`, or `inertia.usecross.dev`.

Run only one production build/deploy at a time, and do not rebuild
`apps/shell/dist` while Wrangler is uploading it. Wait for any earlier deploy
to finish before publishing a newer revision. These are manual constraints,
not enforced by the deploy script; future CI must serialize production
deployments across revisions.

Before publishing, run `bun run build` and `bunx wrangler deploy --dry-run`.
After publishing, verify the shell and `/sw.js` over HTTPS, then open a fresh
browser session and check that Python initializes and the counter increments
and decrements. An HTTP-only check of the shell does not exercise the ASGI bridge.

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
