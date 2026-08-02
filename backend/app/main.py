from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

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

init_app_db(ROOT)
configure_logging(ROOT)

app = FastAPI(title="Bookscape API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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
