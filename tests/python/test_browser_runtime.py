"""Native regression tests for the exact same upstream wheel used by Pyodide."""

import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "packages" / "runner"))
sys.path.insert(0, str(ROOT / "examples" / "counter"))

import cross_inertia
from app import get_counter
from browser_inertia import BrowserInertiaResponse
from cross_inertia.fastapi import InertiaResponse
from starlette.requests import Request


class BrowserRuntimeTests(unittest.IsolatedAsyncioTestCase):
    async def test_real_renderer_works_without_threads_or_runtime_probes(self):
        scope = {
            "type": "http", "method": "GET", "scheme": "https",
            "path": "/preview/counter", "root_path": "/preview",
            "query_string": b"", "headers": [(b"host", b"play.example"), (b"x-inertia", b"true")],
            "server": ("play.example", 443),
        }
        with (
            patch("threading.Thread.start", side_effect=AssertionError("No threads in Pyodide")) as threads,
            patch("httpx.get", side_effect=AssertionError("No Vite probe")) as probe,
            patch("cross_inertia._config.find_available_port", side_effect=AssertionError("No port scan")) as ports,
        ):
            response = BrowserInertiaResponse()
            self.assertIsInstance(response, InertiaResponse)
            self.assertFalse(response.is_dev_mode())
            self.assertFalse(response.ssr_enabled)
            rendered = await get_counter(Request(scope))
            self.assertEqual(rendered.status_code, 200)
            self.assertEqual(rendered.headers["X-Inertia"], "true")
            page = json.loads(rendered.body)
            self.assertEqual(page["url"], "/preview/counter")
            self.assertEqual(page["props"], {"count": 0, "errors": {}})

            scope["headers"] = [(b"host", b"play.example")]
            html = await get_counter(Request(scope))
            self.assertIn(b'script data-page="app"', html.body)
            self.assertIn(b'/preview/static/build/assets/app.js', html.body)
            self.assertIn(b'/preview/static/build/assets/app.css', html.body)
            threads.assert_not_called()
            probe.assert_not_called()
            ports.assert_not_called()
        runtime = json.loads((ROOT / "packages/starters/runtime.json").read_text())
        self.assertEqual(cross_inertia.__version__, runtime["crossInertia"]["version"])


if __name__ == "__main__":
    unittest.main()
