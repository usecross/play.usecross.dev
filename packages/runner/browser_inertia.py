"""Browser-only integration for the published CrossInertia package.

CrossInertia 0.22 has no explicit production-mode option, and its asset URLs
ignore the ASGI root_path the preview is mounted at. Override only runtime
detection and that prefix, not rendering/protocol behavior. Remove this
subclass once upstream supports both.
"""

from typing import Any

from cross_inertia.fastapi import InertiaResponse
from starlette.requests import Request


class BrowserInertiaResponse(InertiaResponse):
    """Use the real manifest/template renderer without sockets, HTTP probes or SSR."""

    def __init__(self, **kwargs: Any) -> None:
        # An explicit URL also avoids config.vite_dev_url's automatic port scan.
        super().__init__(
            vite_dev_url="http://localhost:5173",
            ssr_enabled=False,
            **kwargs,
        )

    def is_dev_mode(self) -> bool:
        return False

    def render(self, request: Request, *args: Any, **kwargs: Any) -> Any:
        # Starter code keeps root-relative asset URLs, like an app served at /.
        # Prefix them with the mount (root_path) for this render only; the
        # worker handles one request at a time.
        prefix = self.asset_url_prefix
        self.asset_url_prefix = request.scope.get("root_path", "") + prefix
        try:
            return super().render(request, *args, **kwargs)
        finally:
            self.asset_url_prefix = prefix
