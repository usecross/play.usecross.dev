# Starters Package

Phase 0: Documentation for curated dependencies
Phase 1+: Actual starter templates and package manifests

## Python Packages (PyPI wheels for Pyodide)

### Core Framework Stack
- **fastapi** - FastAPI framework
- **starlette** - ASGI toolkit (FastAPI dependency)
- **pydantic** - Data validation (FastAPI dependency)
- **cross-inertia** - Inertia.js protocol for Python frameworks

### Database (Phase 2+)
- **sqlite3** - Built into Pyodide 314.0+
- No additional packages needed for SQLite

### Future Frameworks (Phase 3+)
- **django** - Django framework
- **litestar** - Litestar framework

## JavaScript/TypeScript Packages (npm)

### React Stack
- **react** @ ^18.3.0
- **react-dom** @ ^18.3.0
- **@types/react** @ ^18.3.0
- **@types/react-dom** @ ^18.3.0

### Inertia
- **@inertiajs/react** @ ^1.0.0 (or latest with Live Props support)

### Build Tools (Phase 1+)
- **esbuild-wasm** - In-browser bundling
- **typescript** - Type checking

### CSS (Phase 1+)
- TBD: Tailwind CSS or similar lightweight framework

## Phase 0 Approach

For Phase 0, we're using:
- CDN links for React + ReactDOM + Inertia (in counter example template)
- Published PyPI wheels loaded via micropip
- Inline components for simplicity

This avoids bundling complexity while proving the HTTP cycle.

## Phase 1+ Approach

Later phases will:
- Bundle React/Inertia/TypeScript with esbuild-wasm
- Support editable components via Monaco
- Provide starter templates for FastAPI, Django, Litestar
- Include pinned package versions for reproducibility
