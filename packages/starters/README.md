# Starter runtime dependencies

The current starter is the fixed FastAPI/React counter in `examples/counter/`.

- `runtime.json` pins Pyodide.
- The starter's own `examples/counter/pyproject.toml` pins its direct Python dependencies, including `cross-inertia==0.22.2`. This is not a full transitive lockfile. The Python worker reads it from the VFS with `tomllib` and installs the list with micropip; `bun run test:python` passes the same list to `uv`.
- Pyodide provides the WASM-compatible `pydantic_core` and MarkupSafe builds.
- React 19.3.1 and Inertia React 3.11.0 are pinned CDN imports in the real Jinja template.
- The fixed browser-native ESM/CSS sources are mapped to Vite-shaped VFS build paths. There is no dynamic frontend bundler yet.

CrossInertia 0.22.1 and earlier try to create a thread during prop resolution and fail in Pyodide; 0.22.2 is the minimum. micropip installs every pin from PyPI. Dependency failures stop initialization; no fake library is substituted.

See [milestone notes](../../docs/real-cross-inertia.md) for compatibility evidence and deployment restrictions. SQLite/IDBFS, editor templates, additional frameworks, and dynamic bundling are later milestones.
