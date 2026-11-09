from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .auth import TOKEN_HEADER, TokenAuthMiddleware, launch_token
from .db import init_app_db
from .routes import books, collections, csv_transfer, highlights, scraper, settings

# The packaged webview's per-platform origins plus the Vite dev server.
ALLOWED_ORIGINS = [
    "tauri://localhost",       # macOS / Linux, packaged
    "https://tauri.localhost",  # Windows, packaged
    "http://tauri.localhost",
    "http://127.0.0.1:5173",   # Vite dev server
    "http://localhost:5173",
]

init_app_db()

app = FastAPI(title="Bookscape API", version="0.1.0")

# Last added is outermost; CORS must be, or preflights would fail the token check.
app.add_middleware(TokenAuthMiddleware, token=launch_token())

# Blocks DNS rebinding, which Origin checks can't see: the Host header still carries the attacker's name.
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost"])
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    # No cookies; the launch token is the only authenticator.
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Content-Type", TOKEN_HEADER],
)

for module in (books, collections, csv_transfer, highlights, scraper, settings):
    app.include_router(module.router, prefix="/api")


@app.get("/health")
def health() -> dict:
    return {"ok": True}
