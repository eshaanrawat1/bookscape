from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .auth import TOKEN_HEADER, TokenAuthMiddleware, read_or_create_token
from .db import init_app_db
from .repository import DataRepository
from .services.collections import CollectionStore
from .services.highlights import HighlightStore
from .routes.books import create_router as create_books_router
from .routes.collections import create_router as create_collections_router
from .routes.highlights import create_router as create_highlights_router
from .routes.sync import create_router as create_sync_router
from .routes.scraper import create_router as create_scraper_router
from .routes.settings import create_router as create_settings_router


ROOT = Path(__file__).resolve().parents[2]
BACKEND_API_VERSION = 7

# The packaged webview's per-platform origins plus the Vite dev server.
ALLOWED_ORIGINS = [
    "tauri://localhost",       # macOS / Linux, packaged
    "https://tauri.localhost",  # Windows, packaged
    "http://tauri.localhost",
    "http://127.0.0.1:5173",   # Vite dev server
    "http://localhost:5173",
]

init_app_db(ROOT)

app = FastAPI(title="Bookscape API", version="0.1.0")

# Last added is outermost; CORS must be, or preflights would fail the token check.
app.add_middleware(TokenAuthMiddleware, token=read_or_create_token(ROOT))

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

repo = DataRepository(ROOT)
collections = CollectionStore(ROOT)
highlights = HighlightStore(ROOT)

# Create and include routers
api_router = APIRouter()
api_router.include_router(create_books_router(ROOT, repo))
api_router.include_router(create_collections_router(ROOT, collections))
api_router.include_router(create_highlights_router(ROOT, highlights))
api_router.include_router(create_sync_router(ROOT))
api_router.include_router(create_scraper_router(ROOT))
api_router.include_router(create_settings_router(repo))

app.include_router(api_router, prefix="/api")


@app.get("/health")
def health() -> dict:
    return {"ok": True, "backend_api_version": BACKEND_API_VERSION}
