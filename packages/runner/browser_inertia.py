"""Browser-only integration for the published CrossInertia package.

CrossInertia 0.22.1 has no explicit production-mode option. Override only its
runtime detection, not rendering/protocol behavior. Remove this subclass once
an upstream runtime-mode option is released.
"""

from typing import Any

from cross_inertia.fastapi import InertiaResponse


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
