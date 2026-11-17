# CrossInertia Playground Architecture

**Phase 0 / real-library milestone** technical documentation. See [milestone evidence](./real-cross-inertia.md) for the CrossInertia compatibility findings. Future-phase sections below are plans, not implemented features.

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
                                    FastAPI /tasks route  
                                                  │
                                    CrossInertia renderer
                                      ├── VFS manifest + Jinja template
                                      └── real Inertia JSON / HTML
```

The Python VFS includes `/asgi_bridge.py`, `/browser_inertia.py`, and the
starter's Python modules, template and frontend build under `/examples/tasks/`.
Those contents come from the actual repository files, read at build time by
`packages/starters/index.ts`; the frontend build comes from esbuild (see [CrossInertia Integration](#crossinertia-integration)).

## Request Flow (Tasks Example)

### Initial page load

1. The shell registers the Service Worker and waits for page control.
2. It initializes Pyodide, writes the example VFS, installs the dependencies listed in the starter's `pyproject.toml` from PyPI, and imports/validates the starter.
3. Only after success does it navigate the iframe to `/preview/`.
4. The Service Worker forwards the full request URL with `rootPath: "/preview"`.
5. The ASGI scope retains `path=/preview/tasks` and `root_path=/preview`. FastAPI matches the unprefixed `/tasks` route.
6. The shared-props dependency adds the open-task count and any flash message, then the route calls `inertia.render("Tasks/Index", {"tasks": ..., "filter": ...})`, reading the tasks from SQLite.
7. CrossInertia reads the VFS manifest and renders the real Jinja `inertia_head()` / `inertia_body()` helpers.
8. Its template-generated `/preview/static/build/assets/app-[hash].js` and `.css` requests travel through the same bridge and are served from the VFS.

### Form submission

1. `useForm` POSTs JSON to `/preview/tasks`.
2. FastAPI validates it with a Pydantic model. Invalid data raises `RequestValidationError`; CrossInertia's handler stores the errors in the session and redirects back, and the next page gets them as its `errors` prop.
3. Valid data is saved in SQLite and a flash message in the session. The worker saves `/data` to IndexedDB before it answers.
4. A 303 redirect goes back to the page the form was on (the Service Worker passes the request's referrer on as `Referer`).
5. Inertia follows the redirect with `X-Inertia: true`, and CrossInertia returns the actual page JSON, including its manifest-derived asset version.
6. The browser client renders the new list and the flash message without reloading the Python worker.

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
    'path': '/tasks',
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
], 'http://localhost/tasks');
```

**On Request:**
```typescript
// Inject Cookie header before forwarding to Python
const cookieHeader = cookieJar.getCookieHeader('http://localhost/tasks');
// cookieHeader = "sessionid=abc123; csrftoken=xyz789"
```

**Cookie Matching:**
- Domain matching (exact + subdomain)
- Path prefix matching
- Expiration checking
- Secure flag (HTTPS only)
- SameSite (future)

## CrossInertia Integration

The starter uses the real `cross_inertia.fastapi` renderer. Its Vite-shaped
manifest maps `frontend/app.tsx` to hashed `assets/app-[hash].js` and `.css`
files. `bundleFrontend` in `packages/bundler` builds them with esbuild:

- It bundles `frontend/app.tsx` and the files it imports, such as `app.css`,
  from an in-memory map of sources, with the automatic JSX runtime.
- Package imports (`react`, `react/jsx-runtime`, `react-dom/client`,
  `@inertiajs/react`) stay external; the template's import map loads them from
  pinned CDN URLs. Other packages aren't available yet.
- It writes the manifest Vite would, so CrossInertia reads it unchanged. The
  asset version is an MD5 of the manifest, so a new bundle changes it, and an
  Inertia visit from an old page gets a 409 and reloads.

