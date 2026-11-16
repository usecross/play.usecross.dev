"""A FastAPI + CrossInertia counter.

The count lives in SQLite under PLAYGROUND_DATA_DIR, which the playground
persists to IndexedDB, so it survives a full page reload.
"""

import os
import sqlite3
from contextlib import closing
from pathlib import Path
from typing import Literal

import cross_inertia
from cross_inertia.fastapi import InertiaDep
from fastapi import FastAPI, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

DATABASE = Path(os.environ.get("PLAYGROUND_DATA_DIR", ".")) / "counter.sqlite3"

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
def index(request: Request) -> RedirectResponse:
    return RedirectResponse(request.url_for("get_counter"), status_code=303)


@app.get("/counter")
def get_counter(inertia: InertiaDep):
    return inertia.render("Counter", {"count": read_count()})


@app.post("/counter")
def post_counter(request: Request, body: CounterAction) -> RedirectResponse:
    with closing(connect()) as db, db:
        db.execute(UPDATES[body.action])

    return RedirectResponse(request.url_for("get_counter"), status_code=303)


@app.get("/health")
def health() -> dict[str, object]:
    return {
        "status": "ok",
        "counter": read_count(),
        "cross_inertia_version": cross_inertia.__version__,
    }


# The frontend build: hashed JavaScript and CSS under static/build.
app.frontend("/static", directory="static", fallback=None)
