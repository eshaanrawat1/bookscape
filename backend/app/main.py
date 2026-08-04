from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .auth import TOKEN_HEADER, TokenAuthMiddleware, read_or_create_token
from .db import init_app_db
from .observability import configure_logging
from .repository import DataRepository
from .services.catalog import has_data
from .services.cover_worker import start_worker
from .services.reading import ReadingListStore
from .routes.catalog import create_router as create_catalog_router
from .routes.books import create_router as create_books_router
from .routes.lists import create_router as create_lists_router
from .routes.stats import create_router as create_stats_router
from .routes.sync import create_router as create_sync_router
from .routes.scraper import create_router as create_scraper_router
from .routes.settings import create_router as create_settings_router


# App setup
ROOT = Path(__file__).resolve().parents[2]
BACKEND_API_VERSION = 4

# Origins the app itself is served from: the custom protocol the packaged
# webview uses (per-platform), plus the Vite dev server. Anything else is a page
# that found the port, not the app.
ALLOWED_ORIGINS = [
    "tauri://localhost",       # macOS / Linux, packaged
    "https://tauri.localhost",  # Windows, packaged
    "http://tauri.localhost",
    "http://127.0.0.1:5173",   # Vite dev server
    "http://localhost:5173",
]

init_app_db(ROOT)
configure_logging(ROOT)

app = FastAPI(title="Bookscape API", version="0.1.0")

# Middleware order is the reverse of registration: Starlette inserts each new
# one at the front of the stack, so the LAST added ends up OUTERMOST. CORS has
# to be outermost or preflights would hit the token check first and fail — the
# browser does not attach custom headers to an OPTIONS probe.
app.add_middleware(TokenAuthMiddleware, token=read_or_create_token(ROOT))

# Blocks DNS rebinding, which is the attack Origin checks cannot see: the
# attacker points a hostname they control at 127.0.0.1, so the browser believes
# the request is same-origin and sends no Origin worth checking. The Host header
# still carries their name, and that is what this rejects.
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost"])
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    # No cookies or credentials are used; the launch token is the only
    # authenticator. Keeping this False also keeps the wildcard-origin footgun
    # from ever coming back by way of a copy-paste.
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Content-Type", TOKEN_HEADER],
)

repo = DataRepository(ROOT)
lists = ReadingListStore(ROOT)

# Create and include routers
api_router = create_catalog_router(ROOT)
api_router.include_router(create_books_router(ROOT, repo))
api_router.include_router(create_lists_router(ROOT, repo, lists))
api_router.include_router(create_stats_router(ROOT, repo))
api_router.include_router(create_sync_router(ROOT))
api_router.include_router(create_scraper_router(ROOT))
api_router.include_router(create_settings_router(ROOT, repo))

app.include_router(api_router, prefix="/api")

# Fills in cover colors for newly imported books in the background. Started
# after the routes so a slow first claim cannot delay the health check the
# Tauri shell waits on.
start_worker(ROOT)


@app.get("/health")
@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "has_data": has_data(ROOT), "backend_api_version": BACKEND_API_VERSION}