The same function runs twice. At deploy time, the shell's Vite plugin
(`virtual:starter-build`) bundles the starter with esbuild-wasm in Node, so a
first visit downloads no esbuild. After a frontend edit, the shell loads
esbuild-wasm (`packages/bundler/browser.ts`, in its own chunk and Web Worker),
bundles the edited files, and sends the output to Python with `apply-files`.
When the frontend matches the starter again, it sends the starter's own build.
Bundle errors show esbuild's message, with file, line and a code frame, and
the last working bundle keeps serving. Every apply sends all editable files,
and applies run one at a time in order, so a slow bundle can't land after a
later edit or reset: the preview always runs what the editor shows. If
esbuild-wasm fails to download, the next frontend edit tries again.

The starter uses `InertiaDep` and CrossInertia's default settings, run from
its own folder as `fastapi run` would. Before it loads, `browser_inertia.py`
forces production-mode detection, sets an explicit Vite port to avoid port
scans, and adds the request's ASGI `root_path` to asset URLs during each
render; rendering is unchanged. After each apply it drops CrossInertia's
cached renderer, which holds the manifest and Jinja environment, and checks
that a new one loads. Upstream support for an explicit runtime mode and for
`root_path` in asset URLs should eventually replace these settings.

Pyodide has no threads. Starlette and FastAPI run sync routes, sync
dependencies and file reads (`StaticFiles`, `app.frontend()`) through anyio's
thread pool, so the ASGI bridge runs that work inline. The worker handles one
request at a time and its files are in memory, so nothing waits on it.

CrossInertia 0.22.1 cannot render these plain props inside Pyodide's running
event loop without attempting to start a thread; 0.22.2 can, and is pinned in
`examples/tasks/pyproject.toml`. No CrossInertia source patch or
fake-library fallback is applied here.

See [real CrossInertia milestone](./real-cross-inertia.md) for the regression
evidence and remaining async-prop limitations.

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
| FastAPI | ASGI | Phase 0 ✅ | Working in the Tasks starter |
| Starlette | ASGI | Phase 0 ✅ | Same bridge as FastAPI |
| Django | WSGI | Phase 2 | Needs ORM, migrations, middleware |
| Litestar | ASGI | Phase 3 | Similar to FastAPI |
| Flask | WSGI | Later | Simple WSGI adapter |

**Django will need separate WSGI path:**
- Django's ASGI support assumes async threading (not available in Pyodide)
- WSGI is simpler for synchronous Django code
- wsgi-bridge.py will implement `django.core.handlers.wsgi.WSGIHandler`

## State Persistence

The starter keeps its data in SQLite. The Python worker mounts Emscripten's
IndexedDB filesystem (IDBFS) at `/data` and tells the app where it is:

```typescript
pyodide.FS.mkdirTree('/data');
pyodide.FS.mount(pyodide.FS.filesystems.IDBFS, {}, '/data');
await syncData(true);  // FS.syncfs(true): load the saved files from IndexedDB
// os.environ['PLAYGROUND_DATA_DIR'] = '/data', then import the app
```

```python
# examples/tasks/db.py
DATABASE = Path(os.environ.get("PLAYGROUND_DATA_DIR", ".")) / "tasks.sqlite3"
```

After every request, and before answering it, the worker runs
`FS.syncfs(false)` to save `/data` back to IndexedDB. A page reload right after
a response therefore keeps that change. Requests are already processed one at
a time, so syncs never overlap.

- **Only `/data` persists.** The example's code is written fresh from each
  deploy; its data survives deploys.
- **Scope:** IndexedDB is per browser profile and origin. Branch previews have
  their own origin, so their data is separate from the live site's.
- **One writer:** the single-tab Web Lock means only one worker uses the
  database. A waiting tab loads the saved data when it takes over.
- Pyodide ships `sqlite3` as a separate package; the worker loads it with
  `pyodide.loadPackage`.

