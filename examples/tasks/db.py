"""The app's data: tasks in SQLite.

PLAYGROUND_DATA_DIR is the playground's /data folder, which your browser
keeps, so tasks survive a reload.
"""

import os
import sqlite3
from contextlib import closing
from pathlib import Path

DATABASE = Path(os.environ.get("PLAYGROUND_DATA_DIR", ".")) / "tasks.sqlite3"

FILTERS = {
    "all": "",
    "open": "WHERE done = 0",
    "done": "WHERE done = 1",
}


def connect() -> sqlite3.Connection:
    db = sqlite3.connect(DATABASE)
    db.row_factory = sqlite3.Row
    return db


# A new database starts with a few tasks to try.
with closing(connect()) as db, db:
    if db.execute("PRAGMA user_version").fetchone()[0] == 0:
        db.execute(
            "CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0)"
        )
        db.executemany(
            "INSERT INTO tasks (title, done) VALUES (?, ?)",
            [("Open the Stats page", 0), ("Add a task", 0), ("Edit app.py", 0), ("Run FastAPI in the browser", 1)],
        )
        db.execute("PRAGMA user_version = 1")


def list_tasks(filter: str = "all") -> list[dict]:
    with closing(connect()) as db:
        rows = db.execute(f"SELECT * FROM tasks {FILTERS[filter]} ORDER BY done, id DESC")
        return [{**row, "done": bool(row["done"])} for row in rows]


def get_task(task_id: int) -> dict | None:
    with closing(connect()) as db:
        row = db.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        return {**row, "done": bool(row["done"])} if row else None


def add_task(title: str) -> None:
    with closing(connect()) as db, db:
        db.execute("INSERT INTO tasks (title) VALUES (?)", (title,))


def update_task(task_id: int, *, title: str | None = None, done: bool | None = None) -> None:
    with closing(connect()) as db, db:
        if title is not None:
            db.execute("UPDATE tasks SET title = ? WHERE id = ?", (title, task_id))
        if done is not None:
            db.execute("UPDATE tasks SET done = ? WHERE id = ?", (done, task_id))


def delete_task(task_id: int) -> None:
    with closing(connect()) as db, db:
        db.execute("DELETE FROM tasks WHERE id = ?", (task_id,))


def counts() -> dict[str, int]:
    with closing(connect()) as db:
        total, done = db.execute("SELECT COUNT(*), COALESCE(SUM(done), 0) FROM tasks").fetchone()
        return {"total": total, "open": total - done, "done": done}
