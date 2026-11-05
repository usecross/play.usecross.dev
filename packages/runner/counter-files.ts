/**
 * Counter Example Files for Virtual Filesystem
 * 
 * These files are loaded into Pyodide's virtual filesystem
 * before the first HTTP request.
 */

import type { VirtualFileSystem } from './types';

// Import the counter app files as strings
// In a real build, these would be loaded dynamically or from the editor

export const counterFiles: VirtualFileSystem = {
  '/examples/counter/app.py': `"""
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
import json
import html

app = FastAPI()

# In-memory counter (Phase 0)
# Phase 1+: SQLite with IDBFS persistence
counter_value = 0


def is_inertia_request(request: Request) -> bool:
    """Check if request is an Inertia request"""
    return request.headers.get("x-inertia") == "true"


def inertia_response(request: Request, component: str, props: dict):
    """Build an Inertia response (HTMLResponse workaround for Pyodide)"""
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
        # Initial HTML response with inlined Inertia root
        # Using HTMLResponse instead of TemplateResponse due to Pyodide/Jinja2 compatibility
        page_data = {
            "component": component,
            "props": props,
            "url": url,
            "version": "1",
        }
        page_json = html.escape(json.dumps(page_data))
        
        html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Counter - CrossInertia Playground</title>
    <style>
        * {{
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }}
        
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 2rem;
        }}
        
        #app {{
            width: 100%;
            max-width: 600px;
        }}
    </style>
</head>
<body>
    <div id="app" data-page="{page_json}"></div>
    
    <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
    <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
    <script src="https://unpkg.com/@inertiajs/inertia@0.11.1/dist/index.umd.js"></script>
    <script src="https://unpkg.com/@inertiajs/inertia-react@0.8.1/dist/index.umd.js"></script>
    
    <script>
        const {{ createInertiaApp }} = window.InertiaReact;
        const {{ createElement: h }} = window.React;
        const {{ createRoot }} = window.ReactDOM;
        
        function Counter({{ count }}) {{
            const router = window.Inertia.Inertia;
            const [processing, setProcessing] = window.React.useState(false);
            
            const handleSubmit = (action) => (e) => {{
                e.preventDefault();
                setProcessing(true);
                
                router.post('/preview/counter', 
                    {{ action: action }},
                    {{
                        onFinish: () => setProcessing(false),
                        preserveState: false
                    }}
                );
            }};
            
            return h('div', {{
                style: {{
                    background: 'white',
                    borderRadius: '12px',
                    padding: '3rem',
                    boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
                    textAlign: 'center'
                }}
            }}, [
                h('h1', {{
                    key: 'title',
                    style: {{
                        fontSize: '2.5rem',
                        marginBottom: '1rem',
                        color: '#1a1a1a'
                    }}
                }}, 'Counter'),
                
                h('div', {{
                    key: 'count',
                    style: {{
                        fontSize: '4rem',
                        fontWeight: 'bold',
                        color: '#667eea',
                        margin: '2rem 0'
                    }}
                }}, count),
                
                h('div', {{
                    key: 'buttons',
                    style: {{
                        display: 'flex',
                        gap: '1rem',
                        justifyContent: 'center',
                        marginTop: '2rem'
                    }}
                }}, [
                    h('form', {{
                        key: 'dec',
                        onSubmit: handleSubmit('decrement')
                    }}, [
                        h('button', {{
                            key: 'btn',
                            type: 'submit',
                            disabled: processing,
                            style: {{
                                padding: '1rem 2rem',
                                fontSize: '1.25rem',
                                background: '#dc3545',
                                color: 'white',
                                border: 'none',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                fontWeight: '600',
                                transition: 'all 0.2s',
                                opacity: processing ? 0.6 : 1
                            }}
                        }}, '−')
                    ]),
                    
                    h('form', {{
                        key: 'inc',
                        onSubmit: handleSubmit('increment')
                    }}, [
                        h('button', {{
                            key: 'btn',
                            type: 'submit',
                            disabled: processing,
                            style: {{
                                padding: '1rem 2rem',
                                fontSize: '1.25rem',
                                background: '#667eea',
                                color: 'white',
                                border: 'none',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                fontWeight: '600',
                                transition: 'all 0.2s',
                                opacity: processing ? 0.6 : 1
                            }}
                        }}, '+')
                    ]),
                    
                    h('form', {{
                        key: 'reset',
                        onSubmit: handleSubmit('reset')
                    }}, [
                        h('button', {{
                            key: 'btn',
                            type: 'submit',
                            disabled: processing,
                            style: {{
                                padding: '1rem 2rem',
                                fontSize: '1rem',
                                background: '#6c757d',
                                color: 'white',
                                border: 'none',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                fontWeight: '600',
                                transition: 'all 0.2s',
                                opacity: processing ? 0.6 : 1
                            }}
                        }}, 'Reset')
                    ])
                ]),
                
                h('p', {{
                    key: 'note',
                    style: {{
                        marginTop: '2rem',
                        color: '#666',
                        fontSize: '0.875rem'
                    }}
                }}, 'Full Inertia POST → 303 → render via Pyodide ASGI')
            ]);
        }}
        
        const components = {{
            Counter: Counter
        }};
        
        createInertiaApp({{
            resolve: (name) => components[name],
            setup({{ el, App, props }}) {{
                createRoot(el).render(h(App, props));
            }},
        }});
    <\/script>
</body>
</html>"""
        
        return HTMLResponse(content=html_content)


@app.get("/")
async def index(request: Request):
    """Root redirects to counter (relative URL preserves prefix)"""
    return RedirectResponse("counter", status_code=303)


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
async def post_counter(request: Request):
    """
    Handle counter actions
    POST with JSON body {action: 'increment' | 'decrement' | 'reset'}
    """
    global counter_value
    
    # Parse JSON body
    body = await request.json()
    action = body.get("action")
    
    if action == "increment":
        counter_value += 1
    elif action == "decrement":
        counter_value -= 1
    elif action == "reset":
        counter_value = 0
    
    # Inertia POST -> 303 redirect pattern (relative URL)
    return RedirectResponse("counter", status_code=303)


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
`,

  '/examples/counter/templates/app.html': `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Counter - CrossInertia Playground</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 2rem;
        }
        
        #app {
            width: 100%;
            max-width: 600px;
        }
    </style>
</head>
<body>
    <div id="app" data-page="{{ page }}"></div>
    
    <!-- Phase 0: CDN React and Inertia for proof of concept -->
    <!-- Phase 1+: Bundled via esbuild-wasm -->
    <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
    <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
    <script src="https://unpkg.com/@inertiajs/react@1.2.0/dist/index.umd.js"></script>
    
    <script type="module">
        // Phase 0: Inline Counter component for simplicity
        // Phase 1+: Compiled from frontend/pages/Counter.tsx
        
        const { createInertiaApp } = window.InertiaReact;
        const { createElement: h } = window.React;
        const { createRoot } = window.ReactDOM;
        
        // Counter component
        function Counter({ count }) {
            const { useForm } = window.InertiaReact;
            
            const incrementForm = useForm({
                action: 'increment'
            });
            
            const decrementForm = useForm({
                action: 'decrement'
            });
            
            const resetForm = useForm({
                action: 'reset'
            });
            
            return h('div', {
                style: {
                    background: 'white',
                    borderRadius: '12px',
                    padding: '3rem',
                    boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
                    textAlign: 'center'
                }
            }, [
                h('h1', {
                    key: 'title',
                    style: {
                        fontSize: '2.5rem',
                        marginBottom: '1rem',
                        color: '#1a1a1a'
                    }
                }, 'Counter'),
                
                h('div', {
                    key: 'count',
                    style: {
                        fontSize: '4rem',
                        fontWeight: 'bold',
                        color: '#667eea',
                        margin: '2rem 0'
                    }
                }, count),
                
                h('div', {
                    key: 'buttons',
                    style: {
                        display: 'flex',
                        gap: '1rem',
                        justifyContent: 'center',
                        marginTop: '2rem'
                    }
                }, [
                    h('form', {
                        key: 'dec',
                        onSubmit: (e) => {
                            e.preventDefault();
                            decrementForm.post('/counter');
                        }
                    }, [
                        h('button', {
                            key: 'btn',
                            type: 'submit',
                            disabled: decrementForm.processing,
                            style: {
                                padding: '1rem 2rem',
                                fontSize: '1.25rem',
                                background: '#dc3545',
                                color: 'white',
                                border: 'none',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                fontWeight: '600',
                                transition: 'all 0.2s',
                                opacity: decrementForm.processing ? 0.6 : 1
                            }
                        }, '−')
                    ]),
                    
                    h('form', {
                        key: 'inc',
                        onSubmit: (e) => {
                            e.preventDefault();
                            incrementForm.post('/counter');
                        }
                    }, [
                        h('button', {
                            key: 'btn',
                            type: 'submit',
                            disabled: incrementForm.processing,
                            style: {
                                padding: '1rem 2rem',
                                fontSize: '1.25rem',
                                background: '#667eea',
                                color: 'white',
                                border: 'none',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                fontWeight: '600',
                                transition: 'all 0.2s',
                                opacity: incrementForm.processing ? 0.6 : 1
                            }
                        }, '+')
                    ]),
                    
                    h('form', {
                        key: 'reset',
                        onSubmit: (e) => {
                            e.preventDefault();
                            resetForm.post('/counter');
                        }
                    }, [
                        h('button', {
                            key: 'btn',
                            type: 'submit',
                            disabled: resetForm.processing,
                            style: {
                                padding: '1rem 2rem',
                                fontSize: '1rem',
                                background: '#6c757d',
                                color: 'white',
                                border: 'none',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                fontWeight: '600',
                                transition: 'all 0.2s',
                                opacity: resetForm.processing ? 0.6 : 1
                            }
                        }, 'Reset')
                    ])
                ]),
                
                h('p', {
                    key: 'note',
                    style: {
                        marginTop: '2rem',
                        color: '#666',
                        fontSize: '0.875rem'
                    }
                }, 'Phase 0: Full Inertia POST → 303 → render cycle via Pyodide')
            ]);
        }
        
        // Components map
        const components = {
            Counter: Counter
        };
        
        // Initialize Inertia app
        createInertiaApp({
            resolve: (name) => components[name],
            setup({ el, App, props }) {
                createRoot(el).render(h(App, props));
            },
        });
    </script>
</body>
</html>`,

  '/examples/counter/static/build/.vite/manifest.json': `{
  "frontend/app.tsx": {
    "file": "assets/app.js",
    "css": ["assets/app.css"]
  },
  "frontend/pages/Counter.tsx": {
    "file": "assets/Counter.js"
  }
}`,
};
