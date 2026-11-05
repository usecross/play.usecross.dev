# CrossInertia Playground

**Phase 0** — Proof of concept for running CrossInertia applications entirely in the browser using Service Workers and Pyodide.

🌐 **Site**: [play.usecross.dev](https://play.usecross.dev)  
📦 **Repo**: [github.com/usecross/play.usecross.dev](https://github.com/usecross/play.usecross.dev)

## What is this?

An in-browser playground for experimenting with [CrossInertia](https://github.com/usecross/cross-inertia) — the Python implementation of the Inertia.js protocol for FastAPI, Django, and Litestar.

**Key innovation**: Python applications run entirely in the browser via Pyodide (Python in WebAssembly), with a Service Worker intercepting HTTP requests and routing them to a Python ASGI/WSGI application. No backend server required.

## Phase 0 Status

✅ **Complete:**
- Service Worker + Pyodide ASGI bridge architecture
- FastAPI + CrossInertia counter example
- Full Inertia form POST → 303 redirect → render cycle
- Virtual cookie jar for session management
- Synthetic Vite manifest for CrossInertia asset resolution

🚧 **Phase 0 Limitations:**
- Counter uses in-memory state (resets on reload)
- React/Inertia loaded from CDN (inline components)
- No Monaco editor yet (fixed example only)
- esbuild-wasm bundler is stubbed

📋 **Next Phases:**
1. **Phase 1**: Monaco editor, dynamic bundling, IDBFS persistence
2. **Phase 2**: Django support, SQLite ORM, migrations
3. **Phase 3**: WebSockets, SSE, broadcasting, Litestar

## Quick Start

### Prerequisites
- [Bun](https://bun.sh/) >= 1.0.0

### Running Locally

```bash
# Install dependencies
bun install

# Start development server
bun run dev
```

Open http://localhost:3000 to see the playground shell. The preview iframe at `/preview/` is intercepted by the Service Worker and routed to the Pyodide-powered Python application.

### Running Tests

Phase 0 includes lightweight smoke tests to catch build breaks:

```bash
# First time: Install Playwright browsers
npm run test:install

# Run smoke tests
npm test
```

Tests verify:
- Shell loads without Vite errors
- Service Worker registers successfully
- Preview iframe is present
- No critical console errors

### Try the Counter Example

The counter example demonstrates a complete Inertia.js flow:
1. Click **+** button → Inertia form POST to `/counter`
2. Service Worker intercepts → Routes to Pyodide
3. FastAPI handler increments counter in Python
4. Returns 303 redirect → Inertia follows
5. Renders updated counter value

All of this happens in-browser with no backend server.

## Project Structure

```
play.usecross.dev/
├── apps/
│   └── shell/              # Minimal playground shell (Phase 0)
│       ├── index.html      # Main UI with preview iframe
│       └── src/main.ts     # Service Worker registration
├── packages/
│   ├── runner/             # 🔥 Core runtime
│   │   ├── sw.ts           # Service Worker (HTTP interception)
│   │   ├── python-worker.ts # Pyodide worker
│   │   ├── asgi-bridge.py  # Python ASGI adapter
│   │   ├── wsgi-bridge.py  # Django WSGI adapter (stub)
│   │   ├── cookie-jar.ts   # Virtual cookie management
│   │   └── types.ts        # PythonFrameworkRuntime interface
│   ├── bundler/            # esbuild-wasm (Phase 1+, stub)
│   └── starters/           # Dependency notes
├── examples/
│   └── counter/            # 🎯 Phase 0 proof
│       ├── app.py          # FastAPI + CrossInertia routes
│       ├── templates/app.html # Inertia root template
│       ├── frontend/       # React components (source)
│       └── static/build/.vite/manifest.json # Synthetic manifest
├── wrangler.toml           # Cloudflare Pages placeholder
└── docs/
    └── architecture.md     # Technical architecture docs
```

## How It Works

See [`docs/architecture.md`](./docs/architecture.md) for full details. Quick overview:

### HTTP Request Flow

```
Browser request to /preview/counter
        ↓
Service Worker intercepts (sw.ts)
        ↓
MessageChannel → Python Worker (python-worker.ts)
        ↓
Pyodide loads & runs ASGI bridge (asgi-bridge.py)
        ↓
FastAPI app executes (examples/counter/app.py)
        ↓
Response flows back through SW → Browser
```

### Inertia Integration

CrossInertia expects a Vite dev server or manifest in production. Since we can't run Vite inside Pyodide, Phase 0 uses:
- **Synthetic manifest**: `static/build/.vite/manifest.json` in Pyodide VFS
- **Inline components**: React/Inertia in `app.html` template
- **Future**: esbuild-wasm will bundle components; SW serves from `/static/build/`

### Cookie Management

Service Workers can't read the `Cookie` header from intercepted requests. Solution:
- **cookie-jar.ts**: Virtual cookie store in the SW
- Parses `Set-Cookie` from Python responses
- Injects `Cookie` header into subsequent requests

## Development

### Workspace Structure

Bun workspaces for monorepo:
- `apps/shell` - Vite-powered playground UI
- `packages/runner` - Service Worker + Pyodide runtime
- `packages/bundler` - esbuild-wasm integration (Phase 1+)

```bash
# Install all workspaces
bun install

# Run shell dev server
bun run dev

# Build for production (Phase 1+)
bun run build
```

### Debugging

**Service Worker:**
```
Chrome/Edge: DevTools → Application → Service Workers
Firefox: about:debugging → This Firefox → Service Workers
```

**Python Worker:**
Check console logs prefixed with `[Python Worker]`.

**Pyodide Errors:**
Errors in Python execution are caught and returned as JSON with traceback.

## Deployment

Phase 0 is development-only. Deployment planned for Phase 1+ via Cloudflare Pages.

```bash
# When ready (Phase 1+)
bun run build
npx wrangler pages deploy dist
```

## Contributing

Phase 0 is a scaffold. Contributions welcome for:
- Improving ASGI bridge reliability
- Adding proper CrossInertia package detection
- SQLite + IDBFS persistence
- Monaco editor integration (Phase 1)

## Research & Prior Art

This project builds on:
- [Simon Willison's Pyodide ASGI browser experiment](https://simonwillison.net/2024/May/21/pyodide-asgi-browser/) — Service Worker + FastAPI pattern
- [Django Playground](https://github.com/django-playground) — Django in Pyodide reference
- Inertia.js v3.11+ Live Props — Future real-time integration target

## License

MIT

## Links

- [CrossInertia](https://github.com/usecross/cross-inertia) - Python Inertia.js implementation
- [Inertia.js](https://inertiajs.com/) - The Inertia protocol
- [Pyodide](https://pyodide.org/) - Python in the browser
- [FastAPI](https://fastapi.tiangolo.com/) - Modern Python web framework
