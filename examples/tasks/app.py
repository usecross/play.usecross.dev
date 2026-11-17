"""A small task list built with FastAPI and CrossInertia.

Each route renders a React page from frontend/pages/ with props from Python.
Forms post back, and the routes redirect after a change, as Inertia apps do.
"""

import time

import cross_inertia
import db
from cross_inertia import always, defer, optional
from cross_inertia.fastapi import InertiaDep, inertia_exception_handlers, inertia_share
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, field_validator
from starlette.middleware.sessions import SessionMiddleware


@inertia_share
def shared_props(request: Request):
    """Props every page gets, such as the layout's open-task count."""
    return {
        # The path the app is served under: /preview in the playground.
        "root_path": request.scope.get("root_path", ""),
        "counts": db.counts,
        # Read once, then gone. always() keeps it in partial reloads too.
        "flash": always(request.session.pop, "flash", None),
    }


app = FastAPI(
    dependencies=[Depends(shared_props)],
    # Invalid form data redirects back with `errors` instead of returning a 422.
    exception_handlers=inertia_exception_handlers(),
)
# The session cookie carries flash messages and validation errors across a redirect.
app.add_middleware(SessionMiddleware, secret_key="playground-only-not-a-secret")


class TaskForm(BaseModel):
    title: str
    done: bool = False

    @field_validator("title")
    @classmethod
    def check_title(cls, title: str) -> str:
        title = title.strip()
        if not title:
            raise ValueError("Give the task a title.")
        if len(title) > 80:
            raise ValueError("Keep the title under 80 characters.")
        return title


def back(request: Request) -> RedirectResponse:
    """Redirect to the page the form was on."""
    return RedirectResponse(request.headers.get("referer") or request.url_for("list_tasks"), status_code=303)


def find_task(task_id: int) -> dict:
    task = db.get_task(task_id)
    if task is None:
        raise HTTPException(404, "No such task")
    return task


@app.get("/")
def index(request: Request) -> RedirectResponse:
    return RedirectResponse(request.url_for("list_tasks"), status_code=303)


@app.get("/tasks")
def list_tasks(inertia: InertiaDep, filter: str = "all"):
    if filter not in db.FILTERS:
        filter = "all"
    return inertia.render("Tasks/Index", {"tasks": db.list_tasks(filter), "filter": filter})


@app.post("/tasks")
def add_task(request: Request, form: TaskForm) -> RedirectResponse:
    db.add_task(form.title)
    request.session["flash"] = "Task added."
    return back(request)


@app.post("/tasks/{task_id}/toggle")
def toggle_task(request: Request, task_id: int) -> RedirectResponse:
    db.update_task(task_id, done=not find_task(task_id)["done"])
    return back(request)


@app.get("/tasks/{task_id}/edit")
def edit_task(inertia: InertiaDep, task_id: int):
    return inertia.render("Tasks/Edit", {"task": find_task(task_id)})


@app.put("/tasks/{task_id}")
def update_task(request: Request, task_id: int, form: TaskForm) -> RedirectResponse:
    find_task(task_id)
    db.update_task(task_id, title=form.title, done=form.done)
    request.session["flash"] = "Task saved."
    return RedirectResponse(request.url_for("list_tasks"), status_code=303)


@app.delete("/tasks/{task_id}")
def delete_task(request: Request, task_id: int) -> RedirectResponse:
    db.delete_task(find_task(task_id)["id"])
    request.session["flash"] = "Task deleted."
    return RedirectResponse(request.url_for("list_tasks"), status_code=303)


def slow_summary() -> dict:
    time.sleep(1)  # Stands in for a slow query.
    counts = db.counts()
    return {**counts, "percent_done": round(100 * counts["done"] / counts["total"]) if counts["total"] else 0}


@app.get("/stats")
def stats(inertia: InertiaDep):
    return inertia.render("Stats", {
        # Loaded by a second request after the page shows.
        "summary": defer(slow_summary),
        # Loaded only when the page asks for it.
        "done_tasks": optional(db.list_tasks, "done"),
    })


@app.get("/health")
def health() -> dict[str, object]:
    return {"status": "ok", "tasks": db.counts(), "cross_inertia_version": cross_inertia.__version__}


# The frontend build: hashed JavaScript and CSS under static/build.
app.frontend("/static", directory="static", fallback=None)
