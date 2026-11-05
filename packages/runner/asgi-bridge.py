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
        'root_path': '',
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
