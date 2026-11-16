"""Native regression tests for the exact same upstream wheel used by Pyodide."""

import json
import os
import sys
import tempfile
import tomllib
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
# The starter keeps its SQLite database here; the browser uses an IDBFS mount.
os.environ["PLAYGROUND_DATA_DIR"] = tempfile.mkdtemp()
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
            # scripts/test-python.ts builds the frontend first, as `vite build` would.
            manifest = json.loads((ROOT / "examples/counter/static/build/.vite/manifest.json").read_text())
            entry = manifest["frontend/app.tsx"]
            self.assertIn(b'script data-page="app"', html.body)
            self.assertIn(f'/preview/static/build/{entry["file"]}'.encode(), html.body)
            self.assertIn(f'/preview/static/build/{entry["css"][0]}'.encode(), html.body)

            # Asset URLs follow the mount; the starter itself has no /preview.
            root = await get_counter(Request({**scope, "path": "/counter", "root_path": ""}))
            self.assertIn(f'src="/static/build/{entry["file"]}"'.encode(), root.body)
            self.assertNotIn(b"/preview", root.body)
            threads.assert_not_called()
            probe.assert_not_called()
            ports.assert_not_called()
        starter = tomllib.loads((ROOT / "examples/counter/pyproject.toml").read_text())
        self.assertIn(
            f"cross-inertia=={cross_inertia.__version__}", starter["project"]["dependencies"]
        )


if __name__ == "__main__":
    unittest.main()
