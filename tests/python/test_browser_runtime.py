"""Native regression tests for the exact same upstream wheels used by Pyodide."""

import json
import os
import sys
import tempfile
import tomllib
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
STARTER = ROOT / "examples" / os.environ.get("PLAYGROUND_STARTER", "tasks")
# The starter keeps its SQLite database here; the browser uses an IDBFS mount.
os.environ["PLAYGROUND_DATA_DIR"] = tempfile.mkdtemp()
sys.path.insert(0, str(ROOT / "packages" / "runner"))
sys.path.insert(0, str(STARTER))

import importlib.util

import browser_inertia
import cross_inertia

# asgi-bridge.py has a dash, as the worker downloads it under that name.
spec = importlib.util.spec_from_file_location("asgi_bridge", ROOT / "packages" / "runner" / "asgi-bridge.py")
asgi_bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(asgi_bridge)


def request(path: str, root_path: str = "/preview", method: str = "GET", body: object = None, **headers: str) -> dict:
    return {
        "method": method, "url": f"https://play.example{root_path}{path}", "rootPath": root_path,
        "headers": {"host": "play.example", **headers},
        "body": list(json.dumps(body).encode()) if body is not None else None,
    }


class BrowserRuntimeTests(unittest.IsolatedAsyncioTestCase):
    async def test_starter_runs_through_the_bridge_without_threads_or_probes(self):
        with (
            patch("threading.Thread.start", side_effect=AssertionError("No threads in Pyodide")) as threads,
            patch("httpx.get", side_effect=AssertionError("No Vite probe")) as probe,
            patch("cross_inertia._config.find_available_port", side_effect=AssertionError("No port scan")) as ports,
        ):
            # As the worker starts it: browser settings first, then the starter from its folder.
            browser_inertia.install()
            os.chdir(STARTER)
            import app  # noqa: F401

            browser_inertia.reload()

            # A sync route with InertiaDep, a sync dependency, renders.
            json_page = await asgi_bridge.handle_http_request(request("/tasks", **{"x-inertia": "true"}))
            self.assertEqual(json_page["status"], 200, bytes(json_page["body"]))
            self.assertEqual(json_page["headers"]["x-inertia"], "true")
            page = json.loads(bytes(json_page["body"]))
            self.assertEqual(page["url"], "/preview/tasks")
            self.assertEqual(page["component"], "Tasks/Index")
            self.assertEqual(page["props"]["counts"], {"total": 4, "open": 3, "done": 1})
            self.assertEqual(len(page["props"]["tasks"]), 4)
            self.assertEqual(page["props"]["root_path"], "/preview")

            # A rejected form redirects back, and the next page gets the
            # errors through the session cookie (SessionMiddleware).
            # Without a Referer, "back" is the last page in the session.
            cookie = json_page["headers"]["set-cookie"].split(";")[0]
            invalid = await asgi_bridge.handle_http_request(request(
                "/tasks", method="POST", body={"title": "  "}, cookie=cookie,
                **{"x-inertia": "true", "content-type": "application/json"},
            ))
            self.assertEqual(invalid["status"], 303, bytes(invalid["body"] or b""))
            self.assertEqual(invalid["headers"]["location"], "/preview/tasks")
            cookie = invalid["headers"]["set-cookie"].split(";")[0]
            errors = await asgi_bridge.handle_http_request(request("/tasks", cookie=cookie, **{"x-inertia": "true"}))
            self.assertEqual(json.loads(bytes(errors["body"]))["props"]["errors"], {"title": "Give the task a title."})

            # scripts/test-python.ts builds the frontend first, as `vite build` would.
            manifest = json.loads((STARTER / "static/build/.vite/manifest.json").read_text())
            entry = manifest["frontend/app.tsx"]
            html = bytes((await asgi_bridge.handle_http_request(request("/tasks")))["body"])
            self.assertIn(b'script data-page="app"', html)
            self.assertIn(f'/preview/static/build/{entry["file"]}'.encode(), html)
            self.assertIn(f'/preview/static/build/{entry["css"][0]}'.encode(), html)

            # Asset URLs follow the mount; the starter itself has no /preview.
            root = bytes((await asgi_bridge.handle_http_request(request("/tasks", root_path="")))["body"])
            self.assertIn(f'src="/static/build/{entry["file"]}"'.encode(), root)
            self.assertNotIn(b"/preview", root)

            # app.frontend() serves the build, and a missing asset is a 404, not a page.
            asset = await asgi_bridge.handle_http_request(request(f"/static/build/{entry['file']}"))
            self.assertEqual(asset["status"], 200)
            self.assertIn("javascript", asset["headers"]["content-type"])
            self.assertEqual(bytes(asset["body"]), (STARTER / "static/build" / entry["file"]).read_bytes())
            missing = await asgi_bridge.handle_http_request(request("/static/build/assets/missing.js", accept="text/html"))
            self.assertEqual(missing["status"], 404)

            threads.assert_not_called()
            probe.assert_not_called()
            ports.assert_not_called()
        starter = tomllib.loads((STARTER / "pyproject.toml").read_text())
        self.assertIn(
            f"cross-inertia=={cross_inertia.__version__}", starter["project"]["dependencies"]
        )


if __name__ == "__main__":
    unittest.main()
