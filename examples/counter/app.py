"""Real CrossInertia + FastAPI running in Pyodide.

The count lives in SQLite under PLAYGROUND_DATA_DIR, which the playground
persists to IndexedDB, so it survives a full page reload.
All routes are async: Pyodide cannot run Starlette's thread-pool file handlers
or FastAPI's synchronous dependencies.
"""

import mimetypes
import os
import sqlite3
from contextlib import closing
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
DATABASE = Path(os.environ.get("PLAYGROUND_DATA_DIR", BASE_DIR)) / "counter.sqlite3"

response = BrowserInertiaResponse(
    template_dir=str(BASE_DIR / "templates"),
    manifest_path=str(BUILD_DIR / ".vite" / "manifest.json"),
    vite_entry="frontend/app.js",
)

app = FastAPI()

UPDATES = {
    "increment": "UPDATE counter SET value = value + 1",
    "decrement": "UPDATE counter SET value = value - 1",
    "reset": "UPDATE counter SET value = 0",
}


def connect() -> sqlite3.Connection:
    return sqlite3.connect(DATABASE)


with closing(connect()) as db, db:
    db.execute("CREATE TABLE IF NOT EXISTS counter (value INTEGER NOT NULL)")
    db.execute("INSERT INTO counter SELECT 0 WHERE NOT EXISTS (SELECT 1 FROM counter)")


def read_count() -> int:
    with closing(connect()) as db:
        return db.execute("SELECT value FROM counter").fetchone()[0]


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
    return inertia.render("Counter", {"count": read_count()})


@app.post("/counter")
async def post_counter(request: Request, body: CounterAction) -> RedirectResponse:
    with closing(connect()) as db, db:
        db.execute(UPDATES[body.action])

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
        "counter": read_count(),
        "cross_inertia_version": cross_inertia.__version__,
        "response_class": f"{type(response).__module__}.{type(response).__name__}",
    }
