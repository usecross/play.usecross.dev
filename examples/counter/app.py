"""
Counter Example - FastAPI + CrossInertia

Phase 0 proof: Full HTTP cycle with Inertia protocol
- GET /counter -> render Counter page
- POST /counter -> increment -> 303 redirect
- Demonstrates real ASGI request/response through Pyodide

Phase 0 note: SQLite persistence in-memory for now
Phase 1+: IDBFS for persistence across reloads
"""

from fastapi import FastAPI, Form, Request
from fastapi.responses import RedirectResponse, HTMLResponse
from fastapi.templating import Jinja2Templates
from pathlib import Path
import json

app = FastAPI()

# In-memory counter (Phase 0)
# Phase 1+: SQLite with IDBFS persistence
counter_value = 0

# Templates
templates = Jinja2Templates(directory="templates")


def is_inertia_request(request: Request) -> bool:
    """Check if request is an Inertia request"""
    return request.headers.get("x-inertia") == "true"


def inertia_response(request: Request, component: str, props: dict):
    """Build an Inertia response"""
    url = str(request.url)
    
    if is_inertia_request(request):
        # Inertia JSON response
        page_data = {
            "component": component,
            "props": props,
            "url": url,
            "version": "1",
        }
        return HTMLResponse(
            content=json.dumps(page_data),
            headers={
                "X-Inertia": "true",
                "Content-Type": "application/json",
            }
        )
    else:
        # Initial HTML response with Inertia root
        page_data = {
            "component": component,
            "props": props,
            "url": url,
            "version": "1",
        }
        return templates.TemplateResponse(
            "app.html",
            {
                "request": request,
                "page": json.dumps(page_data),
            }
        )


@app.get("/")
async def index(request: Request):
    """Root redirects to counter"""
    return RedirectResponse("/counter", status_code=303)


@app.get("/counter")
async def get_counter(request: Request):
    """Display counter page"""
    global counter_value
    
    return inertia_response(
        request,
        "Counter",
        {
            "count": counter_value,
        }
    )


@app.post("/counter")
async def post_counter(request: Request, action: str = Form(...)):
    """
    Handle counter actions
    POST with action=increment or action=decrement
    """
    global counter_value
    
    if action == "increment":
        counter_value += 1
    elif action == "decrement":
        counter_value -= 1
    elif action == "reset":
        counter_value = 0
    
    # Inertia POST -> 303 redirect pattern
    return RedirectResponse("/counter", status_code=303)


@app.get("/static/build/{path:path}")
async def serve_static(path: str):
    """
    Serve static assets
    
    Phase 0: Direct serve from virtual FS
    The synthetic Vite manifest points to these files
    """
    # This will be intercepted by SW or served from VFS
    # For Phase 0, assets may be CDN links or inline
    return HTMLResponse("Static asset: " + path, status_code=404)


# Health check
@app.get("/health")
async def health():
    return {"status": "ok", "counter": counter_value}
