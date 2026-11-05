# Milestone 1: real CrossInertia in the browser

## Goal

Replace the old handwritten Inertia response helper with the real Python library, and prove its manifest/template/protocol paths in Pyodide before building an editor or persistence layer.

## Compatibility finding

The PyPI `cross-inertia==0.22.1` wheel installs and imports in Pyodide 0.27.8, but rendering inside an async FastAPI route fails with `RuntimeError: can't start new thread`. Its synchronous prop resolver starts a `ThreadPoolExecutor` when an event loop is already running—even for a plain integer counter prop.

The existing upstream [PR #146](https://github.com/usecross/cross-inertia/pull/146), commit `391eefd87055d2f9813c46fd58d0e2299460f19e`, resolves plain/sync props without that thread. We test the unchanged upstream code by building a candidate wheel, not by patching CrossInertia or substituting a protocol implementation.

`packages/starters/runtime.json` records the exact source revision, archive SHA256, wheel path, and Pyodide version. `scripts/prepare-runtime.ts` verifies the archive and builds the wheel with `uv`. The wheel still reports upstream's source version `0.22.1`, but it is **not the wheel published on PyPI**. Its URL/provenance metadata identify the upstream candidate.

When PR #146 is released, replace this temporary source-wheel preparation with a published version pin and remove the deployment guard. Do not infer Pyodide support for arbitrary async prop callbacks from the counter test: callbacks returning coroutines may still require an async rendering API upstream.

## What changed

- `examples/counter/app.py` calls `cross_inertia.fastapi.get_inertia()` and `inertia.render()`. There is no local page JSON/HTML renderer.
- `templates/app.html` uses the real `inertia_head()` / `inertia_body()` helpers.
- CrossInertia reads the actual VFS manifest, computes the asset version, and emits the starter's JS/CSS URLs.
- `counter-files.ts` imports the example files using Vite raw imports. Editing a Python/template/frontend file changes what runs in Pyodide; no second inline copy needs updating.
- The starter serves fixed ESM/CSS from the VFS. React and Inertia remain external, pinned imports; dynamic bundling is a separate milestone.
- The fake CrossInertia installation fallback is removed. Wheel/import/template/manifest failures stop initialization and surface the actual error in the shell.
- The preview stays blank and its reload button disabled until initialization succeeds.
- The bridge preserves the full browser URL and sets ASGI `root_path=/preview`. The router matches `/counter`, while redirects and Inertia page URLs retain `/preview/counter`.

## Browser-specific integration

`packages/runner/browser_inertia.py` overrides **only runtime selection**:

1. An explicit Vite URL prevents config's automatic socket/port scan.
2. `is_dev_mode()` returns `False`, so there is no blocking HTTP probe.
3. SSR is disabled, so there are no SSR HTTP calls or subprocess expectations.

All rendering, prop filtering, asset versioning, template helpers, and version-conflict handling are inherited from the real library. A future upstream `dev_mode=False` option should replace this small subclass; an AssetProvider abstraction is not required for this milestone.

All starter routes are async. It calls CrossInertia's synchronous dependency directly within the async route instead of asking FastAPI to execute a sync dependency in a thread pool. Static assets use synchronous VFS reads in an async route, rather than Starlette's thread-based `StaticFiles`/`FileResponse`. The asset endpoint exposes only files under the built `assets/` directory.

## Evidence and regression tests

```bash
bun run typecheck
bun run test:python
bun run test
bun run test:production
```

The native test forbids `threading.Thread.start`, `httpx.get`, and automatic Vite port discovery while calling the real renderer for JSON and HTML. **It fails against the published PyPI 0.22.1 wheel and passes against the pinned PR #146 wheel.**

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

- No upstream PR was merged or published by this work.
- No candidate build was deployed to production. `bun run deploy` fails before building/uploading unless an explicit unreleased-runtime override is supplied.
- The counter is still a Python global. Preview-only reload retains it; full shell reload creates a new worker and resets it.
- No SQLite, IDBFS, Monaco, dynamic TSX bundler, Django, SSR, or origin-isolation work is included.

## Next checkpoints

1. Review/merge/release upstream PR #146, then pin its published release and rerun the same tests.
2. Add explicit runtime selection upstream and remove the browser mode subclass.
3. Add SQLite + IDBFS; test full-page reload persistence without mistaking in-memory worker reuse for persistence.
4. Add editor and dynamic bundling on top of the now-proven library integration.
