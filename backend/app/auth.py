"""Launch token: the real lock on the loopback API, since origin rules can't stop DNS rebinding."""

from __future__ import annotations

import os
import secrets
from pathlib import Path

from starlette.datastructures import Headers
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

TOKEN_ENV_VAR = "BOOKSCAPE_API_TOKEN"
TOKEN_FILENAME = ".api-token"
TOKEN_HEADER = "x-bookscape-token"

_CREATE_ATTEMPTS = 3


def token_path(root: Path) -> Path:
    return root / "backend" / "data" / TOKEN_FILENAME


def read_or_create_token(root: Path) -> str:
    """Return the shared token, creating it at 0600 with O_EXCL if absent; the env var wins."""
    env_token = os.getenv(TOKEN_ENV_VAR, "").strip()
    if env_token:
        return env_token

    path = token_path(root)
    path.parent.mkdir(parents=True, exist_ok=True)

    for _ in range(_CREATE_ATTEMPTS):
        try:
            existing = path.read_text(encoding="utf-8").strip()
        except FileNotFoundError:
            existing = ""
        if existing:
            return existing

        # An empty file is a crash caught mid-write; clear it or O_EXCL refuses forever.
        path.unlink(missing_ok=True)

        token = secrets.token_urlsafe(32)
        try:
            handle = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            continue
        with os.fdopen(handle, "w", encoding="utf-8") as fh:
            fh.write(token)
        return token

    raise RuntimeError(f"could not establish an API token at {path}")


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
