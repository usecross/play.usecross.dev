"""Real CrossInertia + FastAPI running in Pyodide.

State is intentionally in-memory in this milestone. SQLite/IDBFS follows later.
All routes are async: Pyodide cannot run Starlette's thread-pool file handlers
or FastAPI's synchronous dependencies.
"""

import mimetypes
from pathlib import Path
from typing import Literal

import cross_inertia
from browser_inertia import BrowserInertiaResponse
from cross_inertia.fastapi import get_inertia
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel
from starlette.responses import RedirectResponse, Response

BASE_DIR = Path(__file__).resolve().parent
BUILD_DIR = BASE_DIR / "static" / "build"

response = BrowserInertiaResponse(
    template_dir=str(BASE_DIR / "templates"),
    manifest_path=str(BUILD_DIR / ".vite" / "manifest.json"),
    vite_entry="frontend/app.js",
    asset_url_prefix="/preview/static/build",
)

app = FastAPI()
counter_value = 0


class CounterAction(BaseModel):
    action: Literal["increment", "decrement", "reset"]


@app.get("/")
async def index(request: Request) -> RedirectResponse:
    return RedirectResponse(request.url_for("get_counter"), status_code=303)


@app.get("/counter")
async def get_counter(request: Request) -> Response:
    # Call the published dependency directly inside an async route, avoiding
    # FastAPI's thread-pool dispatch for synchronous dependencies.
    inertia = get_inertia(request, response)
    return inertia.render("Counter", {"count": counter_value})


@app.post("/counter")
async def post_counter(request: Request, body: CounterAction) -> RedirectResponse:
    global counter_value

    if body.action == "increment":
        counter_value += 1
    elif body.action == "decrement":
        counter_value -= 1
    else:
        counter_value = 0

    return RedirectResponse(request.url_for("get_counter"), status_code=303)


@app.get("/static/build/{path:path}")
async def serve_static(path: str) -> Response:
    # StaticFiles/FileResponse use threads. VFS reads are synchronous and local.
    # Expose only built assets, not the manifest or arbitrary example sources.
    asset_root = BUILD_DIR / "assets"
    asset = (BUILD_DIR / path).resolve()
    if not asset.is_relative_to(asset_root) or not asset.is_file():
        raise HTTPException(status_code=404)
    return Response(
        asset.read_bytes(),
        media_type=mimetypes.guess_type(asset.name)[0] or "application/octet-stream",
    )


@app.get("/health")
async def health() -> dict[str, object]:
    return {
        "status": "ok",
        "counter": counter_value,
        "cross_inertia_version": cross_inertia.__version__,
        "response_class": f"{type(response).__module__}.{type(response).__name__}",
    }
