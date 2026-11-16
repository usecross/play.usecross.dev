"""Browser-only settings for the published CrossInertia package.

Starters use CrossInertia as documented: InertiaDep and its default settings.
CrossInertia 0.22 has no explicit production-mode option, and its asset URLs
ignore the ASGI root_path the preview is mounted at. Change only runtime
detection and that prefix, not rendering or protocol behavior. Remove this
once upstream supports both.
"""

from typing import Any

from cross_inertia import configure_inertia
from cross_inertia._core import reset_inertia_response
from cross_inertia.fastapi import InertiaResponse, get_inertia_response
from starlette.requests import Request

_render = InertiaResponse.render


def _is_dev_mode(self: InertiaResponse) -> bool:
    # Never probe for a Vite dev server: the preview has no sockets.
    return False


def _render_under_mount(self: InertiaResponse, request: Request, *args: Any, **kwargs: Any) -> Any:
    # Starter code keeps root-relative asset URLs, like an app served at /.
    # Prefix them with the mount (root_path) for this render only; the worker
    # handles one request at a time.
    prefix = self.asset_url_prefix
    self.asset_url_prefix = request.scope.get("root_path", "") + prefix
    try:
        return _render(self, request, *args, **kwargs)
    finally:
        self.asset_url_prefix = prefix


def install() -> None:
    """Apply the browser settings before the starter imports CrossInertia."""
    # An explicit port also avoids the automatic port scan, which needs sockets.
    configure_inertia(vite_port=5173)
    InertiaResponse.is_dev_mode = _is_dev_mode
    InertiaResponse.render = _render_under_mount


def reload() -> None:
    """Load the edited template and new manifest, failing as a missing build would.

    The renderer caches both, and it outlives the starter's module. After a
    failure, the next request makes a new one from the restored files.
    """
    reset_inertia_response()
    try:
        response = get_inertia_response()
        response.get_manifest()
        response.templates.get_template("app.html")
    except BaseException:
        reset_inertia_response()
        raise
