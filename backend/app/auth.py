"""
auth.py
───────
The launch token that separates "the Bookscape window" from "any other program
on this machine that knows the port".

The API listens on 127.0.0.1, which sounds private but is not: every page in
every browser can reach a loopback port, and CORS alone cannot stop a request
being *sent* — only a reply being *read*. A DNS-rebinding attacker sidesteps
the Origin check entirely by making the request same-origin. So origin rules are
the outer fence and this token is the actual lock.

The token is a per-machine secret shared by the Tauri shell and this process,
rendezvousing through a 0600 file under backend/data (gitignored). Either side
may start first — whoever gets there creates it — so a backend the user started
by hand and a shell launched afterwards still agree.
"""

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
    """Return the shared launch token, creating it if this is the first starter.

    The env var wins, which is how the shell hands a token to the backend it
    spawns. Otherwise the file is the rendezvous. Created with O_EXCL at 0600 so
    a simultaneous start loses the race and re-reads rather than clobbering a
    token the other side has already handed out.
    """
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

        # A present-but-empty file is a crash caught mid-write. Clear it rather
        # than letting O_EXCL refuse forever over a file with nothing in it.
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
    """Reject any request that does not carry the launch token.

    Pure ASGI rather than BaseHTTPMiddleware so it also covers 404s, 405s and
    anything else the routing layer answers on its own — a rejection that only
    guards matched routes is not a rejection.

    OPTIONS is exempt because browsers never attach custom headers to a
    preflight. Requiring the token there would fail every preflight before the
    real request was ever sent. Nothing is lost: a preflight reveals only what
    the CORS policy already advertises, and the request it clears still has to
    present the token on its own.
    """

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
