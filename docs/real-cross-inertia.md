# Milestone 1: real CrossInertia in the browser

## Goal

Replace the old handwritten Inertia response helper with the real Python library, and prove its manifest/template/protocol paths in Pyodide before building an editor or persistence layer.

## Compatibility finding

The PyPI `cross-inertia==0.22.1` wheel installs and imports in Pyodide 0.27.8, but rendering inside an async FastAPI route fails with `RuntimeError: can't start new thread`. Its synchronous prop resolver starts a `ThreadPoolExecutor` when an event loop is already running—even for a plain integer counter prop.

Upstream [PR #146](https://github.com/usecross/cross-inertia/pull/146), released as **0.22.2**, resolves plain and sync props in the calling thread without a thread or event loop. The starter's `examples/counter/pyproject.toml` pins `cross-inertia==0.22.2` from PyPI, with no source patches.

Do not infer Pyodide support for async prop callbacks from the counter test: in an async route, a callback that returns a coroutine still needs a worker thread, so it needs an async rendering API upstream.

## What changed

- `examples/counter/app.py` calls `cross_inertia.fastapi.get_inertia()` and `inertia.render()`. There is no local page JSON/HTML renderer.
- `templates/app.html` uses the real `inertia_head()` / `inertia_body()` helpers.
- CrossInertia reads the actual VFS manifest, computes the asset version, and emits the starter's JS/CSS URLs.
- `counter-files.ts` imports the example files using Vite raw imports. Editing a Python/template/frontend file changes what runs in Pyodide; no second inline copy needs updating.
- The starter serves fixed ESM/CSS from the VFS. React and Inertia remain external, pinned imports; dynamic bundling is a separate milestone.
- The fake CrossInertia installation fallback is removed. Wheel/import/template/manifest failures stop initialization and surface the actual error in the shell.
- The preview stays blank and its reload button disabled until initialization succeeds.
- Only one tab runs Python at a time (a Web Lock). The Service Worker broadcasts preview requests to every shell tab and uses the first answer, so other tabs wait with an "open in another tab" status and take over when the active tab closes.
- The bridge preserves the full browser URL and sets ASGI `root_path=/preview`. The router matches `/counter`, while redirects and Inertia page URLs retain `/preview/counter`.

## Browser-specific integration

`packages/runner/browser_inertia.py` overrides **only runtime selection and the asset URL mount**:

1. An explicit Vite URL prevents config's automatic socket/port scan.
2. `is_dev_mode()` returns `False`, so there is no blocking HTTP probe.
3. SSR is disabled, so there are no SSR HTTP calls or subprocess expectations.
4. During each render, the asset URL prefix gets the request's ASGI `root_path` (`/preview`), which CrossInertia's fixed prefix ignores. The starter keeps CrossInertia's default `/static/build` and posts back to `usePage().url`, so its code contains no `/preview`.

All rendering, prop filtering, asset versioning, template helpers, and version-conflict handling are inherited from the real library. Future upstream support for an explicit production mode and for `root_path` in asset URLs should replace this small subclass; an AssetProvider abstraction is not required for this milestone.

All starter routes are async. It calls CrossInertia's synchronous dependency directly within the async route instead of asking FastAPI to execute a sync dependency in a thread pool. Static assets use synchronous VFS reads in an async route, rather than Starlette's thread-based `StaticFiles`/`FileResponse`. The asset endpoint exposes only files under the built `assets/` directory.

## Evidence and regression tests

```bash
bun run typecheck
bun run test:python
bun run test
bun run test:production
```

The native test forbids `threading.Thread.start`, `httpx.get`, and automatic Vite port discovery while calling the real renderer for JSON and HTML. **It fails against PyPI 0.22.1 and passes against 0.22.2.**

Browser tests run against both Vite development serving and built assets on Wrangler's local static-assets runtime. They check:

- Python initialization and real library version/class
- CrossInertia's manifest-derived version and template-generated JS/CSS URLs
- ESM and CSS bytes actually served through the Python VFS
- Counter increment/decrement/reset and retained state on preview-only reload
- `/preview/` prefix preserved through redirects and client navigation
- Partial reload filtering, 409 version conflicts, invalid-action 422, and asset 404s
- A blocked wheel download causes initialization failure, with no preview/stub fallback

The previously always-passing debug specs were replaced by assertions on these behaviors.

## Deliberately not done

- The counter was a Python global, reset by a full reload. SQLite in IndexedDB replaced it in the next milestone; see [State Persistence](./architecture.md#state-persistence).
- No Monaco, dynamic TSX bundler, Django, SSR, or origin-isolation work is included.

## Next checkpoints

1. Add explicit runtime selection upstream and remove the browser mode subclass.
2. ~~Add SQLite + IDBFS~~ Done: see [State Persistence](./architecture.md#state-persistence).
3. Add editor and dynamic bundling on top of the now-proven library integration.
