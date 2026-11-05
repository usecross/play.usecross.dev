# Starter runtime dependencies

The current starter is the fixed FastAPI/React counter in `examples/counter/`.

- `runtime.json` pins Pyodide and the exact upstream CrossInertia source revision/archive hash.
- `requirements.txt` pins direct Python dependencies. This is not a full transitive lockfile.
- Pyodide provides the WASM-compatible `pydantic_core` and MarkupSafe builds.
- React 19.3.1 and Inertia React 3.11.0 are pinned CDN imports in the real Jinja template.
- The fixed browser-native ESM/CSS sources are mapped to Vite-shaped VFS build paths. There is no dynamic frontend bundler yet.

**Temporary unreleased dependency:** the PyPI CrossInertia 0.22.1 wheel tries to create a thread during prop resolution and fails in Pyodide. We build unchanged upstream PR #146 at the revision recorded in `runtime.json`. The generated wheel reports the upstream source version but is not the published PyPI artifact. Replace this source pin with the next compatible published release.

`bun run prepare:runtime` downloads and checks the source archive, builds the wheel using `uv`, and caches it under ignored `apps/shell/public/wheels/`. No wheel binaries are committed. Dependency failures stop initialization; no fake library is substituted.

See [milestone notes](../../docs/real-cross-inertia.md) for compatibility evidence and deployment restrictions. SQLite/IDBFS, editor templates, additional frameworks, and dynamic bundling are later milestones.