**Code edits keep data.** Editing `app.py` or the template in the shell sends
an `apply-files` message to the worker. `apply_files` in the ASGI bridge writes
the files, drops `app` from `sys.modules`, and imports it again, checking the
manifest and template as initialization does. `/data` is untouched, so the
count survives. If the new code fails, it restores the previous files and
module, so the last working version keeps serving, and returns a traceback
trimmed to the starter's own files. Applies and preview requests share one
serial queue in the worker, and the worker never writes `.pyc` files, so a
fast re-edit can't load stale bytecode.

**Errors in the running preview show in the shell.** Code can bundle and
import fine and still fail in the browser. The Service Worker adds one inline
script to the start of `<head>` in every preview HTML response
(`packages/runner/preview-errors.ts`), the way Vite's dev server injects its
client; it must run before the page's own scripts, which a listener from the
shell can't. It posts the page's uncaught errors, unhandled rejections, and
failed script or stylesheet loads to the shell, which shows the first one
under the editor with the bundle's own stack frames. A new preview page clears
it. The Python app's response is otherwise unchanged.

**Dependency edits restart Python.** Python can't unload a package, so a
`pyproject.toml` edit doesn't apply on a pause. The shell shows **Restart
Python**, which starts a new worker with the edited `pyproject.toml` and the
other edits, while the running worker keeps serving:

1. The new worker loads Pyodide, `/data` and the dependencies, imports the
   app, and applies the edits. If any of that fails, the shell shows the
   error, drops the new worker, and the running one keeps serving.
2. Preview requests are held. The old worker answers a `reload-data` message
   after the requests before it, each of which saved `/data` to IndexedDB,
   and is then terminated.
3. The new worker loads `/data` again with `reload-data`, so writes made while
   it installed are kept, and preview requests go to it.

On page load the worker starts with the saved `pyproject.toml`. If that fails
to install, it starts with the starter's, shows the error, and keeps
**Restart Python** visible. **Reset to starter** restarts Python when the
running dependencies aren't the starter's.

**Edits are saved in the browser.** The shell keeps each edited file in
`localStorage` (key `play.usecross.dev:tasks-edits`), with a fingerprint of the
starter they were made against; a file edited back to the starter is dropped.
On the next load, the tab that owns the runtime applies the saved files with
`apply-files` before the preview first loads, so a waiting tab that takes over
gets the latest edits. If the starter changed in a deploy, the editor shows a
notice suggesting **Reset to starter**; saved edits that fail to apply show
their traceback while the starter keeps serving. Edits are small text, so
`localStorage` is enough; `/data` stays the app's own database.

- **Reset to starter** forgets the saved edits and applies the starter files.
  The data is kept.
- **Clear data** sends `clear-data`: the worker deletes everything in `/data`,
  re-imports the app so it recreates its tables, and syncs IndexedDB. The edits
  are kept.

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
❌ npm packages beyond the template's import map  
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
print(os.listdir('/examples/tasks'))
# ['app.py', 'db.py', 'pyproject.toml', 'templates', 'static']
```

## Deployment

### Cloudflare Workers Static Assets

Cloudflare Workers Builds deploys every push to `main` from GitHub and
uploads a preview version for other branches. See the
[README](../README.md#deployment) for its build settings.

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
    ├── main-[hash].js            # Shell JS and the starter's files
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

Workers Builds does not wait for the GitHub CI checks. To verify a deploy or
a preview, run the browser suite against it with `PLAYWRIGHT_BASE_URL`; an
HTTP-only check of the shell would not exercise the ASGI bridge.

## Next Steps

### Phase 1: Editor + Persistence
- [x] Read-only CodeMirror 6 view of the starter's files (`apps/shell/src/editor.ts`, loaded lazily)
- [x] Editing `app.py` and the template, with a Python reload that keeps `/data`
- [x] Saving edits in the browser, Reset to starter, and Clear data
- [x] Dependency edits, installed by restarting Python without losing data
- [x] IDBFS for SQLite persistence
- [x] esbuild-wasm for React bundling
- [x] Hot reload for Python code changes

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
