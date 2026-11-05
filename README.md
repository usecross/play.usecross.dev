# CrossInertia Playground

An in-browser playground for [CrossInertia](https://github.com/usecross/cross-inertia): Python runs in Pyodide, with a browser Service Worker routing preview requests to a FastAPI ASGI app. There is no backend Python server.

- **Site:** [play.usecross.dev](https://play.usecross.dev)
- **Repository:** [usecross/play.usecross.dev](https://github.com/usecross/play.usecross.dev)

## Current milestone: real CrossInertia

The counter uses the actual CrossInertia renderer for HTML, page JSON, partial reloads, version conflicts, and manifest-generated JavaScript/CSS tags. The handwritten protocol helper and fake-library fallback have been removed.

> **Unreleased upstream dependency:** this branch requires [cross-inertia PR #146](https://github.com/usecross/cross-inertia/pull/146), pinned to commit `391eefd87055d2f9813c46fd58d0e2299460f19e`. Published CrossInertia 0.22.1 attempts to create a thread while resolving props inside an async route, which fails in Pyodide. Development/build commands build a wheel from that exact upstream source, with no local source patches. This is **not** the PyPI 0.22.1 wheel. Normal production deployment is blocked until the dependency is released and the pin is updated. The live site is still the previously deployed bridge demo.

See [the milestone notes](./docs/real-cross-inertia.md) for evidence, constraints, and the next steps.

### Working

- Real FastAPI → CrossInertia → HTML/JSON responses inside Pyodide
- Inertia React client: counter POST → 303 → GET → render
- ASGI `root_path`: redirects and Inertia URLs stay under `/preview/`
- Real Jinja template and Vite-shaped manifest resolving VFS JavaScript/CSS
- Visible initialization failures; no dependency stubs
- Preview reload (retains the current Python worker's in-memory count)

### Not implemented yet

- SQLite / IDBFS persistence: a **full page reload resets the count**
- Monaco and editable projects
- Dynamic esbuild-wasm bundling (the fixed ESM starter imports React/Inertia from pinned CDN URLs)
- Django/WSGI, SSR, WebSockets/SSE, or cross-origin runner isolation
- Async prop callbacks that need an event loop/thread bridge; this milestone uses plain props

## Quick start

### Prerequisites

- [Bun](https://bun.sh/) **1.4+** (the checked-in lockfile uses version 2)
- [uv](https://docs.astral.sh/uv/) and `tar` on `PATH` to build the pinned upstream wheel
- Internet access to GitHub, PyPI, jsDelivr, and esm.sh
- For Wrangler / deployment: **Node.js 22+** on `PATH`

```bash
bun install --frozen-lockfile
bun run dev
```

Open http://localhost:3000. The preview stays blank until the Service Worker controls the page and the real Python package and starter are initialized.

`bun run dev` and `bun run build` first run `bun run prepare:runtime`. It downloads the immutable upstream archive, checks its SHA256 against `packages/starters/runtime.json`, and builds a pure-Python wheel with `uv`. Generated wheels live in ignored `apps/shell/public/wheels/`; a cached wheel is reused only when its source metadata and file hash match. No wheel binary is committed.

### Tests

```bash
bun run typecheck
bun run test:python       # Python 3.12; uv installs it if needed
bun run test:install      # First time: install Playwright Chromium
bun run test             # Vite development server
bun run test:production  # Built assets on Wrangler's local runtime
```

To use an installed Chrome locally instead of Playwright's bundled Chromium:

```bash
PLAYWRIGHT_CHANNEL=chrome bun run test
PLAYWRIGHT_CHANNEL=chrome bun run test:production
```

Tests verify:

- Real CrossInertia rendering with thread creation, Vite probes, and port scans forbidden
- Manifest-derived asset version and JS/CSS delivery through the Python VFS
- Counter increment, decrement (including negative counts), reset, and preview reload
- Mount-prefix preservation, partial reload filtering, version conflicts, and invalid input
- A failed wheel download produces a visible error and never a fake successful preview

CI runs the native regression test and both browser configurations.

## Project structure

```text
apps/shell/                      Vite shell, SW entry, preview host
packages/runner/
  sw.ts                          Browser fetch interception and virtual cookies
  python-worker.ts               Pyodide installation, VFS, serialized requests
  asgi-bridge.py                  HTTP → ASGI adapter
  browser_inertia.py              Runtime-mode shim, not a protocol implementation
  counter-files.ts                Imports actual example files as raw VFS contents
packages/starters/
  runtime.json                   Exact upstream revision / archive hash / Pyodide version
  requirements.txt               Direct Python dependency pins
packages/bundler/                Future in-browser bundler (stub)
examples/counter/
  app.py                         Real CrossInertia + FastAPI routes
  templates/app.html             inertia_head() / inertia_body()
  frontend/app.js                 Fixed browser-native ESM starter
  frontend/app.css                Starter styles
  static/build/.vite/manifest.json
scripts/                         Candidate wheel preparation, tests, deployment guard
```

The example files are the source of truth—there is no second copy embedded inside TypeScript. The ESM/CSS sources are mapped to build paths inside Pyodide's VFS until dynamic bundling is implemented.

## Request flow

```text
Preview request: /preview/counter
  → Service Worker
  → BroadcastChannel to shell
  → MessageChannel to Python worker
  → ASGI scope: path=/preview/counter, root_path=/preview
  → FastAPI route /counter
  → CrossInertia's real renderer / manifest / Jinja template
  → Response back through the bridge to the browser
```

`BrowserInertiaResponse` subclasses the published response class only to force production mode without an HTTP probe, avoid automatic socket-based port selection, and disable SSR. Rendering is inherited unchanged. The starter calls the library's dependency from an async route to avoid FastAPI's sync-dependency thread pool. See [architecture](./docs/architecture.md) and [milestone details](./docs/real-cross-inertia.md).

## Deployment

Hosting uses Cloudflare **Workers Static Assets**, not Pages:

- Config: `wrangler.jsonc`
- Worker: `play-usecross-dev`
- Assets: `apps/shell/dist`
- Custom domain: `play.usecross.dev`
- Fallback: `play-usecross-dev.patrick-arminio.workers.dev`

```bash
bunx wrangler whoami
bun run build
bunx wrangler deploy --dry-run
```

**`bun run deploy` is intentionally blocked while this branch uses an unreleased upstream candidate.** Merge/release PR #146, switch to its published wheel, and remove the temporary candidate build/guard before normal deployment. For a separately approved candidate deployment only, the explicit override is `CROSS_INERTIA_ALLOW_UNRELEASED=1 bun run deploy`.

Wrangler needs credentials (`CLOUDFLARE_API_TOKEN` or `bunx wrangler login`) for account `8a22aaadda6af656a4fe3835b90450dd`. Do not change DNS for `auth`, `docs`, or `inertia.usecross.dev`.

Run one production build/deploy at a time across all checkouts. Do not rebuild `apps/shell/dist` during an upload or allow an older deployment to publish after a newer one. Future deployment CI must enforce serialization.

## Scope and roadmap

1. Release the proven upstream thread-resolution fix and replace the candidate pin.
2. Add an explicit upstream runtime-mode option, then remove the browser mode subclass.
3. Add SQLite + IDBFS with a persistence-after-full-reload acceptance test.
4. Add Monaco and dynamic frontend bundling.
5. Expand framework support and harden runner isolation.

Cross-Auth playgrounds are outside this repository's current scope.

## References

- [CrossInertia](https://github.com/usecross/cross-inertia)
- [Inertia.js](https://inertiajs.com/)
- [Pyodide](https://pyodide.org/)
- [Simon Willison's Pyodide/ASGI experiment](https://simonwillison.net/2024/May/21/pyodide-asgi-browser/)

## License

MIT
