"""Launch token: the real lock on the loopback API, since origin rules can't stop DNS rebinding."""

from __future__ import annotations

import os
import secrets

from starlette.datastructures import Headers
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

TOKEN_ENV_VAR = "BOOKSCAPE_API_TOKEN"
TOKEN_HEADER = "x-bookscape-token"


def launch_token() -> str:
    """The token Tauri generated for this launch; set the env var yourself to run the backend by hand.

    Taken out of the environment so the scraper and its browser never inherit it.
    """
    token = os.environ.pop(TOKEN_ENV_VAR, "").strip()
    if not token:
        raise RuntimeError(f"{TOKEN_ENV_VAR} is not set")
    return token


class TokenAuthMiddleware:
    """Require the launch token. Pure ASGI so 404s/405s are covered; preflights are exempt."""

    def __init__(self, app: ASGIApp, token: str) -> None:
        self.app = app
        self.token = token.encode("utf-8")

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] == "OPTIONS":
            await self.app(scope, receive, send)
            return

        presented = Headers(scope=scope).get(TOKEN_HEADER, "").encode("utf-8")
        if not secrets.compare_digest(presented, self.token):
            response = JSONResponse(
                {"detail": "missing or invalid API token"},
                status_code=401,
            )
            await response(scope, receive, send)
            return

        await self.app(scope, receive, send)
