"""
ASGI Bridge for Pyodide

Adapts HTTP requests from the Service Worker to ASGI application calls.
Inspired by Simon Willison's pyodide-asgi-browser research.

Phase 0: Basic request/response cycle
Future phases: Streaming, WebSockets, proper lifespan
"""

import asyncio
import json
from typing import Dict, List, Any, Optional
from urllib.parse import urlparse, parse_qs, unquote


async def handle_http_request(request_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handle an HTTP request by invoking the ASGI application
    
    Args:
        request_data: Dictionary with method, url, headers, body
        
    Returns:
        Dictionary with status, headers, body
    """
    method = request_data['method']
    url = request_data['url']
    headers = request_data['headers']
    body_bytes = bytes(request_data['body']) if request_data.get('body') else b''
    
    # Parse URL
    parsed = urlparse(url)
    # Unquote path to handle URL-encoded characters properly
    path = unquote(parsed.path) if parsed.path else '/'
    query_string = parsed.query.encode('latin-1')
    
    # Determine default port based on scheme
    default_port = 443 if parsed.scheme == 'https' else 80
    
    # Build ASGI scope
    scope = {
        'type': 'http',
        'asgi': {'version': '3.0'},
        'http_version': '1.1',
        'method': method,
        'scheme': parsed.scheme or 'http',
        'path': path,
        'query_string': query_string,
        'root_path': request_data.get('rootPath', ''),
        'headers': _build_asgi_headers(headers),
        'server': tuple([parsed.hostname or 'localhost', parsed.port or default_port]),
    }
    
    # Response state
    response = {
        'status': 200,
        'headers': {},
        'body': b'',
    }
    
    # ASGI receive callable
    body_sent = False
    
    async def receive():
        nonlocal body_sent
        if not body_sent:
            body_sent = True
            return {
                'type': 'http.request',
                'body': body_bytes,
                'more_body': False,
            }
        else:
            # No more body
            return {
                'type': 'http.disconnect',
            }
    
    # ASGI send callable
    async def send(message: Dict[str, Any]):
        if message['type'] == 'http.response.start':
            response['status'] = message['status']
            response['headers'] = _parse_asgi_headers(message.get('headers', []))
        elif message['type'] == 'http.response.body':
            body = message.get('body', b'')
            if body:
                response['body'] += body
    
    # Load and invoke the ASGI application
    try:
        # Import the user's app
        # Phase 0: Expects app.py with a FastAPI app
        import sys
        
        # Try to import from examples/counter/app.py
        if '/examples/counter' not in sys.path:
            sys.path.insert(0, '/examples/counter')
        
        # Import without reload - app is loaded once at initialization
        from app import app as asgi_app
        
        # Invoke the ASGI app
        await asgi_app(scope, receive, send)
        
    except Exception as e:
        # Error handling
        import traceback
        error_body = json.dumps({
            'error': str(e),
            'traceback': traceback.format_exc(),
        })
        response['status'] = 500
        response['headers'] = {'content-type': 'application/json'}
        response['body'] = error_body.encode('utf-8')
    
    # Convert body to list for JSON serialization, or null if empty
    body_list = list(response['body']) if response['body'] else None
    
    return {
        'status': response['status'],
        'statusText': _get_status_text(response['status']),
        'headers': response['headers'],
        'body': body_list,
    }


def apply_files(files: Dict[str, str]) -> Optional[str]:
    """Write edited starter files and re-import the app.

    Returns None on success. On failure, restores the previous files and app
    module, so the last working version keeps serving, and returns the
    traceback. New files, such as a frontend bundle's, are removed again. The
    data directory is never touched, so app data survives.
    """
    import importlib
    import os
    import sys
    import traceback

    previous = {}
    for path in files:
        try:
            with open(path) as file:
                previous[path] = file.read()
        except FileNotFoundError:
            previous[path] = None
    old_app = sys.modules.pop('app', None)
    try:
        for path, content in files.items():
            with open(path, 'w') as file:
                file.write(content)
        importlib.invalidate_caches()
        app = importlib.import_module('app')
        # Check what initialization checks: manifest and template load.
        app.response.get_manifest()
        app.response.templates.get_template('app.html')
        return None
    except BaseException as exc:
        # Show only the starter's own frames (Python files and Jinja
        # templates), not importlib's or the bridge's, then the error itself.
        frames = [f for f in traceback.extract_tb(exc.__traceback__)
                  if f.filename.startswith('/examples/counter/')]
        lines = ['Traceback (most recent call last):\n', *traceback.format_list(frames)] if frames else []
        error = ''.join(lines + traceback.format_exception_only(type(exc), exc))
        for path, content in previous.items():
            if content is None:
                os.remove(path)
                continue
            with open(path, 'w') as file:
                file.write(content)
        sys.modules.pop('app', None)
        if old_app is not None:
            sys.modules['app'] = old_app
        return error


def clear_data(directory: str) -> Optional[str]:
    """Delete the app's data and re-import it, so it recreates a fresh database."""
    import os
    import shutil

    for name in os.listdir(directory):
        path = os.path.join(directory, name)
        if os.path.isdir(path) and not os.path.islink(path):
            shutil.rmtree(path)
        else:
            os.remove(path)
    return apply_files({})


def _build_asgi_headers(headers: Dict[str, str]) -> List[tuple]:
    """Convert headers dict to ASGI format (list of byte tuples)"""
    asgi_headers = []
    for name, value in headers.items():
        # Ensure tuple, not list (JSON parsing may create lists)
        asgi_headers.append(tuple([
            name.lower().encode('latin-1'),
            value.encode('latin-1')
        ]))
    return asgi_headers


def _parse_asgi_headers(headers: List[tuple]) -> Dict[str, str]:
    """Convert ASGI headers to dict"""
    result = {}
    for name_bytes, value_bytes in headers:
        name = name_bytes.decode('latin-1')
        value = value_bytes.decode('latin-1')
        result[name] = value
    return result


def _get_status_text(status: int) -> str:
    """Get HTTP status text for status code"""
    status_texts = {
        200: 'OK',
        201: 'Created',
        204: 'No Content',
        301: 'Moved Permanently',
        302: 'Found',
        303: 'See Other',
        304: 'Not Modified',
        307: 'Temporary Redirect',
        308: 'Permanent Redirect',
        400: 'Bad Request',
        401: 'Unauthorized',
        403: 'Forbidden',
        404: 'Not Found',
        405: 'Method Not Allowed',
        422: 'Unprocessable Entity',
        500: 'Internal Server Error',
        502: 'Bad Gateway',
        503: 'Service Unavailable',
    }
    return status_texts.get(status, 'Unknown')
